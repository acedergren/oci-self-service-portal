<script lang="ts">
	import type { McpCatalogItem, McpServer } from '@portal/server/admin/mcp-types';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { mcpServerFormSchema } from '$lib/schemas/admin.js';

	interface Props {
		open: boolean;
		mode: 'install' | 'custom' | 'edit';
		catalogItem?: McpCatalogItem | null;
		server?: McpServer | null;
		onClose: () => void;
		onSubmit: (data: Record<string, unknown>) => void;
		isPending?: boolean;
	}

	let {
		open,
		mode,
		catalogItem = null,
		server = null,
		onClose,
		onSubmit,
		isPending = false
	}: Props = $props();

	// Credentials are outside of Zod schema (dynamic per catalog item)
	let credentials = $state<Record<string, string>>({});

	// Parse flat text fields into structured data for API submission
	function parseArgsText(text: string): string[] {
		return text.split('\n').filter((line) => line.trim());
	}

	function parseEnvText(text: string): Record<string, string> {
		const env: Record<string, string> = {};
		text.split('\n').forEach((line) => {
			const [key, ...valueParts] = line.split('=');
			if (key && valueParts.length > 0) {
				env[key.trim()] = valueParts.join('=').trim();
			}
		});
		return env;
	}

	function parseHeadersText(text: string): Record<string, string> {
		const headers: Record<string, string> = {};
		text.split('\n').forEach((line) => {
			const [key, ...valueParts] = line.split(':');
			if (key && valueParts.length > 0) {
				headers[key.trim()] = valueParts.join(':').trim();
			}
		});
		return headers;
	}

	const mcpDefaults = defaults(zod4(mcpServerFormSchema));

	const {
		form: formData,
		errors,
		reset
	} = superForm(mcpDefaults, {
		SPA: true,
		validators: zod4Client(mcpServerFormSchema),
		resetForm: false,
		onUpdate({ form: f }) {
			if (!f.valid) return;
			const d = f.data as Record<string, string>;
			// Convert flat form data to structured API payload
			onSubmit({
				catalogItemId: d.catalogItemId,
				serverName: d.serverName,
				displayName: d.displayName,
				description: d.description,
				transportType: d.transportType,
				credentials,
				config: {
					url: d.url,
					command: d.command,
					args: parseArgsText(d.argsText),
					env: parseEnvText(d.envText),
					headers: parseHeadersText(d.headersText)
				}
			});
		}
	});

	// Initialize form data based on mode
	$effect(() => {
		if (!open) return;

		credentials = {};

		if (mode === 'install' && catalogItem) {
			reset({
				data: {
					catalogItemId: catalogItem.id,
					serverName: catalogItem.catalogId,
					displayName: catalogItem.displayName,
					description: catalogItem.description,
					transportType: catalogItem.defaultConfig.transport || 'stdio',
					url: catalogItem.defaultConfig.url || '',
					command: catalogItem.defaultConfig.command || '',
					argsText: (catalogItem.defaultConfig.args || []).join('\n'),
					envText: Object.entries(catalogItem.defaultConfig.env || {})
						.map(([k, v]) => `${k}=${v}`)
						.join('\n'),
					headersText: Object.entries(catalogItem.defaultConfig.headers || {})
						.map(([k, v]) => `${k}: ${v}`)
						.join('\n')
				}
			});
		} else if (mode === 'edit' && server) {
			reset({
				data: {
					catalogItemId: server.catalogItemId || '',
					serverName: server.serverName,
					displayName: server.displayName,
					description: server.description || '',
					transportType: server.transportType,
					url: server.config.url || '',
					command: server.config.command || '',
					argsText: (server.config.args || []).join('\n'),
					envText: Object.entries(server.config.env || {})
						.map(([k, v]) => `${k}=${v}`)
						.join('\n'),
					headersText: Object.entries(server.config.headers || {})
						.map(([k, v]) => `${k}: ${v}`)
						.join('\n')
				}
			});
		} else if (mode === 'custom') {
			reset({
				data: {
					catalogItemId: '',
					serverName: '',
					displayName: '',
					description: '',
					transportType: 'stdio',
					url: '',
					command: '',
					argsText: '',
					envText: '',
					headersText: ''
				}
			});
		}
	});

	const modalTitle = $derived(
		mode === 'install'
			? `Install ${catalogItem?.displayName}`
			: mode === 'edit'
				? 'Edit MCP Server'
				: 'Add Custom MCP Server'
	);
</script>

{#if open}
	<div class="modal-backdrop" onclick={onClose} role="presentation"></div>
	<div class="modal">
		<div class="modal-header">
			<h2>{modalTitle}</h2>
			<button type="button" class="btn-close" onclick={onClose}>×</button>
		</div>

		<form class="modal-body" method="POST">
			<div class="form-group">
				<label for="serverName">Server Name</label>
				<input
					type="text"
					id="serverName"
					bind:value={$formData.serverName}
					placeholder="my-mcp-server"
					disabled={mode === 'edit'}
					class="form-input"
					class:form-error={$errors.serverName}
					aria-invalid={!!$errors.serverName}
				/>
				{#if $errors.serverName}
					<p class="field-error">{$errors.serverName}</p>
				{:else}
					<p class="form-hint">
						Lowercase alphanumeric with hyphens {mode === 'edit' ? '(cannot be changed)' : ''}
					</p>
				{/if}
			</div>

			<div class="form-group">
				<label for="displayName">Display Name</label>
				<input
					type="text"
					id="displayName"
					bind:value={$formData.displayName}
					placeholder="My MCP Server"
					class="form-input"
					class:form-error={$errors.displayName}
					aria-invalid={!!$errors.displayName}
				/>
				{#if $errors.displayName}<p class="field-error">{$errors.displayName}</p>{/if}
			</div>

			<div class="form-group">
				<label for="description">Description</label>
				<textarea
					id="description"
					bind:value={$formData.description}
					placeholder="Optional description..."
					rows="3"
					class="form-input"
				></textarea>
			</div>

			{#if mode !== 'install'}
				<div class="form-group">
					<label for="transportType">Transport Type</label>
					<select id="transportType" bind:value={$formData.transportType} class="form-select">
						<option value="stdio">stdio (local process)</option>
						<option value="sse">SSE (Server-Sent Events)</option>
						<option value="http">HTTP</option>
					</select>
				</div>
			{/if}

			<!-- Transport-specific config -->
			{#if $formData.transportType === 'stdio'}
				<div class="form-group">
					<label for="command">Command</label>
					<input
						type="text"
						id="command"
						bind:value={$formData.command}
						placeholder="npx"
						class="form-input"
					/>
				</div>

				<div class="form-group">
					<label for="args">Arguments (one per line)</label>
					<textarea
						id="args"
						bind:value={$formData.argsText}
						placeholder="-y&#10;@modelcontextprotocol/server-github"
						rows="4"
						class="form-input"
					></textarea>
				</div>

				<div class="form-group">
					<label for="env">Environment Variables (KEY=value)</label>
					<textarea
						id="env"
						bind:value={$formData.envText}
						placeholder="PATH=/usr/bin&#10;NODE_ENV=production"
						rows="3"
						class="form-input"
					></textarea>
				</div>
			{:else}
				<div class="form-group">
					<label for="url">Server URL</label>
					<input
						type="url"
						id="url"
						bind:value={$formData.url}
						placeholder="https://mcp.example.com/events"
						class="form-input"
					/>
				</div>

				<div class="form-group">
					<label for="headers">Headers (Key: Value)</label>
					<textarea
						id="headers"
						bind:value={$formData.headersText}
						placeholder="Authorization: Bearer token&#10;Content-Type: application/json"
						rows="3"
						class="form-input"
					></textarea>
				</div>
			{/if}

			<!-- Credentials for catalog items -->
			{#if mode === 'install' && catalogItem?.requiredCredentials && catalogItem.requiredCredentials.length > 0}
				<div class="form-divider"></div>
				<h3 class="section-title">Required Credentials</h3>

				{#each catalogItem.requiredCredentials as cred (cred.key)}
					<div class="form-group">
						<label for={`cred-${cred.key}`}>{cred.displayName}</label>
						<input
							type={cred.type === 'password' ? 'password' : 'text'}
							id={`cred-${cred.key}`}
							bind:value={credentials[cred.key]}
							placeholder={cred.description}
							required
							class="form-input"
						/>
						{#if cred.description}
							<p class="form-hint">{cred.description}</p>
						{/if}
					</div>
				{/each}
			{/if}

			<div class="modal-footer">
				<button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
				<button type="submit" class="btn-primary" disabled={isPending}>
					{#if isPending}
						Saving...
					{:else}
						{mode === 'edit' ? 'Update' : mode === 'install' ? 'Install' : 'Create'}
					{/if}
				</button>
			</div>
		</form>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, black 50%, transparent);
		backdrop-filter: blur(4px);
		z-index: 999;
		animation: fade-in 0.2s ease-out;
	}

	.modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 90%;
		max-width: 700px;
		max-height: 90dvh;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		box-shadow: 0 20px 40px -10px color-mix(in srgb, black 30%, transparent);
		z-index: 1000;
		animation: slide-in-up 0.3s ease-out;
		display: flex;
		flex-direction: column;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-lg);
		border-bottom: 1px solid var(--border-muted);
	}

	.modal-header h2 {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--fg-primary);
	}

	.btn-close {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--fg-secondary);
		font-size: 1.5rem;
		cursor: pointer;
		transition: color var(--transition-fast);
	}

	.btn-close:hover {
		color: var(--fg-primary);
	}

	.modal-body {
		padding: var(--space-lg);
		overflow-y: auto;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-md);
		padding: var(--space-lg);
		border-top: 1px solid var(--border-muted);
	}

	.form-group {
		margin-bottom: var(--space-lg);
	}

	label {
		display: block;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
	}

	.form-input,
	.form-select {
		width: 100%;
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
		font-family: inherit;
		transition: all var(--transition-fast);
	}

	textarea.form-input {
		font-family:
			'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Droid Sans Mono', 'Source Code Pro',
			monospace;
		resize: vertical;
	}

	.form-input:focus,
	.form-select:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 30%, transparent);
	}

	.form-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.form-hint {
		margin-top: var(--space-xs);
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
	}

	.field-error {
		color: var(--semantic-error);
		font-size: var(--text-xs);
		margin-top: var(--space-xs);
	}

	.form-error {
		border-color: var(--semantic-error) !important;
	}

	.form-divider {
		height: 1px;
		background: var(--border-muted);
		margin: var(--space-xl) 0;
	}

	.section-title {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: var(--space-lg);
	}

	.btn-primary {
		padding: var(--space-sm) var(--space-lg);
		background: var(--accent-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--accent-secondary);
		box-shadow: 0 0 20px -5px var(--accent-primary);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		padding: var(--space-sm) var(--space-lg);
		background: var(--bg-elevated);
		color: var(--fg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-secondary:hover {
		background: var(--bg-hover);
		border-color: var(--border-focused);
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slide-in-up {
		from {
			transform: translate(-50%, -45%);
			opacity: 0;
		}
		to {
			transform: translate(-50%, -50%);
			opacity: 1;
		}
	}
</style>
