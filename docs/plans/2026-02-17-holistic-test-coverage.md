# Holistic Test Coverage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring API test coverage to a holistic level by filling all critical gaps in routes, services, repositories, and shared packages.

**Architecture:** Tests run through `apps/api/vitest.config.ts` which has `mockReset: true` and aliases for `@portal/server`, `@portal/types`. All test files live under `apps/api/src/tests/`. Route tests use `buildTestApp()` + `simulateSession()` + `app.inject()`. Repository tests mock `withConnection` + counter-based `execute`. Pure utilities need no mocks.

**Tech Stack:** Vitest 4, Fastify 5, Zod 4, Oracle ADB, AES-256-GCM

---

## Vitest Config Reference

```
apps/api/vitest.config.ts:
  mockReset: true          ← clears mock return values between tests
  setupFiles: setup.ts     ← runs before each test file
  include: src/**/*.test.ts
  aliases: @portal/server → packages/server/src
           @portal/types  → packages/types/src
```

**Critical pattern**: Always use forwarding mocks `(...args) => mockFn(...args)` in `vi.mock()` factories, and reconfigure return values in `beforeEach`.

---

## Wave 1: Critical Gaps (8 tasks, ~130 tests)

### Task 1: PortalError Hierarchy Tests

**Files:**

- Test: `apps/api/src/tests/packages/errors.test.ts`
- Source: `packages/types/src/errors.ts` (204 lines, 0 tests)

**Why first:** Pure utility, zero dependencies, validates the error foundation used by every other module. Perfect for verifying the test runner works.

**Step 1: Write ONE minimal smoke test**

```typescript
import { describe, it, expect } from 'vitest';
import {
	PortalError,
	ValidationError,
	isPortalError,
	toPortalError
} from '@portal/types/errors.js';

describe('PortalError (smoke)', () => {
	it('creates an error with code and statusCode', () => {
		const err = new PortalError('TEST', 'test message', 418, { foo: 'bar' });
		expect(err.code).toBe('TEST');
		expect(err.statusCode).toBe(418);
		expect(err.context.foo).toBe('bar');
		expect(err.message).toBe('test message');
	});
});
```

**Step 2: Run smoke test**

Run: `npx vitest run apps/api/src/tests/packages/errors.test.ts --reporter=verbose`
Expected: 1 PASS

**Step 3: Write full test suite (~15 tests)**

Cover:

- `PortalError` — constructor, `toJSON()`, `toSentryExtras()`, `toResponseBody()`, cause chaining
- Each subclass (`ValidationError`→400, `AuthError`→401/403, `NotFoundError`→404, `RateLimitError`→429, `OCIError`→502, `DatabaseError`→503)
- `isPortalError()` — true for PortalError, false for plain Error, false for non-Error
- `toPortalError()` — passthrough for PortalError, wraps plain Error, wraps non-Error string
- `errorResponse()` — builds Response with correct status, body, headers
- `toResponseBody()` never exposes stack or internal context

**Step 4: Run and verify all pass**

Run: `npx vitest run apps/api/src/tests/packages/errors.test.ts --reporter=verbose`

**Step 5: Commit**

```bash
git add apps/api/src/tests/packages/errors.test.ts
git commit -m "test(types): add PortalError hierarchy tests — 15 tests covering all subclasses, serialization, and type guards"
```

---

### Task 2: Crypto Module Tests (AES-256-GCM)

**Files:**

- Test: `apps/api/src/tests/packages/crypto.test.ts`
- Source: `packages/server/src/crypto.ts` (110 lines, 0 tests)

**Step 1: Write ONE minimal smoke test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	encryptWebhookSecret,
	decryptWebhookSecret,
	isWebhookEncryptionEnabled
} from '@portal/server/crypto.js';

describe('crypto (smoke)', () => {
	const TEST_KEY_HEX = 'a'.repeat(64); // 32-byte hex key
	let originalKey: string | undefined;

	beforeEach(() => {
		originalKey = process.env.WEBHOOK_ENCRYPTION_KEY;
		process.env.WEBHOOK_ENCRYPTION_KEY = TEST_KEY_HEX;
	});
	afterEach(() => {
		if (originalKey !== undefined) process.env.WEBHOOK_ENCRYPTION_KEY = originalKey;
		else delete process.env.WEBHOOK_ENCRYPTION_KEY;
	});

	it('encrypts and decrypts round-trip', () => {
		const { ciphertext, iv } = encryptWebhookSecret('my-secret');
		const decrypted = decryptWebhookSecret(ciphertext, iv);
		expect(decrypted).toBe('my-secret');
	});
});
```

**Step 2: Run smoke test**

Run: `npx vitest run apps/api/src/tests/packages/crypto.test.ts --reporter=verbose`
Expected: 1 PASS

**Step 3: Write full test suite (~10 tests)**

Cover:

- Round-trip encrypt/decrypt
- `isWebhookEncryptionEnabled()` returns true/false based on env
- Key formats: 64-char hex, base64url, standard base64
- Missing key throws on encrypt/decrypt
- Invalid key format throws
- Tampered ciphertext throws (auth tag validation)
- Invalid IV length throws
- Payload too short throws
- Caching: same env value reuses cached key

**Step 4: Run and verify**
**Step 5: Commit**

---

### Task 3: Approval Service Tests

**Files:**

- Test: `apps/api/src/tests/services/approvals.test.ts`
- Source: `apps/api/src/services/approvals.ts` (105 lines, 0 direct tests)

**Step 1: Write ONE minimal smoke test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { recordApproval, consumeApproval, _resetApprovals } from '../../services/approvals.js';

describe('approvals (smoke)', () => {
	beforeEach(() => _resetApprovals());

	it('records and consumes an approval token', async () => {
		await recordApproval('call-1', 'list-instances');
		const result = await consumeApproval('call-1', 'list-instances');
		expect(result).toBe(true);
	});
});
```

**Step 2: Run smoke test**

Run: `npx vitest run apps/api/src/tests/services/approvals.test.ts --reporter=verbose`
Expected: 1 PASS

**Step 3: Write full test suite (~12 tests)**

Cover:

- `recordApproval` + `consumeApproval` happy path
- Single-use: second consume returns false
- Wrong tool name: consume returns false
- Unknown toolCallId: consume returns false
- Expiry: approval consumed after 5+ minutes returns false (use `vi.useFakeTimers()`)
- `_resetApprovals()` clears all state
- `pendingApprovals` map: direct state verification
- `sweepStale` via timer: set fake timers, advance 5+ minutes, verify pending approvals auto-rejected

**Step 4: Run and verify**
**Step 5: Commit**

---

### Task 4: Webhook Repository Tests

**Files:**

- Test: `apps/api/src/tests/repositories/webhook-repository.test.ts`
- Source: `packages/server/src/oracle/repositories/webhook-repository.ts` (369 lines, 0 tests)

**Mock strategy:** Mock `withConnection` + `execute` using the counter-based pattern from CLAUDE.md. Mock `crypto.ts` functions for encryption.

**Step 1: Write ONE minimal smoke test**

Verify `withConnection` mock wiring works:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockWithConnection = vi.fn();

vi.mock('@portal/server/oracle/connection', () => ({
	withConnection: (...args: unknown[]) => mockWithConnection(...args)
}));

vi.mock('@portal/server/crypto', () => ({
	encryptWebhookSecret: vi.fn().mockReturnValue({ ciphertext: 'enc', iv: 'iv' }),
	decryptWebhookSecret: vi.fn().mockReturnValue('decrypted'),
	isWebhookEncryptionEnabled: vi.fn().mockReturnValue(true)
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

describe('webhook-repository (smoke)', () => {
	beforeEach(() => {
		mockWithConnection.mockImplementation(async (fn) =>
			fn({ execute: mockExecute, close: vi.fn(), commit: vi.fn(), rollback: vi.fn() })
		);
		mockExecute.mockResolvedValue({ rows: [] });
	});

	it('list returns empty array when no rows', async () => {
		const { webhookRepository } =
			await import('@portal/server/oracle/repositories/webhook-repository.js');
		const result = await webhookRepository.list('org-1');
		expect(result).toEqual([]);
	});
});
```

**Step 2: Run smoke test**

Run: `npx vitest run apps/api/src/tests/repositories/webhook-repository.test.ts --reporter=verbose`
Expected: 1 PASS

**Step 3: Write full test suite (~15 tests)**

Cover:

- `create` — inserts with encrypted secret, returns UUID
- `getById` — returns webhook scoped by orgId, returns null when not found
- `list` — maps Oracle UPPERCASE rows to camelCase, handles empty result
- `update` — builds dynamic SET clauses, skips when no params, org-scoped
- `delete` — org-scoped DELETE
- `getActiveByEvent` — filters by status + JSON_EXISTS event, decrypts secrets, skips on decrypt failure, lazy-migrates plaintext secrets
- `recordFailure` — increments failure_count, trips circuit breaker at 5
- `recordSuccess` — resets failure_count and last_error
- `migratePlaintextSecrets` — encrypts legacy rows, respects batchSize cap, returns count

**Step 4: Run and verify**
**Step 5: Commit**

---

### Task 5: Org Repository Tests

**Files:**

- Test: `apps/api/src/tests/repositories/org-repository.test.ts`
- Source: `packages/server/src/oracle/repositories/org-repository.ts`

**Mock strategy:** Same as Task 4 — mock `withConnection` + counter-based `execute`.

**Step 1: Smoke test** — verify mock wiring with a simple `list()` call
**Step 2: Run**
**Step 3: Full suite (~10 tests)** — CRUD, member management, org-scoping
**Step 4: Run and verify**
**Step 5: Commit**

---

### Task 6: Workflow Routes Tests (LARGEST — split into subtasks)

**Files:**

- Test: `apps/api/src/tests/routes/workflows.test.ts`
- Source: `apps/api/src/routes/workflows.ts` (1,147 lines, 15 endpoints)

**Mock strategy:** Mock `workflowRepository`, `workflowStreamBus`, `PortalMCPServer`, all with forwarding pattern. Use `buildTestApp({ withRbac: true })`.

**Step 6a: Smoke test — verify route registration works**

Register the workflow routes plugin and verify one endpoint responds:

```typescript
// Just test that GET /api/workflows returns 200 with mocked empty list
```

Run: verify PASS

**Step 6b: CRUD tests (~12 tests)**

- GET /api/workflows — list (200, empty, 401, 403)
- POST /api/workflows — create (201, validation errors)
- GET /api/workflows/:id — get by ID (200, 404, IDOR: wrong org returns 404)
- PUT /api/workflows/:id — update (200, 404, validation)
- DELETE /api/workflows/:id — delete (204, 404)

**Step 6c: Execution + approval tests (~12 tests)**

- POST /api/workflows/:id/execute — start execution (200, 404)
- POST /api/workflows/runs/:runId/approve — approve step (200, 404, already consumed)
- POST /api/workflows/runs/:runId/cancel — cancel run (200, 404)
- POST /api/workflows/runs/:runId/resume — resume suspended run (200, 404)
- GET /api/workflows/runs/:runId — get run status (200, 404)
- GET /api/workflows/runs/:runId/steps — list run steps (200)

**Step 6d: SSE + status tests (~8 tests)**

- GET /api/workflows/runs/:runId/stream — SSE stream (verify headers, event delivery)
- GET /api/workflows/runs — list runs (200, filtered by workflowId)
- POST /api/workflows/:id/crash-recovery — trigger crash recovery (200)

Run full suite: 30-35 tests expected
Commit

---

### Task 7: Workflow Repository Service Tests

**Files:**

- Test: `apps/api/src/tests/services/workflow-repository.test.ts`
- Source: `apps/api/src/services/workflow-repository.ts` (829 lines)

**Mock strategy:** Mock `withConnection` + counter-based `execute`.

**Step 1: Smoke test** — verify mock wiring
**Step 2: Run**
**Step 3: Full suite (~20 tests)** — CRUD operations, row-to-entity mapping, org-scoped queries, run/step tracking, status transitions
**Step 4: Run and verify**
**Step 5: Commit**

---

### Task 8: Final Integration Verification

**Step 1:** Run all new test files together:

```bash
npx vitest run apps/api/src/tests/packages/ apps/api/src/tests/repositories/ apps/api/src/tests/services/ apps/api/src/tests/routes/ --reporter=verbose
```

**Step 2:** Run full API test suite:

```bash
npx vitest run apps/api --reporter=verbose
```

**Step 3:** Verify no regressions — new tests must not break existing ones.

**Step 4:** Count total tests and report coverage improvement.

---

## Wave 2: Repository Coverage (5 tasks, ~60 tests)

| Task                           | Source                                       | Est. Tests |
| ------------------------------ | -------------------------------------------- | ---------- |
| 9. approval-repository.test.ts | `oracle/repositories/approval-repository.ts` | 12         |
| 10. audit-repository.test.ts   | `oracle/repositories/audit-repository.ts`    | 12         |
| 11. session-repository.test.ts | `oracle/repositories/session-repository.ts`  | 10         |
| 12. graph-analytics.test.ts    | `oracle/graph-analytics.ts`                  | 15         |
| 13. types-schemas.test.ts      | `packages/types/src/server/api/types.ts`     | 12         |

All follow the same pattern: mock `withConnection`, counter-based `execute`, verify SQL binds and row mapping.

---

## Wave 3: Frontend + Utility Coverage (5 tasks, ~40 tests)

| Task                             | Source                                           | Est. Tests |
| -------------------------------- | ------------------------------------------------ | ---------- |
| 14. fuzzy-search.test.ts         | `frontend/src/lib/utils/fuzzy-search.ts`         | 10         |
| 15. tool-progress-stream.test.ts | `frontend/src/lib/utils/tool-progress-stream.ts` | 8          |
| 16. admin-schemas.test.ts        | `frontend/src/lib/schemas/admin.ts`              | 8          |
| 17. tools-service.test.ts        | `api/src/services/tools.ts`                      | 6          |
| 18. health-module.test.ts        | `packages/server/src/health.ts`                  | 8          |

Note: Frontend tests use `apps/frontend/vitest.config.ts` which does NOT have `mockReset: true`. Different mock patterns apply.

---

## Execution Order & Dependencies

```
Task 1 (errors) ──── no deps, validates runner works
Task 2 (crypto) ──── no deps, validates env mocking works
Task 3 (approvals) ── no deps, validates timer mocking works
Task 4 (webhook-repo) ── depends on crypto mock pattern from Task 2
Task 5 (org-repo) ──── same pattern as Task 4
Task 6 (workflow routes) ── depends on Task 7 mock patterns
Task 7 (workflow-repo) ── same pattern as Tasks 4-5
Task 8 (verification) ── depends on all above
```

Tasks 1-3 are independent (can parallelize). Tasks 4-5 are independent. Task 6 benefits from Task 7 being done first.

---

## Quality Gates

Before EVERY commit:

1. `npx vitest run <test-file> --reporter=verbose` — all new tests pass
2. `npx vitest run apps/api` — no regressions
3. `cd apps/api && npx tsc --noEmit` — types check

After Wave 1 complete: 4. Full suite: `npx vitest run` — all workspaces 5. Lint: `pnpm lint`
