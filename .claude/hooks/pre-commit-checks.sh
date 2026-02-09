#!/bin/bash
# Pre-commit quality gate: lint staged files + type checks
# Triggered by PreToolUse on Bash when command contains "git commit"
set -e

INPUT=$(cat)

# Safely extract command from JSON (handle jq not available)
if command -v jq &>/dev/null; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")
else
  echo "Error: jq is required for pre-commit checks" >&2
  exit 1
fi

# Only run for git commit commands
if ! echo "$COMMAND" | grep -q "git commit"; then
  exit 0
fi

if [ -z "$CLAUDE_PROJECT_DIR" ]; then
  echo "Error: CLAUDE_PROJECT_DIR not set" >&2
  exit 1
fi

cd "$CLAUDE_PROJECT_DIR" || exit 1

ERRORS=""

# Get staged files relative to oci-self-service-portal/
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || echo "")

if [ -z "$STAGED_FILES" ]; then
  echo "No staged files, skipping checks"
  exit 0
fi

# Filter to lintable files in apps/frontend
FRONTEND_FILES=$(echo "$STAGED_FILES" | grep -E '^oci-self-service-portal/apps/frontend/.*\.(ts|svelte|js)$' | sed 's|^oci-self-service-portal/apps/frontend/||' || true)

# Lint only staged frontend files (not entire project)
if [ -n "$FRONTEND_FILES" ]; then
  echo "Linting staged frontend files..."
  if cd "oci-self-service-portal/apps/frontend"; then
    while IFS= read -r f; do
      if [ -f "$f" ]; then
        if ! npx eslint "$f" 2>&1; then
          ERRORS="${ERRORS}\nESLint failed: $f"
        fi
      fi
    done <<< "$FRONTEND_FILES"
    cd "$CLAUDE_PROJECT_DIR" || exit 1
  fi
fi

# Run svelte-check (informational — pre-existing 11 errors in test files are known baseline)
HAS_FRONTEND_SRC=$(echo "$STAGED_FILES" | grep '^oci-self-service-portal/apps/frontend/src/' | grep -cv '/tests/' 2>/dev/null || echo 0)
if [ "$HAS_FRONTEND_SRC" -gt 0 ]; then
  echo "Running svelte-check (informational, not blocking)..."
  if cd "oci-self-service-portal/apps/frontend"; then
    npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 || echo "Note: svelte-check has pre-existing errors in test files (known baseline)"
    cd "$CLAUDE_PROJECT_DIR" || exit 1
  fi
fi

# Check if any API files changed — run tsc
HAS_API=$(echo "$STAGED_FILES" | grep -c '^oci-self-service-portal/apps/api/' 2>/dev/null || echo 0)
if [ "$HAS_API" -gt 0 ] && [ -d "oci-self-service-portal/apps/api" ]; then
  echo "Running tsc (apps/api)..."
  if cd "oci-self-service-portal/apps/api"; then
    if ! npx tsc --noEmit 2>&1; then
      ERRORS="${ERRORS}\ntsc failed in apps/api"
    fi
    cd "$CLAUDE_PROJECT_DIR" || exit 1
  fi
fi

# Check if any shared files changed — run tsc
HAS_SHARED=$(echo "$STAGED_FILES" | grep -c '^oci-self-service-portal/packages/shared/' 2>/dev/null || echo 0)
if [ "$HAS_SHARED" -gt 0 ] && [ -d "oci-self-service-portal/packages/shared" ]; then
  echo "Running tsc (packages/shared)..."
  if cd "oci-self-service-portal/packages/shared"; then
    if ! npx tsc --noEmit 2>&1; then
      ERRORS="${ERRORS}\ntsc failed in packages/shared"
    fi
    cd "$CLAUDE_PROJECT_DIR" || exit 1
  fi
fi

if [ -n "$ERRORS" ]; then
  echo "Pre-commit checks FAILED:$ERRORS" >&2
  exit 2
fi

echo "Pre-commit checks passed"
exit 0
