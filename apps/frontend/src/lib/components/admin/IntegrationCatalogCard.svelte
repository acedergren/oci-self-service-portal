<script lang="ts">
	import type { McpCatalogItem } from '@portal/server/admin/mcp-types';
	import Badge from '$lib/components/ui/Badge.svelte';

	interface Props {
		item: McpCatalogItem;
		onInstall: () => void;
	}

	let { item, onInstall }: Props = $props();

	const iconLetter = $derived(item.displayName[0].toUpperCase());
	const truncatedDescription = $derived(
		item.description.length > 120 ? item.description.slice(0, 120) + '...' : item.description
	);
</script>

<div class="catalog-card">
	<div class="card-header">
		<div class="icon-placeholder">{iconLetter}</div>
		<div class="card-info">
			<h3 class="card-title">{item.displayName}</h3>
			<span class="category-badge">{item.category}</span>
		</div>
	</div>

	<p class="card-description">{truncatedDescription}</p>

	<div class="card-badges">
		{#if item.supportsTools}
			<Badge variant="info">Tools</Badge>
		{/if}
		{#if item.supportsResources}
			<Badge variant="accent">Resources</Badge>
		{/if}
		{#if item.isFeatured}
			<Badge variant="warning">Featured</Badge>
		{/if}
		{#if item.status === 'preview'}
			<Badge variant="info">Preview</Badge>
		{:else if item.status === 'deprecated'}
			<Badge variant="error">Deprecated</Badge>
		{/if}
	</div>

	{#if item.tags && item.tags.length > 0}
		<div class="card-tags">
			{#each item.tags.slice(0, 3) as tag}
				<span class="tag">{tag}</span>
			{/each}
			{#if item.tags.length > 3}
				<span class="tag">+{item.tags.length - 3}</span>
			{/if}
		</div>
	{/if}

	<div class="card-footer">
		<button type="button" class="btn-install" onclick={onInstall}>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
			>
				<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
				<polyline points="7 10 12 15 17 10" />
				<line x1="12" y1="15" x2="12" y2="3" />
			</svg>
			Install
		</button>
		{#if item.documentationUrl}
			<a href={item.documentationUrl} target="_blank" rel="noopener noreferrer" class="btn-docs">
				Docs
			</a>
		{/if}
	</div>
</div>

<style>
	.catalog-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
		padding: var(--space-lg);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		transition: all var(--transition-fast);
	}

	.catalog-card:hover {
		border-color: var(--border-focused);
		box-shadow: 0 4px 12px -2px oklch(0 0 0 / 0.1);
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: var(--space-md);
	}

	.icon-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		color: var(--bg-primary);
		border-radius: var(--radius-md);
		font-size: var(--text-xl);
		font-weight: 700;
		flex-shrink: 0;
	}

	.card-info {
		flex: 1;
		min-width: 0;
	}

	.card-title {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.category-badge {
		display: inline-block;
		padding: 2px 8px;
		background: var(--bg-tertiary);
		color: var(--fg-tertiary);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
	}

	.card-description {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
		line-height: 1.5;
	}

	.card-badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
	}

	.card-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
	}

	.tag {
		padding: 4px 8px;
		background: var(--bg-elevated);
		color: var(--fg-tertiary);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
	}

	.card-footer {
		display: flex;
		gap: var(--space-sm);
		margin-top: auto;
		padding-top: var(--space-sm);
		border-top: 1px solid var(--border-muted);
	}

	.btn-install {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-xs);
		padding: var(--space-sm) var(--space-md);
		background: var(--accent-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-install:hover {
		background: var(--accent-secondary);
		box-shadow: 0 0 20px -5px var(--accent-primary);
	}

	.btn-docs {
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-elevated);
		color: var(--fg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: var(--text-sm);
		text-decoration: none;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-docs:hover {
		background: var(--bg-hover);
		border-color: var(--border-focused);
		color: var(--fg-primary);
	}
</style>
