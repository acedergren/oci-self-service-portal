# QA Verification Checklist (Phase 10+)

When agents report task completion, run these verification checks:

## 1. Package.json updates (haiku-deps-1)

```bash
pnpm install && cd apps/frontend && npx tsc --noEmit 2>&1 | tail -15
```

**Look for:** No type errors, successful install

## 2. API changes (sonnet-impl-2, sonnet-impl-3, streaming)

```bash
cd apps/api && npx tsc --noEmit 2>&1 | tail -15
```

**Look for:** No type errors

## 3. Workflow node tests (sonnet-impl-2)

```bash
npx vitest run apps/api/src/tests/workflows/ 2>&1 | tail -20
```

**Look for:** All tests passing

## 4. Frontend Svelte (sonnet-impl-3)

```bash
cd apps/frontend && npx svelte-check 2>&1 | tail -20
```

**Look for:** 0 errors

## Reporting

- Report PASS/FAIL to team-lead AND to the completing agent
- Be specific about error locations if FAIL

## Pre-committed (skip verification)

- Phase F SQL migrations (015, 016, 017) — commit 05b40206
