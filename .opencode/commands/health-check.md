---
name: health-check
description: Run repo-wide quality gates (typecheck/tests/security/lint) and print a summary table.
---

# Health Check (OpenCode)

Run a full diagnostic across the repo: typechecks, tests, circular deps, dead code, and optional security tooling.

Principles:

- Run everything; do not stop on failures.
- Prefer repo-local tooling via `pnpm`/`npx`.
- If a tool is not installed, record as `SKIP`.
- Print a single summary table at the end.

## Steps

### 1) Typecheck (shared)

```bash
cd packages/shared && npx tsc --noEmit
```

### 2) Typecheck (api)

```bash
cd apps/api && npx tsc --noEmit
```

### 3) Typecheck (frontend)

```bash
cd apps/frontend && npx svelte-check --tsconfig ./tsconfig.json --threshold error
```

### 4) Tests (full)

```bash
npx vitest run --reporter=dot
```

### 5) Circular deps (madge)

```bash
npx madge --circular --ts-config packages/shared/tsconfig.json packages/shared/src/
npx madge --circular --ts-config apps/api/tsconfig.json apps/api/src/
```

### 6) Dead code (knip)

```bash
npx knip --no-progress
```

### 7) Dependency audit (pnpm)

```bash
pnpm audit --prod
```

### Optional security tools (SKIP if missing)

```bash
semgrep scan --config auto --severity ERROR --severity WARNING --quiet --no-git-ignore apps/api/src/ apps/frontend/src/ packages/shared/src/
trufflehog git "file://$(pwd)" --only-verified --no-update --json | head -100
```

## Output

Print a single table:

```text
| Gate         | Status | Details |
|--------------|--------|---------|
| tsc shared   | PASS   | ...     |
| tsc api      | PASS   | ...     |
| svelte-check | PASS   | ...     |
| tests        | PASS   | ...     |
| madge        | PASS   | ...     |
| knip         | WARN   | ...     |
| pnpm audit   | PASS   | ...     |
| semgrep      | SKIP   | ...     |
| trufflehog   | SKIP   | ...     |
```
