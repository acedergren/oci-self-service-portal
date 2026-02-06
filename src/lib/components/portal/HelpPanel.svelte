<script lang="ts">
	import type { HelpPanelProps } from './types.js';

	let { onAskAI }: HelpPanelProps = $props();
</script>

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

<style>
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

	.panel-header ~ * {
		padding: 1.5rem;
	}

	.panel-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--portal-teal-dark, #0f766e);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

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
</style>
