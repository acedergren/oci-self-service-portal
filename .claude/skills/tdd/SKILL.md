---
name: tdd
description: Test-driven development workflow — write failing tests first, implement minimum code, run full suite, commit.
---

# TDD Implementation Skill

Enforce a strict test-driven development cycle: Red → Green → Refactor → Commit.

## Steps

### 1. Understand the Requirement

Read the task description carefully. Identify:

- **What** behavior needs to exist (inputs, outputs, side effects)
- **Where** it belongs in the codebase (which workspace, which module)
- **Acceptance criteria** (what "done" looks like)

If the requirement is ambiguous, ask the user for clarification before writing any code.

### 2. Find the Right Test File

Locate or create the test file following project conventions:

- **Colocated tests**: `src/lib/server/foo.ts` → `src/lib/server/foo.test.ts`
- **Route tests**: `src/routes/api/v1/bar/+server.ts` → test in nearest `*.test.ts`
- **API tests**: `apps/api/src/routes/foo.ts` → `apps/api/src/routes/foo.test.ts`

If no test file exists, create one with proper imports and `describe()` block.

### 3. Write Failing Tests FIRST (Red Phase)

Write test cases that describe the expected behavior. Include:

- **Happy path**: Normal operation with valid inputs
- **Edge cases**: Empty inputs, boundary values, missing optional fields
- **Error cases**: Invalid inputs, unauthorized access, missing resources

```bash
npx vitest run <test-file> --reporter=verbose
```

**Checkpoint**: All new tests MUST fail. If any pass, the tests are not testing new behavior — revise them. If tests fail for the wrong reason (import errors, missing modules), fix the test setup first.

### 4. Implement Minimum Code (Green Phase)

Write the **minimum** code to make all tests pass. Do NOT:

- Add features not covered by tests
- Optimize prematurely
- Add error handling for untested scenarios
- Refactor existing code (that's the next step)

```bash
npx vitest run <test-file> --reporter=verbose
```

**Checkpoint**: All tests (new and existing) MUST pass.

### 5. Run the FULL Test Suite

This is critical — never skip this step:

```bash
npx vitest run --reporter=verbose
```

If any tests outside your file fail:

1. Determine if your change caused the regression
2. If yes → fix it before proceeding
3. If no (pre-existing failure) → note it but continue

### 6. Refactor (Optional)

If the implementation can be cleaner, refactor now while tests are green:

- Extract helpers for repeated logic
- Improve naming
- Simplify conditionals

Re-run the full suite after any refactor to confirm nothing broke.

### 7. Quality Gates

Run lint and type checks on affected workspaces:

```bash
# Frontend
cd apps/frontend && npx eslint <changed-files> && npx svelte-check --tsconfig ./tsconfig.json --threshold error

# API
cd apps/api && npx eslint <changed-files> && npx tsc --noEmit

# Shared
cd packages/shared && npx tsc --noEmit
```

Fix any issues before committing.

### 8. Commit

Stage only the files you changed and commit:

```
type(scope): description

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

Use `test` type if the commit is primarily tests, `feat` if it's a new feature with tests.

## Arguments

- `$ARGUMENTS`: Optional description of what to implement via TDD
  - Example: `/tdd add rate limiting to the search endpoint`
  - If empty, ask the user what to implement

## Key Rules

1. **Never write implementation before tests** — this is the whole point of TDD
2. **Never skip step 5** — the full suite must pass, not just your file
3. **Tests should fail for the RIGHT reason** — a test that fails because of a missing import isn't a valid "red" test
4. **One logical change per cycle** — don't batch multiple features into one TDD cycle
5. **When tests fail after refactor, question the TESTS first** — they may have bad assumptions
