<script lang="ts">
	import type { ResourceLinksPanelProps } from './types.js';

	let { links }: ResourceLinksPanelProps = $props();
</script>

<div class="resources-panel glass">
	<div class="panel-header">
		<h2 class="panel-title">Resources</h2>
	</div>
	<div class="panel-body">
		<div class="resources-list">
			{#each links as link (link.label)}
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

<style>
	.resources-panel {
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
</style>
