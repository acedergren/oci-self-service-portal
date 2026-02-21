<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { browser } from '$app/environment';
	import { createChatContext } from '$lib/components/chat/ai-context.svelte.js';
	import { ChatOverlay } from '$lib/components/portal/index.js';
	import AdvisorSummaryWidget from '$lib/components/cloud-advisor/AdvisorSummaryWidget.svelte';
	import FindingCard from '$lib/components/cloud-advisor/FindingCard.svelte';
	import { Spinner } from '$lib/components/ui/index.js';

	interface Finding {
		id: string;
		title: string;
		severity: 'critical' | 'high' | 'medium' | 'low';
		summary: string;
		impact?: string;
		domain?: string;
		charlieAction?: { prompt: string; label?: string };
	}

	const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;

	let activeFilter = $state<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');

	// ── Chat overlay state ───────────────────────────────────────────────
	const ctx = createChatContext();
	const { chat } = ctx;
	let showChat = $state(false);
	let chatInitialMessage = $state<string | undefined>(undefined);

	function handleCharlieAction(prompt: string) {
		chatInitialMessage = prompt;
		showChat = true;
	}

	const findingsQuery = createQuery<Finding[]>(() => ({
		queryKey: ['cloud-advisor', 'findings'],
		queryFn: async () => {
			const res = await fetch('/api/cloud-advisor/findings');
			if (!res.ok) throw new Error('Failed to fetch findings');
			const data = await res.json();
			return data.findings ?? data;
		},
		enabled: browser
	}));

	const findings = $derived(findingsQuery.data ?? []);

	const filteredFindings = $derived(
		(activeFilter === 'all' ? findings : findings.filter((f) => f.severity === activeFilter))
			.slice()
			.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
	);

	const severityCounts = $derived({
		critical: findings.filter((f) => f.severity === 'critical').length,
		high: findings.filter((f) => f.severity === 'high').length,
		medium: findings.filter((f) => f.severity === 'medium').length,
		low: findings.filter((f) => f.severity === 'low').length
	});

	const filters = [
		{ key: 'all' as const, label: 'All' },
		{ key: 'critical' as const, label: 'Critical', color: 'var(--semantic-error)' },
		{ key: 'high' as const, label: 'High', color: 'var(--semantic-warning)' },
		{ key: 'medium' as const, label: 'Medium', color: 'var(--semantic-info)' },
		{ key: 'low' as const, label: 'Low', color: 'var(--fg-tertiary)' }
	];

	async function handleDismiss(id: string) {
		try {
			const res = await fetch(`/api/cloud-advisor/findings/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'dismissed' })
			});
			if (!res.ok) throw new Error('Failed to dismiss finding');
			findingsQuery.refetch();
		} catch {
			// Silently fail — finding stays in list, user can retry
		}
	}
</script>

<svelte:head>
	<title>CloudAdvisor - CloudNow</title>
</svelte:head>

<div class="advisor-page">
	<header class="page-header">
		<div>
			<h1 class="page-title">CloudAdvisor</h1>
			<p class="page-subtitle">
				Review findings and optimisation recommendations for your cloud environment
			</p>
		</div>
	</header>

	<div class="advisor-layout">
		<div class="summary-section">
			<AdvisorSummaryWidget />
		</div>

		<div class="findings-section">
			<div class="filter-bar">
				{#each filters as filter (filter.key)}
					{@const count = filter.key === 'all' ? findings.length : severityCounts[filter.key]}
					<button
						class="filter-tab"
						class:active={activeFilter === filter.key}
						onclick={() => (activeFilter = filter.key)}
					>
						{#if filter.color}
							<span class="filter-dot" style="background: {filter.color};" aria-hidden="true"
							></span>
						{/if}
						{filter.label}
						{#if count > 0}
							<span class="filter-count">{count}</span>
						{/if}
					</button>
				{/each}
			</div>

			{#if findingsQuery.isPending}
				<div class="loading-state">
					<Spinner variant="dots" />
					<p class="text-tertiary">Loading findings...</p>
				</div>
			{:else if findingsQuery.isError}
				<div class="error-state glass">
					<p class="text-error">Failed to load findings. Please try again.</p>
					<button class="btn btn-secondary" onclick={() => findingsQuery.refetch()}>Retry</button>
				</div>
			{:else if filteredFindings.length === 0}
				<div class="empty-state glass">
					<svg
						width="48"
						height="48"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--accent-primary)"
						stroke-width="1.5"
						aria-hidden="true"
					>
						<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
						<polyline points="22 4 12 14.01 9 11.01" />
					</svg>
					{#if activeFilter === 'all'}
						<h3 class="empty-title">No findings yet</h3>
						<p class="empty-text">
							Run an analysis to scan your cloud environment for optimisation opportunities.
						</p>
					{:else}
						<h3 class="empty-title">No {activeFilter} findings</h3>
						<p class="empty-text">Great news — no {activeFilter}-severity issues found.</p>
					{/if}
				</div>
			{:else}
				<div class="findings-list">
					{#each filteredFindings as finding (finding.id)}
						<FindingCard
							{finding}
							onDismiss={handleDismiss}
							onCharlieAction={handleCharlieAction}
						/>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<ChatOverlay
		open={showChat}
		{chat}
		initialMessage={chatInitialMessage}
		onClose={() => {
			showChat = false;
		}}
	/>
</div>

<style>
	.advisor-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: var(--space-xl) var(--space-lg);
	}

	.page-header {
		margin-bottom: var(--space-xl);
	}

	.page-title {
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin: 0 0 var(--space-xs);
	}

	.page-subtitle {
		color: var(--fg-tertiary);
		font-size: var(--text-sm);
		margin: 0;
	}

	.advisor-layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-xl);
	}

	.filter-bar {
		display: flex;
		gap: var(--space-xs);
		flex-wrap: wrap;
		margin-bottom: var(--space-lg);
	}

	.filter-tab {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		padding: var(--space-xs) var(--space-sm);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-full);
		background: var(--bg-secondary);
		color: var(--fg-secondary);
		font-size: var(--text-xs);
		font-weight: 500;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.filter-tab:hover {
		border-color: var(--accent-primary);
		color: var(--fg-primary);
	}

	.filter-tab.active {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: white;
	}

	.filter-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.filter-tab.active .filter-dot {
		background: white !important;
	}

	.filter-count {
		font-size: 10px;
		font-weight: 700;
		background: color-mix(in srgb, currentColor 15%, transparent);
		padding: 1px 6px;
		border-radius: var(--radius-full);
	}

	.findings-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.loading-state,
	.error-state,
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-md);
		padding: var(--space-xxl);
		text-align: center;
		border-radius: var(--radius-lg);
	}

	.empty-title {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg-primary);
		margin: 0;
	}

	.empty-text {
		color: var(--fg-tertiary);
		font-size: var(--text-sm);
		max-width: 400px;
		margin: 0;
	}

	@media (max-width: 768px) {
		.advisor-page {
			padding: var(--space-lg) var(--space-md);
		}
	}
</style>
