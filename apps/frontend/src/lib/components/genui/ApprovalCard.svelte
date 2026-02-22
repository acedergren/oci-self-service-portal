<script lang="ts">
	export interface ApprovalRequest {
		id: string;
		workflowName: string;
		stepName: string;
		description: string;
		requestedBy?: string;
		requestedAt?: string;
		context?: Record<string, unknown>;
	}

	interface Props {
		request: ApprovalRequest;
		onApprove?: (id: string) => void;
		onDeny?: (id: string, reason?: string) => void;
	}

	let { request, onApprove, onDeny }: Props = $props();

	let status = $state<'pending' | 'approved' | 'denied'>('pending');
	let denyReason = $state('');
	let showDenyForm = $state(false);

	function handleApprove(): void {
		status = 'approved';
		onApprove?.(request.id);
	}

	function handleDeny(): void {
		if (!showDenyForm) {
			showDenyForm = true;
			return;
		}
		status = 'denied';
		onDeny?.(request.id, denyReason || undefined);
	}

	function formatTime(dateStr?: string): string {
		if (!dateStr) return '';
		return new Date(dateStr).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div
	class="approval-card"
	class:approved={status === 'approved'}
	class:denied={status === 'denied'}
>
	<div class="card-header">
		<div class="header-icon">
			{#if status === 'approved'}
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M20 6L9 17l-5-5" />
				</svg>
			{:else if status === 'denied'}
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M18 6L6 18M6 6l12 12" />
				</svg>
			{:else}
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<circle cx="12" cy="12" r="10" />
					<path d="M12 8v4M12 16h.01" />
				</svg>
			{/if}
		</div>
		<div class="header-text">
			<span class="card-label">Approval Required</span>
			<span class="workflow-name">{request.workflowName}</span>
		</div>
		{#if status !== 'pending'}
			<span class="status-badge {status}">
				{status === 'approved' ? 'Approved' : 'Denied'}
			</span>
		{/if}
	</div>

	<div class="card-body">
		<div class="step-name">{request.stepName}</div>
		<p class="description">{request.description}</p>

		{#if request.context && Object.keys(request.context).length > 0}
			<details class="context-details">
				<summary>Context</summary>
				<pre class="context-block">{JSON.stringify(request.context, null, 2)}</pre>
			</details>
		{/if}

		<div class="card-meta">
			{#if request.requestedBy}
				<span class="meta-item">By: {request.requestedBy}</span>
			{/if}
			{#if request.requestedAt}
				<span class="meta-item">{formatTime(request.requestedAt)}</span>
			{/if}
		</div>
	</div>

	{#if status === 'pending'}
		<div class="card-actions">
			{#if showDenyForm}
				<div class="deny-form">
					<input
						type="text"
						bind:value={denyReason}
						placeholder="Reason for denial (optional)"
						class="deny-input"
					/>
				</div>
			{/if}
			<div class="action-buttons">
				<button class="btn btn-deny" onclick={handleDeny}>
					{showDenyForm ? 'Confirm Deny' : 'Deny'}
				</button>
				<button class="btn btn-approve" onclick={handleApprove}> Approve </button>
			</div>
		</div>
	{/if}
</div>

<style>
	.approval-card {
		background: var(--portal-white, #ffffff);
		border: 1px solid var(--portal-border, #e2e8f0);
		border-radius: 8px;
		overflow: hidden;
		border-left: 3px solid var(--portal-warning, #f59e0b);
	}

	.approval-card.approved {
		border-left-color: var(--portal-success, #10b981);
		opacity: 0.85;
	}

	.approval-card.denied {
		border-left-color: var(--portal-error, #ef4444);
		opacity: 0.85;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--portal-border-light, #f1f5f9);
	}

	.header-icon {
		flex-shrink: 0;
		color: var(--portal-warning, #f59e0b);
	}

	.approved .header-icon {
		color: var(--portal-success, #10b981);
	}

	.denied .header-icon {
		color: var(--portal-error, #ef4444);
	}

	.header-text {
		flex: 1;
		display: flex;
		flex-direction: column;
	}

	.card-label {
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--portal-warning-dark, #d97706);
		font-weight: 600;
	}

	.approved .card-label {
		color: var(--portal-success, #059669);
	}

	.denied .card-label {
		color: var(--portal-error, #dc2626);
	}

	.workflow-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--portal-navy, #1e293b);
	}

	.status-badge {
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 500;
	}

	.status-badge.approved {
		background: var(--portal-success-bg, #ecfdf5);
		color: var(--portal-success, #059669);
	}

	.status-badge.denied {
		background: var(--portal-error-bg, #fef2f2);
		color: var(--portal-error, #dc2626);
	}

	.card-body {
		padding: 0.75rem 1rem;
	}

	.step-name {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--portal-navy, #1e293b);
		margin-bottom: 0.25rem;
	}

	.description {
		font-size: 0.8125rem;
		color: var(--portal-slate, #64748b);
		margin: 0 0 0.5rem;
		line-height: 1.5;
	}

	.context-details {
		margin-bottom: 0.5rem;
	}

	.context-details summary {
		font-size: 0.6875rem;
		color: var(--portal-slate, #64748b);
		cursor: pointer;
		user-select: none;
	}

	.context-block {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		background: var(--portal-light, #f8fafc);
		padding: 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--portal-border, #e2e8f0);
		margin-top: 0.25rem;
		max-height: 150px;
		overflow-y: auto;
	}

	.card-meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.6875rem;
		color: var(--portal-slate, #94a3b8);
	}

	.card-actions {
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--portal-border-light, #f1f5f9);
		background: var(--portal-light, #f8fafc);
	}

	.deny-form {
		margin-bottom: 0.5rem;
	}

	.deny-input {
		width: 100%;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--portal-border, #e2e8f0);
		border-radius: 6px;
		font-size: 0.8125rem;
		background: var(--portal-white, #ffffff);
		outline: none;
	}

	.deny-input:focus {
		border-color: var(--portal-error, #ef4444);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--semantic-error) 10%, transparent);
	}

	.action-buttons {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.btn {
		padding: 0.375rem 1rem;
		border-radius: 6px;
		font-size: 0.8125rem;
		font-weight: 500;
		border: 1px solid transparent;
		cursor: pointer;
	}

	.btn-approve {
		background: var(--portal-teal, #0d9488);
		color: white;
	}

	.btn-approve:hover {
		background: var(--portal-teal-dark, #0f766e);
	}

	.btn-deny {
		background: transparent;
		color: var(--portal-error, #ef4444);
		border-color: var(--portal-error, #ef4444);
	}

	.btn-deny:hover {
		background: var(--portal-error-bg, #fef2f2);
	}
</style>
