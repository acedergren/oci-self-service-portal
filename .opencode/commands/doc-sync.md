---
name: doc-sync
description: Audit docs against the codebase; optionally fix drift.
---

# Doc Sync

Audit documentation for drift against the current codebase.

Modes:

- `audit` (default): report only
- `fix`: apply targeted edits + commit

Core checks:

- Architecture: plugin chain, routes, monorepo tree
- Security: plugins/auth/rbac/error hierarchy
- Testing: test counts + current vitest summary
- Roadmap: reflect completed work
- `CLAUDE.md`: paths and rules still accurate

Reference: `.claude/skills/doc-sync/SKILL.md`
