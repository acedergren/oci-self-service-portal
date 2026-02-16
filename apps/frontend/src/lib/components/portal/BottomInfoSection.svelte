<script lang="ts">
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
</script>

<section class="bottom-section">
	<div class="bottom-grid">
		<!-- Recent Activity -->
		<div class="activity-panel">
			<div class="panel-header">
				<h2 class="panel-title">Recent Activity</h2>
				{#if onViewAllActivity}
					<button class="panel-action" onclick={onViewAllActivity}>View All</button>
				{/if}
			</div>
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
		</div>

		<!-- Resources -->
		<div class="resources-panel">
			<div class="panel-header">
				<h2 class="panel-title">Resources</h2>
			</div>
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

		<!-- Help -->
		<div class="help-panel">
			<div class="panel-header">
				<h2 class="panel-title">Need Help?</h2>
			</div>
			<div class="help-content">
				<p class="help-text">Use the AI assistant for instant help with any cloud operations.</p>
				<button
					class="help-btn"
					onclick={() => onAskAI('Help me understand my current OCI infrastructure and costs')}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
						/>
					</svg>
					Ask AI Assistant
				</button>
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

	.activity-panel,
	.resources-panel,
	.help-panel {
		background: var(--portal-white, #ffffff);
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid #e2e8f0;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.5rem;
		background: linear-gradient(135deg, rgba(13, 148, 136, 0.08), rgba(13, 148, 136, 0.15));
		border-bottom: 1px solid rgba(13, 148, 136, 0.2);
	}

	.activity-panel .panel-header ~ *,
	.resources-panel .panel-header ~ *,
	.help-panel .panel-header ~ * {
		padding: 1.5rem;
	}

	.panel-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--portal-teal-dark, #0f766e);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.panel-action {
		font-size: 0.8125rem;
		color: var(--portal-teal, #0d9488);
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
		gap: 0.75rem;
	}

	.activity-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		background: var(--portal-light, #f1f5f9);
		border-radius: 8px;
	}

	.activity-icon {
		width: 32px;
		height: 32px;
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.activity-icon[data-type='compute'] {
		background: rgba(13, 148, 136, 0.15);
		color: var(--portal-teal, #0d9488);
	}
	.activity-icon[data-type='database'] {
		background: rgba(79, 70, 229, 0.15);
		color: #4f46e5;
	}
	.activity-icon[data-type='networking'] {
		background: rgba(16, 185, 129, 0.15);
		color: #10b981;
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
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--portal-navy, #1e293b);
	}

	.activity-id {
		display: block;
		font-size: 0.75rem;
		color: var(--portal-slate, #64748b);
	}

	.activity-status {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.25rem 0.625rem;
		border-radius: 100px;
	}

	.activity-status[data-status='completed'] {
		background: rgba(16, 185, 129, 0.15);
		color: #059669;
	}
	.activity-status[data-status='pending'] {
		background: rgba(245, 158, 11, 0.15);
		color: #d97706;
	}
	.activity-status[data-status='failed'] {
		background: rgba(239, 68, 68, 0.15);
		color: #dc2626;
	}

	/* Resources List */
	.resources-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.resource-link {
		display: block;
		font-size: 0.875rem;
		color: var(--portal-teal, #0d9488);
		text-decoration: none;
		padding: 0.625rem 0;
		border-bottom: 1px solid #e2e8f0;
		transition: color 0.15s ease;
	}

	.resource-link:hover {
		color: var(--portal-teal-dark, #0f766e);
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
		font-size: 0.875rem;
		color: var(--portal-slate, #64748b);
		margin-bottom: 1rem;
		line-height: 1.5;
	}

	.help-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: linear-gradient(
			135deg,
			var(--portal-teal, #0d9488),
			var(--portal-teal-dark, #0f766e)
		);
		color: white;
		font-size: 0.875rem;
		font-weight: 600;
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s ease;
		font-family: inherit;
	}

	.help-btn:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(13, 148, 136, 0.3);
	}

	.help-btn svg {
		width: 18px;
		height: 18px;
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
