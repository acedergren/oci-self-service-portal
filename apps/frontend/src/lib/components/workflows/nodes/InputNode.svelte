<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { InputNodeData } from '@portal/shared/workflows/types.js';

	type InputNode = Node<InputNodeData, 'input'>;

	let { id, data, selected }: NodeProps<InputNode> = $props();
</script>

<div class="input-node" class:selected>
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
			class="input-icon"
		>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="17 8 12 3 7 8" />
			<line x1="12" y1="3" x2="12" y2="15" />
		</svg>
		<span class="header-label">Input</span>
	</div>

	<div class="node-body">
		{#if data.fields && data.fields.length > 0}
			{#each data.fields.slice(0, 4) as field (field.name)}
				<div class="field-row">
					<span class="field-name">{field.name}</span>
					<span class="field-type">{field.type}</span>
					{#if field.required}
						<span class="required-badge">req</span>
					{/if}
				</div>
			{/each}
			{#if data.fields.length > 4}
				<span class="more-fields">+{data.fields.length - 4} more</span>
			{/if}
		{:else}
			<p class="no-fields">No fields defined</p>
		{/if}
	</div>

	<Handle type="source" position={Position.Bottom} />
</div>

<style>
	.input-node {
		background: var(--bg-elevated);
		border: 2px solid var(--semantic-success);
		border-radius: 8px;
		min-width: 150px;
		max-width: 200px;
		font-family: inherit;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.input-node.selected {
		box-shadow: 0 0 0 2px rgba(0, 200, 0, 0.2);
	}

	.node-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		background: rgba(0, 200, 0, 0.08);
		border-bottom: 1px solid var(--border-default);
		border-radius: 6px 6px 0 0;
	}

	.input-icon {
		color: var(--semantic-success);
		flex-shrink: 0;
	}

	.header-label {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--semantic-success);
	}

	.node-body {
		padding: 0.375rem 0.5rem;
	}

	.field-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0;
	}

	.field-name {
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--fg-primary);
		font-family: monospace;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.field-type {
		font-size: 0.5625rem;
		color: var(--fg-tertiary);
		padding: 0 0.25rem;
		background: var(--bg-tertiary);
		border-radius: 3px;
		flex-shrink: 0;
	}

	.required-badge {
		font-size: 0.5rem;
		font-weight: 600;
		color: var(--semantic-error);
		text-transform: uppercase;
		flex-shrink: 0;
	}

	.more-fields {
		font-size: 0.5625rem;
		color: var(--fg-tertiary);
		display: block;
		padding-top: 0.125rem;
	}

	.no-fields {
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
		font-style: italic;
		margin: 0;
	}
</style>
