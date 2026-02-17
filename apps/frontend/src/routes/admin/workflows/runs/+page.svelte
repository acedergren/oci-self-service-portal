<script lang="ts">
	import { createQuery, createMutation } from '@tanstack/svelte-query';
	import { browser } from '$app/environment';

	interface WorkflowRun {
		id: string;
		definitionId: string;
		status: string;
		startedAt: string | null;
		completedAt: string | null;
		createdAt: string | null;
	}

	interface WorkflowRunStep {
		nodeId: string;
		nodeType: string;
		status: string;
		inputs?: unknown;
		output?: unknown;
		error?: unknown;
		startedAt: string | null;
		completedAt: string | null;
		durationMs?: number | null;
	}

	interface WorkflowRunDetail {
		id: string;
		workflowId: string;
		status: string;
		input?: unknown;
		output?: unknown;
		error?: unknown;
		startedAt: string | null;
		completedAt: string | null;
		steps: WorkflowRunStep[];
	}

	interface RunsResponse {
		runs: WorkflowRun[];
		total: number;
	}

	let statusFilter = $state<string>('');
	let currentPage = $state(0);
	const pageSize = 20;
	let selectedRunId = $state<string | null>(null);
	let selectedDefinitionId = $state<string | null>(null);
	let detailOverride = $state<WorkflowRunDetail | null>(null);
	let sseConnected = $state(false);

	const runsQuery = createQuery<RunsResponse>(() => ({
		queryKey: ['admin', 'workflow-runs', statusFilter, currentPage],
		queryFn: async () => {
			const url = new URL('/api/v1/workflows/runs', window.location.origin);
			url.searchParams.set('limit', String(pageSize));
			url.searchParams.set('offset', String(currentPage * pageSize));
			if (statusFilter) url.searchParams.set('status', statusFilter);
			const res = await fetch(url.toString());
			if (!res.ok) throw new Error('Failed to fetch runs');
			return res.json();
		},
		enabled: browser,
		refetchInterval: 5_000
	}));

	const {
		data: runsData,
		isLoading: runsLoading,
		isFetching: runsFetching,
		refetch: refetchRuns
	} = runsQuery;

	const runDetailQuery = createQuery<WorkflowRunDetail | null>(() => ({
		queryKey: ['admin', 'workflow-run', selectedDefinitionId, selectedRunId],
		queryFn: async () => {
			if (!selectedDefinitionId || !selectedRunId) return null;
			const res = await fetch(`/api/v1/workflows/${selectedDefinitionId}/runs/${selectedRunId}`);
			if (!res.ok) throw new Error('Failed to fetch run detail');
			return res.json();
		},
		enabled: browser && Boolean(selectedDefinitionId && selectedRunId)
	}));

	const { data: runDetailData, refetch: refetchRunDetail } = runDetailQuery;

	const runs = $derived(runsData?.runs ?? []);
	const total = $derived(runsData?.total ?? 0);
	const totalPages = $derived(Math.ceil(total / pageSize));
	const selectedRun = $derived(runs.find((run: WorkflowRun) => run.id === selectedRunId) ?? null);
	const runDetail = $derived(detailOverride ?? runDetailData ?? null);

	const statusOptions = ['', 'pending', 'running', 'completed', 'failed', 'suspended', 'cancelled'];

	function statusColor(status: string): string {
		switch (status) {
			case 'completed':
				return 'var(--status-success, oklch(0.75 0.2 155))';
			case 'running':
				return 'var(--status-info, oklch(0.75 0.15 230))';
			case 'failed':
				return 'var(--status-error, oklch(0.75 0.2 30))';
			case 'suspended':
				return 'var(--status-warning, oklch(0.78 0.18 80))';
			case 'pending':
				return 'var(--fg-tertiary)';
			case 'cancelled':
				return 'var(--fg-tertiary)';
			default:
				return 'var(--fg-secondary)';
		}
	}

	function formatTime(iso: string | null): string {
		if (!iso) return '-';
		return new Date(iso).toLocaleString();
	}

	function formatDuration(start: string | null, end: string | null): string {
		if (!start) return '-';
		const s = new Date(start).getTime();
		const e = end ? new Date(end).getTime() : Date.now();
		const ms = e - s;
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
	}

	function formatStepDuration(step: WorkflowRunStep): string {
		if (step.durationMs != null) return `${(step.durationMs / 1000).toFixed(2)}s`;
		if (step.startedAt) return 'Running…';
		return '-';
	}

	function truncateId(id: string): string {
		return `${id.slice(0, 8)}…`;
	}

	function toggleRun(run: WorkflowRun) {
		if (selectedRunId === run.id) {
			selectedRunId = null;
			selectedDefinitionId = null;
			detailOverride = null;
			return;
		}
		selectedRunId = run.id;
		selectedDefinitionId = run.definitionId;
		detailOverride = null;
		refetchRunDetail();
	}

	const cancelRunMutation = createMutation<void, Error, { definitionId: string; runId: string }>(
		() => ({
			mutationFn: async ({ definitionId, runId }) => {
				const res = await fetch(`/api/v1/workflows/${definitionId}/runs/${runId}/cancel`, {
					method: 'POST'
				});
				if (!res.ok) {
					const err = await res.json().catch(() => ({}));
					throw new Error(err.error || 'Failed to cancel workflow run');
				}
			},
			onSuccess: () => {
				refetchRuns();
				refetchRunDetail();
				detailOverride = null;
			}
		})
	);

	const resumeRunMutation = createMutation<void, Error, { definitionId: string; runId: string }>(
		() => ({
			mutationFn: async ({ definitionId, runId }) => {
				const res = await fetch(`/api/v1/workflows/${definitionId}/runs/${runId}/approve`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ resumeData: {} })
				});
				if (!res.ok) {
					const err = await res.json().catch(() => ({}));
					throw new Error(err.error || 'Failed to resume workflow run');
				}
			},
			onSuccess: () => {
				refetchRuns();
				refetchRunDetail();
				detailOverride = null;
			}
		})
	);

	const { isPending: cancelRunPending } = cancelRunMutation;
	const { isPending: resumeRunPending } = resumeRunMutation;
	const cancelButtonLabel = $derived(cancelRunPending ? 'Cancelling…' : 'Cancel');
	const resumeButtonLabel = $derived(resumeRunPending ? 'Resuming…' : 'Resume');

	function cancelSelectedRun() {
		if (!selectedRunId || !selectedDefinitionId) return;
		cancelRunMutation.mutate({ definitionId: selectedDefinitionId, runId: selectedRunId });
	}

	function resumeSelectedRun() {
		if (!selectedRunId || !selectedDefinitionId) return;
		resumeRunMutation.mutate({ definitionId: selectedDefinitionId, runId: selectedRunId });
	}

	function formatJson(value: unknown): string {
		return JSON.stringify(value ?? {}, null, 2);
	}

	$effect(() => {
		if (!browser) return;
		const run = selectedRun;
		if (!run || run.status !== 'running') {
			sseConnected = false;
			return;
		}
		const source = new EventSource(`/api/v1/workflows/${run.definitionId}/runs/${run.id}/stream`);
		sseConnected = true;
		source.onmessage = (event) => {
			try {
				const payload = JSON.parse(event.data);
				const existingDetail = detailOverride ??
					runDetailData ?? {
						id: run.id,
						workflowId: run.definitionId,
						status: run.status,
						steps: [],
						startedAt: run.startedAt,
						completedAt: run.completedAt
					};

				if (payload.type === 'status') {
					detailOverride = {
						...existingDetail,
						status: payload.status ?? run.status,
						output: payload.output ?? existingDetail.output ?? null,
						error: payload.error ?? existingDetail.error ?? null
					};
					if (['completed', 'failed', 'suspended', 'cancelled'].includes(payload.status ?? '')) {
						source.close();
						sseConnected = false;
						refetchRuns();
						refetchRunDetail();
						detailOverride = null;
					}
				} else if (payload.type === 'step') {
					// Merge step update into existing steps array
					const existingSteps = existingDetail.steps ?? [];
					const stepIndex = existingSteps.findIndex(
						(s: WorkflowRunStep) => s.nodeId === payload.nodeId
					);
					const updatedStep: WorkflowRunStep = {
						nodeId: payload.nodeId,
						nodeType: payload.nodeType ?? 'unknown',
						status: payload.status ?? 'pending',
						inputs: payload.inputs,
						output: payload.output,
						error: payload.error,
						startedAt: payload.startedAt ?? null,
						completedAt: payload.completedAt ?? null,
						durationMs: payload.durationMs ?? null
					};

					const updatedSteps =
						stepIndex >= 0
							? existingSteps.map((s: WorkflowRunStep, i: number) =>
									i === stepIndex ? updatedStep : s
								)
							: [...existingSteps, updatedStep];

					detailOverride = {
						...existingDetail,
						steps: updatedSteps
					};
				}
			} catch (error) {
				console.error('Failed to parse workflow SSE event', error);
			}
		};
		source.onerror = () => {
			source.close();
			sseConnected = false;
		};
		return () => {
			source.close();
			sseConnected = false;
		};
	});
</script>

<svelte:head>
	<title>Workflow Monitor - Admin Console</title>
</svelte:head>

<div class="admin-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Workflow Monitor</h1>
			<p class="page-description">Track workflow execution runs across all workflows</p>
		</div>
		<div class="header-stats">
			<span class="stat-badge">{total} total runs</span>
		</div>
	</div>

	<div class="toolbar">
		<select class="filter-select" bind:value={statusFilter}>
			{#each statusOptions as opt (opt)}
				<option value={opt}>{opt || 'All Statuses'}</option>
			{/each}
		</select>
		{#if runsFetching}
			<span class="fetching-indicator">Refreshing...</span>
		{/if}
	</div>

	{#if runsLoading}
		<div class="loading-state">
			<div class="spinner"></div>
			<p>Loading workflow runs...</p>
		</div>
	{:else if runs.length === 0}
		<div class="empty-state">
			<div class="empty-icon">📊</div>
			<h2>No runs found</h2>
			<p>
				{statusFilter ? `No runs with status "${statusFilter}"` : 'No workflow runs recorded yet'}
			</p>
		</div>
	{:else}
		<div class="table-container">
			<table class="data-table">
				<thead>
					<tr>
						<th>Run ID</th>
						<th>Workflow</th>
						<th>Status</th>
						<th>Started</th>
						<th>Duration</th>
					</tr>
				</thead>
				<tbody>
					{#each runs as run (run.id)}
						<tr
							class="run-row"
							class:selected={selectedRunId === run.id}
							onclick={() => toggleRun(run)}
						>
							<td class="run-id">{run.id.slice(0, 8)}...</td>
							<td class="workflow-id">{run.definitionId.slice(0, 8)}...</td>
							<td>
								<span class="status-badge" style={`--status-color: ${statusColor(run.status)}`}>
									{run.status}
								</span>
							</td>
							<td class="time-cell">{formatTime(run.startedAt)}</td>
							<td class="duration-cell">{formatDuration(run.startedAt, run.completedAt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if totalPages > 1}
			<div class="pagination">
				<button
					type="button"
					class="page-btn"
					disabled={currentPage === 0}
					onclick={() => (currentPage = Math.max(0, currentPage - 1))}
				>
					Previous
				</button>
				<span class="page-info">
					Page {currentPage + 1} of {totalPages}
				</span>
				<button
					type="button"
					class="page-btn"
					disabled={currentPage >= totalPages - 1}
					onclick={() => (currentPage = Math.min(totalPages - 1, currentPage + 1))}
				>
					Next
				</button>
			</div>
		{/if}
	{/if}

	{#if selectedRun && runDetail}
		<div class="detail-panel">
			<div class="detail-header">
				<div>
					<h2>Run {truncateId(selectedRun.id)}</h2>
					<p class="detail-meta">
						Status:
						<span class="detail-status" style={`color: ${statusColor(runDetail.status)}`}>
							{runDetail.status}
						</span>
						• Started {formatTime(runDetail.startedAt)}
						• Updated {formatTime(runDetail.completedAt)}
						{#if sseConnected}
							<span class="live-pill">LIVE</span>
						{/if}
					</p>
				</div>
				<div class="detail-actions">
					{#if ['running', 'pending', 'suspended'].includes(runDetail.status)}
						<button
							type="button"
							class="btn-outline"
							onclick={cancelSelectedRun}
							disabled={cancelRunPending}
						>
							{cancelButtonLabel}
						</button>
					{/if}
					{#if runDetail.status === 'suspended'}
						<button
							type="button"
							class="btn-primary"
							onclick={resumeSelectedRun}
							disabled={resumeRunPending}
						>
							{resumeButtonLabel}
						</button>
					{/if}
				</div>
			</div>

			<div class="detail-body">
				<div class="detail-section">
					<h3>Input</h3>
					<pre>{formatJson(runDetail.input)}</pre>
				</div>
				<div class="detail-section">
					<h3>Output</h3>
					<pre>{formatJson(runDetail.output)}</pre>
				</div>
			</div>

			<div class="step-timeline">
				<h3>Steps</h3>
				{#if runDetail.steps.length === 0}
					<p class="empty-steps">No step data recorded yet.</p>
				{:else}
					<ol class="timeline-list">
						{#each runDetail.steps as step, i (step.nodeId)}
							<li class="timeline-item" data-status={step.status}>
								<div class="timeline-marker">
									<div
										class="timeline-dot"
										class:timeline-dot--pulsing={step.status === 'running'}
										style={`--marker-color: ${statusColor(step.status)}`}
									></div>
									{#if i < runDetail.steps.length - 1}
										<div class="timeline-connector"></div>
									{/if}
								</div>
								<div class="step-card" data-status={step.status}>
									<div class="step-heading">
										<div>
											<div class="step-title">{step.nodeId}</div>
											<div class="step-meta">{step.nodeType} • {formatStepDuration(step)}</div>
										</div>
										<span
											class="step-status-badge"
											style={`--status-color: ${statusColor(step.status)}`}
										>
											{step.status}
										</span>
									</div>
									<div class="step-times">
										<span>Started {formatTime(step.startedAt)}</span>
										<span>Completed {formatTime(step.completedAt)}</span>
									</div>
									{#if step.inputs}
										<details>
											<summary>Inputs</summary>
											<pre>{formatJson(step.inputs)}</pre>
										</details>
									{/if}
									{#if step.output}
										<details>
											<summary>Output</summary>
											<pre>{formatJson(step.output)}</pre>
										</details>
									{/if}
									{#if step.error}
										<details open>
											<summary>Error</summary>
											<pre>{formatJson(step.error)}</pre>
										</details>
									{/if}
								</div>
							</li>
						{/each}
					</ol>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.admin-page {
		max-width: 1400px;
		height: calc(100dvh - var(--space-xxl) * 2);
		display: flex;
		flex-direction: column;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: start;
		margin-bottom: var(--space-xl);
	}

	.page-title {
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
	}

	.page-description {
		font-size: var(--text-base);
		color: var(--fg-secondary);
	}

	.stat-badge {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-secondary);
		background: var(--bg-secondary);
		padding: var(--space-sm) var(--space-md);
		border-radius: var(--radius-md);
	}

	.toolbar {
		display: flex;
		gap: var(--space-md);
		align-items: center;
		margin-bottom: var(--space-lg);
	}

	.filter-select {
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.filter-select:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	.fetching-indicator {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	.table-container {
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		overflow: hidden;
		margin-bottom: var(--space-lg);
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
	}

	.data-table th {
		text-align: left;
		padding: var(--space-md) var(--space-lg);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--fg-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid var(--border-default);
		background: var(--bg-tertiary);
	}

	.data-table td {
		padding: var(--space-md) var(--space-lg);
		font-size: var(--text-sm);
		color: var(--fg-primary);
		border-bottom: 1px solid var(--border-muted);
	}

	.run-row {
		cursor: pointer;
		transition: background var(--transition-fast);
	}

	.run-row:hover {
		background: var(--bg-elevated);
	}

	.run-row.selected {
		background: var(--bg-tertiary);
		border-left: 3px solid var(--accent-primary);
	}

	.run-id,
	.workflow-id {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs);
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-xs);
		padding: 2px var(--space-sm);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--status-color, var(--fg-secondary));
		background: color-mix(in oklch, var(--status-color, var(--fg-secondary)) 15%, transparent);
	}

	.time-cell {
		font-size: var(--text-xs);
		color: var(--fg-secondary);
	}

	.duration-cell {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs);
	}

	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-lg);
	}

	.page-btn {
		padding: var(--space-sm) var(--space-lg);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.page-btn:hover:not(:disabled) {
		background: var(--bg-elevated);
		border-color: var(--accent-primary);
	}

	.page-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.page-info {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
	}

	.loading-state,
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-xxl);
		text-align: center;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 4px solid var(--border-muted);
		border-top-color: var(--accent-primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-bottom: var(--space-md);
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: var(--space-md);
	}

	.empty-state h2 {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: var(--space-sm);
	}

	.detail-panel {
		margin-top: var(--space-xl);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: var(--space-lg);
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
	}

	.detail-header {
		display: flex;
		justify-content: space-between;
		gap: var(--space-lg);
		flex-wrap: wrap;
	}

	.detail-header h2 {
		margin: 0;
		font-size: var(--text-lg);
		color: var(--fg-primary);
	}

	.detail-meta {
		margin: 0;
		color: var(--fg-secondary);
		font-size: var(--text-sm);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-sm);
	}

	.detail-status {
		font-weight: 600;
	}

	.live-pill {
		padding: 0 var(--space-sm);
		background: var(--accent-primary);
		color: var(--bg-primary);
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.detail-actions {
		display: flex;
		gap: var(--space-sm);
		align-items: center;
	}

	.btn-outline {
		border: 1px solid var(--border-default);
		background: var(--bg-secondary);
		color: var(--fg-primary);
		padding: var(--space-sm) var(--space-md);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-primary {
		background: var(--accent-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-md);
		padding: var(--space-sm) var(--space-md);
		font-weight: 600;
		cursor: pointer;
	}

	.btn-outline:disabled,
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.detail-body {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: var(--space-lg);
	}

	.detail-section pre {
		background: var(--bg-tertiary);
		padding: var(--space-md);
		border-radius: var(--radius-md);
		max-height: 220px;
		overflow: auto;
	}

	.step-timeline {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.timeline-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.timeline-item {
		display: flex;
		gap: var(--space-md);
		align-items: flex-start;
	}

	.timeline-marker {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 20px;
		flex-shrink: 0;
		padding-top: var(--space-md);
	}

	.timeline-dot {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--marker-color, var(--fg-tertiary));
		border: 2px solid var(--bg-secondary);
		box-shadow: 0 0 0 2px var(--marker-color, var(--fg-tertiary));
		position: relative;
		z-index: 1;
		flex-shrink: 0;
	}

	.timeline-dot--pulsing {
		animation: dot-pulse 1.5s ease-in-out infinite;
	}

	@keyframes dot-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 2px var(--marker-color, var(--fg-tertiary));
		}
		50% {
			box-shadow: 0 0 0 5px
				color-mix(in oklch, var(--marker-color, var(--fg-tertiary)) 30%, transparent);
		}
	}

	.timeline-connector {
		width: 2px;
		flex: 1;
		min-height: var(--space-lg);
		background: var(--border-muted);
	}

	.step-card {
		border: 1px solid var(--border-default);
		border-left: 4px solid var(--fg-tertiary);
		border-radius: var(--radius-md);
		padding: var(--space-md);
		background: var(--bg-tertiary);
		flex: 1;
		margin-bottom: var(--space-md);
	}

	.step-card[data-status='completed'] {
		border-left-color: var(--status-success, oklch(0.75 0.2 155));
	}

	.step-card[data-status='running'] {
		border-left-color: var(--status-info, oklch(0.75 0.15 230));
	}

	.step-card[data-status='failed'] {
		border-left-color: var(--status-error, oklch(0.75 0.2 30));
	}

	.step-card[data-status='suspended'] {
		border-left-color: var(--status-warning, oklch(0.78 0.18 80));
	}

	.step-heading {
		display: flex;
		justify-content: space-between;
		gap: var(--space-md);
		align-items: flex-start;
	}

	.step-title {
		font-weight: 600;
		color: var(--fg-primary);
	}

	.step-meta {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
	}

	.step-status-badge {
		display: inline-flex;
		align-items: center;
		padding: 2px var(--space-sm);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--status-color, var(--fg-secondary));
		background: color-mix(in oklch, var(--status-color, var(--fg-secondary)) 15%, transparent);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
	}

	.step-times {
		font-size: var(--text-xs);
		color: var(--fg-secondary);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-sm);
		margin: var(--space-sm) 0;
	}

	.step-card details {
		margin-top: var(--space-sm);
	}

	.step-card details summary {
		cursor: pointer;
		font-size: var(--text-xs);
		color: var(--fg-secondary);
		font-weight: 600;
		user-select: none;
		padding: var(--space-xs) 0;
	}

	.step-card details summary:hover {
		color: var(--fg-primary);
	}

	.step-card details pre {
		background: var(--bg-elevated);
		padding: var(--space-sm);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		max-height: 160px;
		overflow: auto;
		margin-top: var(--space-xs);
	}

	.empty-steps {
		color: var(--fg-tertiary);
		font-style: italic;
	}

	@media (max-width: 1024px) {
		.page-header {
			flex-direction: column;
			gap: var(--space-sm);
		}
	}
</style>
