# Codex Execution Prompt — Phase 10 Remaining Work (v2)

> **Updated:** 2026-02-12 — Task Group 2 (backend API gaps) is COMPLETE.
> Workflow cancel/resume/detail routes added + 241 lines of test coverage.

## Progress Tracker

| Group   | Tasks   | Description                                                       | Status         |
| ------- | ------- | ----------------------------------------------------------------- | -------------- |
| Group 1 | 4 tasks | Admin page enhancements (agents, workflows, tools, observability) | **NEXT**       |
| Group 2 | 4 tasks | Backend API gap verification + creation                           | **DONE**       |
| Group 3 | 1 task  | OracleStore integration tests (AD-55)                             | **NEXT**       |
| Group 4 | 6 tasks | Post-migration validation (tests, types, lint, security, deps)    | Blocked on 1+3 |

---

## Project Context

You are working on the **OCI Self-Service Portal**, a pnpm monorepo:

```
apps/frontend/     — SvelteKit (Svelte 5 runes, shadcn-svelte, TanStack Query)
apps/api/          — Fastify 5 (TypeScript, Zod validation, Better Auth)
packages/shared/   — Legacy shared package (deprecated — do not add files here)
packages/server/   — @portal/server (business logic, Oracle repos, auth)
packages/types/    — @portal/types (Zod schemas, TS types, zero deps)
packages/ui/       — @portal/ui (Svelte components)
```

**Key conventions:**

- `kebab-case.ts` files, `PascalCase.svelte` components, `.js` extensions in all ESM imports
- Svelte 5 only: `$props()`, `$state()`, `$derived()`, `$effect()` — never `export let`, `$:`, or `writable` stores
- Fastify 5: Zod type provider, `reply.send(undefined)` throws, plugin order is load-bearing
- TanStack Query for all server state (`createQuery`, `createMutation`, `invalidateQueries`)
- CSS custom properties (`var(--fg-primary)`, `var(--bg-secondary)`, `var(--accent-primary)`, etc.) — **no Tailwind**
- Commit format: `type(scope): description`
- All Oracle queries use bind parameters (`:paramName`), never string interpolation
- `mockReset: true` in vitest — re-configure mock return values in `beforeEach`, not at module level
- Test UUIDs must be RFC 9562 compliant: use `12345678-1234-4123-8123-123456789012` (Zod 4 strict validation)

---

## Available Backend API Endpoints (already implemented)

These endpoints are confirmed available for the frontend to call:

### Workflow APIs (`apps/api/src/routes/workflows.ts`)

```
GET    /api/v1/workflows                          — list workflows
POST   /api/v1/workflows                          — create workflow
GET    /api/v1/workflows/:id                      — get workflow detail
PUT    /api/v1/workflows/:id                      — update workflow
DELETE /api/v1/workflows/:id                      — delete workflow
POST   /api/v1/workflows/:id/run                  — execute workflow
GET    /api/v1/workflows/runs                      — list ALL runs (admin, supports ?status=&limit=&offset=)
GET    /api/v1/workflows/:id/runs                  — list runs for specific workflow
GET    /api/v1/workflows/:id/runs/:runId           — get run detail (includes steps array)
GET    /api/v1/workflows/:id/runs/:runId/stream    — SSE stream for run progress
POST   /api/v1/workflows/:id/runs/:runId/approve   — resume suspended run (accepts resumeData in body)
POST   /api/v1/workflows/:id/runs/:runId/cancel    — cancel pending/running/suspended run
```

### Admin Metrics API (`apps/api/src/routes/admin/metrics.ts`)

```
GET    /api/admin/metrics/summary    — JSON metrics overview (chat, tools, sessions, approvals, database, auth, raw)
```

### Chat API (`apps/api/src/routes/chat.ts`)

```
POST   /api/chat                     — send message (accepts model, system, messages in body)
```

### Tools API (`apps/api/src/routes/tools.ts`)

```
GET    /api/v1/tools                 — list all tools (includes name, description, category, inputSchema, approvalLevel)
POST   /api/v1/tools/:name/execute   — execute tool (accepts args in body)
```

### Mastra Auto-Routes

```
GET    /api/mastra/agents            — list registered agents (name, model, description)
```

---

## TASK GROUP 1: Admin Page Enhancements (4 parallel tasks)

All 4 admin pages exist with working core functionality. Each task adds specific enhancements.

### Task 1.1: Agent Playground — Tool Call Visualization + Agent Selection

**File:** `apps/frontend/src/routes/admin/agents/+page.svelte` (576 lines)

**Already working:** Streaming chat with CloudAdvisor, model selection dropdown, system prompt override, token usage + latency metrics.

**Add these 3 features:**

1. **Agent list** — Fetch from `GET /api/mastra/agents`. Replace the hardcoded CloudAdvisor assumption with a selectable agent list in the config sidebar. Show agent name + model. Default to first agent.

2. **Tool call cards** — The chat stream parser already handles `0:` (text) and `d:` (done/usage) prefixes. Add handlers for AI SDK streaming protocol tool events:
   - `9:` prefix → tool call start (parse JSON: `{toolCallId, toolName, args}`)
   - `a:` prefix → tool call result (parse JSON: `{toolCallId, result}`)

   Render tool calls inline between chat messages as collapsible cards:

   ```svelte
   <details class="tool-call-card">
   	<summary>{toolName} — {durationMs}ms</summary>
   	<div class="tool-args">
   		<pre>{JSON.stringify(args, null, 2)}</pre>
   	</div>
   	<div class="tool-result">
   		<pre>{JSON.stringify(result, null, 2)}</pre>
   	</div>
   </details>
   ```

   Style using existing CSS custom properties. Track in-flight tool calls with a `Map<string, {toolName, args, startTime}>` in `$state`.

3. **Temperature + top-p sliders** — Add to config sidebar below system prompt:
   ```svelte
   <input type="range" min="0" max="2" step="0.1" bind:value={temperature} />
   <input type="range" min="0" max="1" step="0.05" bind:value={topP} />
   ```
   Pass `temperature` and `topP` in the `POST /api/chat` body alongside `model`, `system`, `messages`.

**Commit:** `feat(admin): add agent selection, tool call cards, and parameter tuning to playground`

---

### Task 1.2: Workflow Monitor — Step Timeline + Controls + SSE

**File:** `apps/frontend/src/routes/admin/workflows/runs/+page.svelte` (407 lines)

**Already working:** Runs table with status filter, pagination, 5s polling auto-refresh, status color badges, duration display.

**Add these 3 features:**

1. **Step detail panel** — When `selectedRunId` is set (click handler already exists), fetch the run detail:

   ```typescript
   const runDetailQuery = createQuery(() => ({
   	queryKey: ['admin', 'workflow-run', selectedRunId],
   	queryFn: async () => {
   		// Need the definitionId from the selected run
   		const run = runs.find((r) => r.id === selectedRunId);
   		const res = await fetch(`/api/v1/workflows/${run.definitionId}/runs/${selectedRunId}`);
   		if (!res.ok) throw new Error('Failed to fetch run detail');
   		return res.json();
   	},
   	enabled: browser && !!selectedRunId
   }));
   ```

   Display below the selected row as an expandable panel with a vertical step timeline. Each step shows: name, status badge (reuse `statusColor()`), duration, and collapsible JSON for inputs/outputs.

2. **Cancel + Resume buttons** — Show in the detail panel header:
   - "Cancel" button (visible when status is `running`, `pending`, or `suspended`) → `POST /api/v1/workflows/:id/runs/:runId/cancel`
   - "Resume" button (visible when status is `suspended`) → `POST /api/v1/workflows/:id/runs/:runId/approve` with `{ resumeData: {} }` body

   Use `createMutation` + `invalidateQueries(['admin', 'workflow-runs'])` on success. Disable buttons during mutation.

3. **Live SSE** — When a `running` run is selected, connect to SSE:

   ```typescript
   $effect(() => {
   	const run = runs.find((r) => r.id === selectedRunId);
   	if (!run || run.status !== 'running') return;

   	const es = new EventSource(`/api/v1/workflows/${run.definitionId}/runs/${run.id}/stream`);
   	es.onmessage = (event) => {
   		// Update step statuses in real-time
   		const data = JSON.parse(event.data);
   		// Merge into runDetailQuery or local state
   	};
   	return () => es.close(); // cleanup on unmount or selection change
   });
   ```

**Commit:** `feat(admin): add step timeline, run controls, and SSE progress to workflow monitor`

---

### Task 1.3: Tool Tester — Approval Warning + Output Toggle + Timing

**File:** `apps/frontend/src/routes/admin/tools/playground/+page.svelte` (566 lines)

**Already working:** Tool catalog with fuzzy search, category filter, parameter builder from inputSchema, execute + result/error display.

**Add these 3 features:**

1. **Approval warning** — After `selectTool()`, check `selectedTool.approvalLevel`. If `"dangerous"` or `"critical"`, render a warning banner above the execute button:

   ```svelte
   {#if selectedTool.approvalLevel === 'dangerous' || selectedTool.approvalLevel === 'critical'}
   	<div class="approval-warning">
   		This tool requires approval in production. Playground execution bypasses the approval flow.
   	</div>
   {/if}
   ```

   Style: `background: oklch(0.35 0.12 55); color: oklch(0.9 0.1 55); padding: var(--space-md); border-radius: var(--radius-md); font-size: var(--text-sm);`

2. **Raw vs slimmed toggle** — Add two tab buttons above the result `<pre>`:

   ```typescript
   let outputMode = $state<'slimmed' | 'raw'>('slimmed');
   ```

   The execute mutation should request both formats (or the API may already return `{ result, raw }` — check the response shape). Show the selected format in the `<pre>` block. Style tabs using `background: var(--bg-elevated)` for inactive, `var(--accent-primary)` for active.

3. **Execution time** — Wrap the mutation with timing:
   ```typescript
   let executionMs = $state<number | null>(null);
   // In executeSelected():
   const start = performance.now();
   $executeMutation.mutate(
   	{ name: selectedTool.name, args },
   	{
   		onSettled: () => {
   			executionMs = Math.round(performance.now() - start);
   		}
   	}
   );
   ```
   Display below the result panel using the `metric-row` pattern from the Agent Playground.

**Commit:** `feat(admin): add approval warning, output toggle, and timing to tool tester`

---

### Task 1.4: Observability — Workflow Timeline + Cost Placeholder

**File:** `apps/frontend/src/routes/admin/observability/+page.svelte` (498 lines)

**Already working:** Health banner, 6 metric cards, tool performance table, raw metrics list.

**Add these 3 features:**

1. **Workflow run timeline** — Add a new section after the metrics grid. Fetch recent runs:

   ```typescript
   const runsQuery = createQuery(() => ({
   	queryKey: ['admin', 'recent-runs'],
   	queryFn: async () => {
   		const res = await fetch('/api/v1/workflows/runs?limit=20');
   		if (!res.ok) throw new Error('Failed to fetch runs');
   		return res.json();
   	},
   	enabled: browser,
   	refetchInterval: 15_000
   }));
   ```

   Render as a horizontal bar timeline. Each run is a colored bar positioned by start time, width proportional to duration:
   - `completed` → `oklch(0.55 0.15 155)` (green)
   - `running` → `oklch(0.55 0.15 230)` (blue)
   - `failed` → `oklch(0.55 0.15 30)` (red)
   - `suspended` → `oklch(0.55 0.15 80)` (yellow)

   Show tooltip on hover with run ID, workflow name, status, and duration.

2. **Error rate display** — Add a derived metric below the "Tool Executions" card that shows the error count and percentage. This data already exists in `metrics.tools.byStatus` — just render it more prominently:

   ```svelte
   <div class="error-summary">
   	<span class="error-count">{errorCount} errors</span>
   	<span class="error-pct">({errorRate(metrics?.tools.byStatus)})</span>
   </div>
   ```

3. **Cost tracking placeholder** — Add a 7th card to the metrics grid:
   ```svelte
   <div class="metric-card placeholder">
   	<div class="metric-label">Cost Tracking</div>
   	<div class="metric-value placeholder-text">—</div>
   	<div class="metric-detail">
   		<span class="metric-tag">Coming soon — requires OCI Usage API</span>
   	</div>
   </div>
   ```
   Style with `opacity: 0.6` and dashed border to visually indicate placeholder status.

**Commit:** `feat(admin): add workflow timeline, error summary, and cost placeholder to observability`

---

## TASK GROUP 3: OracleStore Integration Tests (AD-55)

**OracleStore location:** `apps/api/src/mastra/storage/oracle-store.ts` (1,243 lines)

This class implements Mastra's `MastraStorage` interface across 3 domains with 20+ methods:

**Workflows:** `getWorkflowRunById`, `listWorkflowRuns`, `deleteWorkflowRunById`, `updateWorkflowResults`, `updateWorkflowState`
**Threads/Messages:** `getThreadById`, `updateThread`, `deleteThread`, `listThreads`, `listMessages`, `listMessagesByResourceId`, `listMessagesById`, `updateMessages`
**Resources/Scores:** `getResourceById`, `updateResource`, `getScoreById`, `listScoresByScorerId`, `listScoresByRunId`, `listScoresByEntityId`, `listScoresBySpan`

### Task 3.1: Write OracleStore tests

**File to create:** `apps/api/src/tests/mastra/oracle-store.test.ts`

**Structure:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Oracle connection module
const mockExecute = vi.fn();
const mockGetRows = vi.fn();
vi.mock('@portal/server/oracle/connection', () => ({
  withConnection: (...args: unknown[]) => mockWithConnection(...args)
}));
const mockWithConnection = vi.fn();

// Import after mocks
const { OracleStore } = await import('../../mastra/storage/oracle-store.js');

describe('OracleStore', () => {
  let store: InstanceType<typeof OracleStore>;

  beforeEach(() => {
    store = new OracleStore();
    // Reset and reconfigure mocks (mockReset: true clears everything)
    mockWithConnection.mockImplementation(async (fn) => fn({
      execute: mockExecute,
      // ... mock connection shape
    }));
    mockExecute.mockResolvedValue({ rows: [] });
  });

  describe('workflows domain', () => {
    it('getWorkflowRunById returns run when found', async () => { ... });
    it('getWorkflowRunById returns null for missing ID', async () => { ... });
    it('listWorkflowRuns returns paginated results', async () => { ... });
    it('listWorkflowRuns handles empty result set', async () => { ... });
    it('updateWorkflowResults persists JSON output', async () => { ... });
  });

  describe('threads/messages domain', () => {
    it('getThreadById returns thread when found', async () => { ... });
    it('listThreads supports cursor pagination', async () => { ... });
    it('listMessages returns messages in order', async () => { ... });
    it('updateMessages handles large payloads (>10KB)', async () => { ... });
  });

  describe('scores domain', () => {
    it('getScoreById returns score data', async () => { ... });
    it('listScoresByRunId filters correctly', async () => { ... });
    it('listScoresBySpan handles empty span', async () => { ... });
  });
});
```

**Key rules:**

- Use forwarding pattern for all mocks (see project CLAUDE.md mock patterns section)
- Counter-based `mockImplementation` for multi-query operations, not chained `mockResolvedValueOnce`
- RFC-compliant UUIDs: `12345678-1234-4123-8123-123456789012` format
- Oracle returns UPPERCASE column keys — verify the store correctly lowercases them
- Test at least 15 cases across the 3 domains

**Commit:** `test(mastra): add OracleStore integration tests for workflows, threads, and scores`

**Verify:** `pnpm --filter ./apps/api exec vitest run src/tests/mastra/oracle-store.test.ts`

---

## TASK GROUP 4: Post-Migration Validation

Run after Groups 1 and 3 are complete.

### Task 4.1: Full test suite

```bash
pnpm --filter ./apps/api exec vitest run
pnpm --filter ./apps/frontend exec vitest run
```

All tests must pass. Fix any failures introduced by Group 1/3 work.

### Task 4.2: Type checking

```bash
cd apps/frontend && npx svelte-check
cd apps/api && npx tsc --noEmit
cd packages/server && npx tsc --noEmit
cd packages/types && npx tsc --noEmit
```

Zero type errors.

### Task 4.3: Lint

```bash
pnpm lint
```

Zero new lint errors in files you touched. Pre-existing errors in untouched files can be ignored.

### Task 4.4: Verify zero API +server.ts files

```bash
find apps/frontend/src/routes -name '+server.ts' -type f
```

Expected: zero results.

### Task 4.5: Security scan

```bash
npx semgrep scan --config auto apps/api/src apps/frontend/src packages/server/src packages/types/src 2>&1 | head -50
```

Zero high-severity findings in modified files.

### Task 4.6: Dependency health

```bash
pnpm outdated 2>&1 | head -30
```

Report findings. No action required.

---

## Execution Order

```
Group 1 (4 frontend tasks) ──┐
                              ├──► Group 4 (validation)
Group 3 (OracleStore tests) ─┘
```

Groups 1 and 3 have **zero dependencies on each other** — run in parallel.
Group 4 runs last as the final quality gate.

## Commit Strategy

One commit per task (6 total), using format:

```
feat(admin): add tool call visualization to agent playground

Co-Authored-By: Codex <noreply@openai.com>
```

Stage specific files only — never `git add -A` or `git add .`.

## Important Caveats

- **Do NOT modify** `apps/api/src/app.ts` plugin registration order — it's load-bearing
- **Do NOT add new npm dependencies** without documenting why in the commit message
- **Do NOT refactor** existing working code outside the scope of these tasks
- **Do NOT create new files** in `packages/shared/` — it's deprecated
- **CSS custom properties only** — no Tailwind, no inline hex colors (use oklch or CSS vars)
- **Svelte 5 only** — `$state()`, `$derived()`, `$effect()`, `$props()`. Never `export let`, `$:`, or `writable()`
- **`.js` extensions** in all TypeScript imports (ESM requirement)
- `vitest.config.ts` has `mockReset: true` — always reconfigure mocks in `beforeEach`
- The workflow resume endpoint is `/approve` not `/resume` — match the actual API path
