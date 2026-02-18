# Phase 10 Test Coverage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring every remaining PRD feature under automated test by finishing the missing backend/frontend behavior via strict TDD loops.

**Architecture:** Drive coverage across Fastify (apps/api), the shared workflow engine (packages/shared), and the SvelteKit admin UI (apps/frontend) while extracting common UI into @portal/ui. Every task follows Red-Green-Refactor: write the test, watch it fail, implement the minimum change, and re-run targeted suites before committing.

**Tech Stack:** Vitest, Svelte Testing Library, Fastify inject tests, pnpm workspaces, OracleDB mocks, @testing-library/svelte, TanStack Query, shadcn-svelte, OCI SDK, LayerChart embeds.

---

### Task 1: Workflow Executor Node Coverage

**Files:**

- Modify: `packages/shared/src/server/workflows/executor.ts`
- Create: `packages/shared/src/server/workflows/executor.spec.ts`
- Modify: `apps/api/src/tests/workflows/executor.test.ts`

**Step 1: Write failing shared executor specs**

```ts
// packages/shared/src/server/workflows/executor.spec.ts
describe('WorkflowExecutor advanced nodes', () => {
	const aiHandler = vi.fn().mockResolvedValue({ summary: 'ok', tokens: 12 });
	const def = buildDefinitionWithAIStep();

	it('runs ai-step nodes via agent adapter and stores result in stepResults', async () => {
		const exec = buildExecutor({ aiStepHandler: aiHandler });
		await expect(exec.run(def, buildInput())).resolves.toMatchObject({
			output: { aiSummary: 'ok' },
			stepResults: expect.objectContaining({ aiStep1: expect.any(Object) })
		});
		expect(aiHandler).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.2 }));
	});

	it('executes loop nodes with retries and break expressions', async () => {
		const exec = buildExecutor({ loopHandler: flakyLoopHandler({ failTimes: 1 }) });
		await expect(exec.run(buildLoopDefinition(), buildInput())).resolves.toMatchObject({
			output: { items: ['a', 'b'] }
		});
	});

	it('executes parallel branches concurrently and merges outputs', async () => {
		const exec = buildExecutor({ parallelHandler: parallelHandler() });
		await expect(exec.run(buildParallelDefinition(), buildInput())).resolves.toMatchObject({
			output: { branchA: 'done', branchB: 'done' }
		});
	});
});
```

**Step 2: Run unit specs (expect FAIL)**

`pnpm vitest run packages/shared/src/server/workflows/executor.spec.ts`

**Step 3: Extend Fastify SSE regression test**

```ts
// apps/api/src/tests/workflows/executor.test.ts
it('streams step/status SSE events for advanced nodes', async () => {
	const app = await buildTestApp();
	const res = await app.inject({
		method: 'GET',
		url: `/api/v1/workflows/${defId}/runs/${runId}/stream`
	});
	const body = res.body.toString();
	expect(body).toContain('event: step');
	expect(body).toContain('event: status');
	expect(body).toContain('data: {"node":"ai-step"');
});
```

Run: `pnpm vitest run apps/api/src/tests/workflows/executor.test.ts` (expect FAIL).

**Step 4: Implement executor + SSE logic**

- Flesh out `executeAIStep`, `executeLoopNode`, and `executeParallelNode` with agent invocations, retry/backoff controls, timeout guards, and resume token persistence.
- Emit `step`/`status` SSE frames from workflow routes whenever the executor reports progress.
- Ensure `stepResults` merges branch outputs deterministically.

**Step 5: Re-run suites (expect PASS)**

`pnpm vitest run packages/shared/src/server/workflows/executor.spec.ts apps/api/src/tests/workflows/executor.test.ts`

**Step 6: Commit**

```bash
git add packages/shared/src/server/workflows/executor.ts \
        packages/shared/src/server/workflows/executor.spec.ts \
        apps/api/src/tests/workflows/executor.test.ts
git commit -m "feat(workflows): implement advanced node execution"
```

---

### Task 2: OCI SDK Enforcement + Latency Budget

**Files:**

- Modify: `apps/api/src/mastra/tools/registry.ts`
- Modify: `apps/api/src/mastra/tools/categories/*.ts`
- Modify: `packages/shared/src/tools/executor.ts`
- Modify: `packages/server/src/embeddings.ts`
- Create: `apps/api/src/tests/tools/oci-sdk-executor.test.ts`

**Step 1: Write failing enforcement specs**

```ts
// apps/api/src/tests/tools/oci-sdk-executor.test.ts
import * as childProcess from 'node:child_process';

it('rejects CLI fallback usage during tool execution', async () => {
	const spy = vi.spyOn(childProcess, 'execFile');
	await expect(executeTool('listBuckets', buildArgs())).rejects.toThrow('OCI CLI is disabled');
	expect(spy).not.toHaveBeenCalled();
});

it('enforces rolling p95 latency under 500ms', async () => {
	vi.useFakeTimers();
	seedLatencySamples([400, 420, 600]);
	await expect(executeTool('listBuckets', buildArgs())).rejects.toThrow(
		'OCI SDK latency budget exceeded'
	);
});
```

Run: `pnpm vitest run apps/api/src/tests/tools/oci-sdk-executor.test.ts` (expect FAIL).

**Step 2: Implement SDK-only path + metrics**

- Remove `executeOCI/executeOCIAsync`; route tool registry through `executeOCISDK` only.
- Update embeddings to use the OCI SDK provider so no path shells out to the CLI.
- Add rolling histogram (metrics bucket or simple Ring buffer) and guard that throws when p95 > 500 ms (mock metrics in tests).

**Step 3: Re-run targeted suites**

```bash
pnpm vitest run apps/api/src/tests/tools/oci-sdk-executor.test.ts
pnpm vitest run apps/api/src/mastra/tools/registry.test.ts
```

**Step 4: Commit**

```bash
git add apps/api/src/mastra/tools apps/api/src/tests/tools \
        packages/shared/src/tools/executor.ts packages/server/src/embeddings.ts
git commit -m "feat(oci): enforce sdk-backed tool execution"
```

---

### Task 3: Oracle VPD Request Wiring

**Files:**

- Modify: `apps/api/src/plugins/oracle.ts`
- Modify: `apps/api/src/plugins/auth.ts`
- Create: `apps/api/src/tests/oracle/vpd.integration.test.ts`

**Step 1: Add failing integration test**

```ts
it('sets and clears portal_ctx_pkg per request', async () => {
	const app = await buildTestApp();
	const executeSpy = vi.fn().mockResolvedValue(undefined);
	mockOracleConnection(executeSpy);

	await app.inject({ method: 'GET', url: '/api/v1/tools', headers: { 'x-org-id': ORG_ID } });

	expect(executeSpy.mock.calls[0][0]).toContain('portal_ctx_pkg.set_org_id');
	expect(executeSpy.mock.calls.at(-1)?.[0]).toContain('portal_ctx_pkg.clear_context');
});
```

Run: `pnpm vitest run apps/api/src/tests/oracle/vpd.integration.test.ts` (expect FAIL).

**Step 2: Implement per-request hooks**

- Wrap Oracle connection acquisition so every request executes `portal_ctx_pkg.set_org_id` (or `set_admin_bypass`) before hitting services.
- Register Fastify `onResponse` hook to call `portal_ctx_pkg.clear_context` even if handler throws.
- Ensure global admins toggle bypass via `apps/api/src/plugins/auth.ts` RBAC helpers.

**Step 3: Run oracle suites**

`pnpm vitest run apps/api/src/tests/oracle/*.test.ts`

**Step 4: Commit**

```bash
git add apps/api/src/plugins/oracle.ts apps/api/src/plugins/auth.ts \
        apps/api/src/tests/oracle/vpd.integration.test.ts
git commit -m "feat(oracle): enforce vpd context per request"
```

---

### Task 4: Observability Dashboard Tests + Features (G-4)

**Files:**

- Modify: `apps/frontend/src/routes/admin/observability/+page.svelte`
- Modify: `packages/ui/src/index.ts`
- Create: `packages/ui/src/admin/ObservabilityCards.svelte`
- Create: `apps/frontend/src/tests/phase10/admin-observability.test.ts`

**Step 1: Write failing component tests**

```ts
import { render, screen } from '@testing-library/svelte';
import ObservabilityPage from '$routes/admin/observability/+page.svelte';

it('renders LayerChart workflow timeline and Grafana embeds when data present', async () => {
	render(ObservabilityPage, { data: mockMetrics() });
	expect(screen.getByText('Cost by Model')).toBeVisible();
	expect(screen.getByLabelText('Workflow Latency Timeline')).toBeVisible();
	expect(screen.getByTestId('grafana-panel')).toBeInTheDocument();
});
```

Run: `pnpm vitest run apps/frontend/src/tests/phase10/admin-observability.test.ts` (expect FAIL).

**Step 2: Implement UI upgrades**

- Extract cards, LayerChart wrapper, and Grafana iframe components into `@portal/ui` to reuse across admin pages.
- Replace placeholder cost card with OCI Usage API-backed graph (mock fetch inside `load` for tests).
- Integrate Tempo trace viewer embed and ensure accessible labels.

**Step 3: Re-run page tests**

`pnpm vitest run apps/frontend/src/tests/phase10/admin-observability.test.ts`

**Step 4: Commit**

```bash
git add apps/frontend/src/routes/admin/observability \
        packages/ui/src apps/frontend/src/tests/phase10
git commit -m "feat(admin): add tested observability dashboard"
```

---

### Task 5: Tool Playground Tests + Approval Flow (G-3)

**Files:**

- Modify: `apps/frontend/src/routes/admin/tools/playground/+page.svelte`
- Modify: `packages/ui/src/admin/ToolPlayground/*.svelte`
- Create: `apps/frontend/src/tests/phase10/admin-tools-playground.test.ts`

**Step 1: Author failing Tool Playground tests**

```ts
it('filters tools with Fuse search and renders schema-driven form', async () => {
	const { user } = renderToolPlayground();
	await user.type(screen.getByRole('searchbox'), 'compute');
	expect(screen.getByText('Compute Instance Agent')).toBeVisible();
});

it('shows approval preview modal and streams progress events', async () => {
	const { user } = renderToolPlayground({ mockSSE: true });
	await user.click(screen.getByText('Request Approval'));
	expect(screen.getByRole('dialog')).toBeVisible();
	expect(await screen.findByText('event: progress')).toBeInTheDocument();
});
```

Run: `pnpm vitest run apps/frontend/src/tests/phase10/admin-tools-playground.test.ts` (expect FAIL).

**Step 2: Implement approval + logging flow**

- Wire SSE progress feed into a Svelte store consumed by the new log panel component.
- Integrate approval preview data from Fastify route, reusing `@portal/ui` modal + trace/cost sidebar components.
- Add TanStack Query mutation for approvals and ensure Fuse search uses `@portal/shared` schema definitions.

**Step 3: Re-run tests + lint**

```bash
pnpm vitest run apps/frontend/src/tests/phase10/admin-tools-playground.test.ts
pnpm lint apps/frontend/src/routes/admin/tools/playground/+page.svelte
```

**Step 4: Commit**

```bash
git add apps/frontend/src/routes/admin/tools/playground \
        packages/ui/src/admin/ToolPlayground apps/frontend/src/tests/phase10
git commit -m "feat(admin): complete tool playground flow"
```

---

### Task 6: Workflow Monitor Tests + SSE First (G-2 subset)

**Files:**

- Modify: `apps/frontend/src/routes/admin/workflows/runs/+page.svelte`
- Modify: `packages/ui/src/admin/WorkflowTimeline/*.svelte`
- Create: `apps/frontend/src/tests/phase10/admin-workflow-monitor.test.ts`

**Step 1: Write failing Workflow Monitor tests**

```ts
it('connects to SSE immediately and renders guardrail/eval badges', async () => {
	const { emitted } = renderWorkflowRunsPage();
	expect(emitted('sse-connect')[0]).toEqual(['/api/v1/workflows/runs/stream']);
	expect(screen.getAllByLabelText('Guardrail')).toHaveLength(2);
});

it('surfaces cancel/resume actions and telemetry in LayerChart timeline', async () => {
	await user.click(screen.getByRole('button', { name: 'Cancel Run' }));
	expect(mockCancel).toHaveBeenCalled();
	expect(screen.getByTestId('layerchart-timeline')).toBeVisible();
});
```

Run: `pnpm vitest run apps/frontend/src/tests/phase10/admin-workflow-monitor.test.ts` (expect FAIL).

**Step 2: Implement SSE-first UX**

- Create dedicated SSE store that begins streaming during `load` and hydrate page via `@portal/ui` timeline components.
- Add guardrail/eval badge components with accessible labels and statuses.
- Wire cancel/resume actions to Fastify API and ensure telemetry card updates.

**Step 3: Re-run tests**

`pnpm vitest run apps/frontend/src/tests/phase10/admin-workflow-monitor.test.ts`

**Step 4: Commit**

```bash
git add apps/frontend/src/routes/admin/workflows/runs \
        packages/ui/src/admin/WorkflowTimeline apps/frontend/src/tests/phase10
git commit -m "feat(admin): add tested workflow monitor"
```

---

### Task 7: Agent Playground Tests + Tracing (G-1 subset)

**Files:**

- Modify: `apps/frontend/src/routes/admin/agents/+page.svelte`
- Modify: `packages/ui/src/admin/AgentPlayground/*.svelte`
- Create: `apps/frontend/src/tests/phase10/admin-agent-playground.test.ts`

**Step 1: Write failing Agent Playground tests**

```ts
it('renders trace spans and guardrail verdict chips per turn', async () => {
	renderAgentPlayground({ trace: mockTrace() });
	expect(screen.getAllByText('Guardrail: PASS').length).toBeGreaterThan(0);
});

it('aggregates per-turn cost summary and multi-session history', async () => {
	expect(screen.getByText('Total Tokens')).toBeVisible();
	expect(screen.getByRole('list', { name: 'Session history' })).toHaveTextContent('Session #2');
});
```

Run: `pnpm vitest run apps/frontend/src/tests/phase10/admin-agent-playground.test.ts` (expect FAIL).

**Step 2: Implement telemetry upgrades**

- Fetch trace/cost data from new Fastify endpoints and populate TanStack Query caches.
- Add verdict chip component + per-turn cost summary row to `@portal/ui` AgentPlayground.
- Persist multi-session history using IndexedDB (mock with Dexie stub in tests).

**Step 3: Re-run tests**

`pnpm vitest run apps/frontend/src/tests/phase10/admin-agent-playground.test.ts`

**Step 4: Commit**

```bash
git add apps/frontend/src/routes/admin/agents \
        packages/ui/src/admin/AgentPlayground apps/frontend/src/tests/phase10
git commit -m "feat(admin): enhance agent playground telemetry"
```

---

### Task 8: Schedule Plugin Cleanup Job

**Files:**

- Modify: `apps/api/src/plugins/schedule.ts`
- Create: `apps/api/src/tests/plugins/schedule.test.ts`

**Step 1: Write failing schedule specs**

```ts
it('deletes sessions older than TTL every hour', async () => {
	vi.useFakeTimers();
	const repo = buildSessionRepo({ stale: ['1', '2'], fresh: ['3'] });
	const plugin = await buildSchedulePlugin({ repo });
	vi.advanceTimersByTime(60 * 60 * 1000);
	expect(repo.deleteMany).toHaveBeenCalledWith(['1', '2']);
});

it('emits cleanup metric', async () => {
	expect(mockMetrics.increment).toHaveBeenCalledWith('schedule.sessions.cleaned', 2);
});
```

Run: `pnpm vitest run apps/api/src/tests/plugins/schedule.test.ts` (expect FAIL).

**Step 2: Implement cleanup job**

- Register hourly Fastify cron that queries session repository for expired rows, deletes them, and emits metrics/logs.
- Ensure job respects configuration TTL and is teardown-safe for tests.

**Step 3: Re-run tests**

`pnpm vitest run apps/api/src/tests/plugins/schedule.test.ts`

**Step 4: Commit**

```bash
git add apps/api/src/plugins/schedule.ts apps/api/src/tests/plugins/schedule.test.ts
git commit -m "feat(schedule): clean up stale sessions hourly"
```

---

### Task 9: Instance Agent SDK Tests

**Files:**

- Modify: `packages/shared/src/tools/categories/compute.ts`
- Create: `packages/shared/src/tools/categories/compute.test.ts`

**Step 1: Write failing compute SDK tests**

```ts
describe('Instance agent SDK adapter', () => {
	const sdk = buildMockInstanceAgent();

	it('delegates runInstanceCommand to SDK', async () => {
		await runInstanceCommand(sdk, { instanceId: 'ocid1', command: 'uname -a' });
		expect(sdk.runCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'uname -a' }));
	});

	it('wraps getCommandExecution + listInstancePlugins', async () => {
		await getCommandExecution(sdk, 'execId');
		await listInstancePlugins(sdk, 'ocid1');
		expect(sdk.getCommandExecution).toHaveBeenCalledWith('execId');
		expect(sdk.listInstancePlugins).toHaveBeenCalledWith('ocid1');
	});
});
```

Run: `pnpm vitest run packages/shared/src/tools/categories/compute.test.ts` (expect FAIL).

**Step 2: Implement SDK wiring**

- Replace CLI placeholders with Instance Agent SDK calls using dependency injection for easier tests.
- Remove TODOs and ensure parameters (compartmentId, availabilityDomain) map correctly.

**Step 3: Re-run compute tests**

`pnpm vitest run packages/shared/src/tools/categories/compute.test.ts`

**Step 4: Commit**

```bash
git add packages/shared/src/tools/categories/compute.ts \
        packages/shared/src/tools/categories/compute.test.ts
git commit -m "feat(oci): switch instance agent tools to sdk"
```

---

### Task 10: @portal/ui Smoke Tests + Design Iteration Artifacts

**Files:**

- Modify: `packages/ui/src/index.ts`
- Create: `packages/ui/src/admin/*.svelte`
- Create: `packages/ui/src/index.test.ts`
- Create: `apps/frontend/src/tests/phase10/admin-ui-smoke.test.ts`
- Update docs: `.claude/reference/PRD.md`, add screenshots under `docs/design/admin/*.md`

**Step 1: Write failing smoke tests**

```ts
// packages/ui/src/index.test.ts
it('exports admin Observability/Tool/Agent components', () => {
	const lib = await import('../index.js');
	expect(lib.ObservabilityCards).toBeDefined();
	expect(lib.ToolPlaygroundPanel).toBeDefined();
});

// apps/frontend/src/tests/phase10/admin-ui-smoke.test.ts
it('renders admin routes with shared components + screenshots metadata', async () => {
	jest.spyOn(fs, 'existsSync').mockReturnValue(true);
	const pages = await loadAdminPages();
	expect(pages.every((p) => p.hasScreenshot)).toBe(true);
});
```

Run: `pnpm vitest run packages/ui/src/index.test.ts apps/frontend/src/tests/phase10/admin-ui-smoke.test.ts` (expect FAIL).

**Step 2: Implement shared components + docs**

- Extract cards/charts/snackbar components into `packages/ui/src/admin` and export via `index.ts`.
- Capture updated screenshots/design notes under `docs/design/admin/*.md` and reference them inside `.claude/reference/PRD.md` checklist.
- Ensure vitest fs mocks look for screenshot metadata JSON.

**Step 3: Re-run smoke + doc tests**

```bash
pnpm vitest run packages/ui/src/index.test.ts apps/frontend/src/tests/phase10/admin-ui-smoke.test.ts
pnpm lint packages/ui/src
```

**Step 4: Commit**

```bash
git add packages/ui/src \
        apps/frontend/src/tests/phase10 \
        .claude/reference/PRD.md docs/design/admin
git commit -m "feat(ui): add shared admin components with iteration docs"
```

---

### Final Verification Task

**Step 1:** Run full repo quality gates

```bash
pnpm -r lint
pnpm -r test
pnpm -r build
pnpm knip
pnpm outdated
```

**Step 2:** Capture console output under a new `## Verification` appendix in this plan file (summaries + pass/fail per command).

**Step 3:** Commit the verification log

```bash
git add docs/plans/2026-02-17-phase10-test-suite.md
git commit -m "chore: document phase10 test coverage verification"
```

---
