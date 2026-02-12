# Admin Agent & Workflow Stabilization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align the admin agent playground and workflow monitor pages with the latest TanStack Query patterns, mobile layout guidance, and test/typing requirements so upcoming UI enhancements have a stable base.

**Architecture:** Continue using Svelte 5 runes with TanStack Svelte Query for server state, keeping UI state in `$state` runes. Stream handlers remain in `streaming.ts`; workflows page keeps SSE wiring but migrates to derived query data + mutation helpers. Styling continues with existing CSS custom properties.

**Tech Stack:** Svelte 5, TanStack Svelte Query v5, Vitest, SvelteKit, CSS custom properties.

---

### Task 1: Agent Query Derivations & Typing

**Files:**

- Modify: `apps/frontend/src/routes/admin/agents/+page.svelte`
- Reference: `apps/frontend/src/routes/admin/agents/streaming.ts`
- Test: `apps/frontend/src/tests/admin/agent-playground.test.ts`

**Step 1: Write failing UI test (logic)**

- In `apps/frontend/src/tests/admin/agent-playground.test.ts`, add a new describe block covering `createQuery` data shaping (e.g., ensure `buildChatRequestPayload` enforces numeric clamping for `temperature` / `topP` and that `AgentInfo` arrays preserve types).
- Run `pnpm --filter ./apps/frontend exec vitest run src/tests/admin/agent-playground.test.ts` expecting failure referencing missing derivation logic.

**Step 2: Update derived stores**

- In `+page.svelte`, type `agentsQuery` data with `satisfies AgentInfo[]` when building `agents` so Svelte infers `AgentInfo` instead of `any`.
- Introduce `$derivedAgentsLoading = $derived($agentsLoading)` and `$derivedAgentsFetching = $derived($agentsFetching)` to feed JSX without `$` references.
- Ensure `selectedAgent`, `agents`, and `totalTokens` reference those derived stores (no lingering `$agentsQuery`).

**Step 3: Fix template bindings**

- Replace template usages of `$agentsLoading` / `$agentsFetching` with the new derived signals (e.g., `{#if agentsLoading}`) to avoid TypeScript implicit `any`.
- Explicitly type `messages` / `history` arrays via `ChatMessage[]` and `TextMessage[]` to satisfy linting.

**Step 4: Re-run targeted tests**

- Run `pnpm --filter ./apps/frontend exec vitest run src/tests/admin/agent-playground.test.ts` and confirm the new test passes.

**Step 5: Document changes**

- Note the query derivation rationale in commit summary (no inline comments unless necessary).

### Task 2: Agent Sidebar Mobile Layout & Autofix Attempt

**Files:**

- Modify: `apps/frontend/src/routes/admin/agents/+page.svelte` (style block + sidebar markup)

**Step 1: Update layout markup**

- Wrap the `<aside>` in a container that supports `aria-expanded` for `sidebarOpen` and add a backdrop `<div class="sidebar-backdrop">` for mobile per design notes.
- Ensure toggle button updates `sidebarOpen` and the new backdrop closes the panel when clicked.

**Step 2: Add responsive CSS**

- In the `<style>` block, add `.sidebar-backdrop` styles (transparent on desktop, fixed overlay on mobile) and update the `@media (max-width: 1024px)` section so the sidebar slides over content with `transform` transitions.
- Include focus-visible styles for the toggle button per accessibility checklist.

**Step 3: Attempt svelte-autofixer**

- Run `npx @sveltejs/mcp svelte-autofixer apps/frontend/src/routes/admin/agents/+page.svelte`.
- If it fails due to npm 403, capture the error text for the final report.

**Step 4: Manual lint verification**

- After CSS updates, run `pnpm --filter ./apps/frontend exec vitest run src/tests/admin/agent-playground.test.ts` (ensures no regressions) and visually sanity-check via `pnpm dev` if time allows.

### Task 3: Workflow Monitor Query Sweep & TODOs

**Files:**

- Modify: `apps/frontend/src/routes/admin/workflows/runs/+page.svelte`

**Step 1: Audit for `$runsQuery`**

- Search the file to confirm only destructured stores are referenced. Remove any leftover `$runsQuery` usages found.

**Step 2: Add TODO markers for upcoming SSE enhancements**

- Near the SSE `$effect`, add a succinct comment describing the pending “step highlight + SSE diff merging” work (per requirements), making sure it is necessary for clarity.

**Step 3: Prepare mutation helpers**

- Extract `cancelSelectedRun` / `resumeSelectedRun` button text into derived constants (e.g., `cancelButtonLabel = $derived($cancelRunPending ? 'Cancelling…' : 'Cancel')`) to align with the agent page pattern.
- Ensure TypeScript types (`WorkflowRun`, `WorkflowRunDetail`) remain intact.

**Step 4: Verify no behavioral changes**

- Run `pnpm --filter ./apps/frontend exec vitest run src/tests/admin/agent-playground.test.ts` (touching shared streaming logic) and `npx svelte-check` to ensure the runs page changes don’t introduce new type errors; document any pre-existing alias warnings.

### Task 4: Quality Gates & Notes

**Files/Commands:**

- `apps/frontend/src/routes/admin/agents/+page.svelte`
- `apps/frontend/src/routes/admin/workflows/runs/+page.svelte`

**Step 1: Lint + type check**

- Run `pnpm --filter ./apps/frontend lint` (or repo-standard lint command) focusing on modified files.
- Run `npx svelte-check` from `apps/frontend`.

**Step 2: Tests**

- Execute `pnpm --filter ./apps/frontend exec vitest run src/tests/admin/agent-playground.test.ts`.

**Step 3: Document npm issue**

- If the svelte-autofixer command still fails with the known 403, capture and summarize it in the final PR notes for future tracking.

**Step 4: Commit guidance**

- Stage only the touched Svelte files + updated test file + plan document.
- Commit message suggestion: `chore(admin): tighten agent query derivations` (adjust to final scope).

---

Plan complete and saved to `docs/plans/2026-02-12-admin-agent-workflow-plan.md`. Two execution options:

1. **Subagent-Driven (this session)** — Dispatch a fresh subagent per task with `superpowers:subagent-driven-development`, reviewing after each task.
2. **Parallel Session (separate)** — Launch a new session using `superpowers:executing-plans` to run the plan end-to-end with checkpoints.

Which approach should we use?
