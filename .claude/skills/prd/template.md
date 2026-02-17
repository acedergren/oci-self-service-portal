# PRD: [Feature Name]

> **Status**: Draft | In Review | Approved | Superseded
> **Author**: [name]
> **Created**: [date]
> **Last Updated**: [date]

---

## Validation Checklist

Run `/prd --validate` to check these gates. All Critical gates must pass before approval.

| #   | Gate                                                    | Severity | Status |
| --- | ------------------------------------------------------- | -------- | ------ |
| V1  | Every Must-Have has Given/When/Then acceptance criteria | Critical | [ ]    |
| V2  | Every Must-Have maps to at least one test file          | Critical | [ ]    |
| V3  | Architecture Decisions have alternatives evaluated      | Critical | [ ]    |
| V4  | No deprecated dependencies in scope                     | Critical | [ ]    |
| V5  | Phases form a valid DAG (no circular dependencies)      | Critical | [ ]    |
| V6  | Success metrics are measurable (number, %, duration)    | High     | [ ]    |
| V7  | All personas referenced in at least one user story      | High     | [ ]    |
| V8  | No `[NEEDS CLARIFICATION]` markers remain               | High     | [ ]    |
| V9  | Risk mitigations are actionable (not "be careful")      | Medium   | [ ]    |
| V10 | Open Questions section is empty or tracked              | Medium   | [ ]    |

---

## 1. Product Overview

### Vision

[NEEDS CLARIFICATION: What is the long-term vision this feature supports?]

### Problem Statement

[NEEDS CLARIFICATION: What specific problem does this solve? Who experiences it and how often?]

### Value Proposition

[NEEDS CLARIFICATION: Why is this worth building now? What's the cost of not building it?]

---

## 2. User Personas

### Persona: [Name]

| Attribute    | Detail                |
| ------------ | --------------------- |
| Role         | [NEEDS CLARIFICATION] |
| Goal         | [NEEDS CLARIFICATION] |
| Pain Point   | [NEEDS CLARIFICATION] |
| Tech Comfort | Low / Medium / High   |

_Add additional personas as needed. Every persona must appear in at least one user story._

---

## 3. User Journey Maps

### Journey: [Name] — [Goal]

```
[Entry Point] → [Step 1] → [Step 2] → [Decision Point]
                                            ├── [Happy Path] → [Success State]
                                            └── [Error Path] → [Recovery Action]
```

**Touchpoints**: [Which parts of the system does this journey touch?]
**Handoffs**: [Where does control pass between frontend/API/external service?]

---

## 4. Feature Requirements

### Must Have (P0)

#### M1: [Feature Name]

**User Story**: As a [persona], I want to [action] so that [benefit].

**Acceptance Criteria**:

```gherkin
Given [precondition]
When [action]
Then [expected result]
```

**Affected Files**: `[path/to/file.ts]`, `[path/to/other.ts]`
**Test File**: `[path/to/feature.test.ts]`

#### M2: [Feature Name]

[Same structure as M1]

### Should Have (P1)

#### S1: [Feature Name]

[Same structure — user story, acceptance criteria, files, tests]

### Could Have (P2)

#### C1: [Feature Name]

[Same structure — lighter detail acceptable]

### Won't Do (Explicit Exclusions)

- **W1**: [What and why it's excluded]
- **W2**: [What and why it's excluded]

---

## 5. Architecture Decisions

### AD-1: [Decision Title]

| Aspect        | Detail                                |
| ------------- | ------------------------------------- |
| **Context**   | [What situation requires a decision?] |
| **Decision**  | [What was decided?]                   |
| **Rationale** | [Why this option over alternatives?]  |

**Alternatives Evaluated**:

| Option       | Pros   | Cons   | Rejected Because |
| ------------ | ------ | ------ | ---------------- |
| [Option A]   | [pros] | [cons] | [reason]         |
| [Option B]   | [pros] | [cons] | [reason]         |
| **[Chosen]** | [pros] | [cons] | **Selected**     |

**Consequences**: [What does this decision imply for future work?]

### AD-2: [Decision Title]

[Same structure as AD-1]

---

## 6. Dependency Analysis

### Current State

| Package        | Current | Latest  | Status                             | Notes     |
| -------------- | ------- | ------- | ---------------------------------- | --------- |
| [package-name] | [x.y.z] | [a.b.c] | Up to date / Outdated / Deprecated | [context] |

### New Dependencies

| Package        | Version   | Purpose      | License   | Size          | Alternatives Considered   |
| -------------- | --------- | ------------ | --------- | ------------- | ------------------------- |
| [package-name] | [version] | [why needed] | [license] | [bundle size] | [what else was evaluated] |

### Deprecation Warnings

- [Any packages in scope with known deprecation timelines]

### CVE Check

- Run `pnpm audit` — document any advisories affecting packages in scope

---

## 7. Phasing & Dependencies

### Phase Overview

```
Phase 1: [Title]        Phase 2: [Title]        Phase 3: [Title]
├── M1                   ├── M2 (needs M1)       ├── S1 (needs M2)
├── AD-1                 ├── S2                   └── C1 (parallel)
└── DB migration         └── AD-2 (needs AD-1)
```

### Phase 1: [Title]

**Goal**: [One sentence]
**Prerequisites**: None
**Delivers**: M1, foundation for M2
**Estimated scope**: [number of files / routes / migrations]
**Parallelizable with**: Nothing (foundation phase)

### Phase 2: [Title]

**Goal**: [One sentence]
**Prerequisites**: Phase 1 complete (M1 functional, AD-1 implemented)
**Delivers**: M2, S2
**Estimated scope**: [number of files / routes / migrations]
**Parallelizable with**: [any independent work streams]

### Phase 3: [Title]

**Goal**: [One sentence]
**Prerequisites**: Phase 2 complete (M2 functional)
**Delivers**: S1, C1
**Estimated scope**: [number of files / routes / migrations]
**Parallelizable with**: [S1 and C1 can run in parallel]

_Phases must form a DAG. Draw dependency arrows explicitly. Mark parallel-safe work._

---

## 8. TDD Protocol

### Test File Mapping

| Requirement | Test File                                    | Test Type          | Vitest Gotchas                           |
| ----------- | -------------------------------------------- | ------------------ | ---------------------------------------- |
| M1          | `apps/api/src/tests/feature-m1.test.ts`      | Unit + Integration | [any mockReset, TDZ, or Fastify 5 notes] |
| M2          | `apps/api/src/tests/feature-m2.test.ts`      | Unit               | [notes]                                  |
| S1          | `apps/frontend/src/tests/feature-s1.test.ts` | Component          | [notes]                                  |

### Testing Strategy

- **Unit tests**: [What gets unit tested — services, repositories, utilities]
- **Integration tests**: [What gets integration tested — API routes, plugin chains]
- **Component tests**: [What gets component tested — Svelte components with @testing-library]

### Known Vitest Patterns to Apply

- `mockReset: true` in vitest.config.ts clears all mocks between tests — use forwarding pattern
- `vi.mock()` factories execute before module-level declarations — use globalThis registry if needed
- Fastify 5: `reply.send(undefined)` throws — always return a value

---

## 9. Risks & Mitigations

| #   | Risk            | Probability  | Impact       | Mitigation                        |
| --- | --------------- | ------------ | ------------ | --------------------------------- |
| R1  | [specific risk] | Low/Med/High | Low/Med/High | [specific, actionable mitigation] |
| R2  | [specific risk] | Low/Med/High | Low/Med/High | [specific, actionable mitigation] |

_Mitigations must be actionable. "Be careful" is not a mitigation._

---

## 10. Success Metrics

| Metric               | Target                   | Measurement Method | Timeframe |
| -------------------- | ------------------------ | ------------------ | --------- |
| [Adoption metric]    | [number or %]            | [how to measure]   | [when]    |
| [Quality metric]     | [number or %]            | [how to measure]   | [when]    |
| [Performance metric] | [duration or throughput] | [how to measure]   | [when]    |

_Every metric must be measurable — a number, percentage, or duration. "Users are happy" is not a metric._

---

## 11. Verification

### Automated Verification

```bash
# Run after each phase
npx vitest run --reporter=verbose              # All tests pass
pnpm lint                                       # No lint errors
cd apps/api && npx tsc --noEmit                 # API types clean
cd apps/frontend && npx svelte-check            # Frontend types clean
```

### Manual Verification

- [ ] [Specific manual check for M1]
- [ ] [Specific manual check for M2]
- [ ] [End-to-end user journey walkthrough]

---

## 12. Open Questions

_All items here must be resolved before the PRD is approved. Move answered questions to the relevant section._

- [ ] [Question 1]
- [ ] [Question 2]

---

## 13. Changelog

_Tracks PRD evolution. Each entry added by `/prd --update`._

| Date   | Change Type | Description |
| ------ | ----------- | ----------- |
| [date] | Created     | Initial PRD |
