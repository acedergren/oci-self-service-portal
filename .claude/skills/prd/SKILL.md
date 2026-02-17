---
name: prd
description: 'Create, validate, and evolve Product Requirements Documents with interactive discovery, technical architecture, phasing, TDD protocol, and dependency analysis. Use when: writing a PRD, planning a feature, defining requirements, or updating an existing PRD. Supports /prd (create), /prd --update (incremental update), /prd --validate (run checklist), /prd --audit-deps (dependency analysis only).'
---

# PRD Skill

Produce comprehensive, drift-proof Product Requirements Documents through iterative discovery.

Output: `.claude/reference/PRD.md` (the living requirements document for the project).

## Mode Routing

Parse `$ARGUMENTS` to determine the mode:

| Argument         | Mode     | Description                              |
| ---------------- | -------- | ---------------------------------------- |
| _(empty)_        | Create   | Interactive PRD creation from scratch    |
| `<feature text>` | Create   | Start with context, then iterate         |
| `--update`       | Update   | Incremental update to existing PRD       |
| `--validate`     | Validate | Run validation checklist on existing PRD |
| `--audit-deps`   | Audit    | Run dependency/drift analysis only       |
| `--to-plan`      | Plan     | Generate orchestrate-ready task plan     |

---

## Plan Mode (`--to-plan`)

Transform the PRD's phasing section into a task plan that `/orchestrate` can execute directly. The generated plan carries full PRD traceability — each task links back to its originating requirement ID, so `/orchestrate` can feed acceptance criteria to agents and auto-update the PRD when phases complete.

### Input

Read `.claude/reference/PRD.md`. If it doesn't exist, report error and stop. Validate V5 (DAG) passes first.

### Transformation Rules

For each **Phase** in the PRD:

1. **Extract requirements** mapped to this phase (M1, S1, etc.)
2. **Generate tasks** from each requirement's acceptance criteria:
   - Each Given/When/Then block becomes one or more implementation tasks
   - Each test file mapping becomes a test-writing task
   - Each architecture decision becomes a scaffolding task
   - **Each task records the originating requirement ID in the `prd_req` column**
3. **Assign waves** within each phase:
   - Wave 1: Foundation tasks (schemas, types, migrations, config)
   - Wave 2: Implementation tasks (routes, services, repositories)
   - Wave 3: Integration tasks (wiring, UI, end-to-end flows)
   - Wave 4: Polish tasks (error handling, edge cases, docs)
4. **Assign agent types**:
   - `haiku`: Type definitions, config changes, simple CRUD, test writing
   - `sonnet`: Business logic, complex integrations, security-sensitive code
5. **Set dependencies** from the PRD's phase prerequisites
6. **Generate verification commands** from the PRD's test file mapping and acceptance criteria
7. **Embed acceptance criteria** inline: For each task with a `prd_req`, append a collapsible "Acceptance Criteria" block under the task row containing the verbatim Given/When/Then from the PRD. This is what `/orchestrate` will pass to agents.

### Output Format

Write to `docs/plans/<feature-name>-plan.md`:

```markdown
# Task Plan: [Feature Name]

Generated from PRD: `.claude/reference/PRD.md`
Generated at: [ISO timestamp]

> PRD traceability: tasks marked with a `prd_req` column carry acceptance criteria
> that `/orchestrate` passes to agents as test specifications.

## Phase 1: [Title]

### Wave 1: Foundation

| ID     | Task                          | Agent | prd_req | Files                   | Depends | Verify           |
| ------ | ----------------------------- | ----- | ------- | ----------------------- | ------- | ---------------- |
| 1-1.01 | Create Zod schemas for M1     | haiku | M1.1    | packages/types/src/...  | —       | npx tsc --noEmit |
| 1-1.02 | Add migration 0XX-feature.sql | haiku | —       | packages/shared/src/... | —       | npx tsc --noEmit |

<!-- Acceptance criteria for M1.1 (embedded for /orchestrate agent injection):
Given a user submits a valid form
When the API receives the request
Then it returns 201 with the created resource ID
-->

### Wave 2: Implementation

| ID     | Task                        | Agent  | prd_req | Files                   | Depends | Verify                |
| ------ | --------------------------- | ------ | ------- | ----------------------- | ------- | --------------------- |
| 1-2.01 | Implement repository for M1 | sonnet | M1.2    | apps/api/src/...        | 1-1.01  | npx vitest run <test> |
| 1-2.02 | Add route handler for M1    | sonnet | M1.2    | apps/api/src/routes/... | 1-2.01  | npx vitest run <test> |

### Wave 3: Integration

[...]

---

## Requirements Coverage Matrix

This table tracks which PRD requirements are covered by tasks in this plan.
`/orchestrate` updates this as tasks complete (via `/prd --update`).

| Requirement | Priority | Description           | Covered By       | Status  |
| ----------- | -------- | --------------------- | ---------------- | ------- |
| M1.1        | Must     | Auth token refresh    | 1-1.01           | pending |
| M1.2        | Must     | Rate limiting per org | 1-2.01, 1-2.02   | pending |
| S2.1        | Should   | Cache invalidation    | 2-2.01           | pending |
| C3.1        | Could    | Dark mode support     | — (out of scope) | skipped |
```

### Post-Generation

1. Print a summary:
   ```
   Plan generated: docs/plans/<feature-name>-plan.md
   Tasks: 18 (6 haiku, 12 sonnet) across 3 waves
   PRD requirements covered: 5/7 (M: 3/3, S: 2/3, C: 0/1 skipped)
   Requirements NOT covered (out of scope): C3.1
   ```
2. If any Must requirements are not covered by tasks: warn the user before proceeding.
3. Ask the user: "Ready to orchestrate? Run `/orchestrate docs/plans/<feature-name>-plan.md`"
4. Commit: `docs(plan): generate task plan from PRD for <feature-name>`

---

## Create Mode

### Phase 1: Codebase Scan (automatic — no user input needed)

Before asking any questions, build context silently:

1. Launch an **Explore agent** to map the codebase areas relevant to the feature:
   - Existing patterns, components, and modules in scope
   - Current dependency versions from `package.json` files
   - Related test files and coverage areas
   - Tech debt signals (TODO/FIXME/HACK comments, deprecated APIs)
2. Read `docs/ROADMAP.md` for phase context and prior decisions.
3. Read `.claude/reference/framework-notes.md` for Fastify 5, Vitest, SvelteKit patterns.
4. Check `pnpm outdated --recursive --format json` for stale dependencies in scope.

Store findings internally — present them during discovery rounds, not as a dump.

### Phase 2: Interactive Discovery (2–4 rounds)

Iterate through focused question rounds. Each round:

- Present relevant findings from the codebase scan
- Ask 2–4 focused questions using `AskUserQuestion` with concrete options
- Adapt the next round based on answers received

**Round 1 — Problem & Vision**:

- What problem does this solve? Who experiences it?
- What does success look like? (adoption metric, quality gate, performance target)
- Who are the primary personas? (offer options derived from existing route handlers/auth roles)

**Round 2 — Scope & Boundaries**:

- Which features are Must-Have vs Should-Have vs Could-Have vs Won't-Do?
- What's explicitly out of scope?
- What existing functionality does this interact with?

**Round 3 — Technical Constraints**:

- Architecture preferences (informed by codebase scan: "I see you use X pattern here — extend it or diverge?")
- Database/API/auth implications
- Performance requirements and SLA targets

**Round 4 — Phasing & Risk** (if needed):

- How many phases? What can be parallelized?
- Risk tolerance (cutting scope vs extending timeline)
- External dependencies or blockers

**Rules**:

- NEVER ask more than 4 questions at once
- NEVER ask about things the codebase scan already answered
- NEVER proceed to drafting until at least Round 1 and Round 2 are complete
- If the user provides a rich feature description in `$ARGUMENTS`, skip questions the description already answers

### Phase 3: Draft Generation

1. Read `template.md` from this skill directory.
2. Write the PRD to `.claude/reference/PRD.md` using the template structure.
3. Fill sections from discovery answers + codebase scan findings.
4. Mark any remaining gaps with `[NEEDS CLARIFICATION: specific question]`.
5. Run dependency audit — check for outdated/deprecated packages in the feature's scope.
6. Populate the Architecture Decisions section with AD-N entries for each major technical choice.
7. Build the phasing DAG with explicit dependency arrows.

### Phase 4: Multi-Angle Validation

**MANDATORY**: Read `validation.md` from this skill directory and run every check against the draft.

1. Execute each validation gate.
2. Present results to the user as a pass/fail checklist.
3. For any failures:
   - If fixable with available information → fix and re-validate
   - If needs user input → ask specific clarifying questions
4. Iterate until all critical gates pass.

### Phase 5: Finalize

1. Remove all `[NEEDS CLARIFICATION]` markers (or convert remaining ones to Open Questions).
2. Print a summary:
   - Sections completed
   - Validation status (all gates)
   - Recommended next steps
3. Add PRD reference to `CLAUDE.md` if not already present (after the framework-notes line):
   ```markdown
   > Product requirements, phasing, architecture decisions, and success criteria in `.claude/reference/PRD.md`
   ```
4. Commit with: `docs(prd): add <feature-name> requirements`

---

## Update Mode (`--update`)

1. Read `.claude/reference/PRD.md`. If it doesn't exist, switch to Create mode.
2. Ask the user what changed (use `AskUserQuestion` with options):
   - New requirement
   - Scope change
   - Dependency update
   - Architecture decision
   - Risk update
   - Implementation learnings
3. Launch an **Explore agent** to check the codebase for changes since PRD was written:
   - New files, routes, or modules not in the PRD
   - Changed dependencies
   - Completed features that should be marked done
4. Generate diff-style updates using these markers:
   - `[ADDED]` — new sections or requirements
   - `[CHANGED]` — modified sections with rationale
   - `[REMOVED]` — dropped items with explanation
   - `[DRIFT DETECTED]` — codebase diverged from PRD
5. Present the proposed changes to the user for approval.
6. Apply updates and append to the Changelog section inside PRD.md.
7. Re-run validation checklist (read `validation.md`).
8. Commit with: `docs(prd): update <feature-name> requirements`

---

## Validate Mode (`--validate`)

1. Read `.claude/reference/PRD.md`. If it doesn't exist, report error and stop.
2. Read `validation.md` from this skill directory.
3. Run every validation gate against the PRD.
4. Print pass/fail results with specific line references for failures.
5. Suggest fixes for each failure.

---

## Audit-Deps Mode (`--audit-deps`)

1. Read `.claude/reference/PRD.md` to identify dependencies in scope.
2. Read `drift-prevention.md` from this skill directory.
3. Run dependency freshness checks:
   - `pnpm outdated --recursive`
   - Check for known deprecation notices
   - Check npm advisories for CVEs
4. Run architectural drift detection:
   - Compare PRD file paths against actual codebase
   - Check for orphaned imports or stale type references
   - Run Oracle-specific and Mastra-specific checks from `drift-prevention.md`
5. Print a drift report with severity ratings.

---

## Anti-Patterns (NEVER)

- NEVER generate a PRD without scanning the codebase first — context prevents drift
- NEVER write acceptance criteria as "should work correctly" — use Given/When/Then
- NEVER skip dependency analysis — this is how legacy accumulates
- NEVER batch all questions into one wall of text — iterate in focused rounds
- NEVER include implementation details in Must/Should/Could sections — architecture decisions get their own section
- NEVER assume a library version — check `package.json` and npm for latest
- NEVER write phasing without dependency arrows — phases must be a DAG
- NEVER leave `[NEEDS CLARIFICATION]` markers in a finalized PRD

## Arguments

- `$ARGUMENTS`: Mode flag or feature description
  - `/prd` — interactive creation from scratch
  - `/prd Workflow Designer & Oracle 26AI Modernization` — start with context
  - `/prd --update` — incremental update
  - `/prd --validate` — run validation only
  - `/prd --audit-deps` — dependency audit only
