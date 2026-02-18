#!/bin/bash
# Post-edit: check if edited .ts file introduces circular dependencies
# Uses madge --circular on the edited file. Fast (~1s).
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

# Only for TypeScript files in src directories
if ! echo "$FILE_PATH" | grep -qE '\.ts$'; then
  exit 0
fi
if echo "$FILE_PATH" | grep -qE '\.(test|spec)\.ts$'; then
  exit 0
fi
if ! echo "$FILE_PATH" | grep -qE '/(apps|packages)/'; then
  exit 0
fi

if ! command -v npx &>/dev/null; then
  exit 0
fi

# Run madge --circular on the file's directory (scoped, not full project)
# Determine the workspace root for this file
if echo "$FILE_PATH" | grep -q "apps/api/"; then
  TSCONFIG="$CLAUDE_PROJECT_DIR/apps/api/tsconfig.json"
elif echo "$FILE_PATH" | grep -q "apps/frontend/"; then
  TSCONFIG="$CLAUDE_PROJECT_DIR/apps/frontend/tsconfig.json"
elif echo "$FILE_PATH" | grep -q "packages/shared/"; then
  TSCONFIG="$CLAUDE_PROJECT_DIR/packages/shared/tsconfig.json"
else
  exit 0
fi

RESULT=$(npx madge --circular --ts-config "$TSCONFIG" "$FILE_PATH" 2>/dev/null || true)

if echo "$RESULT" | grep -q "Found [1-9]"; then
  echo "⚠ Circular dependency detected:"
  echo "$RESULT" | head -10
  # Warning only — don't block the edit
  exit 0
fi

exit 0
