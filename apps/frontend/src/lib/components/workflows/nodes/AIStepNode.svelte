<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { AIStepNodeData } from '@portal/types/workflows/types';

	type AIStepNode = Node<AIStepNodeData, 'ai-step'>;

	let { id: _id, data, selected }: NodeProps<AIStepNode> = $props();

	const modelLabel = $derived(data.model?.split('.').pop() ?? 'default');
	const truncatedPrompt = $derived(
		data.prompt ? (data.prompt.length > 60 ? data.prompt.slice(0, 57) + '...' : data.prompt) : ''
	);
</script>

<div class="ai-step-node" class:selected>
	<Handle type="target" position={Position.Top} />

	<div class="node-header">
		<svg
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			width="14"
			height="14"
			class="ai-icon"
		>
			<circle cx="8" cy="8" r="6" />
			<path d="M5 8.5L7 10.5L11 6.5" />
		</svg>
		<span class="type-label">AI Step</span>
		<span class="model-badge">{modelLabel}</span>
	</div>

	<div class="node-body">
		{#if data.prompt}
			<p class="prompt-text">{truncatedPrompt}</p>
		{:else}
			<p class="prompt-placeholder">No prompt configured</p>
		{/if}
	</div>

	{#if data.temperature !== undefined || data.maxTokens}
		<div class="node-params">
			{#if data.temperature !== undefined}
				<span class="param">temp: {data.temperature}</span>
			{/if}
			{#if data.maxTokens}
				<span class="param">max: {data.maxTokens}</span>
			{/if}
		</div>
	{/if}

	<Handle type="source" position={Position.Bottom} />
</div>

<style>
	.ai-step-node {
		background: var(--bg-elevated);
		border: 2px solid var(--brand-purple, #a855f7);
		border-radius: 8px;
		min-width: 180px;
		max-width: 240px;
		font-family: inherit;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.ai-step-node.selected {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand-purple, #a855f7) 20%, transparent);
	}

	.node-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		background: color-mix(in srgb, var(--brand-purple, #a855f7) 8%, transparent);
		border-bottom: 1px solid var(--border-default);
		border-radius: 6px 6px 0 0;
	}

	.ai-icon {
		color: var(--brand-purple, #a855f7);
		flex-shrink: 0;
	}

	.type-label {
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--brand-purple, #a855f7);
	}

	.model-badge {
		margin-left: auto;
		font-size: 0.5rem;
		font-family: monospace;
		padding: 0.0625rem 0.25rem;
		background: var(--bg-tertiary);
		border-radius: 3px;
		color: var(--fg-secondary);
	}

	.node-body {
		padding: 0.5rem;
	}

	.prompt-text {
		font-size: 0.6875rem;
		color: var(--fg-primary);
		margin: 0;
		word-break: break-word;
		line-height: 1.4;
	}

	.prompt-placeholder {
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
		font-style: italic;
		margin: 0;
	}

	.node-params {
		display: flex;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem 0.375rem;
		border-top: 1px solid var(--border-default);
	}

	.param {
		font-size: 0.5625rem;
		font-family: monospace;
		color: var(--fg-tertiary);
	}
</style>
