#!/bin/bash
# Doc drift warning: checks if architecture-relevant files changed without doc updates.
# Triggered by PreToolUse on Bash when command contains "git push"
# Non-blocking — prints a warning but doesn't fail (exit 0 always).
set -e

INPUT=$(cat)

# Safely extract command from JSON
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
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0

# Files that should trigger doc review when changed
ARCH_PATTERNS="app\.ts|plugins/|routes/|config\.ts|hooks\.server\.ts"
SEC_PATTERNS="auth/|crypto\.ts|rate.limit|helmet|cors|approvals|rbac"
TEST_PATTERNS="vitest\.config|\.test\.ts"
MIGRATION_PATTERNS="migrations/[0-9]"

# Get files changed since last push (compare to remote tracking branch)
REMOTE_BRANCH=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "")
if [ -z "$REMOTE_BRANCH" ]; then
  exit 0
fi

CHANGED=$(git diff --name-only "$REMOTE_BRANCH"...HEAD 2>/dev/null || echo "")
if [ -z "$CHANGED" ]; then
  exit 0
fi

# Check which doc areas are affected
DOCS_CHANGED=$(echo "$CHANGED" | grep -c "docs/" 2>/dev/null || echo 0)
ARCH_HITS=$(echo "$CHANGED" | grep -cE "$ARCH_PATTERNS" 2>/dev/null || echo 0)
SEC_HITS=$(echo "$CHANGED" | grep -cE "$SEC_PATTERNS" 2>/dev/null || echo 0)
MIGRATION_HITS=$(echo "$CHANGED" | grep -cE "$MIGRATION_PATTERNS" 2>/dev/null || echo 0)

WARNINGS=""

if [ "$ARCH_HITS" -gt 0 ] && ! echo "$CHANGED" | grep -q "ARCHITECTURE.md"; then
  WARNINGS="${WARNINGS}\n  - $ARCH_HITS architecture-relevant files changed without ARCHITECTURE.md update"
fi

if [ "$SEC_HITS" -gt 0 ] && ! echo "$CHANGED" | grep -q "SECURITY.md"; then
  WARNINGS="${WARNINGS}\n  - $SEC_HITS security-relevant files changed without SECURITY.md update"
fi

if [ "$MIGRATION_HITS" -gt 0 ] && ! echo "$CHANGED" | grep -q "ARCHITECTURE.md\|ROADMAP.md"; then
  WARNINGS="${WARNINGS}\n  - New migrations added without doc update"
fi

if [ -n "$WARNINGS" ]; then
  echo "Doc drift warning: consider running /doc-sync audit"
  echo -e "$WARNINGS"
  echo "  Run '/doc-sync fix' to auto-update documentation"
fi

# Always pass — this is advisory only
exit 0
