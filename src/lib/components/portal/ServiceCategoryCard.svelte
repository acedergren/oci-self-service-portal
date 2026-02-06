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

<article class="service-card" data-color={category.color}>
	<div class="service-icon">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
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
		background: var(--portal-white, #ffffff);
		border-radius: 12px;
		padding: 1.5rem;
		border: 1px solid #e2e8f0;
		transition: all 0.2s ease;
		display: flex;
		gap: 1rem;
	}

	.service-card:hover {
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
		transform: translateY(-2px);
		border-color: transparent;
	}

	.service-icon {
		width: 48px;
		height: 48px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.service-card[data-color='teal'] .service-icon {
		background: rgba(13, 148, 136, 0.1);
		color: var(--portal-teal, #0d9488);
	}
	.service-card[data-color='indigo'] .service-icon {
		background: rgba(79, 70, 229, 0.1);
		color: #4f46e5;
	}
	.service-card[data-color='emerald'] .service-icon {
		background: rgba(16, 185, 129, 0.1);
		color: #10b981;
	}
	.service-card[data-color='amber'] .service-icon {
		background: rgba(245, 158, 11, 0.1);
		color: #f59e0b;
	}
	.service-card[data-color='rose'] .service-icon {
		background: rgba(244, 63, 94, 0.1);
		color: #f43f5e;
	}
	.service-card[data-color='violet'] .service-icon {
		background: rgba(139, 92, 246, 0.1);
		color: #8b5cf6;
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
		font-size: 1rem;
		font-weight: 600;
		color: var(--portal-navy, #1e293b);
		margin-bottom: 0.25rem;
	}

	.service-description {
		font-size: 0.8125rem;
		color: var(--portal-slate, #64748b);
		margin-bottom: 0.75rem;
		line-height: 1.5;
	}

	.service-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.service-action {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--portal-teal, #0d9488);
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
		transition: color 0.15s ease;
	}

	.service-action:hover {
		color: var(--portal-teal-dark, #0f766e);
	}

	.service-action:not(:last-child)::after {
		content: '|';
		margin-left: 0.5rem;
		color: #cbd5e1;
		text-decoration: none;
		display: inline-block;
	}
</style>
