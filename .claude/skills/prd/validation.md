# PRD Validation Checklist

Run each gate against the PRD. Report pass/fail with specific line references for failures.

## Critical Gates (must all pass)

### V1: Acceptance Criteria Quality

**Check**: Every Must-Have requirement (M1, M2, ...) has acceptance criteria in Given/When/Then format.

**Fail indicators**:

- Criteria that say "should work correctly" or "should handle errors"
- Missing `Given` precondition (untestable without setup)
- Missing `Then` assertion (no way to verify)
- Vague actions in `When` ("the user interacts with the system")

**Fix**: Rewrite each failing criterion with concrete preconditions, specific user actions, and observable outcomes.

### V2: Test File Mapping

**Check**: Every Must-Have requirement maps to at least one test file path that follows project conventions.

**Fail indicators**:

- Missing test file path
- Test path doesn't match project convention (`apps/api/src/tests/` or colocated `*.test.ts`)
- Test type not specified (unit, integration, component)

**Fix**: Add test file path and type for each Must-Have. Verify the path is valid for the workspace.

### V3: Architecture Decision Quality

**Check**: Every AD-N entry has:

- A context statement explaining why a decision is needed
- At least 2 alternatives evaluated with pros/cons
- A clear rationale for the chosen option
- Consequences section describing implications

**Fail indicators**:

- Only one option listed (no comparison made)
- "Because it's the best" as rationale (no evidence)
- Missing consequences (implications not considered)
- Decision contradicts existing codebase patterns without acknowledging the divergence

**Fix**: Add missing alternatives. Base rationale on evidence (benchmarks, community adoption, codebase fit). Document consequences.

### V4: Dependency Health

**Check**: No deprecated packages in the feature's scope. No known CVEs. Versions pinned.

**Fail indicators**:

- Package marked as deprecated on npm
- `pnpm audit` reports advisories for packages in scope
- Version specified as `*` or `latest` instead of pinned
- Package has been superseded by an official replacement

**Fix**: Replace deprecated packages. Update to patched versions. Pin all version numbers.

### V5: Phasing DAG Validity

**Check**: Phase dependencies form a directed acyclic graph.

**Fail indicators**:

- Phase A depends on Phase B which depends on Phase A (cycle)
- Missing prerequisite declarations
- Phase claims to be parallelizable with a phase it depends on
- Phase lists deliverables that aren't defined in the requirements section

**Fix**: Redraw phase dependencies. Remove cycles. Verify all deliverables trace back to M/S/C requirements.

## High Gates (should all pass)

### V6: Metric Measurability

**Check**: Every success metric specifies a number, percentage, or duration with a measurement method.

**Fail indicators**:

- "Users are happy" (not measurable)
- "System is fast" (no threshold)
- "Good test coverage" (no percentage target)
- Missing measurement method (how do you actually check this?)

**Fix**: Convert each metric to a specific threshold with a concrete measurement approach.

### V7: Persona Coverage

**Check**: Every defined persona appears in at least one user story (`As a [persona]...`).

**Fail indicators**:

- Persona defined but never referenced in a user story
- User story references a persona not defined in the Personas section

**Fix**: Either add user stories for orphaned personas or remove unused personas.

### V8: Clarification Markers

**Check**: No `[NEEDS CLARIFICATION: ...]` markers remain in the document.

**Fail indicators**:

- Any text matching `[NEEDS CLARIFICATION` pattern

**Fix**: Resolve each marker by either:

- Filling in the information from discovery answers
- Moving the question to Open Questions section (if genuinely unresolved)
- Removing the section if it's not applicable

## Medium Gates (recommended)

### V9: Risk Mitigation Quality

**Check**: Every risk mitigation is a specific, actionable step.

**Fail indicators**:

- "Be careful with X" (not actionable)
- "Monitor for issues" (no specific monitoring target)
- "Handle errors properly" (no error handling strategy specified)
- Risk listed without any mitigation

**Fix**: Rewrite each mitigation as a concrete action: who does what, when, with what tool/process.

### V10: Open Questions Resolution

**Check**: Open Questions section is either empty or all items are tracked with owners.

**Fail indicators**:

- Questions that could have been answered during discovery rounds
- Questions without any indication of who will resolve them
- Questions that block Must-Have requirements (should be resolved before approval)

**Fix**: Answer resolvable questions. Assign owners to remaining items. Escalate blocking questions.

## Validation Report Format

After running all gates, print:

```
PRD Validation Report
=====================

Critical Gates:
  [PASS] V1: Acceptance Criteria Quality
  [FAIL] V2: Test File Mapping — M3 missing test file path (line 87)
  [PASS] V3: Architecture Decision Quality
  [PASS] V4: Dependency Health
  [PASS] V5: Phasing DAG Validity

High Gates:
  [PASS] V6: Metric Measurability
  [PASS] V7: Persona Coverage
  [FAIL] V8: Clarification Markers — 2 markers remaining (lines 43, 112)

Medium Gates:
  [PASS] V9: Risk Mitigation Quality
  [PASS] V10: Open Questions Resolution

Result: 2 failures (1 Critical, 1 High) — must fix before approval
```
