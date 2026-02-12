<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { browser } from '$app/environment';

	interface MetricsSummary {
		timestamp: string;
		chat: { totalRequests: number; byModel: Record<string, number> };
		tools: {
			totalExecutions: number;
			byTool: Record<string, number>;
			byStatus: Record<string, number>;
		};
		sessions: { active: number };
		approvals: { pending: number };
		database: { poolActive: number; poolIdle: number };
		auth: { totalLogins: number; byStatus: Record<string, number> };
		raw: Array<{ name: string; help: string; type: string; valueCount: number }>;
	}

	interface HealthStatus {
		status: string;
		uptime: number;
		checks?: Record<string, { status: string; message?: string }>;
	}

	const metricsQuery = createQuery<MetricsSummary>(() => ({
		queryKey: ['admin', 'metrics', 'summary'],
		queryFn: async () => {
			const res = await fetch('/api/admin/metrics/summary');
			if (!res.ok) throw new Error('Failed to fetch metrics');
			return res.json();
		},
		enabled: browser,
		refetchInterval: 15_000
	}));

	const healthQuery = createQuery<HealthStatus>(() => ({
		queryKey: ['health'],
		queryFn: async () => {
			const res = await fetch('/api/health');
			if (!res.ok) throw new Error('Failed to fetch health');
			return res.json();
		},
		enabled: browser,
		refetchInterval: 30_000
	}));

	const metrics = $derived($metricsQuery.data);
	const health = $derived($healthQuery.data);

	function formatUptime(seconds: number): string {
		const days = Math.floor(seconds / 86400);
		const hours = Math.floor((seconds % 86400) / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		if (days > 0) return `${days}d ${hours}h ${mins}m`;
		if (hours > 0) return `${hours}h ${mins}m`;
		return `${mins}m`;
	}

	function topEntries(record: Record<string, number> | undefined, limit = 10): [string, number][] {
		if (!record) return [];
		return Object.entries(record)
			.sort(([, a], [, b]) => b - a)
			.slice(0, limit);
	}

	function errorRate(byStatus: Record<string, number> | undefined): string {
		if (!byStatus) return '0%';
		const total = Object.values(byStatus).reduce((s, v) => s + v, 0);
		if (total === 0) return '0%';
		const errors = (byStatus['error'] ?? 0) + (byStatus['timeout'] ?? 0);
		return ((errors / total) * 100).toFixed(1) + '%';
	}
</script>

<svelte:head>
	<title>Observability - Admin Console</title>
</svelte:head>

<div class="admin-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Observability Dashboard</h1>
			<p class="page-description">System health, metrics, and performance overview</p>
		</div>
		{#if metrics}
			<div class="last-updated">
				Updated {new Date(metrics.timestamp).toLocaleTimeString()}
			</div>
		{/if}
	</div>

	{#if $metricsQuery.isLoading && $healthQuery.isLoading}
		<div class="loading-state">
			<div class="spinner"></div>
			<p>Loading metrics...</p>
		</div>
	{:else if metricsQuery.isError || healthQuery.isError}
		<div class="error-state">
			<h2>Unable to load observability data</h2>
			<p>
				{#if metricsQuery.isError}
					Metrics: {(metricsQuery.error as Error | null)?.message ?? 'Unknown error'}
				{/if}
				{#if metricsQuery.isError && healthQuery.isError}
					<br />
				{/if}
				{#if healthQuery.isError}
					Health: {(healthQuery.error as Error | null)?.message ?? 'Unknown error'}
				{/if}
			</p>
			<button
				class="btn-secondary"
				onclick={() => {
					metricsQuery.refetch();
					healthQuery.refetch();
				}}>Retry</button
			>
		</div>
	{:else}
		<!-- Health Status Banner -->
		{#if health}
			<div
				class="health-banner"
				class:healthy={health.status === 'ok'}
				class:degraded={health.status !== 'ok'}
			>
				<span class="health-dot"></span>
				<span class="health-label">
					{health.status === 'ok' ? 'All Systems Operational' : 'Degraded'}
				</span>
				<span class="health-uptime">Uptime: {formatUptime(health.uptime)}</span>
			</div>
		{/if}

		<!-- Summary Cards -->
		<div class="metrics-grid">
			<div class="metric-card">
				<div class="metric-label">Chat Requests</div>
				<div class="metric-value">{metrics?.chat.totalRequests ?? 0}</div>
				<div class="metric-detail">
					{#each topEntries(metrics?.chat.byModel, 3) as [model, count]}
						<span class="metric-tag">{model}: {count}</span>
					{/each}
				</div>
			</div>

			<div class="metric-card">
				<div class="metric-label">Tool Executions</div>
				<div class="metric-value">{metrics?.tools.totalExecutions ?? 0}</div>
				<div class="metric-detail">
					<span class="metric-tag error-rate">Error rate: {errorRate(metrics?.tools.byStatus)}</span
					>
				</div>
			</div>

			<div class="metric-card">
				<div class="metric-label">Active Sessions</div>
				<div class="metric-value">{metrics?.sessions.active ?? 0}</div>
			</div>

			<div class="metric-card">
				<div class="metric-label">Pending Approvals</div>
				<div class="metric-value">{metrics?.approvals.pending ?? 0}</div>
			</div>

			<div class="metric-card">
				<div class="metric-label">DB Pool Active</div>
				<div class="metric-value">{metrics?.database.poolActive ?? 0}</div>
				<div class="metric-detail">
					<span class="metric-tag">Idle: {metrics?.database.poolIdle ?? 0}</span>
				</div>
			</div>

			<div class="metric-card">
				<div class="metric-label">Auth Logins</div>
				<div class="metric-value">{metrics?.auth.totalLogins ?? 0}</div>
				<div class="metric-detail">
					{#each topEntries(metrics?.auth.byStatus) as [status, count]}
						<span class="metric-tag">{status}: {count}</span>
					{/each}
				</div>
			</div>
		</div>

		<!-- Tool Performance Table -->
		{#if metrics && Object.keys(metrics.tools.byTool).length > 0}
			<section class="section">
				<h2 class="section-title">Tool Performance</h2>
				<div class="table-container">
					<table class="data-table">
						<thead>
							<tr>
								<th>Tool Name</th>
								<th>Executions</th>
								<th>Share</th>
							</tr>
						</thead>
						<tbody>
							{#each topEntries(metrics.tools.byTool) as [tool, count]}
								<tr>
									<td class="tool-name">{tool}</td>
									<td>{count.toLocaleString()}</td>
									<td>
										<div class="bar-container">
											<div
												class="bar-fill"
												style="width: {metrics.tools.totalExecutions > 0
													? (count / metrics.tools.totalExecutions) * 100
													: 0}%"
											></div>
											<span class="bar-label"
												>{(metrics.tools.totalExecutions > 0
													? (count / metrics.tools.totalExecutions) * 100
													: 0
												).toFixed(1)}%</span
											>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		<!-- Raw Metrics -->
		{#if metrics && metrics.raw.length > 0}
			<section class="section">
				<h2 class="section-title">Registered Metrics ({metrics.raw.length})</h2>
				<div class="raw-metrics">
					{#each metrics.raw as metric}
						<div class="raw-metric">
							<span class="raw-name">{metric.name}</span>
							<span class="raw-type">{metric.type}</span>
							<span class="raw-help">{metric.help}</span>
						</div>
					{/each}
				</div>
			</section>
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

	.error-state {
		background: var(--surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: var(--space-xl);
	}

	.error-state h2 {
		margin: 0 0 var(--space-sm) 0;
		font-size: var(--text-lg);
		color: var(--fg-primary);
	}

	.error-state p {
		margin: 0 0 var(--space-lg) 0;
		color: var(--fg-secondary);
		line-height: 1.5;
	}

	.last-updated {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-secondary);
		border-radius: var(--radius-md);
	}

	/* Health Banner */
	.health-banner {
		display: flex;
		align-items: center;
		gap: var(--space-md);
		padding: var(--space-md) var(--space-lg);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-xl);
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.health-banner.healthy {
		background: oklch(0.35 0.08 155);
		color: oklch(0.85 0.15 155);
	}

	.health-banner.degraded {
		background: oklch(0.35 0.12 30);
		color: oklch(0.85 0.15 30);
	}

	.health-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.healthy .health-dot {
		background: oklch(0.75 0.2 155);
		box-shadow: 0 0 8px oklch(0.75 0.2 155);
	}

	.degraded .health-dot {
		background: oklch(0.75 0.2 30);
		box-shadow: 0 0 8px oklch(0.75 0.2 30);
	}

	.health-uptime {
		margin-left: auto;
		font-weight: 400;
		opacity: 0.8;
	}

	/* Metrics Grid */
	.metrics-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: var(--space-lg);
		margin-bottom: var(--space-xxl);
	}

	.metric-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: var(--space-lg);
		transition: border-color var(--transition-fast);
	}

	.metric-card:hover {
		border-color: var(--accent-primary);
	}

	.metric-label {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--fg-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: var(--space-sm);
	}

	.metric-value {
		font-size: var(--text-3xl);
		font-weight: 700;
		color: var(--fg-primary);
		line-height: 1;
		margin-bottom: var(--space-sm);
	}

	.metric-detail {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
	}

	.metric-tag {
		font-size: var(--text-xs);
		color: var(--fg-secondary);
		background: var(--bg-elevated);
		padding: 2px var(--space-sm);
		border-radius: var(--radius-sm);
	}

	.metric-tag.error-rate {
		color: oklch(0.8 0.15 30);
	}

	/* Sections */
	.section {
		margin-bottom: var(--space-xxl);
	}

	.section-title {
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: var(--space-lg);
	}

	/* Table */
	.table-container {
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		overflow: hidden;
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

	.data-table tr:last-child td {
		border-bottom: none;
	}

	.tool-name {
		font-family: var(--font-mono, monospace);
		font-weight: 600;
	}

	.bar-container {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
	}

	.bar-fill {
		height: 6px;
		background: var(--accent-primary);
		border-radius: 3px;
		min-width: 2px;
		flex: 1;
		max-width: 120px;
	}

	.bar-label {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		min-width: 40px;
	}

	/* Raw Metrics */
	.raw-metrics {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}

	.raw-metric {
		display: grid;
		grid-template-columns: 1fr auto 2fr;
		gap: var(--space-md);
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-secondary);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		align-items: center;
	}

	.raw-name {
		font-family: var(--font-mono, monospace);
		font-weight: 600;
		color: var(--accent-primary);
	}

	.raw-type {
		font-size: var(--text-xs);
		padding: 2px var(--space-sm);
		background: var(--bg-elevated);
		border-radius: var(--radius-sm);
		color: var(--fg-secondary);
	}

	.raw-help {
		color: var(--fg-tertiary);
		font-size: var(--text-xs);
	}

	/* Loading */
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-xxl);
		text-align: center;
		color: var(--fg-secondary);
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

	@media (max-width: 768px) {
		.metrics-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.raw-metric {
			grid-template-columns: 1fr;
		}
	}
</style>
