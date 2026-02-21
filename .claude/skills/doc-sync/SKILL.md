---
name: doc-sync
description: Audit project documentation against the codebase and fix drift. Run before PRs or after major changes.
---

# Documentation Sync Audit

Audit all project documentation against the actual codebase and report (or fix) any drift.

## Steps

1. **Read all four reference docs**:
   - `docs/ARCHITECTURE.md` — system design
   - `docs/SECURITY.md` — security model
   - `docs/TESTING.md` — test strategy
   - `docs/ROADMAP.md` — phase planning

2. **Audit ARCHITECTURE.md** against the actual codebase:
   - Check `apps/api/src/app.ts` — does the plugin chain match the documented order?
   - Check `apps/api/src/routes/` — are all route modules listed?
   - Check `apps/frontend/src/routes/` — are all API/page routes represented?
   - Check `packages/shared/src/` — are all shared exports documented?
   - Check monorepo layout — does the tree match the actual directory structure?

3. **Audit SECURITY.md** against the codebase:
   - Check `apps/api/src/plugins/` — are all security plugins documented?
   - Check `apps/frontend/src/lib/server/auth/` — does the auth description match?
   - Check for any new `fix(security):` commits since last doc update
   - Verify RBAC permission count matches `packages/shared/src/auth/rbac.ts`
   - Verify error hierarchy matches `packages/shared/src/errors.ts`

4. **Audit TESTING.md**:
   - Count actual test files: `find . -name "*.test.ts" -not -path "*/node_modules/*"`
   - Run `npx vitest run --reporter=verbose 2>&1 | tail -5` to get current pass counts
   - Compare documented test counts to actual counts
   - Check if any new test patterns exist that aren't documented

5. **Audit ROADMAP.md**:
   - Check `git log --oneline` for commits not reflected in any phase
   - Verify completed phases are marked with `[x]`
   - Check that test counts match actual counts

6. **Audit CLAUDE.md** (repo root):
   - Check naming conventions still match actual code patterns
   - Verify anti-patterns section is current
   - Confirm documented file paths still exist

7. **Report findings**: Print a table of drift items found:

   ```
   | Doc | Section | Issue | Severity |
   |-----|---------|-------|----------|
   ```

8. **Fix drift** (if `$ARGUMENTS` contains "fix" or "update"):
   - Make targeted edits to fix each drift item
   - Commit with `docs: sync documentation with codebase [doc-sync]`

If `$ARGUMENTS` is empty or "audit", only report — don't edit.

## Arguments

- `$ARGUMENTS`: `audit` (default, report only) or `fix` (report and fix drift)

## When to Run

- Before creating a pull request (`/doc-sync audit`)
- After completing a development phase (`/doc-sync fix`)
- After security hardening sprints (`/doc-sync fix`)
- After any structural changes (new plugins, routes, migrations)

Tip: Start with `claude -w` (worktree mode) when running `/doc-sync fix` to edit docs in isolation without affecting your working tree.
