<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { LoopNodeData } from '@portal/types/workflows/types';

	type LoopNode = Node<LoopNodeData, 'loop'>;

	let { id: _id, data, selected }: NodeProps<LoopNode> = $props();

	const mode = $derived(data.executionMode ?? 'sequential');
	const iterVar = $derived(data.iterationVariable ?? 'item');
	const truncatedExpr = $derived(
		data.iteratorExpression
			? data.iteratorExpression.length > 40
				? data.iteratorExpression.slice(0, 37) + '...'
				: data.iteratorExpression
			: ''
	);
</script>

<div class="loop-node" class:selected>
	<Handle type="target" position={Position.Top} />

	<div class="node-header">
		<svg
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			width="14"
			height="14"
			class="loop-icon"
		>
			<path d="M12 4A6 6 0 1 1 4 4" />
			<path d="M12 4L14 2M12 4L14 6" />
		</svg>
		<span class="type-label">Loop</span>
		<span class="mode-badge">{mode}</span>
	</div>

	<div class="node-body">
		{#if data.iteratorExpression}
			<div class="iterator-row">
				<span class="iter-label">for</span>
				<span class="iter-var">{iterVar}</span>
				<span class="iter-label">in</span>
			</div>
			<p class="expression-text">{truncatedExpr}</p>
		{:else}
			<p class="expression-placeholder">No iterator configured</p>
		{/if}
	</div>

	<div class="node-footer">
		{#if data.maxIterations}
			<span class="limit">max: {data.maxIterations}</span>
		{/if}
		{#if data.breakCondition}
			<span class="limit">break: set</span>
		{/if}
	</div>

	<Handle type="source" position={Position.Bottom} />
</div>

<style>
	.loop-node {
		background: var(--bg-elevated);
		border: 2px solid var(--semantic-accent, #06b6d4);
		border-radius: 8px;
		min-width: 170px;
		max-width: 230px;
		font-family: inherit;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.loop-node.selected {
		box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.2);
	}

	.node-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		background: rgba(6, 182, 212, 0.08);
		border-bottom: 1px solid var(--border-default);
		border-radius: 6px 6px 0 0;
	}

	.loop-icon {
		color: var(--semantic-accent, #06b6d4);
		flex-shrink: 0;
	}

	.type-label {
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--semantic-accent, #06b6d4);
	}

	.mode-badge {
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

	.iterator-row {
		display: flex;
		gap: 0.25rem;
		align-items: center;
		margin-bottom: 0.25rem;
	}

	.iter-label {
		font-size: 0.5625rem;
		color: var(--fg-tertiary);
		font-family: monospace;
	}

	.iter-var {
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--semantic-accent, #06b6d4);
		font-family: monospace;
	}

	.expression-text {
		font-size: 0.6875rem;
		font-family: monospace;
		color: var(--fg-primary);
		padding: 0.25rem 0.375rem;
		background: var(--bg-tertiary);
		border-radius: 4px;
		word-break: break-all;
		margin: 0;
	}

	.expression-placeholder {
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
		font-style: italic;
		margin: 0;
	}

	.node-footer {
		display: flex;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem 0.375rem;
		border-top: 1px solid var(--border-default);
	}

	.limit {
		font-size: 0.5625rem;
		font-family: monospace;
		color: var(--fg-tertiary);
	}
</style>
