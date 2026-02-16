<script lang="ts">
	import type { PendingApproval } from '@portal/types/tools/types';

	interface Props {
		approval: PendingApproval;
		onApprove: () => void;
		onReject: () => void;
	}

	let { approval, onApprove, onReject }: Props = $props();

	// Keyboard shortcuts: Y to approve, N/Escape to reject
	$effect(() => {
		function handleKeydown(e: KeyboardEvent) {
			if (e.key === 'y' || e.key === 'Y') {
				e.preventDefault();
				onApprove();
			} else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') {
				e.preventDefault();
				onReject();
			}
		}
		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});

	// Format the args for display (hide sensitive values, truncate OCIDs)
	function formatArgs(args: Record<string, unknown>): Array<{ key: string; value: string }> {
		return Object.entries(args).map(([key, value]) => {
			let displayValue: string;

			if (typeof value === 'string' && value.startsWith('ocid1.')) {
				// Truncate OCIDs for readability
				displayValue = value.substring(0, 35) + '...';
			} else if (typeof value === 'object') {
				displayValue = JSON.stringify(value);
			} else {
				displayValue = String(value);
			}

			return { key, value: displayValue };
		});
	}

	const formattedArgs = $derived(formatArgs(approval.args));
	const isDanger = $derived(approval.approvalLevel === 'danger');
</script>

<div class="approval-overlay">
	<div
		class="approval-dialog"
		role="alertdialog"
		aria-modal="true"
		aria-labelledby="approval-title"
		aria-describedby="approval-desc"
	>
		<!-- Header -->
		<div class="approval-header" class:danger={isDanger}>
			<div class="approval-icon">
				{#if isDanger}
					<svg viewBox="0 0 24 24" fill="currentColor" class="icon-danger">
						<path
							d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
						/>
					</svg>
				{:else}
					<svg viewBox="0 0 24 24" fill="currentColor" class="icon-confirm">
						<path
							d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
						/>
					</svg>
				{/if}
			</div>
			<div class="approval-title-group">
				<h2 id="approval-title" class="approval-title">
					{isDanger ? 'Destructive Operation' : 'Confirm Operation'}
				</h2>
				<span class="approval-badge" class:danger={isDanger} class:confirm={!isDanger}>
					{approval.category}
				</span>
			</div>
		</div>

		<!-- Content -->
		<div class="approval-content">
			<p id="approval-desc" class="approval-description">
				{approval.description}
			</p>

			{#if approval.warningMessage}
				<div class="approval-warning">
					<svg viewBox="0 0 24 24" fill="currentColor" class="warning-icon">
						<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
					</svg>
					<div>
						<strong>Warning:</strong>
						{approval.warningMessage}
						{#if approval.estimatedImpact}
							<p class="impact-text">{approval.estimatedImpact}</p>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Tool details -->
			<div class="tool-details">
				<div class="tool-name">
					<span class="label">Tool:</span>
					<code>{approval.toolName}</code>
				</div>

				<div class="tool-args">
					<span class="label">Parameters:</span>
					<div class="args-list">
						{#each formattedArgs as { key, value } (key)}
							<div class="arg-item">
								<span class="arg-key">{key}:</span>
								<code class="arg-value">{value}</code>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<!-- Actions -->
		<div class="approval-actions">
			<button class="btn btn-cancel" onclick={onReject}>
				Cancel
				<kbd>N</kbd>
			</button>
			<button class="btn btn-approve" class:danger={isDanger} onclick={onApprove}>
				{isDanger ? 'Yes, proceed' : 'Approve'}
				<kbd>Y</kbd>
			</button>
		</div>

		<!-- Audit notice -->
		<div class="audit-notice">
			<svg viewBox="0 0 24 24" fill="currentColor" class="audit-icon">
				<path
					d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"
				/>
			</svg>
			<span>This action will be logged to the audit trail</span>
		</div>
	</div>
</div>

<style>
	.approval-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(4px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		animation: fadeIn 0.15s ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.approval-dialog {
		width: 100%;
		max-width: 520px;
		background: var(--bg-secondary, #1a1a2e);
		border: 1px solid var(--border-default, #2d2d44);
		border-radius: 12px;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
		animation: slideUp 0.2s ease;
		overflow: hidden;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(20px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.approval-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border-muted, #2d2d44);
		background: var(--bg-elevated, #252540);
	}

	.approval-header.danger {
		background: rgba(239, 68, 68, 0.1);
		border-bottom-color: rgba(239, 68, 68, 0.2);
	}

	.approval-icon {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-primary, #0f0f1a);
	}

	.approval-header.danger .approval-icon {
		background: rgba(239, 68, 68, 0.15);
	}

	.icon-danger {
		width: 24px;
		height: 24px;
		color: #ef4444;
	}

	.icon-confirm {
		width: 24px;
		height: 24px;
		color: #10b981;
	}

	.approval-title-group {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.approval-title {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-primary, #fff);
		margin: 0;
	}

	.approval-badge {
		padding: 0.25rem 0.5rem;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		border-radius: 4px;
		letter-spacing: 0.5px;
	}

	.approval-badge.danger {
		background: rgba(239, 68, 68, 0.2);
		color: #f87171;
	}

	.approval-badge.confirm {
		background: rgba(16, 185, 129, 0.2);
		color: #34d399;
	}

	.approval-content {
		padding: 1.5rem;
	}

	.approval-description {
		color: var(--text-secondary, #a0a0b0);
		margin: 0 0 1rem 0;
		line-height: 1.5;
	}

	.approval-warning {
		display: flex;
		gap: 0.75rem;
		padding: 1rem;
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.2);
		border-radius: 8px;
		margin-bottom: 1rem;
		color: #fbbf24;
	}

	.warning-icon {
		flex-shrink: 0;
		width: 20px;
		height: 20px;
	}

	.impact-text {
		margin: 0.5rem 0 0 0;
		font-size: 0.875rem;
		color: #fcd34d;
	}

	.tool-details {
		background: var(--bg-primary, #0f0f1a);
		border-radius: 8px;
		padding: 1rem;
		font-size: 0.875rem;
	}

	.tool-name {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border-muted, #2d2d44);
	}

	.label {
		color: var(--text-tertiary, #6b6b80);
		font-weight: 500;
	}

	.tool-name code {
		font-family: 'JetBrains Mono', monospace;
		color: #60a5fa;
		background: rgba(96, 165, 250, 0.1);
		padding: 0.2rem 0.4rem;
		border-radius: 4px;
	}

	.tool-args {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.args-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-top: 0.5rem;
	}

	.arg-item {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.arg-key {
		color: var(--text-tertiary, #6b6b80);
		min-width: 120px;
	}

	.arg-value {
		font-family: 'JetBrains Mono', monospace;
		color: var(--text-secondary, #a0a0b0);
		background: var(--bg-secondary, #1a1a2e);
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		font-size: 0.8rem;
		word-break: break-all;
	}

	.approval-actions {
		display: flex;
		gap: 0.75rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--border-muted, #2d2d44);
		background: var(--bg-elevated, #252540);
	}

	.btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		font-size: 0.9rem;
		font-weight: 500;
		border-radius: 8px;
		border: none;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn kbd {
		font-family: inherit;
		font-size: 0.7rem;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.2);
		color: inherit;
		opacity: 0.7;
	}

	.btn-cancel {
		background: var(--bg-primary, #0f0f1a);
		color: var(--text-secondary, #a0a0b0);
		border: 1px solid var(--border-default, #2d2d44);
	}

	.btn-cancel:hover {
		background: var(--bg-secondary, #1a1a2e);
		color: var(--text-primary, #fff);
	}

	.btn-approve {
		background: #10b981;
		color: white;
	}

	.btn-approve:hover {
		background: #059669;
	}

	.btn-approve.danger {
		background: #ef4444;
	}

	.btn-approve.danger:hover {
		background: #dc2626;
	}

	.audit-notice {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--bg-primary, #0f0f1a);
		border-top: 1px solid var(--border-muted, #2d2d44);
		font-size: 0.75rem;
		color: var(--text-tertiary, #6b6b80);
	}

	.audit-icon {
		width: 14px;
		height: 14px;
		opacity: 0.7;
	}
</style>
