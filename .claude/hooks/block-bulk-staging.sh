#!/bin/bash
# Block bulk git staging: prevents "git add -A", "git add .", "git add --all"
# Enforces project policy: always stage specific files by name
set -e

INPUT=$(cat)

# Extract command from JSON
if command -v jq &>/dev/null; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")
else
  COMMAND=""
fi

# Skip commands that aren't primarily git add (e.g., git commit messages mentioning "git add")
# Extract only the actual command portion before any heredoc or commit message
FIRST_CMD=$(echo "$COMMAND" | sed -n '1p' | sed 's/&&.*//' | sed 's/;.*//')

# Only check if the primary command is git add
if ! echo "$FIRST_CMD" | grep -q "git add"; then
  exit 0
fi

# Block dangerous patterns in the actual git add command
if echo "$FIRST_CMD" | grep -qE 'git add\s+(-A|--all|\.\s|\.&&|\.;|\.$)'; then
  echo "BLOCKED: 'git add -A' / 'git add .' is not allowed." >&2
  echo "Stage specific files instead: git add file1.ts file2.ts" >&2
  exit 2
fi

exit 0
