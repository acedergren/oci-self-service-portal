# Documentation Drift Report

**Generated**: 2026-02-12
**Status**: 7 drift items found

## Summary

| Doc         | Section            | Issue                               | Severity |
| ----------- | ------------------ | ----------------------------------- | -------- |
| ROADMAP.md  | Phase 9 stats      | Test count (1213 → 828)             | MEDIUM   |
| ROADMAP.md  | Phase 9 stats      | Test file count (100 → 113)         | LOW      |
| SECURITY.md | RBAC Permissions   | Permission count (13 → 15)          | MEDIUM   |
| ROADMAP.md  | Phase 10 status    | Missing Wave 6 completion note      | LOW      |
| **MISSING** | N/A                | ARCHITECTURE.md doesn't exist       | HIGH     |
| **MISSING** | N/A                | TESTING.md doesn't exist            | HIGH     |
| CLAUDE.md   | Monorepo structure | Outdated paths (old shared package) | LOW      |

## Details

### 1. Test Count Mismatch (ROADMAP.md Line 239)

**Current**: "1213+ tests passing across 100 test files"
**Actual**: 828 tests passing (51/53 test files), 113 total test files
**Root Cause**: 3 tests failing due to decorator collision in app.ts

**Recommendation**: Update to "828 tests passing across 113 test files (3 failing: decorator collision)"

### 2. Permission Count (SECURITY.md Line 85-99)

**Current**: Lists 13 permissions
**Actual**: 15 unique permissions in `packages/server/src/auth/rbac.ts`

**Missing from docs**:

- `admin:settings` (or similar - need to verify exact additions)
- One other permission

**Recommendation**: Audit rbac.ts and update SECURITY.md table

### 3. Phase 10 Wave 6 Completion (ROADMAP.md)

**Commits show**:

- Wave 4: AI guardrails + 3 workflow nodes (6d2c3704)
- Wave 5: Admin backend APIs (dc20133e)
- Wave 6: 4 admin developer tools pages (e5c3bfb8)

**Current roadmap**: No Wave 6 checkboxes

**Recommendation**: Add Wave 6 completion note to Phase 10 section

### 4. Missing ARCHITECTURE.md

**Expected**: System design doc at `docs/ARCHITECTURE.md`
**Actual**: File doesn't exist
**Impact**: doc-sync skill references this file

**Options**:

1. Create ARCHITECTURE.md from Phase 9 architecture doc
2. Update doc-sync skill to remove reference
3. Create lightweight architecture overview

**Recommendation**: Create from `docs/PHASE9_ARCHITECTURE.md` (23KB exists)

### 5. Missing TESTING.md

**Expected**: Test strategy doc at `docs/TESTING.md`
**Actual**: File doesn't exist
**Impact**: doc-sync skill references this file

**Options**:

1. Create TESTING.md from Phase 9 test report
2. Update doc-sync skill to remove reference
3. Create lightweight test strategy doc

**Recommendation**: Create from `docs/PHASE9_TEST_REPORT.md` (10KB exists)

### 6. API Routes Count (ROADMAP.md Phase 9)

**Current**: Doesn't list specific route count
**Actual**: 19 route modules in `apps/api/src/routes/`

**Recommendation**: Add route count to Phase 9 verification section

### 7. CLAUDE.md Monorepo Paths (Repo Root)

**Issue**: References old `packages/shared/src/` paths
**Actual**: Split into `packages/types`, `packages/server`, `packages/ui`

**Recommendation**: Update all import path examples to use new packages

## Action Plan

**High Priority** (blocking):

1. Create ARCHITECTURE.md from Phase 9 docs
2. Create TESTING.md from Phase 9 docs

**Medium Priority** (accuracy): 3. Fix test count in ROADMAP.md 4. Audit and fix permission count in SECURITY.md

**Low Priority** (housekeeping): 5. Add Wave 6 completion note to ROADMAP 6. Update CLAUDE.md paths 7. Add route count to Phase 9 stats

---

**Next Steps**: Run `/doc-sync --fix` to apply all fixes automatically.
