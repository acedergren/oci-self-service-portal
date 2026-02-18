---
name: implement
description: Full feature pipeline — pre-flight checks, TDD cycle, scope guard, quality commit. Combines pre-flight + tdd + scope-check + quality-commit into one flow.
---

# Implement

End-to-end feature implementation pipeline. Runs pre-flight validation, TDD cycle, scope enforcement, and quality commit as a single orchestrated flow.

## Pipeline Phases

### Phase 0: Pre-flight (< 30 seconds)

Before writing any code, validate the workspace is ready:

1. **Git status** — check for uncommitted changes that might conflict
2. **Shared package freshness** — compare `packages/shared/src/` mtime against `packages/shared/dist/` mtime. If source is newer, run `pnpm --filter @portal/shared build`
3. **Workspace typecheck** — run `tsc --noEmit` on the target workspace (determine from `$ARGUMENTS` path)
4. **Existing test check** — if a test file exists for the target module, run it to confirm green baseline

If any check fails, report and ask the user how to proceed before writing code.

### Phase 1: Understand & Plan (no code yet)

1. Read the target file(s) mentioned in `$ARGUMENTS`
2. Identify the module type (route handler, repository, plugin, utility, service)
3. Determine the mock strategy from the table in `/write-tests`
4. Plan what tests to write and what implementation to add

Present a brief summary: "I'll add X tests covering Y, then implement Z." Wait for user confirmation if the scope seems large (> 3 files).

### Phase 2: Bootstrap Mock (1 test)

Follow `/tdd` Step 3 exactly:

1. Check vitest config for `mockReset` settings
2. Write ONE minimal test with `vi.hoisted()` + forwarding pattern
3. Run it, confirm it passes
4. If it fails, diagnose mock wiring before proceeding

### Phase 3: Red — Write Failing Tests

Write test cases for:

- Happy path
- Edge cases
- Error cases

Run the test file — all new tests MUST fail. If any pass unexpectedly, the tests aren't testing new behavior.

### Phase 4: Green — Minimum Implementation

Write the minimum code to make all tests pass. Do NOT:

- Add features not covered by tests
- Optimize prematurely
- Refactor existing code

Run the test file — all tests MUST pass.

### Phase 5: Scope Guard

Before committing, self-audit the changes:

1. Run `git diff --name-only` to see all modified files
2. Compare against the original task from `$ARGUMENTS`
3. Flag any files that don't relate to the task:
   - Formatting-only changes → revert with `git checkout -- <file>`
   - Unrelated refactors → revert or split into separate commit
   - Docstring additions to untouched code → revert

If scope creep is detected, report it and ask the user whether to keep or revert the extra changes.

### Phase 6: Full Suite + Quality Gates

1. Run the full test suite: `npx vitest run --reporter=dot`
2. Run workspace typecheck: `tsc --noEmit` (or `svelte-check` for frontend)
3. Run ESLint on changed files only

If any gate fails:

- Test failure: determine if your change caused it (regression) or pre-existing
- Type error: fix it
- Lint error in your files: fix it
- Lint error in files you didn't touch: ignore, note in commit message

### Phase 7: Commit

Stage only the files you changed (NEVER `git add -A`). Commit with conventional format:

```
type(scope): description

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

## Abort Conditions

STOP the pipeline and ask the user if:

- Pre-flight finds the workspace in a broken state
- More than 5 files need modification (scope may be too large)
- Bootstrap mock test fails after 2 attempts
- Full suite regression is caused by your changes

## Arguments

- `$ARGUMENTS`: What to implement
  - Example: `/implement add rate limiting to POST /api/search`
  - Example: `/implement apps/api/src/routes/admin/settings.ts — add PATCH endpoint for theme`
  - If empty, ask the user what to implement
