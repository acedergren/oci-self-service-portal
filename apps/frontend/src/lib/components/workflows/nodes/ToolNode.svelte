<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { ToolNodeData } from '@portal/types/workflows/types';

	type ToolNode = Node<ToolNodeData, 'tool'>;

	let { id: _id, data, selected }: NodeProps<ToolNode> = $props();

	const approvalColors: Record<string, { bg: string; border: string; text: string }> = {
		auto: {
			bg: 'color-mix(in srgb, var(--semantic-success) 8%, transparent)',
			border: 'var(--semantic-success)',
			text: 'var(--semantic-success)'
		},
		confirm: {
			bg: 'color-mix(in srgb, var(--semantic-warning) 8%, transparent)',
			border: 'var(--semantic-warning)',
			text: 'var(--semantic-warning)'
		},
		danger: {
			bg: 'color-mix(in srgb, var(--semantic-error) 8%, transparent)',
			border: 'var(--semantic-error)',
			text: 'var(--semantic-error)'
		}
	};

	const colors = $derived(approvalColors[data.toolCategory ?? 'auto'] ?? approvalColors.auto);
</script>

<div
	class="tool-node"
	class:selected
	style="--node-border: {colors.border}; --node-bg: {colors.bg}"
>
	<Handle type="target" position={Position.Top} />

	<div class="node-header">
		<span class="category-badge">{data.toolCategory ?? 'tool'}</span>
		<span
			class="approval-dot"
			style="background: {colors.text}"
			title="{data.toolCategory ?? 'auto'} approval"
		></span>
	</div>

	<div class="node-body">
		<h4 class="node-title">{data.toolName}</h4>
	</div>

	{#if data.args && Object.keys(data.args).length > 0}
		<div class="node-params">
			{#each Object.entries(data.args).slice(0, 3) as [key, value] (key)}
				<div class="param-row">
					<span class="param-key">{key}:</span>
					<span class="param-val">{String(value ?? '').substring(0, 20)}</span>
				</div>
			{/each}
			{#if Object.keys(data.args).length > 3}
				<span class="param-more">+{Object.keys(data.args).length - 3} more</span>
			{/if}
		</div>
	{/if}

	<Handle type="source" position={Position.Bottom} />
</div>

<style>
	.tool-node {
		background: var(--bg-elevated);
		border: 2px solid var(--border-default);
		border-radius: 8px;
		min-width: 180px;
		max-width: 240px;
		font-family: inherit;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.tool-node.selected {
		border-color: var(--node-border);
		box-shadow: 0 0 0 2px var(--node-bg);
	}

	.node-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.375rem 0.5rem;
		background: var(--node-bg);
		border-bottom: 1px solid var(--border-default);
		border-radius: 6px 6px 0 0;
	}

	.category-badge {
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-secondary);
	}

	.approval-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.node-body {
		padding: 0.5rem;
	}

	.node-title {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--fg-primary);
		margin: 0;
		word-break: break-word;
	}

	.node-params {
		padding: 0 0.5rem 0.375rem;
		border-top: 1px solid var(--border-default);
		margin-top: 0;
	}

	.param-row {
		display: flex;
		gap: 0.25rem;
		font-size: 0.5625rem;
		padding-top: 0.25rem;
	}

	.param-key {
		color: var(--fg-tertiary);
		font-family: monospace;
		flex-shrink: 0;
	}

	.param-val {
		color: var(--fg-secondary);
		font-family: monospace;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.param-more {
		font-size: 0.5625rem;
		color: var(--fg-tertiary);
		display: block;
		padding-top: 0.125rem;
	}
</style>
