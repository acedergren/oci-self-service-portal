#!/bin/bash
# Post-edit: run related test file when a source file is edited
# Maps src/lib/server/foo.ts → src/tests/**/foo.test.ts (or colocated .test.ts)
set -e

INPUT=$(cat)

# Extract file path
if command -v jq &>/dev/null; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || echo "")
else
  FILE_PATH=""
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only for TypeScript source files (not test files themselves, not .svelte)
if ! echo "$FILE_PATH" | grep -qE '\.ts$'; then
  exit 0
fi
if echo "$FILE_PATH" | grep -qE '\.(test|spec)\.ts$'; then
  exit 0
fi

# Determine the base name without extension
BASENAME=$(basename "$FILE_PATH" .ts)
DIR=$(dirname "$FILE_PATH")

# Strategy 1: Colocated test (same directory)
COLOCATED="$DIR/$BASENAME.test.ts"
if [ -f "$COLOCATED" ]; then
  echo "Running colocated test: $COLOCATED"
  npx vitest run "$COLOCATED" --reporter=verbose 2>&1 | tail -20
  exit 0
fi

# Strategy 2: Search in tests/ directories for matching name
if [ -n "$CLAUDE_PROJECT_DIR" ]; then
  FOUND=$(find "$CLAUDE_PROJECT_DIR" -name "$BASENAME.test.ts" -not -path "*/node_modules/*" 2>/dev/null | head -1)
  if [ -n "$FOUND" ]; then
    echo "Running related test: $FOUND"
    npx vitest run "$FOUND" --reporter=verbose 2>&1 | tail -20
    exit 0
  fi
fi

# No matching test found — that's fine, not every file has one
exit 0
