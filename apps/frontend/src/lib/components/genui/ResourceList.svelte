<script lang="ts">
	import type { ResourceItem } from './types.js';
	import { fuzzySearch } from '$lib/utils/fuzzy-search.js';

	interface Props {
		resources: ResourceItem[];
		title?: string;
		filterable?: boolean;
	}

	let { resources, title = 'Resources', filterable = true }: Props = $props();

	let filterQuery = $state('');

	const filtered = $derived(
		fuzzySearch(resources, filterQuery, [
			{ name: 'name', weight: 2 },
			{ name: 'type', weight: 1.5 },
			{ name: 'description', weight: 1 }
		])
	);

	function statusVariant(status: ResourceItem['status']): string {
		switch (status) {
			case 'active':
				return 'status-active';
			case 'inactive':
				return 'status-inactive';
			case 'warning':
				return 'status-warning';
			case 'error':
				return 'status-error';
			case 'pending':
				return 'status-pending';
			case 'terminated':
				return 'status-terminated';
			default:
				return '';
		}
	}

	function formatDate(dateStr?: string): string {
		if (!dateStr) return '';
		return new Date(dateStr).toLocaleDateString();
	}
</script>

<div class="resource-list-wrapper">
	{#if title}
		<div class="list-header">
			<h3 class="list-title">{title}</h3>
			<span class="list-count">{filtered.length} of {resources.length}</span>
		</div>
	{/if}

	{#if filterable && resources.length > 3}
		<div class="filter-bar">
			<input
				type="text"
				bind:value={filterQuery}
				placeholder="Filter resources..."
				class="filter-input"
			/>
		</div>
	{/if}

	{#if filtered.length === 0}
		<p class="empty-message">
			{filterQuery ? 'No resources match your filter.' : 'No resources found.'}
		</p>
	{:else}
		<ul class="resource-items">
			{#each filtered as item (item.id)}
				<li class="resource-item">
					<div class="item-main">
						<div class="item-name-row">
							<span class="item-name">{item.name}</span>
							<span class="status-badge {statusVariant(item.status)}">
								{item.status}
							</span>
						</div>
						<div class="item-meta">
							<span class="item-type">{item.type}</span>
							{#if item.timeCreated}
								<span class="item-date">{formatDate(item.timeCreated)}</span>
							{/if}
						</div>
						{#if item.description}
							<p class="item-description">{item.description}</p>
						{/if}
					</div>
					{#if item.metadata && Object.keys(item.metadata).length > 0}
						<div class="item-metadata">
							{#each Object.entries(item.metadata) as [key, value] (key)}
								<span class="meta-tag">
									<span class="meta-key">{key}:</span>
									<span class="meta-value">{value}</span>
								</span>
							{/each}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.resource-list-wrapper {
		background: var(--portal-white, #ffffff);
		border: 1px solid var(--portal-border, #e2e8f0);
		border-radius: 8px;
		overflow: hidden;
	}

	.list-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--portal-border, #e2e8f0);
	}

	.list-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--portal-navy, #1e293b);
		margin: 0;
	}

	.list-count {
		font-size: 0.75rem;
		color: var(--portal-slate, #64748b);
	}

	.filter-bar {
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--portal-border-light, #f1f5f9);
	}

	.filter-input {
		width: 100%;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--portal-border, #e2e8f0);
		border-radius: 6px;
		font-size: 0.8125rem;
		color: var(--portal-navy, #1e293b);
		background: var(--portal-light, #f8fafc);
		outline: none;
	}

	.filter-input:focus {
		border-color: var(--portal-teal, #0d9488);
		box-shadow: 0 0 0 2px rgba(13, 148, 136, 0.1);
	}

	.filter-input::placeholder {
		color: var(--portal-slate-light, #94a3b8);
	}

	.empty-message {
		padding: 2rem;
		text-align: center;
		color: var(--portal-slate, #64748b);
		font-size: 0.875rem;
	}

	.resource-items {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.resource-item {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--portal-border-light, #f1f5f9);
	}

	.resource-item:last-child {
		border-bottom: none;
	}

	.resource-item:hover {
		background: var(--portal-hover, #f8fafc);
	}

	.item-main {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.item-name-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.item-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--portal-navy, #1e293b);
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.0625rem 0.4375rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: capitalize;
	}

	.status-badge.status-active {
		background: var(--portal-success-bg, #ecfdf5);
		color: var(--portal-success, #059669);
	}

	.status-badge.status-inactive {
		background: var(--portal-muted-bg, #f1f5f9);
		color: var(--portal-slate, #64748b);
	}

	.status-badge.status-warning {
		background: var(--portal-warning-bg, #fffbeb);
		color: var(--portal-warning-dark, #d97706);
	}

	.status-badge.status-error {
		background: var(--portal-error-bg, #fef2f2);
		color: var(--portal-error, #dc2626);
	}

	.status-badge.status-pending {
		background: var(--portal-info-bg, #eff6ff);
		color: var(--portal-info, #2563eb);
	}

	.status-badge.status-terminated {
		background: var(--portal-muted-bg, #f1f5f9);
		color: var(--portal-muted, #94a3b8);
	}

	.item-meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--portal-slate, #64748b);
	}

	.item-type {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
	}

	.item-description {
		font-size: 0.75rem;
		color: var(--portal-slate, #64748b);
		margin: 0.25rem 0 0;
		line-height: 1.4;
	}

	.item-metadata {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-top: 0.5rem;
	}

	.meta-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.5rem;
		background: var(--portal-light, #f8fafc);
		border-radius: 4px;
		font-size: 0.6875rem;
	}

	.meta-key {
		color: var(--portal-slate, #64748b);
	}

	.meta-value {
		color: var(--portal-navy, #1e293b);
		font-weight: 500;
	}
</style>
