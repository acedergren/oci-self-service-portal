#!/bin/bash
# Post-edit: run workspace-scoped tsc --noEmit on edited TypeScript files
# Only checks the workspace containing the edited file (not the full monorepo)
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

# Only typecheck TypeScript files
if ! echo "$FILE_PATH" | grep -qE '\.tsx?$'; then
  exit 0
fi

# Skip test files — type errors in mocks are noisy and often intentional
if echo "$FILE_PATH" | grep -qE '\.(test|spec)\.tsx?$'; then
  exit 0
fi

# Only check if the file exists
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Determine which workspace to typecheck based on file path
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

if echo "$FILE_PATH" | grep -q "apps/api/"; then
  TSCONFIG="$PROJECT_DIR/apps/api/tsconfig.json"
elif echo "$FILE_PATH" | grep -q "apps/frontend/"; then
  # Use tsc for frontend TypeScript files
  TSCONFIG="$PROJECT_DIR/apps/frontend/tsconfig.json"
elif echo "$FILE_PATH" | grep -q "packages/shared/"; then
  TSCONFIG="$PROJECT_DIR/packages/shared/tsconfig.json"
else
  exit 0
fi

# Only run if tsconfig exists
if [ ! -f "$TSCONFIG" ]; then
  exit 0
fi

# Run tsc scoped to the workspace, limit output to first 20 lines
# Use --pretty for readable errors; exit 0 to not block edits (informational only)
npx tsc --noEmit --pretty -p "$TSCONFIG" 2>&1 | head -20 || true

exit 0
