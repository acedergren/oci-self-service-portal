---
name: phase-kickoff
description: Scaffold a new development phase with branch, test shells, and roadmap entry
---

# Phase Kickoff

Scaffold a new phase of development for the self-service portal, following the established phase-based workflow.

## Steps

1. **Parse arguments**: Extract the phase number and goal from `$ARGUMENTS` (e.g., "10 - Admin Console MVP").

2. **Update ROADMAP.md**: Append a new phase section to `docs/ROADMAP.md` following the existing format:

   ```markdown
   ---
   
   ## Phase {N}: {Title}
   
   **Goal**: {One-sentence goal description}
   
   - [ ] {N}.1 {First task}
   - [ ] {N}.2 {Second task}
   ...

   **Verify**: {How to confirm the phase is complete}
   ```

3. **Create feature branch** (if not already on one):

   ```
   git checkout -b feature/phase{N}-{kebab-case-title}
   ```

4. **Create TDD test shell**: Create a test file at `apps/frontend/src/tests/phase{N}/{feature-name}.test.ts` with `describe` blocks matching the planned tasks. Use the project's vitest setup:

   ```typescript
   import { describe, it, expect } from "vitest";

   describe("Phase {N}: {Title}", () => {
     describe("{N}.1 - {First task}", () => {
       it.todo("should ...");
     });
   });
   ```

5. **Print summary**: Show the phase number, branch name, test file location, and task count.

## Arguments

- `$ARGUMENTS`: Phase number and title (e.g., "10 - Admin Console MVP" or "11 Real-time Notifications")

## Context

This project follows a rigorous phase-based model:

- Each phase has a clear goal, numbered tasks, and a verification criteria
- Test files go in `apps/frontend/src/tests/phase{N}/`
- Branches follow `feature/phase{N}-{kebab-case}` naming
- Quality gates: lint, typecheck, semgrep, coderabbit, codeql per commit
- Test counts are tracked in MEMORY.md after phase completion
