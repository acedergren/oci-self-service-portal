# Post-Migration Validation Plan

> **For Claude:** Use `/orchestrate docs/plans/2026-02-16-post-migration-validation.md` to execute.

**Goal:** Run all Phase 10 post-migration quality gates, fix failing tests (26 frontend failures from stale Phase C references), resolve svelte-check type errors (237 in 70 files), fix syncpack mismatches, clean up knip findings, run security scan, and update documentation to reflect the completed Phase 10 architecture.

**Architecture:** All 6 Phase 10 sub-phases (A-F) plus Phase G admin UI are implemented. This plan validates completeness, fixes test/type regressions from the Fastify-first migration, and formally closes Phase 10 with passing quality gates.

**Tech Stack:** Vitest 4, TypeScript, svelte-check, syncpack, knip, Semgrep, pnpm workspaces.

**Background:** Phase 10 rewrote the portal's architecture: SvelteKit API routes migrated to Fastify (Phase C deleted 37 +server.ts files), packages split from @portal/shared into @portal/types + @portal/server + @portal/ui, OCI tools migrated from CLI to SDK, Oracle 26AI features deployed. Frontend tests written during Phases 4-8 reference deleted SvelteKit modules and need removal or updates. The svelte-check errors are mostly implicit `any` types on callback params and stale module imports.

**Setup:**

1. Ensure `pnpm install` is current
2. Read failing test files to understand root causes
3. Check svelte-check error patterns for batch-fixable categories

---

### Task 1: Fix syncpack version mismatches

**Files:**

- Modify: `apps/api/package.json`
- Modify: `apps/frontend/package.json`
- Modify: `packages/shared/package.json`
- Modify: `packages/server/package.json`
- Modify: `packages/types/package.json`
- Modify: `packages/ui/package.json`

**Step 1: Run syncpack auto-fix**

Command: `npx syncpack fix-mismatches`

Expected: 13 LocalPackageMismatch and HighestSemverMismatch issues resolved. workspace:\* refs should align with actual package versions. svelte/svelte-check ranges in packages/ui should match apps/frontend.

**Step 2: Verify fix**

Command: `npx syncpack lint` → expect 0 errors (only semver range config notice).

**Step 3: Verify install**

Command: `pnpm install` → clean install, no version conflicts.

**Step 4: Run tests**

Command: `cd apps/api && npx vitest run` → 888+ passed.

**Step 5: Commit**

`git add apps/api/package.json apps/frontend/package.json packages/shared/package.json packages/server/package.json packages/types/package.json packages/ui/package.json pnpm-lock.yaml`

`git commit -m "chore(deps): fix syncpack version mismatches across workspaces"`

---

### Task 2: Remove stale SvelteKit API tests (Phase C debris)

**Files:**

- Delete: `apps/frontend/src/tests/phase5/activity-api.test.ts` (tests deleted +server.ts module importability)
- Delete: `apps/frontend/src/tests/phase4/execute-endpoint.test.ts` (tests deleted +server.ts module importability)
- Delete: `apps/frontend/src/tests/phase5/session-list.test.ts` (tests deleted +server.ts module importability)
- Delete: `apps/frontend/src/tests/phase4/cors-v1-api.test.ts` (tests CORS on deleted SvelteKit error handler)

These 4 test files test code that was intentionally removed in Phase C (Fastify-first migration). The functionality they tested now lives in Fastify route tests under `apps/api/src/tests/routes/`.

**Step 1: Verify Fastify equivalents exist**

Check that `apps/api/src/tests/routes/` has tests covering: activity endpoint, execute endpoint, session list, CORS. If equivalents exist, safe to delete frontend versions. If not, note the gap and create stubs in the API test directory instead.

**Step 2: Delete stale test files**

Remove the 4 files identified above.

**Step 3: Run frontend tests**

Command: `cd apps/frontend && npx vitest run` → confirm 6 fewer failures (these 4 files had 6 total failures).

**Step 4: Commit**

`git commit -m "test(frontend): remove stale SvelteKit API tests superseded by Fastify routes"`

---

### Task 3: Fix webhook validation tests (async/await mismatch)

**Files:**

- Modify: `apps/frontend/src/tests/phase8/webhooks.test.ts` (3 failures — isValidWebhookUrl returns Promise)
- Modify: `apps/frontend/src/tests/phase8/webhook-validation-fixes.test.ts` (14 failures — validation schema changes)

**Step 1: Read the current isValidWebhookUrl implementation**

Check whether `isValidWebhookUrl()` was changed to async (returns Promise) or the export path changed. The test expects sync boolean returns but receives Promise objects.

**Step 2: Fix webhooks.test.ts**

If the function is now async, add `await` to all `isValidWebhookUrl()` calls in the test. If the function moved to a different module, update the import path.

**Step 3: Fix webhook-validation-fixes.test.ts**

Read the test file and the source module it tests. The 14 failures suggest the Zod validation schema changed during Phase 10. Update the test to match the current schema shape (field names, validation rules, error messages).

**Step 4: Run webhook tests**

Command: `cd apps/frontend && npx vitest run src/tests/phase8/webhooks.test.ts src/tests/phase8/webhook-validation-fixes.test.ts` → all 17 tests should pass.

**Step 5: Commit**

`git commit -m "fix(test): update webhook validation tests for async SSRF checks and schema changes"`

---

### Task 4: Fix remaining frontend test failures

**Files:**

- Modify: `apps/frontend/src/tests/phase4/medium-findings.test.ts` (1 failure — switchToSessionFallback)
- Modify: `apps/frontend/src/tests/phase8/idcs-provisioning.test.ts` (1 failure — provisionFromIdcsGroups)

**Step 1: Read failing tests and their source modules**

Understand what changed: module paths, function signatures, or behavior.

**Step 2: Fix medium-findings.test.ts**

The `switchToSessionFallback` test likely fails because the function moved from SvelteKit hooks to Fastify auth plugin. Update the import path or remove the test if the functionality is now covered in API tests.

**Step 3: Fix idcs-provisioning.test.ts**

The `provisionFromIdcsGroups` test likely has an import path change after the @portal/shared → @portal/server migration. Update the import.

**Step 4: Run all frontend tests**

Command: `cd apps/frontend && npx vitest run` → 0 failures, 928+ passed.

**Step 5: Commit**

`git commit -m "fix(test): update medium-findings and IDCS provisioning tests for new module paths"`

---

### Task 5: Fix svelte-check type errors (237 errors in 70 files)

**Files:**

- Modify: Multiple files under `apps/frontend/src/` (70 files with type errors)

**Step 1: Categorize errors by pattern**

Run `cd apps/frontend && npx svelte-check 2>&1 | grep "Error:" | sort | uniq -c | sort -rn | head -20` to identify the most common error patterns. Expected patterns:

- Implicit `any` on callback parameters (add type annotations)
- Missing module `$lib/components/ui/index.js` (fix barrel export path)
- Property does not exist on type (component prop changes)

**Step 2: Fix barrel export issue**

If `$lib/components/ui/index.js` is missing, either create it or update imports to use specific component paths. This likely affects multiple files.

**Step 3: Fix implicit any parameters**

Add explicit types to callback parameters in Svelte components. Common pattern: `onNameChange={(name: string) => {...}}`, `onSelectRun={(id: string) => {...}}`.

**Step 4: Fix remaining type errors**

Address remaining errors by category: missing props, wrong types, deprecated APIs.

**Step 5: Run svelte-check**

Command: `cd apps/frontend && npx svelte-check` → 0 errors.

**Step 6: Run frontend tests**

Command: `cd apps/frontend && npx vitest run` → all pass (ensure fixes didn't break tests).

**Step 7: Commit**

`git commit -m "fix(frontend): resolve 237 svelte-check type errors across 70 files"`

---

### Task 6: Clean up knip findings

**Files:**

- Modify: `knip.config.ts` (root — remove stale ignoreDependencies, refine entry patterns)
- Modify: `apps/api/src/routes/schemas.ts` (remove or re-export 14 unused type exports)
- Modify: `apps/api/src/services/approvals.ts` (prefix unused exports with \_ or remove)
- Modify: `apps/api/src/services/tools.ts` (same)
- Modify: `apps/api/src/mastra/tools/types.ts` (remove 4 unused interfaces)
- Modify: `apps/api/src/mastra/mcp/portal-mcp-server.ts` (remove unused MCPToolResult)

**Step 1: Fix knip.config.ts**

Remove 10+ stale `ignoreDependencies` entries that knip says are no longer needed. Refine entry patterns that don't match.

**Step 2: Remove truly unused exports**

For each unused export, verify it's not used dynamically (e.g., by Fastify schema resolution or Zod inference). If truly unused, remove the export keyword or delete the type/function. If used dynamically, add to knip ignore list with a comment explaining why.

**Step 3: Run knip**

Command: `npx knip` → 0 unused exports, 0 configuration hints.

**Step 4: Run tests**

Command: `cd apps/api && npx vitest run` → all pass.

**Step 5: Commit**

`git commit -m "chore(knip): remove unused exports and fix knip configuration"`

---

### Task 7: Run Semgrep security scan

**Files:**

- N/A (scan only, remediate if needed)

**Step 1: Run Semgrep**

Command: `npx semgrep scan --config auto apps/api/src apps/frontend/src packages/server/src packages/types/src 2>&1 | tail -50`

**Step 2: Triage findings**

- Critical/High: Fix immediately in this task
- Medium: Create follow-up task if not blocking
- Low/Info: Document and skip

**Step 3: Fix critical findings**

Apply fixes for any critical or high findings. Common patterns: eval usage, SQL injection, XSS.

**Step 4: Commit fixes (if any)**

`git commit -m "fix(security): address Semgrep findings from post-migration scan"`

---

### Task 8: Update documentation for Phase 10 completion

**Files:**

- Modify: `CLAUDE.md` (update test counts, package structure notes, verify accuracy)
- Modify: `.claude/reference/PRD.md` (mark post-migration checklist items as done)

**Step 1: Update CLAUDE.md**

- Update test count in "Test Infrastructure" section to reflect current numbers (888 API + 928 frontend)
- Verify package structure diagram matches reality (packages/types, packages/server, packages/ui, packages/shared still exists as legacy)
- Update any stale references to Phase 9 or pre-migration architecture

**Step 2: Update PRD post-migration checklist**

Mark each validation gate as [x] completed with the date:

- [x] Full test suite — all passing
- [x] Semgrep security scan
- [x] pnpm outdated
- [x] knip
- [x] syncpack lint
- [x] svelte-check — 0 errors
- [x] Zero +server.ts API routes
- etc.

**Step 3: Commit**

`git commit -m "docs: update CLAUDE.md and PRD for Phase 10 completion"`

---

### Task 9: Final validation gate

**Files:** N/A (verification only)

**Step 1: Full test suite**

```bash
cd apps/api && npx vitest run          # → 888+ passed
cd apps/frontend && npx vitest run     # → 928+ passed, 0 failed
```

**Step 2: Type checks**

```bash
cd apps/api && npx tsc --noEmit        # → clean
cd apps/frontend && npx svelte-check   # → 0 errors
cd packages/server && npx tsc --noEmit # → clean
cd packages/types && npx tsc --noEmit  # → clean
```

**Step 3: Lint + deps**

```bash
pnpm lint                              # → all clean
npx syncpack lint                      # → 0 mismatches
npx knip                               # → 0 unused
```

**Step 4: Document results**

Create `docs/validation/2026-02-16-post-migration.txt` with all gate outputs.

**Step 5: Commit**

`git commit -m "chore(qa): record Phase 10 post-migration validation gates"`

---

## Testing

- After Task 1: `npx syncpack lint` → 0 errors
- After Task 2: Frontend test count drops by ~6, remaining failures drop to 20
- After Task 3: Webhook tests pass (17 previously failing tests now green)
- After Task 4: All frontend tests pass (0 failures)
- After Task 5: `npx svelte-check` → 0 errors
- After Task 6: `npx knip` → 0 findings
- After Task 7: `npx semgrep scan` → 0 critical/high
- After Task 8: CLAUDE.md and PRD are current
- After Task 9: All gates pass simultaneously — Phase 10 formally complete

## Wave Structure

**Wave 1** (Tasks 1, 2, 6 — parallel, all quick fixes):

- syncpack fix (haiku, 15min)
- Remove stale tests (haiku, 15min)
- knip cleanup (haiku, 20min)

**Wave 2** (Tasks 3, 4, 5 — parallel, test/type fixes):

- Webhook test fixes (sonnet, 30min)
- Remaining test fixes (sonnet, 20min)
- svelte-check fixes (sonnet, 60min)

**Wave 3** (Tasks 7, 8 — parallel, security + docs):

- Semgrep scan (haiku, 20min)
- Documentation update (haiku, 20min)

**Wave 4** (Task 9 — sequential, final gate):

- Full validation (haiku, 15min)

**Gate per wave:**

- Wave 1 gate: `pnpm install && cd apps/api && npx vitest run`
- Wave 2 gate: `cd apps/frontend && npx vitest run && npx svelte-check` → 0 errors
- Wave 3 gate: Semgrep 0 critical, docs committed
- Wave 4 gate: ALL gates pass simultaneously
