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
		<button class="command-backdrop" onclick={onClose} aria-label="Close AI assistant"></button>
		<div class="command-palette" role="dialog" aria-modal="true" aria-label="AI Assistant">
			<div class="command-header">
				<h3 class="command-title">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="command-icon">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
						/>
					</svg>
					AI Assistant
				</h3>
				<button class="command-close" onclick={onClose} aria-label="Close AI assistant">
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
		animation: fadeIn 0.15s ease;
	}

	.command-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(15, 23, 42, 0.6);
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
		background: var(--portal-white, #ffffff);
		border-radius: 16px;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
		display: flex;
		flex-direction: column;
		animation: slideUp 0.2s ease;
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
		border-bottom: 1px solid #e2e8f0;
	}

	.command-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--portal-navy, #1e293b);
	}

	.command-icon {
		width: 20px;
		height: 20px;
		color: var(--portal-teal, #0d9488);
	}

	.command-close {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--portal-slate, #64748b);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.command-close:hover {
		background: var(--portal-light, #f1f5f9);
		color: var(--portal-navy, #1e293b);
	}

	.command-close svg {
		width: 18px;
		height: 18px;
	}

	/* Workflow panel container with design system variable overrides */
	.workflow-panel-container {
		border-bottom: 1px solid #e2e8f0;
		padding: 1rem 1.5rem;
		background: var(--portal-white, #ffffff);
		max-height: 40vh;
		overflow-y: auto;
		flex-shrink: 0;

		--text-primary: var(--portal-navy, #1e293b);
		--text-secondary: var(--portal-navy-light, #334155);
		--text-tertiary: var(--portal-slate, #64748b);
		--bg-tertiary: #f1f5f9;
		--bg-secondary: var(--portal-light, #f1f5f9);
		--bg-elevated: #e2e8f0;
		--bg-hover: #cbd5e1;
		--border-default: #cbd5e1;
		--border-muted: #e2e8f0;
		--color-success: #10b981;
		--color-executing: var(--portal-teal, #0d9488);
		--color-error: #ef4444;
		--color-info: #3b82f6;
		--color-warning: #f59e0b;
		--fg-primary: var(--portal-navy, #1e293b);
		--fg-secondary: var(--portal-slate, #64748b);
		--fg-tertiary: var(--portal-gray, #94a3b8);
		--accent-primary: var(--portal-teal, #0d9488);
		--semantic-success: #10b981;
		--semantic-error: #ef4444;
		--semantic-warning: #f59e0b;
		--semantic-info: #3b82f6;
		--radius-md: 8px;
		--radius-lg: 12px;
		--radius-full: 9999px;
		--space-sm: 0.5rem;
		--space-md: 1rem;
		--transition-fast: 150ms ease;
		--transition-normal: 250ms ease;
	}

	/* Panel styles for Collapsible component inside workflow container */
	.workflow-panel-container :global(.panel) {
		background-color: var(--portal-white, #ffffff);
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		margin-bottom: 0;
	}

	.workflow-panel-container :global(.panel-header) {
		background-color: var(--portal-light, #f1f5f9);
		border-bottom: 1px solid #e2e8f0;
		padding: 0.5rem 1rem;
		cursor: pointer;
		user-select: none;
		border-radius: 8px 8px 0 0;
	}

	.workflow-panel-container :global(.panel-header:hover) {
		background-color: #e2e8f0;
	}

	.workflow-panel-container :global(.panel-content) {
		padding: 1rem;
		background: var(--portal-white, #ffffff);
		border-radius: 0 0 8px 8px;
	}

	/* Text utilities for workflow container */
	.workflow-panel-container :global(.text-primary) {
		color: var(--portal-navy, #1e293b);
	}
	.workflow-panel-container :global(.text-secondary) {
		color: var(--portal-slate, #64748b);
	}
	.workflow-panel-container :global(.text-tertiary) {
		color: var(--portal-gray, #94a3b8);
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
		background-color: #e2e8f0;
		color: var(--portal-slate, #64748b);
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
		animation: slideUp 0.15s ease;
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
		transition: transform 0.15s ease;
	}

	@media (max-width: 768px) {
		.command-palette {
			max-height: 90vh;
			border-radius: 12px 12px 0 0;
			margin-top: auto;
		}
	}
</style>
