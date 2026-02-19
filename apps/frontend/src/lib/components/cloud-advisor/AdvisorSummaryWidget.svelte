<script lang="ts">
	interface Summary {
		findings: {
			critical: number;
			high: number;
			medium: number;
			low: number;
			total: number;
		};
		estimatedMonthlySavings?: number;
		lastRunAt?: string | null;
	}

	type State = 'loading' | 'error' | 'empty' | 'populated';

	let summary: Summary | null = $state(null);
	let widgetState: State = $state('loading');
	let analysisRunning = $state(false);

	$effect(() => {
		fetchSummary();
	});

	async function fetchSummary() {
		widgetState = 'loading';
		summary = null;
		try {
			const res = await fetch('/api/cloud-advisor/summary');
			if (!res.ok) throw new Error('Failed to load');
			const data: Summary = await res.json();
			summary = data;
			const total = data.findings?.total ?? 0;
			widgetState = total === 0 ? 'empty' : 'populated';
		} catch {
			widgetState = 'error';
		}
	}

	async function runAnalysis() {
		if (analysisRunning) return;
		analysisRunning = true;
		try {
			const res = await fetch('/api/cloud-advisor/analyse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domain: 'all' })
			});
			if (!res.ok) throw new Error('Analysis failed');
			await fetchSummary();
		} catch {
			// Silently fail — user can retry manually
		} finally {
			analysisRunning = false;
		}
	}

	function relativeTime(iso: string | null | undefined): string {
		if (!iso) return 'Never';
		const diff = Date.now() - new Date(iso).getTime();
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
		const days = Math.floor(hours / 24);
		return `${days} day${days === 1 ? '' : 's'} ago`;
	}

	function formatSavings(amount: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			maximumFractionDigits: 0
		}).format(amount);
	}

	const severities = [
		{ key: 'critical' as const, label: 'Critical', color: 'var(--semantic-error)' },
		{ key: 'high' as const, label: 'High', color: 'var(--semantic-warning)' },
		{ key: 'medium' as const, label: 'Medium', color: 'var(--semantic-info)' },
		{ key: 'low' as const, label: 'Low', color: 'var(--fg-tertiary)' }
	];
</script>

<div class="widget glass-advisor" aria-label="CloudAdvisor summary">
	<div class="widget-header">
		<div class="widget-title-row">
			<div class="advisor-icon" aria-hidden="true">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<rect
						x="2"
						y="4"
						width="20"
						height="16"
						rx="3"
						stroke="var(--advisor-accent)"
						stroke-width="1.5"
					/>
					<circle cx="12" cy="12" r="3.5" stroke="var(--advisor-accent)" stroke-width="1.5" />
					<circle cx="12" cy="12" r="1" fill="var(--advisor-accent)" />
					<path
						d="M2 12h3M19 12h3"
						stroke="var(--advisor-accent)"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
				</svg>
			</div>
			<span class="widget-title">CloudAdvisor</span>
		</div>

		<button
			class="run-btn"
			onclick={runAnalysis}
			disabled={analysisRunning || widgetState === 'loading'}
			aria-label="Run analysis"
		>
			{#if analysisRunning}
				<span class="spinner" aria-hidden="true"></span>
				Running…
			{:else}
				Run Analysis
			{/if}
		</button>
	</div>

	{#if widgetState === 'loading'}
		<div class="state-body">
			<div class="skeleton-row"></div>
			<div class="skeleton-row short"></div>
			<div class="skeleton-counts">
				{#each { length: 4 } as _, i (i)}
					<div class="skeleton-badge"></div>
				{/each}
			</div>
		</div>
	{:else if widgetState === 'error'}
		<div class="state-body centered">
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="var(--semantic-error)"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="10" />
				<line x1="12" y1="8" x2="12" y2="12" />
				<line x1="12" y1="16" x2="12.01" y2="16" />
			</svg>
			<p class="state-text">Unable to connect to CloudAdvisor.</p>
			<button class="retry-btn" onclick={fetchSummary}>Retry</button>
		</div>
	{:else if widgetState === 'empty'}
		<div class="state-body centered">
			<p class="state-text">
				No findings yet. CloudAdvisor will analyse your cloud environment on schedule, or you can
				trigger an analysis now.
			</p>
		</div>
	{:else if widgetState === 'populated' && summary}
		<div class="findings-counts">
			{#each severities as { key, label, color } (key)}
				{@const count = summary.findings[key]}
				{#if count > 0}
					<div class="severity-chip">
						<span class="sev-dot" style="background: {color};" aria-hidden="true"></span>
						<span class="sev-count" style="color: {color};">{count}</span>
						<span class="sev-label">{label}</span>
					</div>
				{/if}
			{/each}
		</div>

		<div class="widget-meta">
			{#if summary.estimatedMonthlySavings != null && summary.estimatedMonthlySavings > 0}
				<div class="meta-row">
					<span class="meta-label">Est. monthly savings</span>
					<span class="meta-value savings">{formatSavings(summary.estimatedMonthlySavings)}</span>
				</div>
			{/if}
			<div class="meta-row">
				<span class="meta-label">Last run</span>
				<span class="meta-value">{relativeTime(summary.lastRunAt)}</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.widget {
		border-radius: var(--radius-lg);
		padding: var(--space-md);
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.widget-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
	}

	.widget-title-row {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
	}

	.advisor-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: color-mix(in srgb, var(--advisor-accent) 15%, var(--bg-secondary));
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--advisor-accent) 30%, transparent);
		flex-shrink: 0;
	}

	.widget-title {
		font-size: var(--text-sm);
		font-weight: 700;
		color: var(--fg-primary);
		letter-spacing: -0.01em;
	}

	.run-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-xs);
		padding: var(--space-xs) var(--space-md);
		background: var(--accent-primary);
		color: #ffffff;
		border: none;
		border-radius: var(--radius-md);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
		white-space: nowrap;
	}

	.run-btn:hover:not(:disabled) {
		background: var(--accent-secondary);
	}

	.run-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.state-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		padding: var(--space-sm) 0;
	}

	.state-body.centered {
		align-items: center;
		text-align: center;
		padding: var(--space-sm) var(--space-xs);
	}

	.state-text {
		font-size: var(--text-sm);
		color: var(--fg-tertiary);
		margin: 0;
		line-height: 1.5;
	}

	.retry-btn {
		background: none;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--fg-secondary);
		font-size: var(--text-xs);
		padding: var(--space-xs) var(--space-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
		margin-top: var(--space-xs);
	}

	.retry-btn:hover {
		background: var(--bg-hover);
		color: var(--fg-primary);
	}

	/* Skeleton loading */
	.skeleton-row {
		height: 12px;
		background: var(--bg-elevated);
		border-radius: var(--radius-sm);
		animation: shimmer 1.5s ease-in-out infinite;
	}

	.skeleton-row.short {
		width: 60%;
	}

	.skeleton-counts {
		display: flex;
		gap: var(--space-sm);
		margin-top: var(--space-xs);
	}

	.skeleton-badge {
		height: 24px;
		width: 64px;
		background: var(--bg-elevated);
		border-radius: var(--radius-full);
		animation: shimmer 1.5s ease-in-out infinite;
	}

	@keyframes shimmer {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	/* Findings counts */
	.findings-counts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-sm);
	}

	.severity-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-xs);
		padding: var(--space-xs) var(--space-sm);
		background: var(--bg-tertiary);
		border: 1px solid var(--border-muted);
		border-radius: var(--radius-full);
	}

	.sev-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.sev-count {
		font-size: var(--text-xs);
		font-weight: 700;
	}

	.sev-label {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
	}

	/* Meta info */
	.widget-meta {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		padding-top: var(--space-sm);
		border-top: 1px solid var(--border-muted);
	}

	.meta-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
	}

	.meta-label {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
	}

	.meta-value {
		font-size: var(--text-xs);
		color: var(--fg-secondary);
		font-weight: 500;
	}

	.meta-value.savings {
		color: var(--semantic-success);
		font-weight: 700;
	}

	.spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid rgba(255, 255, 255, 0.4);
		border-top-color: #ffffff;
		border-radius: var(--radius-full);
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
