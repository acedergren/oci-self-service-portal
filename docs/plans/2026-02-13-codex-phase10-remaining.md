# Codex Phase 10 Remaining Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the outstanding admin UI enhancements, OracleStore coverage, and repo-wide validation gates described in `docs/plans/codex-phase10-remaining.md` so Phase 10 can advance to final E2E testing.

**Architecture:** Extend existing SvelteKit admin routes (Agent Playground, Workflow Monitor, Tool Tester, Observability) using TanStack Query state and the portal design tokens, add full OracleStore integration tests by mocking the Oracle connector, and finish with repo-wide lint/type/test/security gates. Each task keeps Fastify/Svelte boundaries intact and uses existing API endpoints.

**Tech Stack:** SvelteKit 5 (runes, shadcn-svelte), TanStack Query, Fastify 5 routes, Vitest, TypeScript, Oracle repositories, pnpm workspace scripts.

---

### Task 1: Admin Agent Playground Enhancements

**Files:**

- Modify: `apps/frontend/src/routes/admin/agents/+page.svelte`
- Modify: `apps/frontend/src/lib/components/admin/agent-playground/stream-parser.ts`
- Test: `apps/frontend/src/tests/phase10/admin-agents.test.ts`

**Step 1: Write failing component test**

```typescript
// apps/frontend/src/tests/phase10/admin-agents.test.ts
it('renders agent list, tool call cards, and temperature sliders', async () => {
	const page = await renderAgentPlayground({ agents: mockAgents });
	await page.selectAgent('FinOps Analyst');
	expect(page.temperatureSlider).toHaveValue('1.0');
	await page.emitToolCall('call-123', 'oci.compute.listInstances', {
		compartmentId: 'ocid1.compartment...'
	});
	expect(page.getToolCard('call-123')).toContain('oci.compute.listInstances');
});
```

Run: `pnpm --filter apps/frontend exec vitest run src/tests/phase10/admin-agents.test.ts` → FAIL (missing UI pieces).

**Step 2: Implement agent list + sliders + tool call cards**

```svelte
// +page.svelte (sidebar agent list)
const agentsQuery = createQuery(() => ({
	queryKey: ['admin', 'agents'],
	queryFn: async () => {
		const res = await fetch('/api/mastra/agents');
		if (!res.ok) throw new Error('Failed to load agents');
		return res.json();
	}
}));
let selectedAgentId = $state<string | null>(null);

<ul class="agent-list">
	{#each agentsQuery.data ?? [] as agent}
	<li class:selected={agent.id === selectedAgentId} on:click={() => (selectedAgentId = agent.id)}>
		<h4>{agent.name}</h4>
		<p>{agent.model}</p>
	</li>
	{/each}
</ul>

// Config sliders
let temperature = $state(1.0);
<input type="range" min="0" max="2" step="0.1" bind:value={temperature} />
```

Update stream parser to handle `9:` start and `a:` result events, storing them in `$state<Map<string, ToolCall>>()` and rendering `<details>` cards inline.

**Step 3: Pass `temperature`/`topP` to chat mutation**

```ts
await fetch('/api/chat', {
	method: 'POST',
	body: JSON.stringify({ model, system, messages, agentId: selectedAgentId, temperature, topP })
});
```

**Step 4: Run tests**

`pnpm --filter apps/frontend exec vitest run src/tests/phase10/admin-agents.test.ts` → PASS.

**Step 5: Commit**

`git add apps/frontend/src/routes/admin/agents/+page.svelte apps/frontend/src/lib/components/admin/agent-playground/stream-parser.ts apps/frontend/src/tests/phase10/admin-agents.test.ts`

`git commit -m "feat(admin): enhance agent playground controls"`

---

### Task 2: Workflow Monitor Timeline, Controls, SSE

**Files:**

- Modify: `apps/frontend/src/routes/admin/workflows/runs/+page.svelte`
- Test: `apps/frontend/src/tests/phase10/admin-workflow-runs.test.ts`

**Step 1: Add failing test**

```typescript
it('displays step timeline and cancel/resume buttons', async () => {
	const page = await renderWorkflowRuns({ runs: [mockRunningRun] });
	await page.selectRun(mockRunningRun.id);
	expect(page.detailPanel).toContain('cancel run');
	expect(page.detailPanel).toContain('resume run');
});
```

Run: `pnpm --filter apps/frontend exec vitest run src/tests/phase10/admin-workflow-runs.test.ts` → FAIL.

**Step 2: Fetch detail + render timeline**

```ts
const runDetailQuery = createQuery(() => ({
	queryKey: ['admin', 'workflow-run', selectedRunId],
	queryFn: async () => {
		if (!selectedRunId) return null;
		const run = runs.find((r) => r.id === selectedRunId);
		const res = await fetch(`/api/v1/workflows/${run.definitionId}/runs/${selectedRunId}`);
		if (!res.ok) throw new Error('Failed to fetch run detail');
		return res.json();
	},
	enabled: browser && !!selectedRunId
}));

<div class="step-timeline">
	{#if runDetailQuery.data}
		{#each runDetailQuery.data.steps as step}
		<div class="step" data-status={step.status}>
			<span>{step.name}</span>
			<span>{ms(step.durationMs)}</span>
			<details><summary>Inputs</summary><pre>{JSON.stringify(step.inputs, null, 2)}</pre></details>
		</div>
		{/each}
	{/if}
</div>
```

**Step 3: Cancel/resume mutations + SSE**

```ts
const cancelMutation = createMutation(() => ({
	mutationFn: async ({ run }) => {
		const res = await fetch(`/api/v1/workflows/${run.definitionId}/runs/${run.id}/cancel`, {
			method: 'POST'
		});
		if (!res.ok) throw new Error('Failed to cancel');
	}
}));

$effect(() => {
	const run = runs.find((r) => r.id === selectedRunId);
	if (!run || run.status !== 'running') return;
	const es = new EventSource(`/api/v1/workflows/${run.definitionId}/runs/${run.id}/stream`);
	es.onmessage = (event) => updateSteps(JSON.parse(event.data));
	return () => es.close();
});
```

**Step 4: Tests**

`pnpm --filter apps/frontend exec vitest run src/tests/phase10/admin-workflow-runs.test.ts`

**Step 5: Commit**

`git commit -m "feat(admin): add workflow run SSE controls"`

---

### Task 3: Tool Tester Warning, Output Toggle, Timing

**Files:**

- Modify: `apps/frontend/src/routes/admin/tools/playground/+page.svelte`
- Test: `apps/frontend/src/tests/phase10/admin-tools.test.ts`

**Step 1: Write failing test**

```typescript
it('shows approval warning and output toggle', async () => {
	const page = await renderToolPlayground({ tool: dangerousTool });
	await page.selectTool('deleteBucket');
	expect(page.warningBanner).toHaveText('requires approval');
	await page.toggleOutput('raw');
	expect(page.output).toContain('opc-request-id');
});
```

Run targeted vitest → FAIL.

**Step 2: Implement warning + tabs + timing**

```svelte
{#if selectedTool?.approvalLevel === 'dangerous' || selectedTool?.approvalLevel === 'critical'}
	<div class="approval-warning">This tool requires approval in production. Playground execution bypasses approvals.</div>
{/if}

<div class="output-tabs">
	<button class:selected={outputMode === 'slimmed'} on:click={() => (outputMode = 'slimmed')}>Slimmed</button>
	<button class:selected={outputMode === 'raw'} on:click={() => (outputMode = 'raw')}>Raw</button>
</div>

let executionMs = $state<number | null>(null);

const executeMutation = createMutation(() => ({
	mutationFn: async ({ name, args }) => {
		const start = performance.now();
		const res = await fetch(`/api/v1/tools/${name}/execute`, { method: 'POST', body: JSON.stringify({ args, mode: 'both' }) });
		executionMs = Math.round(performance.now() - start);
		return res.json();
	}
}));
```

**Step 3: Tests**

`pnpm --filter apps/frontend exec vitest run src/tests/phase10/admin-tools.test.ts`

**Step 4: Commit**

`git commit -m "feat(admin): improve tool tester feedback"`

---

### Task 4: Observability Timeline, Error Summary, Cost Placeholder

**Files:**

- Modify: `apps/frontend/src/routes/admin/observability/+page.svelte`
- Test: `apps/frontend/src/tests/phase10/admin-observability.test.ts`

**Step 1: Failing test**

```typescript
it('renders workflow timeline and error summary', async () => {
	const page = await renderObservability({ runs: sampleRuns, metrics: sampleMetrics });
	expect(page.timelineBars).toHaveLength(sampleRuns.length);
	expect(page.errorSummary).toContain('12 errors');
	expect(page.costPlaceholder).toHaveText('Coming soon');
});
```

Run vitest → FAIL.

**Step 2: Implement runs query + timeline**

```ts
const runsQuery = createQuery(() => ({
	queryKey: ['admin', 'recent-runs'],
	queryFn: async () => {
		const res = await fetch('/api/v1/workflows/runs?limit=20');
		if (!res.ok) throw new Error('Failed to fetch runs');
		return res.json();
	},
	refetchInterval: 15_000,
	enabled: browser
}));

<div class="workflow-timeline">
	{#each runsQuery.data?.runs ?? [] as run}
		<div class="timeline-bar" style={`left:${position(run)}%; width:${width(run)}%;`} data-status={run.status}></div>
	{/each}
</div>
```

Add error summary deriving counts from `metrics.tools.byStatus` and placeholder metric card.

**Step 3: Tests**

`pnpm --filter apps/frontend exec vitest run src/tests/phase10/admin-observability.test.ts`

**Step 4: Commit**

`git commit -m "feat(admin): expand observability dashboard"`

---

### Task 5: OracleStore Integration Tests (AD-55)

**Files:**

- Create: `apps/api/src/tests/mastra/oracle-store.test.ts`
- Modify: `apps/api/src/mastra/storage/oracle-store.ts` (fixes surfaced by tests)

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockExecute = vi.fn();
const mockWithConnection = vi.fn();
vi.mock('@portal/server/oracle/connection', () => ({ withConnection: mockWithConnection }));

const { OracleStore } = await import('../../mastra/storage/oracle-store.js');

describe('OracleStore workflows', () => {
	let store: OracleStore;

	beforeEach(() => {
		mockExecute.mockReset();
		mockWithConnection.mockReset().mockImplementation(async (fn) => fn({ execute: mockExecute }));
		store = new OracleStore();
	});

	it('getWorkflowRunById returns normalized row', async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{ ID: 'run-1', DEFINITION_ID: 'def-1', STATUS: 'running' }]
		});
		const run = await store.getWorkflowRunById('run-1');
		expect(run).toMatchObject({ id: 'run-1', status: 'running' });
	});
});
```

Add 15+ cases covering workflows, threads/messages, scores as per spec.

Run: `pnpm --filter apps/api exec vitest run src/tests/mastra/oracle-store.test.ts` → FAIL.

**Step 2: Implement fixes**

Adjust `OracleStore` methods if tests expose normalization or pagination issues (e.g., ensure cursor filters propagate, convert Oracle timestamp columns to ISO strings, wrap `resumeData` JSON parsing with `JSON.parse` guards).

**Step 3: Re-run tests**

`pnpm --filter apps/api exec vitest run src/tests/mastra/oracle-store.test.ts`

**Step 4: Commit**

`git add apps/api/src/tests/mastra/oracle-store.test.ts apps/api/src/mastra/storage/oracle-store.ts`

`git commit -m "test(mastra): cover OracleStore workflows and scores"`

---

### Task 6: Post-Migration Validation Gates

**Files:**

- N/A (commands only, but capture logs under `docs/validation/2026-02-13-phase10.txt` if desired)

**Step 1: Full tests**

```bash
pnpm --filter ./apps/api exec vitest run
pnpm --filter ./apps/frontend exec vitest run
```

**Step 2: Type checks**

```bash
cd apps/frontend && npx svelte-check
cd apps/api && npx tsc --noEmit
cd packages/server && npx tsc --noEmit
cd packages/types && npx tsc --noEmit
```

**Step 3: Lint + security + deps**

```bash
pnpm lint
npx semgrep scan --config auto
npx syncpack lint
pnpm outdated --long
```

Document outputs in `docs/validation/2026-02-13-phase10.txt`.

**Step 4: Commit QA log**

`git add docs/validation/2026-02-13-phase10.txt`

`git commit -m "chore(qa): record phase 10 validation gates"`

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-02-13-codex-phase10-remaining.md`. Two execution options:

1. **Subagent-Driven (this session)** — I dispatch a fresh superpowers:subagent-driven-development helper per task with reviews between steps for rapid iteration.
2. **Parallel Session** — Start a new conversation/worktree session dedicated to superpowers:executing-plans and run tasks sequentially with checkpoints.

Which approach do you prefer?
