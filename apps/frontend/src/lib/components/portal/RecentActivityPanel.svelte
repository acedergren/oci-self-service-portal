<script lang="ts">
	import type { RecentActivityPanelProps } from './types.js';

	let { items, onViewAll }: RecentActivityPanelProps = $props();

	const iconPaths: Record<string, string> = {
		server:
			'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"/>',
		database:
			'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/>',
		network:
			'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>'
	};

	function getIconForType(type: string): string {
		if (type === 'compute') return iconPaths.server;
		if (type === 'database') return iconPaths.database;
		return iconPaths.network;
	}
</script>

<div class="activity-panel glass">
	<div class="panel-header">
		<h2 class="panel-title">Recent Activity</h2>
		{#if onViewAll}
			<button class="panel-action" onclick={onViewAll}>View All</button>
		{/if}
	</div>
	<div class="panel-body">
		{#if items.length > 0}
			<div class="activity-list">
				{#each items as item (item.id)}
					<div class="activity-item">
						<div class="activity-icon" data-type={item.type}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- safe: hardcoded SVG lookup -->
								{@html getIconForType(item.type)}
							</svg>
						</div>
						<div class="activity-details">
							<span class="activity-action">{item.action}</span>
							<span class="activity-id">{item.id} - {item.time}</span>
						</div>
						<span class="activity-status" data-status={item.status}>
							{item.status}
						</span>
					</div>
				{/each}
			</div>
		{:else}
			<div class="empty-state">
				<p>No recent activity. Try asking Charlie to check your infrastructure.</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.activity-panel {
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-md) var(--space-lg);
		border-bottom: 1px solid var(--border-muted);
	}

	.panel-body {
		padding: var(--space-lg);
	}

	.panel-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.panel-action {
		font-size: var(--text-xs);
		color: var(--accent-primary);
		background: transparent;
		border: none;
		cursor: pointer;
		font-weight: 500;
	}

	.panel-action:hover {
		text-decoration: underline;
	}

	.activity-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
	}

	.activity-item {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-sm);
		background: var(--bg-tertiary);
		border-radius: var(--radius-md);
	}

	.activity-icon {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.activity-icon[data-type='compute'] {
		background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
		color: var(--accent-primary);
	}
	.activity-icon[data-type='database'] {
		background: color-mix(in srgb, var(--semantic-info) 15%, transparent);
		color: var(--semantic-info);
	}
	.activity-icon[data-type='networking'] {
		background: color-mix(in srgb, var(--semantic-success) 15%, transparent);
		color: var(--semantic-success);
	}

	.activity-icon svg {
		width: 16px;
		height: 16px;
	}

	.activity-details {
		flex: 1;
		min-width: 0;
	}
	.activity-action {
		display: block;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--fg-primary);
	}
	.activity-id {
		display: block;
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
	}

	.activity-status {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.25rem 0.625rem;
		border-radius: var(--radius-full);
	}

	.activity-status[data-status='completed'] {
		background: color-mix(in srgb, var(--semantic-success) 15%, transparent);
		color: var(--semantic-success);
	}
	.activity-status[data-status='pending'] {
		background: color-mix(in srgb, var(--semantic-warning) 15%, transparent);
		color: var(--semantic-warning);
	}
	.activity-status[data-status='failed'] {
		background: color-mix(in srgb, var(--semantic-error) 15%, transparent);
		color: var(--semantic-error);
	}

	.empty-state {
		text-align: center;
		padding: var(--space-lg) 0;
	}

	.empty-state p {
		font-size: var(--text-sm);
		color: var(--fg-tertiary);
		line-height: 1.5;
	}
</style>
