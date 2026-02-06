<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { OutputNodeData } from '@portal/shared/workflows/types.js';

	type OutputNode = Node<OutputNodeData, 'output'>;

	let { id, data, selected }: NodeProps<OutputNode> = $props();
</script>

<div class="output-node" class:selected>
	<Handle type="target" position={Position.Top} />

	<div class="node-header">
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			width="14"
			height="14"
			class="output-icon"
		>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="7 10 12 15 17 10" />
			<line x1="12" y1="15" x2="12" y2="3" />
		</svg>
		<span class="header-label">Output</span>
	</div>

	<div class="node-body">
		{#if data.outputMapping && Object.keys(data.outputMapping).length > 0}
			{#each Object.entries(data.outputMapping).slice(0, 3) as [key, expr] (key)}
				<div class="mapping-row">
					<span class="mapping-key">{key}</span>
					<span class="mapping-arrow">&larr;</span>
					<span class="mapping-expr">{expr}</span>
				</div>
			{/each}
			{#if Object.keys(data.outputMapping).length > 3}
				<span class="more-mappings">+{Object.keys(data.outputMapping).length - 3} more</span>
			{/if}
		{:else}
			<p class="no-mappings">No output mapping set</p>
		{/if}
	</div>
</div>

<style>
	.output-node {
		background: var(--bg-elevated);
		border: 2px solid var(--semantic-info);
		border-radius: 8px;
		min-width: 150px;
		max-width: 220px;
		font-family: inherit;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.output-node.selected {
		box-shadow: 0 0 0 2px rgba(0, 100, 255, 0.2);
	}

	.node-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		background: rgba(0, 100, 255, 0.08);
		border-bottom: 1px solid var(--border-default);
		border-radius: 6px 6px 0 0;
	}

	.output-icon {
		color: var(--semantic-info);
		flex-shrink: 0;
	}

	.header-label {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--semantic-info);
	}

	.node-body {
		padding: 0.375rem 0.5rem;
	}

	.mapping-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0;
		font-size: 0.6875rem;
		font-family: monospace;
	}

	.mapping-key {
		color: var(--fg-primary);
		font-weight: 500;
		flex-shrink: 0;
	}

	.mapping-arrow {
		color: var(--fg-tertiary);
		flex-shrink: 0;
	}

	.mapping-expr {
		color: var(--accent-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.more-mappings {
		font-size: 0.5625rem;
		color: var(--fg-tertiary);
		display: block;
		padding-top: 0.125rem;
	}

	.no-mappings {
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
		font-style: italic;
		margin: 0;
	}
</style>
