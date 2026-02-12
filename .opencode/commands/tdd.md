---
name: tdd
description: Test-driven development workflow (Red -> Green -> Refactor -> Gates -> Commit).
---

# TDD

Strict Red -> Green -> Refactor -> Commit loop.

## Workflow

1. Understand the requirement (inputs/outputs/side effects, acceptance criteria)
2. Locate/create the right test file
3. Red: write failing tests first; run only that test file
4. Green: implement minimum code to pass; re-run the same test file
5. Run full suite (do not skip)
6. Optional refactor while green
7. Quality gates: lint + typecheck for affected workspaces
8. Stage only changed files; commit one logical unit

## Commands

Run a single test file:

```bash
npx vitest run <test-file> --reporter=verbose
```

Run full suite:

```bash
npx vitest run --reporter=dot
```

Typecheck:

```bash
cd apps/api && npx tsc --noEmit
cd apps/frontend && npx svelte-check --tsconfig ./tsconfig.json --threshold error
cd packages/shared && npx tsc --noEmit
```

Reference: `.claude/skills/tdd/SKILL.md`
