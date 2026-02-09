#!/bin/bash
# Post-edit: run ESLint --fix on edited TypeScript/Svelte files
# Complements Prettier (formatting) with ESLint (code quality)
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

# Only lint TypeScript and Svelte files
if ! echo "$FILE_PATH" | grep -qE '\.(ts|svelte)$'; then
  exit 0
fi

# Only lint if the file exists
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Run ESLint fix (fail silently — auto-fix is best-effort)
if command -v npx &>/dev/null; then
  npx eslint --fix "$FILE_PATH" 2>/dev/null || true
fi

exit 0
