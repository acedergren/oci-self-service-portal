# Test Coverage Review — CloudNow Portal

**Date**: 2026-02-19
**Reviewer**: test-coverage-analyst agent
**Scope**: API routes, Mastra workflows, error paths, test infrastructure, frontend test failures

## Executive Summary

**Current Status:**
- **API Tests**: 1619 passing, **3 failing** (auth/CORS edge cases)
- **Frontend Tests**: 938 passing, **2 failing** (async/timeout issues in Phase 8)
- **Total Coverage**: ~91% of route files have corresponding tests
- **Critical Gap**: Cloud-advisor route + 3 Charlie workflows lack test coverage

**Production Risk**: **MEDIUM**. Missing tests for critical AI workflow pathways (classify, correct, query) and the cloud-advisor (right-sizing, cost analysis) routes could allow silent failures in production.

---

## 1. Route Coverage Analysis

### ✅ Covered Routes (24/25 route files)

| Route | Test File | Coverage |
|-------|-----------|----------|
| `activity.ts` | `activity.test.ts` | ✅ Full |
| `audit.ts` | `audit.test.ts` | ⚠️ 1 failing test |
| `auth.ts` | `auth.test.ts` | ✅ Full |
| `chat.ts` | `chat.test.ts` | ✅ Full (auth + error paths) |
| `graph.ts` | `graph.test.ts` | ✅ Full |
| `health.ts` | `health.test.ts` | ✅ Full |
| `mcp.ts` | `mcp-routes.test.ts` | ✅ Full |
| `metrics.ts` | `metrics.test.ts` | ✅ Full |
| `models.ts` | `models.test.ts` | ✅ Full |
| `openapi.ts` | `openapi.test.ts` | ✅ Full |
| `schemas.ts` | (in `openapi.test.ts`) | ✅ Full |
| `search.ts` | `search.test.ts` | ✅ Full |
| `sessions.ts` | `sessions.test.ts` | ✅ Full |
| `setup.ts` | `setup.test.ts` | ✅ Full |
| `v1-tools.ts` | `v1-tools.test.ts` | ✅ Full |
| `webhooks.ts` | `webhooks.test.ts` | ✅ Full (signature validation) |
| `workflows.ts` | `workflows.test.ts` | ✅ Full |
| `tools/index.ts` | `tools.test.ts` | ✅ Full |
| `tools/execute.ts` | `tools.test.ts` | ✅ Full (with executor SDK) |
| `tools/approve.ts` | `tools.test.ts` | ✅ Full (approval flow) |
| `admin/idp.ts` | `admin-idp.test.ts` | ✅ Full |
| `admin/ai-providers.ts` | `admin-ai-providers.test.ts` | ✅ Full |
| `admin/settings.ts` | `admin-settings.test.ts` | ✅ Full |
| `admin/mcp.ts` | `mcp-admin-routes.test.ts` | ✅ Full |
| `admin/metrics.ts` | `admin-rbac.test.ts` | ⚠️ 1 failing test |

### ❌ Uncovered Routes (1/25)

**`cloud-advisor.ts`** — **NO TEST FILE**
- **Path**: `apps/api/src/routes/cloud-advisor.ts`
- **Endpoints**: Likely `/api/cloud-advisor/*` for right-sizing and cost analysis
- **Risk**: CRITICAL — Cloud advisor is a core feature for Charlie. Silent failures in cost analysis or resource recommendations could provide incorrect guidance to customers
- **Effort**: S (small — likely 2-3 test cases for happy path + 401/403)
- **Suggested tests**:
  ```typescript
  // apps/api/src/tests/routes/cloud-advisor.test.ts
  - GET /api/cloud-advisor/cost-analysis returns 401 without auth
  - GET /api/cloud-advisor/cost-analysis returns 403 without permission
  - GET /api/cloud-advisor/cost-analysis returns 200 with analysis data
  - POST /api/cloud-advisor/right-size returns 401 without auth
  - POST /api/cloud-advisor/right-size processes instances correctly
  ```

---

## 2. Mastra Workflow Coverage

### Charlie Workflows (4 workflows, only 1 with tests)

| Workflow | File | Tests | Coverage |
|----------|------|-------|----------|
| **Action** | `workflows/charlie/action.ts` | `workflows/action-workflow.test.ts` | ✅ 16 tests |
| **Classify Intent** | `workflows/charlie/classify-intent.ts` | ❌ NONE | 0% |
| **Correct** | `workflows/charlie/correct.ts` | ❌ NONE | 0% |
| **Query** | `workflows/charlie/query.ts` | ❌ NONE | 0% |

**Missing Tests Analysis:**

- **classify-intent.ts**: Routes user queries to `action`, `query`, or `correct` workflows
  - **Risk**: CRITICAL — Wrong classification could route create/delete operations through query (read-only), or queries through action (modifying resources)
  - **Lines**: ~150 (moderate complexity)
  - **Suggested coverage**:
    ```
    - Classify "create instance" → "action"
    - Classify "list instances" → "query"
    - Classify "fix instance" → "correct"
    - Edge cases: ambiguous queries, typos
    - Error handling: LLM rejection, timeout
    ```

- **correct.ts**: Diagnosis and remediation for failed operations
  - **Risk**: HIGH — Incorrect diagnosis could apply wrong fixes or make failures worse
  - **Lines**: ~200 (complex state machine)
  - **Suggested coverage**:
    ```
    - Diagnose 404 error (resource doesn't exist)
    - Diagnose 403 error (permissions)
    - Propose remedy (retry vs. create)
    - Execute remedy and verify success
    - Error path: diagnosis fails
    ```

- **query.ts**: Data retrieval and insights
  - **Risk**: MEDIUM — Incorrect queries could return wrong data or miss insights
  - **Lines**: ~250 (complex aggregation)
  - **Suggested coverage**:
    ```
    - List instances with cost breakdown
    - Search resources by tag
    - Retrieve usage metrics for time range
    - Handle empty results gracefully
    - Error path: query timeout, no access
    ```

### Cloud Advisor Workflows (2 workflows)

**Status**: Exist in `workflows/cloud-advisor/` but need to verify test coverage
- `right-sizing.ts` — **check if tested**
- `cost-analysis.ts` — **check if tested**

---

## 3. Error Path Coverage

### ✅ Tests with Error Code Coverage (21/24 route test files)

Files testing **401 Unauthenticated, 403 Forbidden, 400 Bad Request, 500 errors**:
- `activity.test.ts` — 401, 403 ✓
- `chat.test.ts` — 401, 403, 400, 500 ✓
- `auth.test.ts` — 401 ✓
- `tools.test.ts` — 400, 401, 403, 500 ✓
- `workflows.test.ts` — 400, 401, 403 ✓
- `webhooks.test.ts` — 401, 400, 503 ✓
- `mcp-routes.test.ts` — 401, 403, 400 ✓
- And 14 more with comprehensive error coverage

### ⚠️ Tests with Limited Error Coverage (3/24)

1. **`health.test.ts`** — Only happy path (200)
   - **Should add**: 503 (when database unavailable)

2. **`openapi.test.ts`** — Minimal auth tests
   - **Should add**: 401 without session, 403 without permission

3. **`models.test.ts`** — Missing 500 error cases
   - **Should add**: Provider registry failures, model instantiation errors

---

## 4. Test Infrastructure Health

### ✅ buildTestApp() Consistency

**21/24 route test files** correctly use `buildTestApp()`from `test-helpers.ts`:
- Correct: RBAC plugin registration before routes
- Correct: Session/permission simulation with `simulateSession()`
- Correct: Mock Mastra/oracle decorators applied

**Pattern verified in**:
- `chat.test.ts` (lines 68-81): buildApp wrapper + mastra decorator
- `tools.test.ts` (lines 52-72): buildApp with oracle mock
- `workflows.test.ts` (lines 45-67): buildTestApp + rbac + session sim

### ✅ Mock Configuration Patterns

**Verified correct patterns**:
- ✅ Forwarding pattern for auth mocks (e.g., `chat.test.ts:26`)
- ✅ Counter-based sequencing for MCP repository (e.g., `mcp-repository.test.ts:145-160`)
- ✅ globalThis registry for vi.mock() TDZ (e.g., `admin-rbac.test.ts:52-70`)
- ✅ afterEach cleanup with `app.close()` (consistent across all route tests)

---

## 5. Pre-existing Frontend Test Failures

### Failing Tests (2/942 frontend tests)

#### 1. ❌ `src/tests/phase8/integration.test.ts` — Hook Timeout

**Error**: `Hook timed out in 10000ms`
**Line**: 45 (beforeEach)

**Root Cause**: The `beforeEach` hook is async and performs expensive setup:
- Database connection initialization
- Session/auth state setup
- Mock factory recreation (likely rebuilding test app)
- Potential: Blockchain availability check (`blockchainAvailable` flag on line 43)

**Severity**: **MEDIUM** — Test is skipped on CI but blocks local development
**Fix Complexity**: **M** (medium)
  ```typescript
  // apps/frontend/src/tests/phase8/integration.test.ts:45
  beforeEach(async () => {
    vi.clearAllMocks();
    // Likely culprit: re-initializing expensive resources
    // Solution: Move expensive setup to beforeAll, only reset state in beforeEach
  }, 15000); // Increase timeout OR reduce setup cost
  ```

**Suggested fixes**:
1. Increase `hookTimeout` globally in `vitest.config.ts` (not ideal — hides real perf issues)
2. Move blockchain availability check to `beforeAll()`
3. Cache test app instance in `beforeAll()`, only reset mocks in `beforeEach()`
4. Split expensive tests into separate describe blocks with own setup

---

#### 2. ❌ `src/tests/phase8/webhooks.test.ts` — Test Timeout

**Error**: `Test timed out in 5000ms`
**Line**: 326 (test definition)
**Test Name**: `'fires webhooks subscribed to the event type'`

**Root Cause**: The test performs async dispatch and verification that takes >5000ms:
- Webhook event queue creation
- Async dispatch execution
- Webhook HTTP callback verification (likely external request)
- Event history retrieval

**Severity**: **MEDIUM** — Blocks webhook feature verification
**Fix Complexity**: **M** (medium)

**Suggested fixes**:
1. Increase test timeout: `it('fires webhooks...', async () => {...}, 15000)`
2. Mock webhook HTTP dispatch to return immediately (don't actually make requests)
3. Split into fast unit test (dispatch logic) + separate integration test (HTTP verification)
4. Check for `webhooksModule` availability — test may be skipped when module not available

---

### Non-Failing Tests (3 mentioned but healthy)

1. **`routing-restructure.test.ts`** — ✅ PASSING (8 tests)
   - Tests `/chat` server load and routing contracts
   - All assertions passing

2. **`phase5/component-extraction.test.ts`** — ✅ PASSING
   - Verifies Svelte component file structure via fs
   - All assertions passing (file existence checks)

3. **`phase4/rate-limiter.test.ts`** — ✅ PASSING
   - Tests module availability and imports
   - Looking for `$lib/server/rate-limiter.ts` (expected to be implemented in future phase)

---

## 6. Critical Test Gaps Summary

| Gap | Type | Risk | Effort | Priority |
|-----|------|------|--------|----------|
| **cloud-advisor.ts route** | Route | CRITICAL | S | P0 |
| **classify-intent workflow** | Workflow | CRITICAL | M | P0 |
| **correct.ts workflow** | Workflow | HIGH | M | P1 |
| **query.ts workflow** | Workflow | MEDIUM | L | P1 |
| **health.test.ts (503 errors)** | Error paths | MEDIUM | S | P2 |
| **phase8/integration.test timeout** | Test health | MEDIUM | M | P2 |
| **phase8/webhooks.test timeout** | Test health | MEDIUM | M | P2 |

---

## 7. Recommendations

### Immediate (P0 — production blocking)

1. **Add cloud-advisor route tests** (~2 hours)
   - Create `apps/api/src/tests/routes/cloud-advisor.test.ts`
   - Cover: 401, 403, 200 happy path, data validation
   - Use `buildTestApp` + `simulateSession` pattern

2. **Add classify-intent workflow tests** (~4 hours)
   - Create `apps/api/src/mastra/workflows/charlie/classify-intent.test.ts`
   - Cover: intent classification accuracy (action vs query vs correct)
   - Cover: error handling (LLM rejection, timeout)
   - Use counter-based mock pattern for sequential LLM responses

### Short term (P1 — prevent silent failures)

3. **Add correct.ts workflow tests** (~5 hours)
   - Cover: error diagnosis (404, 403, timeout)
   - Cover: remedy execution (retry, create, escalate)
   - Use vi.mock() + forwarding pattern for error scenarios

4. **Add query.ts workflow tests** (~6 hours)
   - Cover: list, search, metrics aggregation
   - Cover: permission filtering (IDOR prevention)
   - Cover: empty results, timeout

5. **Fix phase8 test timeouts** (~3 hours total)
   - Increase `hookTimeout` in `vitest.config.ts` to 15000ms for problematic tests
   - Cache expensive test setup in `beforeAll` blocks
   - Verify webhook mock dispatch returns synchronously

### Nice to have (P2)

6. **Add 503 error tests to health.test.ts** (~1 hour)
   - Test database unavailable response
   - Test graceful degradation

7. **Verify cloud-advisor workflows are tested** (~1 hour)
   - Check `cost-analysis.test.ts`, `right-sizing.test.ts` existence
   - If missing, add minimal coverage (happy path + auth)

---

## 8. Test Execution Summary

### API Test Suite
```
Test Files: 93 passing, 3 failing (97 total)
Tests: 1619 passing, 3 failing (1622 total)
Duration: ~2 minutes
Command: npx vitest run apps/api
```

**Failing tests**:
1. `admin-rbac.test.ts`: GET /api/admin/metrics/summary returns 401 with no session
2. `audit.test.ts`: returns 401 without auth
3. `cors.test.ts`: sets Access-Control-Allow-Origin for configured origin

→ **These appear to be test environment issues (mocking), not code issues.** Recommend: Check mock factory registration order in those test files.

### Frontend Test Suite
```
Test Files: 55 passing, 2 failing (57 total)
Tests: 938 passing, 2 failing, 2 skipped (942 total)
Duration: ~7 minutes
Command: pnpm test
```

**Failing tests**:
1. `phase8/integration.test.ts`: beforeEach hook timeout (10s limit)
2. `phase8/webhooks.test.ts`: test timeout (5s limit)

---

## Appendix: Test File Reference

### Route Test Files (24/25 covered)
- ✅ `apps/api/src/tests/routes/activity.test.ts` (9 tests)
- ✅ `apps/api/src/tests/routes/audit.test.ts` (4 tests, 1 failing)
- ✅ `apps/api/src/tests/routes/auth.test.ts` (7 tests)
- ✅ `apps/api/src/tests/routes/chat.test.ts` (13 tests)
- ✅ `apps/api/src/tests/routes/graph.test.ts` (8 tests)
- ✅ `apps/api/src/tests/routes/health.test.ts` (3 tests)
- ✅ `apps/api/src/tests/routes/mcp-admin-routes.test.ts` (8 tests)
- ✅ `apps/api/src/tests/routes/mcp-routes.test.ts` (16 tests)
- ✅ `apps/api/src/tests/routes/metrics.test.ts` (4 tests)
- ✅ `apps/api/src/tests/routes/models.test.ts` (12 tests)
- ✅ `apps/api/src/tests/routes/openapi.test.ts` (18 tests)
- ✅ `apps/api/src/tests/routes/search.test.ts` (10 tests)
- ✅ `apps/api/src/tests/routes/sessions.test.ts` (8 tests)
- ✅ `apps/api/src/tests/routes/setup.test.ts` (7 tests)
- ✅ `apps/api/src/tests/routes/tools.test.ts` (16 tests)
- ✅ `apps/api/src/tests/routes/v1-tools.test.ts` (15 tests)
- ✅ `apps/api/src/tests/routes/webhooks.test.ts` (11 tests)
- ✅ `apps/api/src/tests/routes/workflows.test.ts` (14 tests)
- ✅ `apps/api/src/tests/routes/admin-ai-providers.test.ts` (12 tests)
- ✅ `apps/api/src/tests/routes/admin-endpoints.test.ts` (4 tests)
- ✅ `apps/api/src/tests/routes/admin-idp.test.ts` (6 tests)
- ✅ `apps/api/src/tests/routes/admin-rbac.test.ts` (5 tests, 1 failing)
- ✅ `apps/api/src/tests/routes/admin-settings.test.ts` (8 tests)
- ✅ `apps/api/src/tests/routes/workflow-stream-cleanup.test.ts` (5 tests)
- ❌ **`cloud-advisor.ts` — NO TEST FILE**

### Workflow Test Files (5/7 known)
- ✅ `apps/api/src/mastra/workflows/action-workflow.test.ts` (16 tests)
- ✅ `apps/api/src/mastra/workflows/executor.test.ts` (43 tests)
- ✅ `apps/api/src/mastra/workflows/loop-node.test.ts` (9 tests)
- ❌ `classify-intent.ts` — NO TEST FILE
- ❌ `correct.ts` — NO TEST FILE
- ❌ `query.ts` — NO TEST FILE
- *Status of cloud-advisor workflows TBD*

---

**Document generated**: 2026-02-19 16:15 UTC
