<script lang="ts">
	import type { McpServer } from '@portal/server/admin/mcp-types';
	import { Badge } from '@portal/ui';

	interface Props {
		server: McpServer;
		onConnect: () => void;
		onDisconnect: () => void;
		onRestart: () => void;
		onEdit: () => void;
		onDelete: () => void;
	}

	let { server, onConnect, onDisconnect, onRestart, onEdit, onDelete }: Props = $props();

	const statusVariant = $derived(
		server.status === 'connected'
			? 'success'
			: server.status === 'disconnected'
				? 'default'
				: server.status === 'error'
					? 'error'
					: 'warning'
	);

	const statusLabel = $derived(
		server.status === 'connected'
			? 'Connected'
			: server.status === 'disconnected'
				? 'Disconnected'
				: server.status === 'error'
					? 'Error'
					: 'Connecting'
	);

	const lastConnectedText = $derived(
		server.lastConnectedAt ? new Date(server.lastConnectedAt).toLocaleString() : 'Never'
	);
</script>

<div class="server-card">
	<div class="card-header">
		<div class="card-header-left">
			<h3 class="card-title">{server.displayName}</h3>
			<Badge variant={statusVariant}>
				{#if server.status === 'connecting'}
					<span class="pulse-dot"></span>
				{/if}
				{statusLabel}
			</Badge>
		</div>
		<div class="card-actions">
			{#if server.status === 'connected'}
				<button type="button" class="btn-icon" onclick={onDisconnect} title="Disconnect">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
						<line x1="12" y1="2" x2="12" y2="12" />
					</svg>
				</button>
			{:else if server.status === 'disconnected'}
				<button type="button" class="btn-icon" onclick={onConnect} title="Connect">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path d="M12 2v10" />
						<path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
					</svg>
				</button>
			{/if}
			<button
				type="button"
				class="btn-icon"
				onclick={onRestart}
				title="Restart"
				disabled={server.status === 'connecting'}
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<polyline points="23 4 23 10 17 10" />
					<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
				</svg>
			</button>
			<button type="button" class="btn-icon" onclick={onEdit} title="Edit">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
					<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
				</svg>
			</button>
			<button type="button" class="btn-icon btn-danger" onclick={onDelete} title="Delete">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<polyline points="3 6 5 6 21 6" />
					<path
						d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
					/>
				</svg>
			</button>
		</div>
	</div>

	<div class="card-body">
		{#if server.description}
			<p class="server-description">{server.description}</p>
		{/if}

		<div class="info-grid">
			<div class="info-row">
				<span class="info-label">Server Name:</span>
				<span class="info-value">{server.serverName}</span>
			</div>
			<div class="info-row">
				<span class="info-label">Transport:</span>
				<span class="info-value">{server.transportType.toUpperCase()}</span>
			</div>
			<div class="info-row">
				<span class="info-label">Tools:</span>
				<span class="info-value">{server.toolCount}</span>
			</div>
			<div class="info-row">
				<span class="info-label">Last Connected:</span>
				<span class="info-value">{lastConnectedText}</span>
			</div>
		</div>

		{#if server.lastError}
			<div class="error-message">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<circle cx="12" cy="12" r="10" />
					<line x1="12" y1="8" x2="12" y2="12" />
					<line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
				{server.lastError}
			</div>
		{/if}
	</div>
</div>

<style>
	.server-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		overflow: hidden;
		transition: all var(--transition-fast);
	}

	.server-card:hover {
		border-color: var(--border-focused);
		box-shadow: 0 4px 12px -2px oklch(0 0 0 / 0.1);
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: start;
		padding: var(--space-lg);
		background: var(--bg-elevated);
		border-bottom: 1px solid var(--border-muted);
	}

	.card-header-left {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}

	.card-title {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg-primary);
	}

	.card-actions {
		display: flex;
		gap: var(--space-xs);
	}

	.btn-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--fg-secondary);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-icon:hover:not(:disabled) {
		background: var(--bg-primary);
		border-color: var(--border-focused);
		color: var(--fg-primary);
	}

	.btn-icon:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-icon.btn-danger:hover:not(:disabled) {
		background: var(--semantic-error);
		border-color: var(--semantic-error);
		color: var(--bg-primary);
	}

	.card-body {
		padding: var(--space-lg);
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.server-description {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
		line-height: 1.5;
	}

	.info-grid {
		display: grid;
		gap: var(--space-sm);
	}

	.info-row {
		display: flex;
		justify-content: space-between;
		gap: var(--space-md);
		font-size: var(--text-sm);
	}

	.info-label {
		color: var(--fg-secondary);
		font-weight: 600;
	}

	.info-value {
		color: var(--fg-primary);
		text-align: right;
	}

	.error-message {
		display: flex;
		align-items: start;
		gap: var(--space-sm);
		padding: var(--space-sm);
		background: oklch(from var(--semantic-error) l c h / 0.1);
		border: 1px solid var(--semantic-error);
		border-radius: var(--radius-sm);
		color: var(--semantic-error);
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.pulse-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
		animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
</style>
