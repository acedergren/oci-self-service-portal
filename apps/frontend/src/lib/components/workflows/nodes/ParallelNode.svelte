<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { ParallelNodeData } from '@portal/types/workflows/types';

	type ParallelNode = Node<ParallelNodeData, 'parallel'>;

	let { id, data, selected }: NodeProps<ParallelNode> = $props();

	const branchCount = $derived(data.branchNodeIds?.length ?? 0);
	const strategy = $derived(data.mergeStrategy ?? 'all');
	const errorMode = $derived(data.errorHandling ?? 'fail-fast');
</script>

<div class="parallel-node" class:selected>
	<Handle type="target" position={Position.Top} />

	<div class="node-header">
		<svg
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			width="14"
			height="14"
			class="parallel-icon"
		>
			<path d="M2 4H14" />
			<path d="M2 8H14" />
			<path d="M2 12H14" />
		</svg>
		<span class="type-label">Parallel</span>
		<span class="branch-count">{branchCount} branches</span>
	</div>

	<div class="node-body">
		<div class="config-row">
			<span class="config-key">merge:</span>
			<span class="config-val">{strategy}</span>
		</div>
		<div class="config-row">
			<span class="config-key">errors:</span>
			<span class="config-val">{errorMode}</span>
		</div>
		{#if data.timeoutMs}
			<div class="config-row">
				<span class="config-key">timeout:</span>
				<span class="config-val">{Math.round(data.timeoutMs / 1000)}s</span>
			</div>
		{/if}
	</div>

	<Handle type="source" position={Position.Bottom} />
</div>

<style>
	.parallel-node {
		background: var(--bg-elevated);
		border: 2px solid var(--semantic-warning);
		border-radius: 8px;
		min-width: 170px;
		max-width: 220px;
		font-family: inherit;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.parallel-node.selected {
		box-shadow: 0 0 0 2px rgba(255, 180, 0, 0.2);
	}

	.node-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		background: rgba(255, 180, 0, 0.08);
		border-bottom: 1px solid var(--border-default);
		border-radius: 6px 6px 0 0;
	}

	.parallel-icon {
		color: var(--semantic-warning);
		flex-shrink: 0;
	}

	.type-label {
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--semantic-warning);
	}

	.branch-count {
		margin-left: auto;
		font-size: 0.5rem;
		font-family: monospace;
		padding: 0.0625rem 0.25rem;
		background: var(--bg-tertiary);
		border-radius: 3px;
		color: var(--fg-secondary);
	}

	.node-body {
		padding: 0.375rem 0.5rem;
	}

	.config-row {
		display: flex;
		gap: 0.25rem;
		font-size: 0.5625rem;
		padding: 0.125rem 0;
	}

	.config-key {
		color: var(--fg-tertiary);
		font-family: monospace;
		flex-shrink: 0;
	}

	.config-val {
		color: var(--fg-secondary);
		font-family: monospace;
	}
</style>
