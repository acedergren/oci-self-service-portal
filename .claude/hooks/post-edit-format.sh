#!/bin/bash
# Post-edit auto-format: runs Prettier on files edited by Claude
# Triggered by PostToolUse on Edit/Write tools
set -e

INPUT=$(cat)

# Extract the file path from tool output
if command -v jq &>/dev/null; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || echo "")
else
  FILE_PATH=""
fi

# Nothing to format if no file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only format files Prettier understands
if ! echo "$FILE_PATH" | grep -qE '\.(ts|js|svelte|json|css|html|md|yaml|yml)$'; then
  exit 0
fi

# Only format if the file exists
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Run Prettier (fail silently — formatting is best-effort, not blocking)
if command -v npx &>/dev/null; then
  npx prettier --write "$FILE_PATH" 2>/dev/null || true
fi

exit 0
