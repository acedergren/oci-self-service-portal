<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { ConditionNodeData } from '@portal/shared/workflows/types.js';

	type ConditionNode = Node<ConditionNodeData, 'condition'>;

	let { id, data, selected }: NodeProps<ConditionNode> = $props();
</script>

<div class="condition-node" class:selected>
	<Handle type="target" position={Position.Top} />

	<div class="diamond-shape">
		<div class="diamond-content">
			<svg
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				width="14"
				height="14"
				class="condition-icon"
			>
				<path d="M8 1L15 8L8 15L1 8Z" />
			</svg>
			<span class="condition-label">Condition</span>
		</div>

		{#if data.expression}
			<p class="expression-text">{data.expression}</p>
		{:else}
			<p class="expression-placeholder">No expression set</p>
		{/if}
	</div>

	<div class="handle-labels">
		<span class="handle-label true-label">True</span>
		<span class="handle-label false-label">False</span>
	</div>

	<Handle type="source" position={Position.Bottom} id="true" style="left: 30%;" />
	<Handle type="source" position={Position.Bottom} id="false" style="left: 70%;" />
</div>

<style>
	.condition-node {
		background: var(--bg-elevated);
		border: 2px solid var(--semantic-info);
		border-radius: 8px;
		min-width: 160px;
		max-width: 220px;
		font-family: inherit;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.condition-node.selected {
		box-shadow: 0 0 0 2px rgba(0, 100, 255, 0.2);
	}

	.diamond-shape {
		padding: 0.5rem;
	}

	.diamond-content {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 0.25rem;
	}

	.condition-icon {
		color: var(--semantic-info);
		flex-shrink: 0;
	}

	.condition-label {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--semantic-info);
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

	.handle-labels {
		display: flex;
		justify-content: space-between;
		padding: 0.25rem 0.75rem 0.375rem;
	}

	.handle-label {
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.true-label {
		color: var(--semantic-success);
	}

	.false-label {
		color: var(--semantic-error);
	}
</style>
