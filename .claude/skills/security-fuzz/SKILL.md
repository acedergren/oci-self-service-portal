---
name: security-fuzz
description: Run CATS DAST fuzzer against a running Fastify API instance. Requires a live server.
---

# Security Fuzz (CATS)

Dynamic Application Security Testing (DAST) using [CATS](https://github.com/Endava/cats) against a running Fastify API.

CATS generates thousands of malformed requests from the OpenAPI spec — fuzzing headers, payloads, paths, and auth — to find runtime vulnerabilities that static tools miss.

## Prerequisites

- **Java 11+**: `java --version` (OpenJDK 21 installed)
- **CATS JAR**: Download from GitHub releases if not present
- **Running Fastify server**: `pnpm --filter @portal/api dev` (default: `http://localhost:3001`)

## Steps

### 1. Check prerequisites

```bash
# Check Java
java --version 2>&1 | head -1; echo "EXIT:$?"

# Check CATS
CATS_JAR="$HOME/.local/bin/cats.jar"
if [ ! -f "$CATS_JAR" ]; then
  echo "CATS not found at $CATS_JAR"
  echo "Installing CATS..."
  mkdir -p "$HOME/.local/bin"
  CATS_VERSION=$(curl -s https://api.github.com/repos/Endava/cats/releases/latest | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'].lstrip('v'))" 2>/dev/null || echo "12.0.0")
  curl -sL "https://github.com/Endava/cats/releases/download/cats-${CATS_VERSION}/cats.jar" -o "$CATS_JAR"
  echo "CATS ${CATS_VERSION} downloaded to $CATS_JAR"
fi
echo "EXIT:$?"
```

### 2. Export OpenAPI spec

```bash
pnpm --filter @portal/api swagger:export -- /tmp/cats-openapi.json 2>&1; echo "EXIT:$?"
```

### 3. Verify API is running

```bash
curl -sf http://localhost:3001/health 2>&1; echo "EXIT:$?"
```

If the API is not running, instruct the user:

> Start the API first: `pnpm --filter @portal/api dev`

Do NOT start the API yourself — the user should control server lifecycle.

### 4. Run CATS fuzzer

```bash
CATS_JAR="$HOME/.local/bin/cats.jar"
java -jar "$CATS_JAR" \
  --contract /tmp/cats-openapi.json \
  --server http://localhost:3001 \
  --skipFuzzers HappyFuzzer \
  --reportFormat htmlJs \
  --output /tmp/cats-report \
  --maxRequestsPerMinute 100 \
  --connectionTimeout 5000 \
  2>&1 | tail -30
echo "EXIT:$?"
```

Options:

- `--skipFuzzers HappyFuzzer`: Skip positive-case tests (focus on security)
- `--maxRequestsPerMinute 100`: Rate limit to avoid overwhelming local dev server
- `--connectionTimeout 5000`: 5s timeout per request
- `--reportFormat htmlJs`: Generate browsable HTML report

### 5. Parse results

```bash
if [ -f /tmp/cats-report/index.html ]; then
  echo "Report generated at: /tmp/cats-report/index.html"
  echo "Open with: open /tmp/cats-report/index.html"
fi

# Count findings by severity
python3 -c "
import json, glob, os
errors = warnings = 0
for f in glob.glob('/tmp/cats-report/**/*.json', recursive=True):
    try:
        data = json.load(open(f))
        result = data.get('result', '').lower()
        if 'error' in result: errors += 1
        elif 'warn' in result: warnings += 1
    except: pass
print(f'{errors} error(s), {warnings} warning(s)')
" 2>/dev/null
echo "EXIT:$?"
```

### 6. Summary

Print a one-line summary:

```
CATS Fuzz Results: X errors, Y warnings — Report: /tmp/cats-report/index.html
```

Clean up temp spec file:

```bash
rm -f /tmp/cats-openapi.json
```

Do NOT clean up the report — the user needs to review it.

## Arguments

- `$ARGUMENTS`: Optional flags:
  - `--server <url>`: Override server URL (default: `http://localhost:3001`)
  - `--fuzzers <list>`: Run specific fuzzers only (comma-separated)
  - `--paths <regex>`: Only fuzz paths matching regex (e.g., `/api/v1/workflows`)
  - If empty: Fuzz all paths with all security fuzzers
