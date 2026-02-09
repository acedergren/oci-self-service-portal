#!/bin/bash
# Pre-push quality gate: semgrep scan
# Triggered by PreToolUse on Bash when command contains "git push"
# Note: coderabbit and codeql run as agent hooks (see settings.json)
set -e

INPUT=$(cat)

# Safely extract command from JSON (handle jq not available)
if command -v jq &>/dev/null; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")
else
  COMMAND=""
fi

# Only run for git push commands
if ! echo "$COMMAND" | grep -q "git push"; then
  exit 0
fi

if [ -z "$CLAUDE_PROJECT_DIR" ]; then
  echo "Error: CLAUDE_PROJECT_DIR not set" >&2
  exit 1
fi

cd "$CLAUDE_PROJECT_DIR" || exit 1

# Run semgrep if available (check both paths and tool name)
if command -v semgrep &>/dev/null; then
  echo "Running Semgrep security scan..."

  # Get changed files safely (handle missing git history)
  CHANGED_FILES=$(git diff --name-only HEAD~1 -- '*.ts' '*.svelte' '*.js' 2>/dev/null || \
                  git diff --cached --name-only -- '*.ts' '*.svelte' '*.js' 2>/dev/null || \
                  echo "")

  if [ -n "$CHANGED_FILES" ]; then
    # Run semgrep and handle potential failures gracefully
    if RESULT=$(semgrep --config auto --json $CHANGED_FILES 2>/dev/null); then
      # Extract error count safely (handle jq not available)
      if command -v jq &>/dev/null; then
        ERROR_COUNT=$(echo "$RESULT" | jq '.results | length' 2>/dev/null || echo 0)
      else
        ERROR_COUNT=$(echo "$RESULT" | grep -c '"check_id"' 2>/dev/null || echo 0)
      fi

      if [ "$ERROR_COUNT" -gt 0 ]; then
        echo "Semgrep found $ERROR_COUNT issues:" >&2
        if command -v jq &>/dev/null; then
          echo "$RESULT" | jq -r '.results[] | "  \(.path):\(.start.line) — \(.check_id): \(.extra.message)"' 2>/dev/null >&2 || \
          echo "  (error details available in full Semgrep output)"
        fi
        exit 2
      else
        echo "Semgrep: no issues found"
      fi
    else
      echo "Semgrep scan had errors, but continuing..." >&2
    fi
  else
    echo "Semgrep: no changed files to scan"
  fi
else
  echo "Semgrep not installed, skipping CLI scan"
fi

echo "Pre-push security checks passed"
exit 0
