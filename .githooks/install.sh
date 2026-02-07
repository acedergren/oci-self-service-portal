#!/usr/bin/env bash
# =============================================================================
# Install git hooks for the OCI Self-Service Portal
#
# Usage: ./.githooks/install.sh
# =============================================================================
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.githooks"

echo "Setting up git hooks..."

# Point git to our hooks directory
git config core.hooksPath .githooks

# Ensure hooks are executable
chmod +x "$HOOKS_DIR/pre-commit" "$HOOKS_DIR/pre-push"

echo ""
echo "Git hooks installed:"
echo "  pre-commit  — ESLint, type checks, Prettier (on staged files)"
echo "  pre-push    — Semgrep, CodeQL, CodeRabbit, tests (on pushed commits)"
echo ""
echo "Optional tools (install for full scanning):"

# Check tool availability
for tool in semgrep codeql claude; do
  if command -v "$tool" &>/dev/null; then
    echo "  $tool — installed"
  else
    echo "  $tool — NOT INSTALLED"
  fi
done

echo ""
echo "Done. Hooks are active for this repo."
