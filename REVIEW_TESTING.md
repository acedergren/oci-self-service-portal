# Test Coverage & Quality Review — CloudNow

**Date**: 2026-02-19
**Reviewer**: Test Coverage Analyst (Claude Opus 4.6)
**Scope**: `apps/api/`, `apps/frontend/`, `packages/server/`

---

## Executive Summary

The CloudNow monorepo has **154 test files** with **~2,546 tests** (1,621 API + 925 frontend). Test quality is generally strong — no empty-assertion tests were found, and most route tests include both happy and error paths. However, several **critical coverage gaps** exist in the service layer (12% error path coverage), newer features (CloudAdvisor, admin metrics), and workflow subsystems. The most impactful issue for stability is **missing Fastify app cleanup** in 3 route test files, which is the likely root cause of the known full-suite timeout failures.

---

## 1. Test File Inventory

| Workspace                  | Test Files | Estimated Tests | Notes                                            |
| -------------------------- | ---------- | --------------- | ------------------------------------------------ |
| `apps/api/src/tests/`      | 57         | ~1,100          | Routes, services, repositories, tools, workflows |
| `apps/api/src/plugins/`    | 5          | ~80             | Co-located plugin unit tests                     |
| `apps/api/src/mastra/`     | 12         | ~441            | Agent, RAG, storage, workflow tests              |
| `apps/frontend/src/tests/` | 57         | ~925            | Phase-organized frontend tests                   |
| **Total**                  | **154**    | **~2,546**      |                                                  |

### Configuration

| Setting      | API                                | Frontend                    |
| ------------ | ---------------------------------- | --------------------------- |
| `mockReset`  | `true`                             | not set (defaults to false) |
| `setupFiles` | `src/tests/setup.ts` (logger mock) | none                        |
| Test pattern | `src/**/*.test.ts`                 | `src/**/*.test.ts`          |

**Key implication**: API tests clear all mock implementations between tests — requires the forwarding pattern (`(...args) => mockFn(...args)`) documented in CLAUDE.md. Frontend tests don't reset mocks, which means mock state can leak between tests (less isolated but lower configuration burden).

---

## 2. Critical Path Coverage Gaps

### [CRITICAL] CloudAdvisor Routes — ZERO Tests

**Source**: `apps/api/src/routes/cloud-advisor.ts` (190 lines, 5 endpoints)
**Test file**: None exists

**Risk**: CloudAdvisor is a user-facing feature with auth-protected CRUD operations on findings. No test coverage means:

- Auth bypass could go undetected
- MERGE INTO SQL in `findings-repository.ts` is completely untested
- `updateFindingStatus()` has a **string interpolation pattern** (line 232-233) that constructs SQL via `JSON_MERGEPATCH` with the `note` parameter — potential SQL injection vector needs verification

**Suggested tests**:

- POST `/api/cloud-advisor/analyse` — auth gate (401/403), valid request (202), invalid domain enum
- GET `/api/cloud-advisor/findings` — auth, pagination, filter by domain/severity/status
- GET `/api/cloud-advisor/findings/:findingId` — auth, 404 not found, valid finding
- PATCH `/api/cloud-advisor/findings/:findingId` — auth, 404, valid status update
- GET `/api/cloud-advisor/summary` — auth, empty state, active findings

---

### [CRITICAL] Findings Repository — ZERO Tests

**Source**: `apps/api/src/services/findings-repository.ts` (351 lines)
**Test file**: None exists

**Risk**: The findings repository handles Oracle MERGE INTO with JSON_VALUE, JSON_EXISTS, and JSON_MERGEPATCH — complex SQL patterns that are brittle and hard to debug without tests. The `upsertFinding` function has 30+ bind parameters. The `listFindings` function dynamically builds WHERE clauses. None of this has test coverage.

**Suggested tests**:

- `upsertFinding()` — insert new, update existing (MERGE INTO behavior)
- `listFindings()` — with/without filters, pagination, default ordering
- `getFinding()` — found, not found (null return)
- `updateFindingStatus()` — status change, note handling
- `upsertRun()` — new run, update existing
- `getLatestRunSummary()` — with data, no data (null), malformed JSON

---

### [CRITICAL] Admin Metrics Route — ZERO Tests

**Source**: `apps/api/src/routes/admin/metrics.ts` (142 lines)
**Test file**: None exists

**Risk**: The `parsePrometheusText()` function (lines 25-66) is a hand-written parser for Prometheus text format. Parsing logic is notoriously fragile — edge cases like empty labels, multi-line help text, or histogram bucket lines could produce incorrect data. The admin dashboard relies on this for operational visibility.

**Suggested tests**:

- `parsePrometheusText()` — well-formed input, empty input, malformed lines, histogram metrics
- GET `/api/admin/metrics/summary` — auth gate (admin:all), response shape, metric categories
- Edge: counter total when no matching metric, breakdown by missing label key

---

### [CRITICAL] Service Layer Error Path Coverage — 12%

**Files affected**: All 6 service test files

| Service Test                  | Total Tests | Error Path Tests | Gap                                     |
| ----------------------------- | ----------- | ---------------- | --------------------------------------- |
| `approvals.test.ts`           | 11          | 0                | No DB failure tests                     |
| `workflow-repository.test.ts` | 28          | 0                | **No Oracle error tests at all**        |
| `workflow-stream-bus.test.ts` | 10          | 0                | No subscriber error tests               |
| `oracle-agent-state.test.ts`  | 22          | 2                | Minimal Oracle error codes              |
| `cache.test.ts`               | 19          | 6                | Better, but no Redis connection failure |
| `tools-service.test.ts`       | 8           | 2                | No tool execution timeout test          |

**Risk**: The service layer is the primary Oracle integration point. When Oracle becomes unavailable, times out, or returns constraint violations, the application's behavior is completely untested. Production incidents from database issues will be harder to diagnose.

**Suggested tests**: Add `mockExecute.mockRejectedValue(new Error('ORA-00001'))` patterns to each service test. Key scenarios:

- Connection pool exhaustion
- Constraint violations (unique, foreign key)
- Query timeout
- NULL handling in optional columns

---

### [HIGH] Charlie Workflow Nodes — ZERO Tests

**Source**: `apps/api/src/mastra/workflows/charlie/` (4 files, 1,098 lines total)

- `action.ts` (457 lines) — executes OCI tool calls
- `query.ts` (333 lines) — RAG query pipeline
- `correct.ts` (174 lines) — error correction chain
- `classify-intent.ts` (134 lines) — intent classification

**Test file**: None exists

**Risk**: These are the core AI agent workflow steps. The action workflow handles tool approval, execution, and error recovery. The query workflow handles RAG retrieval. Complete test blindness here means AI agent regressions can't be caught.

---

### [HIGH] Cloud-Advisor Workflows — ZERO Tests

**Source**: `apps/api/src/mastra/workflows/cloud-advisor/` (5 files, 1,540 lines total)

- `full-analysis.ts` (493 lines)
- `cost-analysis.ts` (313 lines)
- `security-analysis.ts` (261 lines)
- `right-sizing.ts` (240 lines)
- `ai-performance.ts` (233 lines)

**Test file**: None exists

**Risk**: These workflows orchestrate multi-step analysis with OCI API calls, AI inference, and finding persistence. They're complex multi-step operations with branching logic and error handling paths.

---

### [HIGH] Scheduler — ZERO Tests

**Source**: `apps/api/src/mastra/scheduler.ts` (264 lines)
**Test file**: None exists

**Risk**: The scheduler `triggerAnalysis()` function is called from the CloudAdvisor routes and from the periodic job. It coordinates workflow execution and finding persistence.

---

### [HIGH] Portal MCP Server — ZERO Tests

**Source**: `apps/api/src/mastra/mcp/portal-mcp-server.ts` (205 lines)
**Test file**: None exists

**Risk**: The MCP server exposes tools and resources over the MCP protocol. It's the primary integration point between external MCP clients and the tool registry.

---

### [HIGH] Rate Limiting (429) — ZERO Tests Across Entire Codebase

**Status**: No test file anywhere verifies that rate-limited requests receive a 429 response.

**Risk**: Rate limiting is a critical security control. The `rate-limiter-oracle.test.ts` tests the plugin's internal logic but never tests an actual HTTP request returning 429.

**Suggested test**: Add to any authenticated route test:

```typescript
it('returns 429 when rate limit exceeded', async () => {
    mockCheckRateLimit.mockResolvedValue({ remaining: 0, resetAt: Date.now() + 60000 });
    const res = await app.inject({ method: 'POST', url: '/api/chat', payload: {...} });
    expect(res.statusCode).toBe(429);
});
```

---

## 3. Untested Source Files (Complete Gap Map)

### Routes (source → test mapping)

| Route Source                   | Lines | Has Test? | Test File                                 |
| ------------------------------ | ----- | --------- | ----------------------------------------- |
| `routes/activity.ts`           | —     | Yes       | `tests/routes/activity.test.ts`           |
| `routes/admin/ai-providers.ts` | —     | Yes       | `tests/routes/admin-ai-providers.test.ts` |
| `routes/admin/idp.ts`          | —     | Yes       | `tests/routes/admin-idp.test.ts`          |
| `routes/admin/mcp.ts`          | —     | Yes       | `tests/routes/mcp-admin-routes.test.ts`   |
| `routes/admin/metrics.ts`      | 142   | **NO**    | —                                         |
| `routes/admin/settings.ts`     | —     | Yes       | `tests/routes/admin-settings.test.ts`     |
| `routes/audit.ts`              | —     | Yes       | `tests/routes/audit.test.ts`              |
| `routes/auth.ts`               | —     | Yes       | `tests/routes/auth.test.ts`               |
| `routes/chat.ts`               | —     | Yes       | `tests/routes/chat.test.ts`               |
| `routes/cloud-advisor.ts`      | 190   | **NO**    | —                                         |
| `routes/graph.ts`              | —     | Yes       | `tests/routes/graph.test.ts`              |
| `routes/health.ts`             | —     | Yes       | `tests/routes/health.test.ts`             |
| `routes/mcp.ts`                | —     | Yes       | `tests/routes/mcp-routes.test.ts`         |
| `routes/metrics.ts`            | —     | Yes       | `tests/routes/metrics.test.ts`            |
| `routes/models.ts`             | —     | Yes       | `tests/routes/models.test.ts`             |
| `routes/openapi.ts`            | —     | Yes       | `tests/routes/openapi.test.ts`            |
| `routes/search.ts`             | —     | Yes       | `tests/routes/search.test.ts`             |
| `routes/sessions.ts`           | —     | Yes       | `tests/routes/sessions.test.ts`           |
| `routes/setup.ts`              | —     | Yes       | `tests/routes/setup.test.ts`              |
| `routes/tools.ts`              | —     | Yes       | `tests/routes/tools.test.ts`              |
| `routes/tools/approve.ts`      | 92    | Partial   | Covered by `tests/routes/tools.test.ts`   |
| `routes/tools/execute.ts`      | 125   | Partial   | Covered by `tests/routes/tools.test.ts`   |
| `routes/v1-tools.ts`           | —     | Yes       | `tests/routes/v1-tools.test.ts`           |
| `routes/webhooks.ts`           | —     | Yes       | `tests/routes/webhooks.test.ts`           |
| `routes/workflows.ts`          | —     | Yes       | `tests/routes/workflows.test.ts`          |

### Services

| Service Source                       | Lines | Has Test? | Test File                                    |
| ------------------------------------ | ----- | --------- | -------------------------------------------- |
| `services/approvals.ts`              | —     | Yes       | `tests/services/approvals.test.ts`           |
| `services/cache.ts`                  | —     | Yes       | `tests/services/cache.test.ts`               |
| `services/findings-repository.ts`    | 351   | **NO**    | —                                            |
| `services/mcp-connection-manager.ts` | —     | Yes       | `tests/mcp-connection-manager.test.ts`       |
| `services/tools.ts`                  | —     | Yes       | `tests/services/tools-service.test.ts`       |
| `services/workflow-repository.ts`    | —     | Yes       | `tests/services/workflow-repository.test.ts` |
| `services/workflow-stream-bus.ts`    | —     | Yes       | `tests/services/workflow-stream-bus.test.ts` |

### Mastra (untested files only)

| Mastra Source                        | Lines            | Has Test?                       |
| ------------------------------------ | ---------------- | ------------------------------- |
| `mastra/agents/cloud-advisor.ts`     | 114              | **NO**                          |
| `mastra/events.ts`                   | 65               | **NO**                          |
| `mastra/findings.ts`                 | 127              | **NO** (Zod schemas — low risk) |
| `mastra/mcp/portal-mcp-server.ts`    | 205              | **NO**                          |
| `mastra/providers.ts`                | 20               | **NO** (config only — low risk) |
| `mastra/risk.ts`                     | 52               | **NO**                          |
| `mastra/scheduler.ts`                | 264              | **NO**                          |
| `mastra/tools/executor.ts`           | 158              | **NO**                          |
| `mastra/tools/sdk-auth.ts`           | 82               | **NO**                          |
| `mastra/workflows/charlie/*`         | 1,098            | **NO**                          |
| `mastra/workflows/cloud-advisor/*`   | 1,540            | **NO**                          |
| `mastra/workflows/nodes/approval.ts` | 148              | **NO**                          |
| **Total untested**                   | **~3,873 lines** |                                 |

### Repositories (packages/server)

| Repository                                           | Lines | Has Test?                    |
| ---------------------------------------------------- | ----- | ---------------------------- |
| `oracle/repositories/approval-repository.ts`         | —     | Yes                          |
| `oracle/repositories/audit-repository.ts`            | —     | Yes                          |
| `oracle/repositories/blockchain-audit-repository.ts` | —     | Partial (frontend test)      |
| `oracle/repositories/embedding-repository.ts`        | —     | Partial (embeddings.test.ts) |
| `oracle/repositories/org-repository.ts`              | —     | Yes                          |
| `oracle/repositories/session-repository.ts`          | —     | Yes                          |
| `oracle/repositories/webhook-repository.ts`          | —     | Yes                          |

---

## 4. Test Quality Issues

### [HIGH] Tests That Always Pass (No Real Assertions)

**Finding**: No test files contain `it()` blocks with zero `expect()` calls. All tests have at least one assertion. This is excellent.

However, several test patterns are **structurally weak**:

**`health-endpoint.test.ts` lines 198-228** — "TDD contract" tests that validate a local object's shape:

```typescript
const expectedShape = { status: 'ok', checks: {...}, timestamp: '...', ... };
expect(expectedShape).toHaveProperty('status');  // Always passes — it's a literal
```

These tests validate code that was written _in the test itself_, not actual application behavior. They serve as documentation but provide zero regression protection.

**`health-endpoint.test.ts` line 172** — Time-sensitive assertion:

```typescript
const start = performance.now();
await app.inject({ method: 'GET', url: '/health' });
const elapsed = performance.now() - start;
expect(elapsed).toBeLessThan(100);
```

This test is fragile on slow CI runners. Response time depends on system load, not code correctness.

---

### [HIGH] Missing Error Path Tests in Route Files

Route tests that test **ONLY happy paths** (no 4xx/5xx assertions):

| Route Test                        | Tests | Error Tests | What's Missing                        |
| --------------------------------- | ----- | ----------- | ------------------------------------- |
| `metrics.test.ts`                 | 4     | 0           | No 401, no 500 from collect() failure |
| `models.test.ts`                  | 3     | 0           | No auth tests, no DB failure          |
| `workflow-stream-cleanup.test.ts` | 1     | 0           | Minimal test file                     |

Route tests with **minimal error coverage** (only auth gates, no DB/service failures):

| Route Test               | Tests | Error Tests | What's Missing              |
| ------------------------ | ----- | ----------- | --------------------------- |
| `openapi.test.ts`        | 6     | 1           | Only 503 when docs disabled |
| `admin-settings.test.ts` | 8     | 3           | No DB failure on get/set    |
| `setup.test.ts`          | 8     | 3           | No validation errors        |
| `auth.test.ts`           | 7     | 3           | No cookie/redirect failures |
| `search.test.ts`         | 10    | 4           | No embedding/vector failure |
| `mcp-routes.test.ts`     | 9     | 3           | No tool execution errors    |
| `graph.test.ts`          | 8     | 5           | No analytics query failure  |

---

### [MEDIUM] Skipped and Incomplete Tests

| File                               | Pattern                                              | Impact                                 |
| ---------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| `rag/vector-benchmark.test.ts:312` | `describe.skip('Performance Characteristics')`       | Performance regression blindspot       |
| `cloud-pricing.test.ts:468`        | `it.skip('fetches real OCI pricing via MCP client')` | Integration test disabled (acceptable) |
| `cloud-pricing.test.ts:479`        | `it.skip('fetches real Azure pricing via REST API')` | Integration test disabled (acceptable) |

---

## 5. Flaky Test Patterns

### [CRITICAL] Missing `app.close()` — Root Cause of Suite Timeouts

Three route test files create Fastify instances without cleaning them up. This is **the most likely root cause of the known timeout failures** when running the full API test suite (app-factory, health-endpoint, auth-middleware tests timing out).

| File                                    | Tests | Issue                                                                     |
| --------------------------------------- | ----- | ------------------------------------------------------------------------- |
| `tests/routes/webhooks.test.ts`         | ~20   | Every test creates `buildTestApp()` — **NO afterEach with app.close()**   |
| `tests/routes/mcp-admin-routes.test.ts` | ~100  | Most tests create `buildTestApp()` — **NO afterEach cleanup in majority** |
| `tests/routes/search.test.ts`           | ~10   | Uses `buildSearchApp()` — afterEach exists but fails if app not assigned  |

**Why this causes timeouts**: Each unclosed Fastify instance holds open:

- TCP socket listeners
- Connection pool references
- Plugin lifecycle hooks (including Oracle and auth)

When dozens of these accumulate during a full suite run, Node.js's event loop becomes overloaded. Later tests (app-factory, health-endpoint) timeout waiting for their own Fastify instances to start because the OS is exhausting ephemeral ports or Fastify's internal registry is congested.

**Fix**: Add this to each file:

```typescript
let app: FastifyInstance;
afterEach(async () => {
	if (app) await app.close();
});
```

---

### [MEDIUM] Missing `vi.useRealTimers()` Restoration

| File                                           | Line     | Issue                                                                    |
| ---------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `tests/workflows/retry.test.ts`                | 131, 361 | `vi.useFakeTimers()` in beforeEach, no `vi.useRealTimers()` in afterEach |
| `tests/routes/workflow-stream-cleanup.test.ts` | 8        | `vi.useFakeTimers()` without restoration                                 |

**Risk**: Tests later in the same file or suite may see frozen time, causing unexpected timeout behavior.

---

### [MEDIUM] `process.env` Shallow Copy Pattern

| File                             | Lines   | Issue                                                |
| -------------------------------- | ------- | ---------------------------------------------------- |
| `tests/server-lifecycle.test.ts` | 89-99   | `process.env = { ...originalEnv }` is a shallow copy |
| `tests/app-factory.test.ts`      | 746-754 | Same pattern                                         |

**Risk**: Shallow copy means nested values or newly-added keys aren't properly isolated. If a test adds `process.env.NEW_KEY`, it persists across tests. Should use `vi.stubEnv()` or deep restoration.

---

### [LOW] Time-Dependent Test Data Without Mocking

| File                                        | Lines                 | Pattern                          | Risk                                              |
| ------------------------------------------- | --------------------- | -------------------------------- | ------------------------------------------------- |
| `tests/services/oracle-agent-state.test.ts` | 61-741 (14 instances) | `Date.now()` for timestamps      | Low — used for data creation, not time comparison |
| `tests/plugins/rate-limiter-oracle.test.ts` | 29, 272-309           | `Date.now() + 60000` for resetAt | Low — relative offsets are stable                 |
| `tests/routes/tools.test.ts`                | 714-869               | `Date.now()` for approval tokens | Low — used as fixture data                        |

---

## 6. Mock Coverage Gaps

### [HIGH] Oracle `withConnection` Error Paths

Most test files mock `withConnection` to succeed:

```typescript
vi.fn(async (fn: (conn: unknown) => unknown) => fn({ execute: vi.fn()... }))
```

No test file mocks `withConnection` to **fail** (e.g., `mockRejectedValue(new Error('Connection pool exhausted'))`). This means the application's behavior when the database becomes unavailable is completely untested.

**Files affected**: All route tests, all service tests, app-factory.test.ts, health-endpoint.test.ts

---

### [MEDIUM] Frontend mockReset Asymmetry

The frontend vitest.config.ts does **not** set `mockReset: true` (the API does). This means:

- Frontend tests can chain `mockResolvedValueOnce()` safely
- But mock state leaks between tests — a mock configured in test A may still be active in test B
- This creates a subtle order dependency that could make tests pass individually but fail when run in a different order

---

## 7. Frontend Test Organization

The frontend tests are organized by development phase:

| Directory  | Tests    | Coverage Area                                           |
| ---------- | -------- | ------------------------------------------------------- |
| `phase4/`  | 7 files  | Security (CSP, rate limiting, column injection)         |
| `phase5/`  | 3 files  | UI components (shadcn, notifications)                   |
| `phase6/`  | 5 files  | Observability (errors, health, logger, metrics, sentry) |
| `phase7/`  | 4 files  | Workflows (executor, model, repository, types)          |
| `phase8/`  | 13 files | API v1, webhooks, MCP, vector search, blockchain        |
| `phase10/` | 4 files  | Admin tools, genui, hooks, workflow nodes               |
| `admin/`   | 6 files  | Admin panel (crypto, IDP, setup, types)                 |
| `auth/`    | 4 files  | Auth flow (oracle-adapter, rbac, session, tenancy)      |
| Root       | 9 files  | Core (search, loading, routing, query, pricing)         |

**Notable gaps**: No frontend tests for:

- Svelte component rendering (most tests are for server-side utilities)
- SvelteKit load functions (`+page.server.ts` files)
- Client-side stores (`$lib/stores/`)
- Mobile-specific components

---

## 8. Prioritized Recommendations

### P0 — Fix Immediately (Stability)

1. **Add `afterEach(app.close())` to webhooks.test.ts, mcp-admin-routes.test.ts, search.test.ts**
   - This is the probable fix for the full-suite timeout issue
   - Estimated effort: 30 minutes
   - Impact: Eliminates cascading test failures

### P1 — Add Within 1 Sprint (Critical Coverage)

2. **Add cloud-advisor route tests** (~20 tests)
   - Auth gates, CRUD operations, validation errors, 404s
   - Verify `updateFindingStatus()` note parameter is safe from injection

3. **Add findings-repository tests** (~15 tests)
   - MERGE INTO behavior, filter combinations, NULL handling
   - Oracle error scenarios

4. **Add admin-metrics route tests** (~8 tests)
   - `parsePrometheusText()` unit tests (edge cases)
   - Auth gate, response shape

5. **Add rate-limit 429 response test** (~2 tests)
   - At least one route should verify the full 429 HTTP response

### P2 — Add Within 2 Sprints (High Value)

6. **Add service layer error tests** (~30 tests total)
   - `mockExecute.mockRejectedValue()` patterns for each service
   - Connection pool exhaustion, constraint violations, timeouts

7. **Add `vi.useRealTimers()` to retry.test.ts and workflow-stream-cleanup.test.ts**

8. **Add Charlie workflow node tests** — at least integration smoke tests for `action.ts` and `query.ts`

### P3 — Add When Capacity Allows

9. **Add CloudAdvisor workflow tests** (1,540 lines untested)
10. **Add scheduler.ts tests** (264 lines untested)
11. **Add portal-mcp-server.ts tests** (205 lines untested)
12. **Add `withConnection` failure path tests** across all route tests
13. **Convert `performance.now()` health test to deterministic check**
14. **Add frontend component rendering tests** (Svelte components are currently untested)

---

## 9. Metrics Summary

| Metric                         | Value               | Assessment                      |
| ------------------------------ | ------------------- | ------------------------------- |
| Total test files               | 154                 | Good volume                     |
| Estimated total tests          | ~2,546              | Strong count                    |
| Route test coverage            | 23/25 routes (92%)  | Good — 2 routes untested        |
| Service test coverage          | 6/7 services (86%)  | Good — 1 service untested       |
| Mastra test coverage           | 12/56 files (21%)   | **Poor** — 3,873 lines untested |
| Error path coverage (routes)   | ~72%                | Moderate                        |
| Error path coverage (services) | ~12%                | **Critical gap**                |
| Tests with no assertions       | 0                   | Excellent                       |
| Skipped tests                  | 3                   | Acceptable                      |
| Flaky test patterns            | 6 files             | Needs attention                 |
| Known timeout root cause       | Missing app.close() | **Fixable**                     |
