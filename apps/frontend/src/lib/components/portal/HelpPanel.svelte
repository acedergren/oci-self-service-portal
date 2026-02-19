<script lang="ts">
	import type { HelpPanelProps } from './types.js';

	let { onAskAI }: HelpPanelProps = $props();
</script>

<div class="help-panel glass-charlie">
	<div class="panel-header">
		<h2 class="panel-title">
			<span class="charlie-mark">C</span>
			Ask Charlie
		</h2>
	</div>
	<div class="help-content">
		<p class="help-text">
			Charlie can help with any cloud operation — from cost analysis to infrastructure provisioning.
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
	</div>
</div>

<style>
	.help-panel {
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-md) var(--space-lg);
		border-bottom: 1px solid color-mix(in srgb, var(--charlie-accent) 20%, transparent);
	}

	.panel-header ~ * {
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
</style>
