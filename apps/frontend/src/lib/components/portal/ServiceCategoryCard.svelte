<script lang="ts">
	import type { ServiceCategoryCardProps, ServiceIconId } from './types.js';

	let { category, onAction }: ServiceCategoryCardProps = $props();

	const iconPaths: Record<ServiceIconId, string> = {
		server:
			'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"/>',
		database:
			'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/>',
		network:
			'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>',
		storage:
			'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/>',
		shield:
			'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>',
		chart:
			'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>'
	};
</script>

<article class="service-card glass" data-color={category.color}>
	<div class="service-icon">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- safe: hardcoded SVG lookup -->
			{@html iconPaths[category.icon] || iconPaths.server}
		</svg>
	</div>
	<div class="service-content">
		<h3 class="service-title">{category.title}</h3>
		<p class="service-description">{category.description}</p>
		<div class="service-actions">
			{#each category.actions as action (action.label)}
				<button class="service-action" onclick={() => onAction(action)}>
					{action.label}
				</button>
			{/each}
		</div>
	</div>
</article>

<style>
	.service-card {
		border-radius: var(--radius-lg);
		padding: var(--space-lg);
		border: 1px solid var(--border-default);
		transition: all var(--transition-normal);
		display: flex;
		gap: var(--space-md);
	}

	.service-card:hover {
		box-shadow: var(--shadow-md);
		transform: translateY(-2px);
		border-color: transparent;
	}

	.service-icon {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.service-card[data-color='teal'] .service-icon {
		background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
		color: var(--accent-primary);
	}
	.service-card[data-color='indigo'] .service-icon {
		background: color-mix(in srgb, var(--agent-waiting) 10%, transparent);
		color: var(--agent-waiting);
	}
	.service-card[data-color='emerald'] .service-icon {
		background: color-mix(in srgb, var(--semantic-success) 10%, transparent);
		color: var(--semantic-success);
	}
	.service-card[data-color='amber'] .service-icon {
		background: color-mix(in srgb, var(--semantic-warning) 10%, transparent);
		color: var(--semantic-warning);
	}
	.service-card[data-color='rose'] .service-icon {
		background: color-mix(in srgb, var(--semantic-error) 10%, transparent);
		color: var(--semantic-error);
	}
	.service-card[data-color='violet'] .service-icon {
		background: color-mix(in srgb, var(--agent-waiting) 10%, transparent);
		color: var(--agent-waiting);
	}

	.service-icon svg {
		width: 24px;
		height: 24px;
	}

	.service-content {
		flex: 1;
		min-width: 0;
	}

	.service-title {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
	}

	.service-description {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		margin-bottom: var(--space-sm);
		line-height: 1.5;
	}

	.service-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-sm);
	}

	.service-action {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--accent-primary);
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
		transition: color var(--transition-fast);
	}

	.service-action:hover {
		color: var(--accent-secondary);
	}

	.service-action:not(:last-child)::after {
		content: '|';
		margin-left: var(--space-sm);
		color: var(--border-default);
		text-decoration: none;
		display: inline-block;
	}
</style>
