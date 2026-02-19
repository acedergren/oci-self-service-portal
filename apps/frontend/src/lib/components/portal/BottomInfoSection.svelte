<script lang="ts">
	import { resolve } from '$app/paths';
	import type { BottomInfoSectionProps } from './types.js';

	let { recentActivity, resourceLinks, onAskAI, onViewAllActivity }: BottomInfoSectionProps =
		$props();

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

	const hasActivity = $derived(recentActivity.length > 0);
</script>

<section class="bottom-section">
	<div class="bottom-grid">
		<!-- Recent Activity -->
		<div class="activity-panel glass">
			<div class="panel-header">
				<h2 class="panel-title">Recent Activity</h2>
				{#if onViewAllActivity}
					<button class="panel-action" onclick={onViewAllActivity}>View All</button>
				{/if}
			</div>
			<div class="panel-body">
				{#if hasActivity}
					<div class="activity-list">
						{#each recentActivity as item (item.id)}
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

		<!-- Resources -->
		<div class="resources-panel glass">
			<div class="panel-header">
				<h2 class="panel-title">Resources</h2>
			</div>
			<div class="panel-body">
				<div class="resources-list">
					{#each resourceLinks as link (link.label)}
						<a
							href={link.href}
							target="_blank"
							rel="external noopener noreferrer"
							class="resource-link"
						>
							{link.label}
						</a>
					{/each}
				</div>
			</div>
		</div>

		<!-- Charlie Help -->
		<div class="help-panel glass-charlie">
			<div class="panel-header charlie-header">
				<h2 class="panel-title">
					<span class="charlie-mark">C</span>
					Ask Charlie
				</h2>
			</div>
			<div class="panel-body">
				<div class="help-content">
					<p class="help-text">
						Charlie can help with any cloud operation — from cost analysis to infrastructure
						provisioning.
					</p>
					<button
						class="help-btn"
						onclick={() => onAskAI('Help me understand my current OCI infrastructure and costs')}
					>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
							/>
						</svg>
						Chat with Charlie
					</button>
					<a href={resolve('/chat')} class="chat-link"> Open full chat → </a>
				</div>
			</div>
		</div>
	</div>
</section>

<style>
	.bottom-section {
		max-width: 1400px;
		margin: 0 auto;
		padding: 0 2rem 3rem;
	}

	.bottom-grid {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 1.5rem;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-md) var(--space-lg);
		border-bottom: 1px solid var(--border-muted);
	}

	.charlie-header {
		border-bottom-color: color-mix(in srgb, var(--charlie-accent) 20%, transparent);
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
		display: flex;
		align-items: center;
		gap: var(--space-sm);
	}

	.charlie-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-full);
		background: var(--charlie-accent);
		color: white;
		font-size: var(--text-xs);
		font-weight: 700;
		flex-shrink: 0;
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

	/* Activity List */
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

	/* Resources List */
	.resources-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
	}

	.resource-link {
		display: block;
		font-size: var(--text-sm);
		color: var(--accent-primary);
		text-decoration: none;
		padding: 0.625rem 0;
		border-bottom: 1px solid var(--border-muted);
		transition: color var(--transition-fast);
	}

	.resource-link:hover {
		color: var(--accent-secondary);
		text-decoration: underline;
	}

	.resource-link:last-child {
		border-bottom: none;
	}

	/* Help Panel */
	.help-content {
		text-align: center;
	}

	.help-text {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
		margin-bottom: var(--space-md);
		line-height: 1.5;
	}

	.help-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-sm);
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		color: white;
		font-size: var(--text-sm);
		font-weight: 600;
		padding: var(--space-sm) var(--space-lg);
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all var(--transition-normal);
		font-family: inherit;
	}

	.help-btn:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent-primary) 30%, transparent);
	}

	.help-btn svg {
		width: 18px;
		height: 18px;
	}

	.chat-link {
		display: block;
		margin-top: var(--space-md);
		font-size: var(--text-xs);
		color: var(--accent-primary);
		text-decoration: none;
		transition: color var(--transition-fast);
	}

	.chat-link:hover {
		color: var(--accent-secondary);
		text-decoration: underline;
	}

	/* Empty state */
	.empty-state {
		text-align: center;
		padding: var(--space-lg) 0;
	}

	.empty-state p {
		font-size: var(--text-sm);
		color: var(--fg-tertiary);
		line-height: 1.5;
	}

	@media (max-width: 1024px) {
		.bottom-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 768px) {
		.bottom-section {
			padding: 0 1rem 2rem;
		}
	}
</style>
