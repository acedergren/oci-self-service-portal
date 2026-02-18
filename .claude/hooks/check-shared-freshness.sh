#!/bin/bash
# Pre-edit: warn if packages/shared dist is stale before editing consuming files
# This catches the "stale shared package types" problem documented in MEMORY.md
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

# Only check when editing files that import from @portal/shared
if ! echo "$FILE_PATH" | grep -qE '\.(ts|svelte)$'; then
  exit 0
fi

# Only relevant for files in apps/ (consumers of shared package)
if ! echo "$FILE_PATH" | grep -qE 'apps/(api|frontend)/'; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
SHARED_SRC="$PROJECT_DIR/packages/shared/src"
SHARED_DIST="$PROJECT_DIR/packages/shared/dist"

# If dist doesn't exist at all, definitely stale
if [ ! -d "$SHARED_DIST" ]; then
  echo "WARNING: packages/shared/dist/ does not exist. Run: pnpm --filter @portal/shared build"
  exit 0  # warn but don't block
fi

# Compare newest source file vs newest dist file
if command -v stat &>/dev/null; then
  # macOS stat
  NEWEST_SRC=$(find "$SHARED_SRC" -name '*.ts' -not -name '*.test.ts' -exec stat -f '%m' {} \; 2>/dev/null | sort -rn | head -1)
  NEWEST_DIST=$(find "$SHARED_DIST" -name '*.js' -exec stat -f '%m' {} \; 2>/dev/null | sort -rn | head -1)

  if [ -n "$NEWEST_SRC" ] && [ -n "$NEWEST_DIST" ]; then
    if [ "$NEWEST_SRC" -gt "$NEWEST_DIST" ]; then
      echo "WARNING: packages/shared source is newer than dist. Types may be stale. Run: pnpm --filter @portal/shared build"
    fi
  fi
fi

exit 0
