<script lang="ts">
	import { Badge } from '$lib/components/ui/index.js';
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	interface WorkflowSummary {
		id: string;
		name: string;
		description?: string;
		status: 'draft' | 'published' | 'archived';
		version: number;
		tags?: string[];
		nodeCount: number;
		edgeCount: number;
		createdAt: string;
		updatedAt: string;
	}

	let workflows = $state<WorkflowSummary[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let searchQuery = $state('');
	let statusFilter = $state<string>('');

	async function fetchWorkflows() {
		loading = true;
		error = null;
		try {
			const params = new SvelteURLSearchParams();
			if (statusFilter) params.set('status', statusFilter);
			if (searchQuery) params.set('search', searchQuery);

			const res = await fetch(`/api/workflows?${params}`);
			if (!res.ok) throw new Error(`Failed to load workflows: ${res.status}`);
			const data = await res.json();
			workflows = data.workflows ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load workflows';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		// Reference reactive dependencies to trigger re-fetch
		void statusFilter;
		void searchQuery;
		fetchWorkflows();
	});

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	const statusVariant: Record<string, 'default' | 'success' | 'info' | 'warning'> = {
		draft: 'info',
		published: 'success',
		archived: 'default'
	};
</script>

<svelte:head>
	<title>Workflows | OCI Self-Service Portal</title>
</svelte:head>

<div class="workflows-page">
	<div class="page-header">
		<div class="header-text">
			<h1 class="page-title">Workflows</h1>
			<p class="page-subtitle">Create and manage automated OCI infrastructure workflows</p>
		</div>
		<a href={resolve('/workflows/new')} class="new-workflow-btn">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				width="16"
				height="16"
			>
				<path d="M12 5v14M5 12h14" />
			</svg>
			New Workflow
		</a>
	</div>

	<div class="filters">
		<input
			type="text"
			class="search-input"
			placeholder="Search workflows..."
			bind:value={searchQuery}
		/>
		<select class="status-filter" bind:value={statusFilter}>
			<option value="">All statuses</option>
			<option value="draft">Draft</option>
			<option value="published">Published</option>
			<option value="archived">Archived</option>
		</select>
	</div>

	{#if loading}
		<div class="loading-state">
			<p>Loading workflows...</p>
		</div>
	{:else if error}
		<div class="error-state">
			<p>{error}</p>
			<button onclick={fetchWorkflows} class="retry-btn">Retry</button>
		</div>
	{:else if workflows.length === 0}
		<div class="empty-state">
			{#if workflows.length === 0}
				<div class="empty-icon">
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						width="48"
						height="48"
					>
						<rect x="3" y="3" width="18" height="18" rx="2" />
						<path d="M3 9h18M9 21V9" />
					</svg>
				</div>
				<h2 class="empty-title">No workflows yet</h2>
				<p class="empty-text">Create your first workflow to automate OCI infrastructure tasks</p>
				<a href={resolve('/workflows/new')} class="new-workflow-btn">Create Workflow</a>
			{:else}
				<p class="empty-text">No workflows match your search</p>
			{/if}
		</div>
	{:else}
		<div class="workflows-grid">
			{#each workflows as wf (wf.id)}
				<a href={resolve(`/workflows/${wf.id}`)} class="workflow-card">
					<div class="card-header">
						<h3 class="card-name">{wf.name}</h3>
						<Badge variant={statusVariant[wf.status] ?? 'default'}>{wf.status}</Badge>
					</div>
					{#if wf.description}
						<p class="card-description">{wf.description}</p>
					{/if}
					<div class="card-meta">
						<span class="meta-item">{wf.nodeCount} nodes</span>
						<span class="meta-separator">&middot;</span>
						<span class="meta-item">v{wf.version}</span>
						<span class="meta-separator">&middot;</span>
						<span class="meta-item">{formatDate(wf.updatedAt)}</span>
					</div>
					{#if wf.tags && wf.tags.length > 0}
						<div class="card-tags">
							{#each wf.tags.slice(0, 4) as tag (tag)}
								<span class="tag">{tag}</span>
							{/each}
						</div>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.workflows-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 2rem;
	}

	.page-title {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: 0.25rem;
	}

	.page-subtitle {
		font-size: 0.875rem;
		color: var(--fg-tertiary);
	}

	.new-workflow-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		background: var(--accent-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: 8px;
		font-size: 0.875rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition: all 0.15s;
		font-family: inherit;
		white-space: nowrap;
	}

	.new-workflow-btn:hover {
		filter: brightness(1.1);
	}

	.filters {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.search-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		color: var(--fg-primary);
		outline: none;
		font-family: inherit;
	}

	.search-input::placeholder {
		color: var(--fg-tertiary);
	}

	.search-input:focus {
		border-color: var(--accent-primary);
	}

	.status-filter {
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		color: var(--fg-primary);
		outline: none;
		font-family: inherit;
		cursor: pointer;
	}

	.workflows-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 1rem;
	}

	.workflow-card {
		display: block;
		padding: 1.25rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		text-decoration: none;
		transition: all 0.2s;
	}

	.workflow-card:hover {
		border-color: var(--accent-primary);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		transform: translateY(-2px);
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.card-name {
		font-size: 1rem;
		font-weight: 600;
		color: var(--fg-primary);
		margin: 0;
	}

	.card-description {
		font-size: 0.8125rem;
		color: var(--fg-secondary);
		margin-bottom: 0.75rem;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.card-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--fg-tertiary);
		margin-bottom: 0.5rem;
	}

	.meta-separator {
		opacity: 0.5;
	}

	.card-tags {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.tag {
		padding: 0.125rem 0.5rem;
		background: var(--bg-tertiary);
		border-radius: 10px;
		font-size: 0.6875rem;
		color: var(--fg-secondary);
	}

	.loading-state,
	.error-state,
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
	}

	.empty-icon {
		color: var(--fg-tertiary);
		opacity: 0.4;
		margin-bottom: 1rem;
	}

	.empty-title {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: 0.5rem;
	}

	.empty-text {
		font-size: 0.875rem;
		color: var(--fg-tertiary);
		margin-bottom: 1.5rem;
	}

	.retry-btn {
		padding: 0.5rem 1rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--fg-secondary);
		cursor: pointer;
		font-family: inherit;
		font-size: 0.875rem;
	}

	.retry-btn:hover {
		background: var(--bg-hover);
	}

	@media (max-width: 768px) {
		.workflows-page {
			padding: 1rem;
		}

		.page-header {
			flex-direction: column;
			gap: 1rem;
		}

		.filters {
			flex-direction: column;
		}

		.workflows-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
