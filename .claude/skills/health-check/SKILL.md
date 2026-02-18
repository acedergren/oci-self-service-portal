---
name: health-check
description: Run all quality gates across the entire codebase and report results. Headless — no analysis, just execute and print.
---

# Health Check

Full codebase diagnostic: typecheck, tests, security scans, dead code, circular deps, package health. Reports a summary table.

**This skill is headless.** Run each step as a single Bash command, capture the exit code and key output lines, then print the summary table. Do NOT analyze output, suggest fixes, or spawn agents. Just report what passed and what failed.

## Steps

Run all steps. Capture exit code and summary line from each. Do NOT stop on failure — run everything and report at the end.

### 1. Shared Package Type Check

```bash
cd packages/shared && npx tsc --noEmit 2>&1; echo "EXIT:$?"
```

Capture: exit code + error count (grep for "error TS").

### 2. API Type Check

```bash
cd apps/api && npx tsc --noEmit 2>&1; echo "EXIT:$?"
```

Capture: exit code + error count.

### 3. Frontend Type Check

```bash
cd apps/frontend && npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1; echo "EXIT:$?"
```

Capture: exit code + error/warning counts from the final summary line.

### 4. Full Test Suite

```bash
npx vitest run --reporter=dot 2>&1; echo "EXIT:$?"
```

Use `dot` reporter to minimize output. Capture: exit code + pass/fail counts from the summary line.

### 5. Semgrep Security Scan

```bash
semgrep scan --config auto --severity ERROR --severity WARNING --quiet --no-git-ignore apps/api/src/ apps/frontend/src/ packages/shared/src/ 2>&1; echo "EXIT:$?"
```

If `semgrep` is not installed, record as SKIP. Capture: exit code + finding count.

### 6. CodeQL Security Analysis

```bash
CODEQL_DB_DIR=$(mktemp -d)
codeql database create "$CODEQL_DB_DIR/db" --language=javascript --source-root="$(pwd)" --overwrite --quiet 2>/dev/null && \
codeql database analyze "$CODEQL_DB_DIR/db" --format=sarif-latest --output="$CODEQL_DB_DIR/results.sarif" --quiet \
  codeql/javascript-queries:codeql-suites/javascript-security-extended.qls 2>/dev/null && \
python3 -c "
import json
with open('$CODEQL_DB_DIR/results.sarif') as f:
    sarif = json.load(f)
    results = []
    for run in sarif.get('runs', []):
        for r in run.get('results', []):
            rule = r.get('ruleId', 'unknown')
            locs = r.get('locations', [])
            loc = ''
            if locs:
                phys = locs[0].get('physicalLocation', {})
                uri = phys.get('artifactLocation', {}).get('uri', '')
                line = phys.get('region', {}).get('startLine', '?')
                loc = f'{uri}:{line}'
            msg = r.get('message', {}).get('text', '')[:100]
            results.append(f'  [{rule}] {loc}: {msg}')
    print(f'{len(results)} finding(s)')
    for line in results:
        print(line)
" 2>/dev/null
echo "EXIT:$?"
rm -rf "$CODEQL_DB_DIR"
```

If `codeql` is not installed, record as SKIP. CodeQL is slow (~60-90s) — use a 120s timeout.

### 7. Trufflehog Secret Scan

```bash
trufflehog git "file://$(pwd)" --only-verified --no-update --json 2>&1 | head -100; echo "EXIT:$?"
```

If `trufflehog` is not installed, record as SKIP. Capture: count of verified secrets (grep for `"DetectorName"`). Full repo scan (not incremental like pre-push).

### 8. Spectral OWASP (OpenAPI Lint)

```bash
pnpm --filter @portal/api swagger:export -- /tmp/openapi-healthcheck.json 2>/dev/null && \
npx spectral lint /tmp/openapi-healthcheck.json --ruleset .spectral.yaml 2>&1; echo "EXIT:$?"
rm -f /tmp/openapi-healthcheck.json
```

Requires `@stoplight/spectral-cli` and `.spectral.yaml`. Exports OpenAPI spec from Fastify swagger, then lints against OWASP ruleset. Capture: error/warning counts.

### 9. Cherrybomb API Security

```bash
pnpm --filter @portal/api swagger:export -- /tmp/openapi-healthcheck.json 2>/dev/null && \
cherrybomb --no-telemetry --file /tmp/openapi-healthcheck.json --profile passive 2>&1; echo "EXIT:$?"
rm -f /tmp/openapi-healthcheck.json
```

If `cherrybomb` is not installed, record as SKIP. Static OpenAPI security analysis. Capture: alert count. Record WARN (not FAIL) — can be noisy.

### 10. nodejsscan Static Analysis

```bash
nodejsscan --directory apps/api/src/ --output /tmp/nodejsscan-results.json 2>/dev/null && \
python3 -c "
import json
with open('/tmp/nodejsscan-results.json') as f:
    data = json.load(f)
    total = data.get('total_count', {})
    good = total.get('good', 0)
    mis = total.get('mis', 0)
    sec = total.get('sec', 0)
    print(f'{sec} security, {mis} misconfiguration, {good} good practices')
" 2>/dev/null
echo "EXIT:$?"
rm -f /tmp/nodejsscan-results.json
```

If `nodejsscan` is not installed, record as SKIP. Scans Node.js source for known vulnerability patterns. Record WARN for mis/sec findings.

### 11. Circular Dependency Check (madge)

```bash
npx madge --circular --ts-config packages/shared/tsconfig.json packages/shared/src/ 2>&1; echo "EXIT:$?"
npx madge --circular --ts-config apps/api/tsconfig.json apps/api/src/ 2>&1; echo "EXIT:$?"
```

Capture: exit code + cycle count from each workspace. Record FAIL if any cycles found.

### 12. Dead Code / Unused Exports (knip)

```bash
npx knip --no-progress 2>&1; echo "EXIT:$?"
```

Capture: exit code + counts of unused files, exports, dependencies. Record WARN (not FAIL) — knip can be noisy on first run.

### 13. Dependency Vulnerabilities (pnpm audit)

```bash
pnpm audit --prod 2>&1; echo "EXIT:$?"
```

Capture: exit code + vulnerability count by severity. `--prod` skips devDependencies. Record WARN for low/moderate, FAIL for high/critical.

### 14. Package Exports Validation (attw + publint)

Only run on `packages/shared`:

```bash
cd packages/shared && npx publint 2>&1; echo "EXIT:$?"
cd packages/shared && npx attw --pack 2>&1; echo "EXIT:$?"
```

If shared package hasn't been built, run `pnpm --filter @portal/shared build` first. Capture: exit code + issue count from each tool.

## 15. Summary Table

After all steps complete, print a single summary:

```
## Health Check Results

| Gate         | Status | Details                          |
|--------------|--------|----------------------------------|
| tsc shared   | PASS   | 0 errors                         |
| tsc api      | PASS   | 0 errors                         |
| svelte-check | PASS   | 0 errors, 3 warnings             |
| Tests        | PASS   | 1200 passed, 0 failed            |
| Semgrep      | PASS   | 0 findings                       |
| CodeQL       | PASS   | 0 findings                       |
| Trufflehog   | PASS   | 0 verified secrets               |
| Spectral     | PASS   | 0 errors, 2 warnings             |
| Cherrybomb   | SKIP   | not installed                    |
| nodejsscan   | PASS   | 0 security, 0 misconfiguration   |
| madge        | PASS   | 0 circular dependencies          |
| knip         | WARN   | 3 unused exports, 1 unused dep   |
| pnpm audit   | PASS   | 0 vulnerabilities                |
| publint      | PASS   | 0 issues                         |
| attw         | PASS   | 0 issues                         |
```

Status values: `PASS`, `FAIL`, `SKIP` (tool not installed), `WARN` (non-zero findings but non-blocking).

**That's it.** Do not suggest fixes, do not analyze errors, do not read files. Just print the table. If the user wants details, they'll ask.

## Arguments

- `$ARGUMENTS`: Optional flags:
  - `--quick`: Skip CodeQL + Trufflehog + Cherrybomb + attw + publint (saves ~2-3min)
  - `--security-only`: Only Semgrep + CodeQL + Trufflehog + Spectral + Cherrybomb + nodejsscan + pnpm audit
  - `--code-quality`: Only knip + madge + typecheck (skip security + tests)
  - If empty: Run all 15 gates
