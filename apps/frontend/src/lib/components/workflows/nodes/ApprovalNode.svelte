<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { ApprovalNodeData } from '@portal/types/workflows/types';

	type ApprovalNode = Node<ApprovalNodeData, 'approval'>;

	let { id, data, selected }: NodeProps<ApprovalNode> = $props();
</script>

<div class="approval-node" class:selected>
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
			class="shield-icon"
		>
			<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
		</svg>
		<span class="header-label">Approval Gate</span>
	</div>

	<div class="node-body">
		{#if data.message}
			<p class="approval-message">{data.message}</p>
		{:else}
			<p class="approval-placeholder">Set approval message...</p>
		{/if}

		<div class="approval-meta">
			{#if data.approvers && data.approvers.length > 0}
				<span class="meta-item">
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						width="10"
						height="10"
					>
						<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
						<circle cx="9" cy="7" r="4" />
					</svg>
					{data.approvers.length} approver{data.approvers.length === 1 ? '' : 's'}
				</span>
			{/if}
			{#if data.timeoutMinutes}
				<span class="meta-item">
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						width="10"
						height="10"
					>
						<circle cx="12" cy="12" r="10" />
						<path d="M12 6v6l4 2" />
					</svg>
					{data.timeoutMinutes}m timeout
				</span>
			{/if}
		</div>
	</div>

	<Handle type="source" position={Position.Bottom} />
</div>

<style>
	.approval-node {
		background: var(--bg-elevated);
		border: 2px solid var(--semantic-warning);
		border-radius: 8px;
		min-width: 160px;
		max-width: 220px;
		font-family: inherit;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.approval-node.selected {
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

	.shield-icon {
		color: var(--semantic-warning);
		flex-shrink: 0;
	}

	.header-label {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--semantic-warning);
	}

	.node-body {
		padding: 0.5rem;
	}

	.approval-message {
		font-size: 0.6875rem;
		color: var(--fg-primary);
		line-height: 1.4;
		margin: 0 0 0.375rem;
		word-break: break-word;
	}

	.approval-placeholder {
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
		font-style: italic;
		margin: 0 0 0.375rem;
	}

	.approval-meta {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.5625rem;
		color: var(--fg-tertiary);
	}
</style>
