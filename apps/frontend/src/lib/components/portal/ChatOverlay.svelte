<script lang="ts">
	import { AgentWorkflowPanel } from '$lib/components/panels/index.js';
	import ChatMessageList from './ChatMessageList.svelte';
	import ChatInput from './ChatInput.svelte';
	import type { ChatOverlayProps } from './types.js';

	let {
		open,
		chat,
		activeWorkflowPlan = undefined,
		workflowPanelOpen = true,
		hideToolExecution = true,
		onClose,
		onToggleWorkflowPanel
	}: ChatOverlayProps = $props();

	function handleChatSubmit(text: string) {
		chat.sendMessage({ text });
	}
</script>

{#if open}
	<div class="command-overlay">
		<button class="command-backdrop" onclick={onClose} aria-label="Close Charlie"></button>
		<div class="command-palette glass-charlie" role="dialog" aria-modal="true" aria-label="Charlie">
			<div class="command-header">
				<h3 class="command-title">
					<span class="charlie-mark">C</span>
					Charlie
				</h3>
				<button class="command-close" onclick={onClose} aria-label="Close Charlie">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			{#if activeWorkflowPlan}
				<div class="workflow-panel-container">
					<AgentWorkflowPanel
						isOpen={workflowPanelOpen}
						plan={activeWorkflowPlan}
						ontoggle={() => onToggleWorkflowPanel?.()}
					/>
				</div>
			{/if}

			<ChatMessageList messages={chat.messages} chatStatus={chat.status} {hideToolExecution} />

			<ChatInput disabled={chat.status === 'streaming'} onSubmit={handleChatSubmit} />
		</div>
	</div>
{/if}

<style>
	.command-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 5vh 1rem;
		animation: fadeIn var(--transition-fast);
	}

	.command-backdrop {
		position: absolute;
		inset: 0;
		background: color-mix(in srgb, var(--fg-primary) 60%, transparent);
		backdrop-filter: blur(4px);
		border: none;
		cursor: pointer;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.command-palette {
		position: relative;
		z-index: 1;
		width: 100%;
		max-width: 700px;
		max-height: 80vh;
		border-radius: 16px;
		box-shadow: 0 25px 50px -12px color-mix(in srgb, var(--fg-primary) 25%, transparent);
		display: flex;
		flex-direction: column;
		animation: slideUp var(--transition-normal);
	}

	.charlie-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--charlie-accent, var(--accent-primary));
		color: white;
		font-weight: 700;
		font-size: var(--text-xs, 0.75rem);
		flex-shrink: 0;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.command-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--border-default);
	}

	.command-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--fg-primary);
	}

	.command-close {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--fg-tertiary);
		border-radius: 6px;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.command-close:hover {
		background: var(--bg-tertiary);
		color: var(--fg-primary);
	}

	.command-close svg {
		width: 18px;
		height: 18px;
	}

	/* Workflow panel container — maps component-specific vars to design system tokens */
	.workflow-panel-container {
		border-bottom: 1px solid var(--border-default);
		padding: 1rem 1.5rem;
		background: var(--bg-secondary);
		max-height: 40vh;
		overflow-y: auto;
		flex-shrink: 0;

		/* Map legacy --text-* names to design system fg tokens */
		--text-primary: var(--fg-primary);
		--text-secondary: var(--fg-secondary);
		--text-tertiary: var(--fg-tertiary);

		/* Workflow execution state colors */
		--color-success: #10b981;
		--color-executing: var(--accent-primary);
		--color-error: #ef4444;
		--color-info: #3b82f6;
		--color-warning: #f59e0b;
		--semantic-success: #10b981;
		--semantic-error: #ef4444;
		--semantic-warning: #f59e0b;
		--semantic-info: #3b82f6;
	}

	/* Panel styles for Collapsible component inside workflow container */
	.workflow-panel-container :global(.panel) {
		background-color: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		margin-bottom: 0;
	}

	.workflow-panel-container :global(.panel-header) {
		background-color: var(--bg-tertiary);
		border-bottom: 1px solid var(--border-default);
		padding: 0.5rem 1rem;
		cursor: pointer;
		user-select: none;
		border-radius: 8px 8px 0 0;
	}

	.workflow-panel-container :global(.panel-header:hover) {
		background-color: var(--border-default);
	}

	.workflow-panel-container :global(.panel-content) {
		padding: 1rem;
		background: var(--bg-secondary);
		border-radius: 0 0 8px 8px;
	}

	/* Text utilities for workflow container */
	.workflow-panel-container :global(.text-primary) {
		color: var(--fg-primary);
	}
	.workflow-panel-container :global(.text-secondary) {
		color: var(--fg-tertiary);
	}
	.workflow-panel-container :global(.text-tertiary) {
		color: var(--fg-disabled);
	}
	.workflow-panel-container :global(.text-success) {
		color: #10b981;
	}
	.workflow-panel-container :global(.text-error) {
		color: #ef4444;
	}

	/* Badge styles for workflow container */
	.workflow-panel-container :global(.badge) {
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 500;
	}

	.workflow-panel-container :global(.badge-default) {
		background-color: var(--border-default);
		color: var(--fg-tertiary);
	}

	.workflow-panel-container :global(.badge-success) {
		background-color: #10b981;
		color: white;
	}
	.workflow-panel-container :global(.badge-warning) {
		background-color: #f59e0b;
		color: white;
	}
	.workflow-panel-container :global(.badge-error) {
		background-color: #ef4444;
		color: white;
	}
	.workflow-panel-container :global(.badge-info) {
		background-color: #3b82f6;
		color: white;
	}

	.workflow-panel-container :global(.animate-slide-in-up) {
		animation: slideUp var(--transition-fast);
	}
	.workflow-panel-container :global(.flex) {
		display: flex;
	}
	.workflow-panel-container :global(.items-center) {
		align-items: center;
	}
	.workflow-panel-container :global(.justify-between) {
		justify-content: space-between;
	}
	.workflow-panel-container :global(.gap-2) {
		gap: 0.5rem;
	}
	.workflow-panel-container :global(.w-full) {
		width: 100%;
	}
	.workflow-panel-container :global(.mb-2) {
		margin-bottom: 0.5rem;
	}
	.workflow-panel-container :global(.mb-3) {
		margin-bottom: 0.75rem;
	}
	.workflow-panel-container :global(.ml-2) {
		margin-left: 0.5rem;
	}
	.workflow-panel-container :global(.font-medium) {
		font-weight: 500;
	}
	.workflow-panel-container :global(.text-sm) {
		font-size: 0.875rem;
	}
	.workflow-panel-container :global(.text-xs) {
		font-size: 0.75rem;
	}
	.workflow-panel-container :global(.space-y-4 > * + *) {
		margin-top: 1rem;
	}
	.workflow-panel-container :global(.rounded-t-md) {
		border-top-left-radius: 6px;
		border-top-right-radius: 6px;
	}
	.workflow-panel-container :global(.rotate-90) {
		transform: rotate(90deg);
	}
	.workflow-panel-container :global(.transition-transform) {
		transition: transform var(--transition-fast);
	}

	@media (max-width: 768px) {
		.command-palette {
			max-height: 90vh;
			border-radius: 12px 12px 0 0;
			margin-top: auto;
		}
	}
</style>
