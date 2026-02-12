---
name: quality-commit
description: Run quality gates on staged changes, then commit (optionally push).
---

# Quality Commit

Run quality gates on staged changes and then create a commit.

Intended usage:

- You already staged the exact files you want in the commit.
- This command runs checks; it does not decide what to stage.

## Flow

1. List staged files: `git diff --cached --name-only`
2. Run relevant checks based on which workspaces are touched:
   - frontend: eslint (staged files), optional `svelte-check`
   - api: `npx tsc --noEmit`
   - shared: `npx tsc --noEmit`
3. Run related tests or targeted `npx vitest run` if applicable
4. Optional security scan (semgrep) if available
5. Commit using a conventional message
6. Optional push

Reference:

- `.claude/skills/quality-commit/SKILL.md`
- `.claude/hooks/pre-commit-checks.sh`
- `.claude/hooks/pre-push-security.sh`
