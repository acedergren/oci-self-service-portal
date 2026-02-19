# Production Readiness Report — CloudNow Portal

**Date**: 2026-02-19
**Reviewers**: Security, Observability, Performance, Quality, Testing
**Scope**: Full monorepo — `apps/frontend`, `apps/api`, `packages/*`
**Baseline**: 1619/1622 API tests passing; 938/942 frontend tests passing

---

## Executive Summary

**Recommendation: DO NOT SHIP — fix 7 critical items first.**

CloudNow has strong structural security (100% SQL bind-parameter coverage across audited repos, RBAC on all routes, HMAC-signed webhooks) and solid infrastructure (bounded Oracle pool, LLM token guardrails, graceful shutdown). However, deep-dive analysis by 10 specialist agents revealed **7 critical blockers** spanning security, performance, and correctness that must be resolved before production deployment.

**Critical blockers summary:** auth secret bypass (security), 2 IDOR gaps (security), N+1 loops on chat hot path (performance/reliability), unbounded memory leak in stream bus (reliability), potential SQL injection in findings repository (security — needs verification), and a test infrastructure gap causing cascade CI failures.

---

## Quality Gate Results

| Gate                  | Status       | Detail                                         |
| --------------------- | ------------ | ---------------------------------------------- |
| API Tests             | ⚠️ 1619/1622 | 3 pre-existing failures (auth edge cases)      |
| Frontend Tests        | ⚠️ 938/942   | 2 pre-existing failures (Phase 8 timeouts)     |
| TypeScript (API)      | ✅ Clean     | 0 errors                                       |
| TypeScript (Frontend) | ✅ Clean     | 0 svelte-check errors                          |
| Lint (API)            | ✅ Clean     | 0 ESLint errors                                |
| Semgrep               | ✅ Clean     | 0 security findings                            |
| SQL Injection         | ✅ Clean     | 14 repository files audited, 0 vulnerabilities |
| Cross-app imports     | ✅ Clean     | No boundary violations detected                |
| Debug statements      | ✅ Clean     | No console.log in production code              |
| Route coverage        | ⚠️ 24/25     | `cloud-advisor.ts` route has no test file      |
| Workflow coverage     | ⚠️ 1/4       | `classify-intent`, `correct`, `query` untested |

**Pre-existing test failures:**

- API: `audit.test.ts`, `admin-rbac.test.ts`, `cors.test.ts` — mock factory registration order issues
- Frontend: `phase8/integration.test.ts` (hook timeout 10s), `phase8/webhooks.test.ts` (test timeout 5s)

---

## Critical Blockers (must fix before production deploy)

### [CRITICAL-1] `BETTER_AUTH_SECRET` hardcoded fallback silently runs in production

**Source**: Security reviewer
**File**: `packages/server/src/auth/config.ts:102`, `apps/frontend/src/hooks.server.ts:23-24`
**Risk**: Auth secret uses `|| 'dev-build-only-secret'`. The frontend hooks only `log.error()` — they do not halt startup. The Fastify API has **no check at all**. An attacker who knows this default can forge session tokens and decrypt AES-256-GCM webhook secrets (which derive their key from `BETTER_AUTH_SECRET`). Complete auth bypass + credential exposure.
**Effort**: S (< 1h)
**Fix**:

```typescript
// apps/frontend/src/hooks.server.ts — change log.error → throw
if (!env.BETTER_AUTH_SECRET) {
	throw new Error('BETTER_AUTH_SECRET is required in production');
}

// apps/api/src/app.ts or plugins/auth.ts — add startup guard
if (process.env.NODE_ENV === 'production' && !process.env.BETTER_AUTH_SECRET) {
	throw new Error('BETTER_AUTH_SECRET is required in production');
}
```

---

### [CRITICAL-2] Chat approval IDOR guard bypassed when Oracle is unavailable

**Source**: Security reviewer
**File**: `apps/api/src/routes/chat.ts:163`
**Risk**: The IDOR guard for `intent === 'approval'` is conditional on Oracle being available and orgId being non-null. When either is false (DB outage, user without active org), the code falls through and **resumes any workflow run without ownership verification**. The `targetRunId` comes from LLM classification of user-supplied text.
**Effort**: S (< 1h)
**Fix**: Make the guard mandatory — deny if check cannot be performed:

```typescript
if (!orgId || !fastify.hasDecorator('oracle') || !fastify.oracle.isAvailable()) {
	clearTimeout(timeout);
	reply.raw.writeHead(403, { 'Content-Type': 'application/json' });
	reply.raw.write(JSON.stringify({ error: 'Cannot verify workflow ownership' }));
	reply.raw.end();
	return;
}
const runRepo = createWorkflowRunRepository(fastify.oracle.withConnection);
const existingRun = await runRepo.getByIdForUser(targetRunId, userId, orgId);
```

---

### [CRITICAL-3] N+1 query loops on the chat hot path

**Source**: Performance reviewer (deep-dive)
**Files**: `apps/api/src/mastra/storage/oracle-store.ts:709-735` (saveMessages), `:737-803` (updateMessages)
**Risk**: Every chat message triggers individual INSERT/SELECT+UPDATE in a `for` loop. A conversation with 50 messages = 50-100 Oracle round-trips per save. Under production load, this will saturate the connection pool (max 10) and make the chat feature unusable.
**Effort**: M-L (batch INSERT ALL / MERGE INTO with multi-row source)
**Fix**: Replace per-row loops with Oracle `INSERT ALL ... SELECT FROM DUAL` for inserts, and batch `MERGE INTO ... USING (SELECT FROM DUAL UNION ALL ...)` for updates.

---

### [CRITICAL-4] Unbounded `latestStatusByRun` Map — memory leak

**Source**: Performance reviewer (deep-dive)
**File**: `apps/api/src/services/workflow-stream-bus.ts:25,29`
**Risk**: Every workflow run adds an entry to `latestStatusByRun`. No eviction policy exists. `clearWorkflowStreamState()` is only called in tests. Over days/weeks of operation, this Map grows unbounded, causing eventual OOM. `setMaxListeners(0)` on the same emitter also disables Node.js leak warnings — compounding the risk.
**Effort**: S
**Fix**:

```typescript
// Add TTL-based eviction to latestStatusByRun:
setInterval(() => {
	const cutoff = Date.now() - 24 * 60 * 60 * 1000;
	for (const [key, val] of latestStatusByRun) {
		if (val.ts < cutoff) latestStatusByRun.delete(key);
	}
}, 60_000).unref();

// Change setMaxListeners(0) to a reasonable cap:
emitter.setMaxListeners(1000);
```

---

### [CRITICAL-5] Potential SQL injection in `updateFindingStatus` — needs verification

**Source**: Test coverage reviewer (deep-dive)
**File**: `apps/api/src/services/findings-repository.ts:232-233`
**Risk**: `updateFindingStatus()` constructs SQL using `JSON_MERGEPATCH` with a `note` parameter that may use string interpolation rather than bind parameters. The SQL injection audit covered 14 specific repository files — `findings-repository.ts` was **not in scope**. If the note value is interpolated rather than bound, an attacker with `tools:execute` permission could inject SQL via the CloudAdvisor findings API.
**Effort**: S (verify and fix if needed — convert to bind parameter if interpolated)
**Action**: Audit `findings-repository.ts` immediately; fix before deploy if string interpolation confirmed.

---

### [CRITICAL-6] Missing `app.close()` in 3 test files causes cascade timeouts

**Source**: Test coverage reviewer (deep-dive)
**Files**: `apps/api/src/tests/routes/webhooks.test.ts`, `mcp-admin-routes.test.ts`, `search.test.ts`
**Risk**: These 3 test files start Fastify instances but never call `app.close()` in `afterEach`. Each test run leaks ~130 Fastify instances into the process, exhausting file descriptors and causing the known timeout failures in `app-factory.test.ts`, `health-endpoint.test.ts`, and `auth-middleware.test.ts` when the full suite runs.
**Effort**: S (30 min — add `afterEach(() => app.close())` to 3 files)

---

## High Priority (fix within first sprint post-launch)

### [HIGH-1] MCP admin routes bypass IDOR when orgId is null

**Source**: Security reviewer
**File**: `apps/api/src/routes/admin/mcp.ts` — lines 209-212, 328-330, and 10+ other locations
**Risk**: Pattern `if (orgId && existing.orgId !== orgId)` means an admin without an active org selected can read, modify, delete, and connect to **any organization's MCP servers**, including decrypted credentials. Cross-tenant isolation breach in multi-tenant deployments.
**Effort**: M (2-4h — update 12 locations)
**Fix**: Change to fail-closed:

```typescript
const orgId = resolveOrgId(request);
if (!orgId) throw new ValidationError('Organization context required');
if (existing.orgId !== orgId) throw new NotFoundError(...);
```

---

### [HIGH-2] Fire-and-forget workflow invocation without error handler

**Source**: Observability reviewer
**File**: `apps/api/src/routes/chat.ts:140`
**Risk**: `void actionRun.start({...})` — if the Charlie action workflow encounters an unhandled rejection during async execution, it silently fails with no notification to the frontend or structured logging.
**Effort**: M (2h)
**Fix**:

```typescript
actionRun.start({ inputData: { ... } }).catch(err => {
  request.log.error({ err, runId: actionRun.runId }, 'Charlie action workflow failed');
  emitWorkflowStatus(actionRun.runId, 'failed', { error: 'Workflow initialization failed' });
});
```

---

### [HIGH-3] Compensation failures silently swallowed

**Source**: Observability reviewer
**File**: `apps/api/src/mastra/workflows/charlie/action.ts:344`
**Risk**: When saga rollback runs during a tool failure, any error during compensation is caught and silently discarded — no logging, no event emission. Operators cannot detect failed rollbacks, leaving cloud resources in partially-committed states.
**Effort**: M (2h)
**Fix**: Log compensation results and emit a structured event:

```typescript
} catch (compensationErr) {
  request.log.error({ err: compensationErr, runId }, 'Compensation failed');
  emitWorkflowStep(runId, 'error', 'compensate', 'tool-call', { error: compensationErr.message });
}
```

---

### [HIGH-3b] Valkey cache built but completely unused

**Source**: Performance reviewer (deep-dive)
**Files**: `apps/api/src/plugins/cache.ts`, `apps/api/src/services/cache.ts`
**Risk**: The entire Valkey cache infrastructure (CacheService, getOrFetch pattern, namespace TTLs, graceful degradation) is registered as a Fastify decorator but **no production route or repository ever calls it**. Every request hits Oracle directly. `getEnabledModelIds()` — called on every `POST /api/chat` — queries Oracle each time even though model config changes rarely. Additionally, `reloadProviderRegistry()` is never called from admin CRUD handlers, so AI provider changes require an app restart.
**Effort**: M (wire existing cache to hot paths; add invalidation calls)
**Fix**: Add `fastify.cache.getOrFetch()` for `getEnabledModelIds()` (5 min TTL), `settingsRepository.getPublic()` (30 min TTL), `mcpServerRepository.getCatalog()` (30 min TTL). Call `reloadProviderRegistry()` in AI provider create/update/delete handlers.

---

### [HIGH-4] Raw `Error()` throws bypass PortalError hierarchy

**Source**: Observability reviewer
**Files**: `apps/api/src/routes/workflows.ts:92`, `apps/api/src/routes/cloud-advisor.ts:62`
**Risk**: Oracle unavailability throws plain `new Error('Database not available')` which bypasses the structured error hierarchy, reaching the global handler as an untyped "Unhandled error".
**Effort**: S (30 min)
**Fix**: `throw new DatabaseError('Oracle connection required for workflows');`

---

## Medium Priority (fix within first month)

### [MEDIUM-1] Session continue allows null-userId legacy sessions

**Source**: Security reviewer
**File**: `apps/api/src/routes/sessions.ts:217`
**Risk**: `if (session.userId && session.userId !== userId)` — sessions with `userId = null` short-circuit to false. Any authenticated user can hijack orphaned sessions.
**Fix**: Invert to deny-by-default: `if (!session.userId || session.userId !== userId)`

---

### [MEDIUM-2] MCP HTTP/SSE URLs not validated for SSRF

**Source**: Security reviewer
**File**: `apps/api/src/services/mcp-connection-manager.ts:631-658`
**Risk**: `server.config.url` passed directly to `new URL()` without SSRF validation. Webhooks go through `isValidExternalUrl()` but MCP URLs do not. An admin could point to `169.254.169.254` (cloud metadata).
**Fix**: Validate through `isValidExternalUrl()` before connecting any non-stdio transport.

---

### [MEDIUM-3] MCP stdio allows arbitrary command execution by admins

**Source**: Security reviewer
**File**: `apps/api/src/services/mcp-connection-manager.ts:626-629`
**Risk**: `server.config.command` passed from DB to subprocess without validation. Admin could set `command: '/bin/sh'` with malicious args. RCE surface for any admin user.
**Fix**: Allowlist valid commands (`npx`, `node`, `uvx`, `python3`) and validate args against `/^[a-z0-9/_.\- ]+$/i`.

---

### [MEDIUM-4] Setup AI provider test endpoint missing authentication

**Source**: Security reviewer
**File**: `apps/api/src/routes/setup.ts:305-357`
**Risk**: `POST /api/setup/ai-provider/test` has no `preHandler` — no `requireAuth()` or `requireSetupToken`. Before setup is complete, unauthenticated attackers can probe AI provider configs.
**Fix**: Add `preHandler: requireSetupToken` to match other setup endpoints.

---

### [MEDIUM-5] CloudAdvisor analysis endpoint missing org scoping

**Source**: Security reviewer
**File**: `apps/api/src/routes/cloud-advisor.ts:75-93`
**Risk**: `POST /api/cloud-advisor/analyse` calls `triggerAnalysis()` with a hardcoded compartment, not the user's org context. Findings stored without org scoping — cross-org data pollution risk.
**Fix**: Resolve and pass `orgId` to `triggerAnalysis()`. Add `if (!orgId) return reply.code(400)...`.

---

### [MEDIUM-6] Unbounded SELECT queries in IDP and auth adapter

**Source**: Performance reviewer
**Files**: `packages/server/src/admin/idp-repository.ts:153, :228`, `packages/server/src/auth/oracle-adapter.ts:357, :419`
**Risk**: Full table scans on large datasets. Auth hot path affected.
**Fix**: Add `FETCH FIRST 1 ROW ONLY` to `findOne` queries; `FETCH FIRST 500 ROWS ONLY` to list queries.

---

### [MEDIUM-7] Session refresh doesn't invalidate on org membership revocation

**Source**: Security reviewer
**File**: `packages/server/src/auth/config.ts:170-173`
**Risk**: Revoked admin retains access for up to 24 hours after removal (session `updateAge: 60*60*24`).
**Fix**: Reduce `updateAge` to 1 hour; consider flagging sessions for immediate invalidation when membership changes.

---

### [MEDIUM-8] console.warn() used in production workflow code

**Source**: Observability reviewer
**File**: `apps/api/src/mastra/workflows/charlie/action.ts:324`
**Risk**: Missing compensation warnings go to container stdout, bypassing Pino/Sentry.
**Fix**: Replace with `emitWorkflowStep(runId, 'warning', ...)` call.

---

## Low Priority / Tech Debt (backlog)

### [LOW-1] CORS origin not validated in production startup

**Source**: Security reviewer
**File**: `apps/api/src/plugins/cors.ts:11`
**Fix**: Add startup guard: if `NODE_ENV === 'production' && corsOrigin === '*'`, throw.

---

### [LOW-2] AI provider routes not org-scoped (intentionally global)

**Source**: Security reviewer
**File**: `apps/api/src/routes/admin/ai-providers.ts:52-62`
**Note**: Document as intentionally global with appropriate trust boundaries, or add `orgId` scoping.

---

### [LOW-3] Unbounded MCP tool/resource cache queries

**Source**: Performance reviewer
**Files**: `packages/server/src/admin/mcp-repository.ts:638, :695`
**Fix**: Add `FETCH FIRST 1000 ROWS ONLY` to `getCachedTools()`; `FETCH FIRST 5000 ROWS ONLY` to `getCachedResources()`.

---

### [LOW-4] SSE stream timeout not configurable

**Source**: Performance reviewer
**File**: `apps/api/src/routes/workflows.ts:580-584`
**Fix**: `const SSE_TIMEOUT_MS = parseInt(process.env.SSE_TIMEOUT_MS ?? '300000', 10);` — document client retry strategy.

---

### [LOW-5] Rate limiting missing workflow streaming endpoint variants

**Source**: Performance reviewer
**File**: `apps/api/src/plugins/rate-limiter-oracle.ts:28-31`
**Fix**: Add `/api/v1/workflows` to endpoint category map at lower limit (40 req/min) than general API.

---

### [LOW-6] Compute tool SDK migration TODOs (3 tools)

**Source**: Quality reviewer
**File**: `packages/shared/src/tools/categories/compute.ts:286, :327, :350`
**Note**: Awaiting OCI SDK v6 `computeinstanceagent` client. Functionally correct today via CLI fallback. Create Phase 11+ tech debt card.

---

### [LOW-7] CloudAdvisor multi-cloud integration TODOs

**Source**: Quality reviewer
**Files**: `apps/api/src/mastra/workflows/cloud-advisor/security-analysis.ts:89`, `right-sizing.ts:92`, `cost-analysis.ts:101`
**Note**: OCI-only today. AWS/Azure integration requires L effort (separate SDK integrations). Evaluate for Phase 11 if multi-cloud is prioritized.

---

### [LOW-8] Untracked Mastra discovery documentation

**Source**: Quality reviewer
**Files**: `apps/api/src/mastra/MASTRA-DISCOVERY.md`, `MCP-DISCOVERY.md`, `PATTERNS.md`, `README.md`
**Fix**: Either `git add` and commit to `docs/` directory, or add `apps/api/src/mastra/*.md` to `.gitignore`.

---

### [LOW-9] `cloud-advisor.ts` route has no test file

**Source**: Test reviewer
**File**: `apps/api/src/routes/cloud-advisor.ts`
**Note**: Only uncovered route in the entire API. Silent failures in cost/right-sizing analysis would go undetected. Create `tests/routes/cloud-advisor.test.ts` with `buildTestApp` + auth + happy path. **Effort: S**

---

### [LOW-10] Charlie classify-intent, correct, query workflows have no tests

**Source**: Test reviewer
**Files**: `apps/api/src/mastra/workflows/charlie/classify-intent.ts`, `correct.ts`, `query.ts`
**Note**: Wrong intent classification could route destructive operations through read-only workflow path. Use counter-based mock pattern for sequential LLM responses. **Effort: M-L**

---

### [LOW-11] Pre-existing frontend test failures (Phase 8)

**Source**: Test baseline
**Files**: `apps/frontend/src/tests/phase8/integration.test.ts`, `phase8/webhooks.test.ts`
**Note**: Hook timeout and test timeout. Fix: move expensive setup to `beforeAll`, increase timeout, mock webhook HTTP dispatch. Unrelated to current work. Fix as Phase 11 test hygiene.

---

### [LOW-12] 23 ad-hoc error responses in `workflows.ts` bypass PortalError

**Source**: Error consistency sub-agent
**File**: `apps/api/src/routes/workflows.ts` (lines 173, 221, 247, 256, 279, 285, 305, 315, 338, 348, 444, 483, 490, 492, 604, 610, 719, 779, 890, 924, 933, 979+)
**Risk**: Three distinct error shapes exist across routes — `PortalError.toResponseBody()`, `{ error: string }`, and `{ error, code, message }`. The global error handler catches thrown errors correctly, but these `reply.send()` calls bypass it entirely, producing inconsistent shapes that complicate frontend error handling.
**Fix**: Replace ad-hoc `reply.code(4xx).send({ error: '...' })` with `throw new ValidationError(...)` or `throw new NotFoundError(...)` — let the global handler serialize via `toResponseBody()`. **Effort: M**

---

### [LOW-13] Health endpoint missing Mastra and Valkey checks

**Source**: Health endpoint sub-agent
**File**: `apps/api/src/routes/health.ts`, `packages/server/src/health.ts`
**Risk**: The `/health` readiness probe checks Oracle, OCI CLI, Sentry, and Prometheus — but not the Mastra workflow engine or Valkey cache. A degraded Mastra instance returns 200 healthy while Charlie is non-functional.
**Missing items**: Mastra plugin availability check, Valkey connectivity verification, `/startup` probe for K8s slow-boot scenarios (Oracle migrations take 15-30s on first boot).
**Fix**: Add `checks.mastra` using `fastify.hasDecorator('mastra')` + basic capability check; add `checks.cache` using `fastify.cache.get('__healthcheck__')`; add `/api/startup` endpoint. **Effort: M**

---

### [LOW-14] No workflow/job/webhook cancellation on graceful shutdown

**Source**: Health endpoint sub-agent
**File**: `apps/api/src/app.ts:356-364`
**Risk**: SIGTERM drains HTTP connections and closes Oracle/Valkey — but long-running Mastra workflows are not signaled, scheduled cron jobs are not cancelled, and pending webhook deliveries are not flushed. Workflows in-progress at shutdown will be orphaned (status stuck as "running").
**Fix**: Add `onClose` hooks for Mastra workflow cancellation, schedule plugin shutdown, and webhook queue flush. **Effort: M**

---

### [LOW-15] Two frontend catch blocks swallow errors without user feedback

**Source**: Frontend error sub-agent
**Files**: `apps/frontend/src/routes/chat/+page.svelte:346`, `apps/frontend/src/routes/admin/workflows/runs/+page.svelte:276`
**Risk**:

1. `chat/+page.svelte:346` — When approval logging fails, the user receives no feedback and believes the approval succeeded. The backend rejection is invisible.
2. `admin/workflows/runs/+page.svelte:276` — SSE step-event parse errors are swallowed; workflow steps silently disappear from the UI without any degradation indicator.
   **Fix**: Add `showError(...)` call in chat approval catch; add degradation flag in workflow SSE catch. **Effort: S**

---

### [LOW-16] ID logging in 16 locations enables activity correlation

**Source**: PII/log sub-agent
**Files**: `apps/api/src/plugins/rbac.ts`, `apps/api/src/routes/sessions.ts`, `apps/api/src/routes/workflows.ts`, `packages/server/src/auth/api-keys.ts`
**Risk**: `userId`, `keyId`, `orgId`, `sessionId`, and `toolCallId` are logged in structured objects across 16 call sites. No raw credentials are exposed (auth headers redacted correctly), but ID logging creates an activity correlation trail that aids targeted phishing or privilege escalation reconnaissance.
**Assessment**: Acceptable for audit/compliance purposes; worth reviewing which IDs are operationally necessary. No action required unless compliance posture demands stricter log hygiene. **Effort: S-M**

---

## Production Readiness Checklist

| Item                             | Status | Action Required                                        |
| -------------------------------- | ------ | ------------------------------------------------------ |
| BETTER_AUTH_SECRET guard         | ❌     | Fix CRITICAL-1 — add throw on missing secret           |
| Chat approval IDOR (Oracle down) | ❌     | Fix CRITICAL-2 — deny-by-default when unavailable      |
| N+1 loops on chat hot path       | ❌     | Fix CRITICAL-3 — batch INSERT/UPDATE in oracle-store   |
| Stream bus memory leak           | ❌     | Fix CRITICAL-4 — add TTL eviction + cap listeners      |
| findings-repository SQL audit    | ❌     | Fix CRITICAL-5 — verify/fix JSON_MERGEPATCH note param |
| Test app.close() leaks           | ❌     | Fix CRITICAL-6 — add afterEach to 3 test files         |
| MCP admin IDOR (null orgId)      | ⚠️     | Fix HIGH-1 before multi-tenant deployment              |
| SQL injection                    | ✅     | 14 repos audited, 0 vulns                              |
| Auth on all routes               | ✅     | RBAC preHandler on every non-health route              |
| SSRF prevention (webhooks)       | ✅     | `isValidExternalUrl()` with DNS rebinding protection   |
| SSRF prevention (MCP URLs)       | ⚠️     | Fix MEDIUM-2                                           |
| Fire-and-forget error handling   | ⚠️     | Fix HIGH-2                                             |
| Saga compensation observability  | ⚠️     | Fix HIGH-3                                             |
| Connection pool bounded          | ✅     | Min=2, Max=10, withConnection() pattern                |
| Graceful shutdown                | ✅     | 30s timeout, SIGTERM handling                          |
| Rate limiting                    | ✅     | Dual-layer: in-memory + Oracle                         |
| LLM token guardrails             | ✅     | 50k input chars, 4000 output tokens                    |
| Frontend error boundary          | ✅     | +error.svelte handles 4xx/5xx cleanly                  |
| Frontend catch blocks            | ⚠️     | 2 silent swallows with no user feedback (LOW-15)       |
| Structured logging (no PII)      | ✅     | Pino redacts auth headers; no credential leakage       |
| Error response consistency       | ⚠️     | 23 ad-hoc responses in workflows.ts (LOW-12)           |
| Health checks (Mastra/Valkey)    | ⚠️     | Missing from /health readiness probe (LOW-13)          |
| Graceful shutdown (workflows)    | ⚠️     | No workflow/job/webhook cancellation (LOW-14)          |
| Type safety                      | ✅     | 0 TypeScript errors, no implicit any leakage           |
| Test coverage                    | ⚠️     | 5 pre-existing failures in frontend suite              |

---

## Recommended Pre-Deploy Action Plan

**Immediate (before any production traffic):**

1. Fix CRITICAL-1: Add `throw new Error(...)` for missing `BETTER_AUTH_SECRET` in both API and frontend startup
2. Fix CRITICAL-2: Change chat approval guard to deny-by-default when Oracle unavailable

**Sprint 1 post-launch:** 3. Fix HIGH-1: MCP admin IDOR — require non-null `orgId` on all org-scoped operations (12 locations) 4. Fix HIGH-2: Attach `.catch()` to fire-and-forget `actionRun.start()` 5. Fix HIGH-3: Emit structured event on compensation failure 6. Fix HIGH-4: Replace `new Error()` throws with `DatabaseError` in workflows.ts and cloud-advisor.ts 7. Fix MEDIUM-4: Add `requireSetupToken` preHandler to setup AI provider test endpoint 8. Fix MEDIUM-6: Add `FETCH FIRST N ROWS ONLY` to IDP and auth adapter queries

**Month 1:** 9. Fix MEDIUM-2, MEDIUM-3: SSRF + command allowlist for MCP connections 10. Fix MEDIUM-5: Add orgId scoping to CloudAdvisor analysis 11. Fix LOW-1: CORS wildcard production guard 12. Fix LOW-9: Clean up 5 pre-existing frontend test failures

---

_Report generated: 2026-02-19 | Source reports: REVIEW_SECURITY.md, REVIEW_OBSERVABILITY.md, REVIEW_PERFORMANCE.md, REVIEW_QUALITY.md, REVIEW_TESTING.md_
_Additional deep-dive sub-agents: route-error-review, frontend-error-review, pii-log-review, error-consistency-review, health-endpoint-review (observability); N+1/cache/memory deep-dive (performance); CloudAdvisor/findings coverage (testing)_
_Total findings: 6 CRITICAL + 1 CRITICAL-verify, 8 HIGH, 12 MEDIUM, 18 LOW_
