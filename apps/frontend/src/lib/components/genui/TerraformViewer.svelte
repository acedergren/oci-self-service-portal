<script lang="ts">
	export type ChangeAction = 'create' | 'update' | 'delete' | 'no-op' | 'read';

	export interface TerraformResourceChange {
		address: string;
		type: string;
		name: string;
		action: ChangeAction;
		before?: Record<string, unknown>;
		after?: Record<string, unknown>;
	}

	interface Props {
		changes: TerraformResourceChange[];
		title?: string;
	}

	let { changes, title = 'Terraform Plan' }: Props = $props();

	let expandedSet = $state(new Set<string>());

	function toggleExpanded(address: string): void {
		const next = new Set(expandedSet);
		if (next.has(address)) {
			next.delete(address);
		} else {
			next.add(address);
		}
		expandedSet = next;
	}

	function actionSymbol(action: ChangeAction): string {
		switch (action) {
			case 'create':
				return '+';
			case 'delete':
				return '-';
			case 'update':
				return '~';
			case 'read':
				return '<';
			default:
				return ' ';
		}
	}

	function actionClass(action: ChangeAction): string {
		switch (action) {
			case 'create':
				return 'action-create';
			case 'delete':
				return 'action-delete';
			case 'update':
				return 'action-update';
			case 'read':
				return 'action-read';
			default:
				return 'action-noop';
		}
	}

	const summary = $derived({
		create: changes.filter((c) => c.action === 'create').length,
		update: changes.filter((c) => c.action === 'update').length,
		destroy: changes.filter((c) => c.action === 'delete').length,
		unchanged: changes.filter((c) => c.action === 'no-op').length
	});
</script>

<div class="terraform-viewer">
	<div class="viewer-header">
		<h3 class="viewer-title">{title}</h3>
		<div class="plan-summary">
			{#if summary.create > 0}
				<span class="summary-badge action-create">+{summary.create}</span>
			{/if}
			{#if summary.update > 0}
				<span class="summary-badge action-update">~{summary.update}</span>
			{/if}
			{#if summary.destroy > 0}
				<span class="summary-badge action-delete">-{summary.destroy}</span>
			{/if}
		</div>
	</div>

	{#if changes.length === 0}
		<p class="empty-message">No changes. Infrastructure is up-to-date.</p>
	{:else}
		<ul class="change-list">
			{#each changes as change (change.address)}
				<li class="change-item {actionClass(change.action)}">
					<button class="change-header" onclick={() => toggleExpanded(change.address)}>
						<span class="change-symbol">{actionSymbol(change.action)}</span>
						<span class="change-type">{change.type}</span>
						<span class="change-name">{change.name}</span>
						<span class="expand-icon">{expandedSet.has(change.address) ? '▾' : '▸'}</span>
					</button>
					{#if expandedSet.has(change.address)}
						<div class="change-details">
							<div class="change-address">
								<span class="detail-label">Address:</span>
								<code>{change.address}</code>
							</div>
							{#if change.after && Object.keys(change.after).length > 0}
								<div class="change-attrs">
									<span class="detail-label">Attributes:</span>
									<pre class="attr-block">{JSON.stringify(change.after, null, 2)}</pre>
								</div>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.terraform-viewer {
		background: var(--portal-white, #ffffff);
		border: 1px solid var(--portal-border, #e2e8f0);
		border-radius: 8px;
		overflow: hidden;
		font-family: 'JetBrains Mono', monospace;
	}

	.viewer-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--portal-border, #e2e8f0);
	}

	.viewer-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--portal-navy, #1e293b);
		margin: 0;
		font-family: system-ui, sans-serif;
	}

	.plan-summary {
		display: flex;
		gap: 0.375rem;
	}

	.summary-badge {
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 600;
	}

	.empty-message {
		padding: 2rem;
		text-align: center;
		color: var(--portal-slate, #64748b);
		font-size: 0.875rem;
		font-family: system-ui, sans-serif;
	}

	.change-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.change-item {
		border-bottom: 1px solid var(--portal-border-light, #f1f5f9);
		border-left: 3px solid transparent;
	}

	.change-item:last-child {
		border-bottom: none;
	}

	.change-item.action-create {
		border-left-color: var(--portal-success, #10b981);
	}
	.change-item.action-delete {
		border-left-color: var(--portal-error, #ef4444);
	}
	.change-item.action-update {
		border-left-color: var(--portal-warning, #f59e0b);
	}
	.change-item.action-read {
		border-left-color: var(--portal-info, #3b82f6);
	}
	.change-item.action-noop {
		border-left-color: var(--portal-gray, #94a3b8);
	}

	.summary-badge.action-create {
		background: var(--portal-success-bg, #ecfdf5);
		color: var(--portal-success, #059669);
	}
	.summary-badge.action-delete {
		background: var(--portal-error-bg, #fef2f2);
		color: var(--portal-error, #dc2626);
	}
	.summary-badge.action-update {
		background: var(--portal-warning-bg, #fffbeb);
		color: var(--portal-warning-dark, #d97706);
	}

	.change-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		width: 100%;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
	}

	.change-header:hover {
		background: var(--portal-hover, #f8fafc);
	}

	.change-symbol {
		font-weight: 700;
		width: 1rem;
		text-align: center;
	}

	.action-create .change-symbol {
		color: var(--portal-success, #10b981);
	}
	.action-delete .change-symbol {
		color: var(--portal-error, #ef4444);
	}
	.action-update .change-symbol {
		color: var(--portal-warning, #f59e0b);
	}

	.change-type {
		color: var(--portal-slate, #64748b);
	}

	.change-name {
		color: var(--portal-navy, #1e293b);
		font-weight: 500;
	}

	.expand-icon {
		margin-left: auto;
		color: var(--portal-slate, #94a3b8);
		font-size: 0.75rem;
	}

	.change-details {
		padding: 0.5rem 1rem 0.75rem 2.5rem;
		background: var(--portal-light, #f8fafc);
		border-top: 1px solid var(--portal-border-light, #f1f5f9);
	}

	.detail-label {
		font-size: 0.6875rem;
		color: var(--portal-slate, #64748b);
		font-family: system-ui, sans-serif;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.change-address {
		margin-bottom: 0.5rem;
	}

	.change-address code {
		font-size: 0.75rem;
		color: var(--portal-navy, #334155);
		margin-left: 0.5rem;
	}

	.attr-block {
		font-size: 0.6875rem;
		color: var(--portal-navy-light, #334155);
		background: var(--portal-white, #ffffff);
		padding: 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--portal-border, #e2e8f0);
		margin-top: 0.25rem;
		max-height: 200px;
		overflow-y: auto;
	}
</style>
