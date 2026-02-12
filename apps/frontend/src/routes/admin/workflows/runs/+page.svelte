<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { browser } from '$app/environment';

	interface WorkflowRun {
		id: string;
		definitionId: string;
		status: string;
		startedAt: string | null;
		completedAt: string | null;
		createdAt: string | null;
	}

	interface RunsResponse {
		runs: WorkflowRun[];
		total: number;
	}

	// State
	let statusFilter = $state<string>('');
	let currentPage = $state(0);
	const pageSize = 20;
	let selectedRunId = $state<string | null>(null);

	const runsQuery = createQuery<RunsResponse>(() => ({
		queryKey: ['admin', 'workflow-runs', statusFilter, currentPage],
		queryFn: async () => {
			const params = new URLSearchParams({
				limit: String(pageSize),
				offset: String(currentPage * pageSize)
			});
			if (statusFilter) params.set('status', statusFilter);
			const res = await fetch(`/api/v1/workflows/runs?${params}`);
			if (!res.ok) throw new Error('Failed to fetch runs');
			return res.json();
		},
		enabled: browser,
		refetchInterval: 5_000
	}));

	const runs = $derived($runsQuery.data?.runs ?? []);
	const total = $derived($runsQuery.data?.total ?? 0);
	const totalPages = $derived(Math.ceil(total / pageSize));

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

	function duration(start: string | null, end: string | null): string {
		if (!start) return '-';
		const s = new Date(start).getTime();
		const e = end ? new Date(end).getTime() : Date.now();
		const ms = e - s;
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
	}
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

	<!-- Toolbar -->
	<div class="toolbar">
		<select class="filter-select" bind:value={statusFilter}>
			{#each statusOptions as opt}
				<option value={opt}>{opt || 'All Statuses'}</option>
			{/each}
		</select>
		{#if $runsQuery.isFetching}
			<span class="fetching-indicator">Refreshing...</span>
		{/if}
	</div>

	<!-- Runs Table -->
	{#if $runsQuery.isLoading}
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
							onclick={() => (selectedRunId = selectedRunId === run.id ? null : run.id)}
						>
							<td class="run-id">{run.id.slice(0, 8)}...</td>
							<td class="workflow-id">{run.definitionId.slice(0, 8)}...</td>
							<td>
								<span class="status-badge" style="--status-color: {statusColor(run.status)}">
									{run.status}
								</span>
							</td>
							<td class="time-cell">{formatTime(run.startedAt)}</td>
							<td class="duration-cell">{duration(run.startedAt, run.completedAt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Pagination -->
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
</div>

<style>
	.admin-page {
		max-width: 1400px;
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

	/* Toolbar */
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

	/* Table */
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
		color: var(--status-color);
		background: color-mix(in oklch, var(--status-color) 15%, transparent);
	}

	.time-cell {
		font-size: var(--text-xs);
		color: var(--fg-secondary);
	}

	.duration-cell {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs);
	}

	/* Pagination */
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

	/* Loading & Empty */
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

	.empty-state p {
		color: var(--fg-secondary);
	}
</style>
