<script lang="ts">
	import { getToolState, formatToolName } from '$lib/utils/message-parts.js';
	import { getToolProgressMessage } from '@portal/shared/tools/types';
	import type { ToolCallCardProps } from './types.js';
	import type { ToolProgressEvent } from '@portal/types/tools/types';

	interface Props extends ToolCallCardProps {
		progress?: ToolProgressEvent;
	}

	let { part, hideToolExecution = true, progress }: Props = $props();

	const uiState = $derived(getToolState(part.state));
	const toolName = $derived(formatToolName(part.type));
	const toolResult = $derived(
		part.output as { success?: boolean; data?: unknown; error?: string } | undefined
	);
	const isComplete = $derived(toolResult !== undefined);

	// Progress message: prefer server-sent progress, fall back to derived
	const progressMessage = $derived(
		progress?.message ?? getToolProgressMessage(toolName, isComplete ? 'completed' : 'executing')
	);

	// Elapsed time in seconds (from progress event or estimate)
	const elapsedMs = $derived.by(() => {
		if (!progress?.startedAt) return undefined;
		if (progress.completedAt) return progress.completedAt - progress.startedAt;
		return undefined;
	});

	/** Only render when: tool execution is shown, tool failed, or tool is still running */
	const shouldRender = $derived(
		!hideToolExecution || (toolResult && !toolResult.success) || !isComplete
	);
</script>

{#if shouldRender}
	<div class="tool-card" data-state={uiState}>
		<div class="tool-header">
			<span class="tool-name">{toolName}</span>
			<span class="tool-status">
				{#if isComplete}
					{#if toolResult?.success === false}
						<span class="status-dot error"></span>
						Failed
					{:else}
						<span class="status-dot completed"></span>
						Completed
						{#if elapsedMs !== undefined}
							<span class="elapsed">({(elapsedMs / 1000).toFixed(1)}s)</span>
						{/if}
					{/if}
				{:else if uiState === 'running' || uiState === 'streaming'}
					<span class="status-dot running"></span>
					{progressMessage}
				{:else}
					<span class="status-dot pending"></span>
					Pending
				{/if}
			</span>
		</div>
		{#if uiState === 'completed' && toolResult}
			<div class="tool-result">
				{#if toolResult.success}
					<pre class="result-data">{JSON.stringify(toolResult.data, null, 2).slice(
							0,
							500
						)}{JSON.stringify(toolResult.data).length > 500 ? '...' : ''}</pre>
				{:else}
					<p class="result-error">{toolResult.error || 'Unknown error'}</p>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.tool-card {
		background: var(--bg-tertiary);
		border-radius: var(--radius-md);
		padding: var(--space-sm) var(--space-md);
		margin-bottom: var(--space-sm);
		border-left: 3px solid var(--accent-primary);
	}

	.tool-card[data-state='call'] {
		border-left-color: var(--semantic-warning);
	}

	.tool-card[data-state='result'] {
		border-left-color: var(--semantic-success);
	}

	.tool-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-xs);
	}

	.tool-name {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--fg-primary);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
	}

	.tool-status {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
	}

	.status-dot.running {
		background: var(--agent-executing);
		animation: blink 1s infinite;
	}

	.status-dot.completed {
		background: var(--semantic-success);
	}

	.status-dot.pending {
		background: var(--fg-disabled);
	}

	.status-dot.error {
		background: var(--semantic-error);
	}

	@keyframes blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	.tool-result {
		margin-top: var(--space-xs);
	}

	.result-data {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: var(--text-xs);
		background: var(--bg-secondary);
		padding: var(--space-sm);
		border-radius: var(--radius-sm);
		overflow-x: auto;
		max-height: 200px;
		overflow-y: auto;
		color: var(--fg-secondary);
	}

	.result-error {
		font-size: var(--text-xs);
		color: var(--semantic-error);
	}

	.elapsed {
		font-size: 0.6875rem;
		color: var(--fg-disabled);
		margin-left: 2px;
	}
</style>
