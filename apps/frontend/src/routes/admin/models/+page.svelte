<script lang="ts">
	import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	interface AIProvider {
		id: string;
		displayName: string;
		providerType: 'oci' | 'openai' | 'anthropic';
		apiEndpoint: string;
		modelId: string;
		enabled: boolean;
		compartmentId?: string;
		isDefault: boolean;
	}

	const queryClient = useQueryClient();

	// Query for fetching AI providers
	const providersQuery = createQuery(() => ({
		queryKey: ['admin', 'ai-providers'],
		queryFn: async () => {
			const response = await fetch('/api/admin/ai-providers');
			if (!response.ok) {
				throw new Error('Failed to fetch AI providers');
			}
			return response.json() as Promise<AIProvider[]>;
		},
		initialData: data.initialProviders,
		enabled: typeof window !== 'undefined'
	}));

	// Mutation for creating a new provider
	const createProviderMutation = createMutation(() => ({
		mutationFn: async (provider: Omit<AIProvider, 'id'>) => {
			const response = await fetch('/api/admin/ai-providers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(provider)
			});
			if (!response.ok) throw new Error('Failed to create AI provider');
			return response.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'ai-providers'] });
			toast.success('AI provider created successfully');
			showModal = false;
			resetSuperform();
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	// Mutation for updating a provider
	const updateMutation = createMutation(() => ({
		mutationFn: async ({ id, ...updates }: Partial<AIProvider> & { id: string }) => {
			const response = await fetch(`/api/admin/ai-providers/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updates)
			});
			if (!response.ok) throw new Error('Failed to update AI provider');
			return response.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'ai-providers'] });
			toast.success('AI provider updated successfully');
			showModal = false;
			resetSuperform();
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	// Mutation for deleting a provider
	const deleteMutation = createMutation(() => ({
		mutationFn: async (id: string) => {
			const response = await fetch(`/api/admin/ai-providers/${id}`, {
				method: 'DELETE'
			});
			if (!response.ok) throw new Error('Failed to delete AI provider');
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'ai-providers'] });
			toast.success('AI provider deleted successfully');
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	// Mutation for toggling enabled status
	const toggleEnabledMutation = createMutation(() => ({
		mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
			const response = await fetch(`/api/admin/ai-providers/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled })
			});
			if (!response.ok) throw new Error('Failed to toggle AI provider status');
			return response.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'ai-providers'] });
			toast.success('AI provider status updated');
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	// Mutation for setting default provider
	const setDefaultMutation = createMutation(() => ({
		mutationFn: async (id: string) => {
			const response = await fetch(`/api/admin/ai-providers/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isDefault: true })
			});
			if (!response.ok) throw new Error('Failed to set default AI provider');
			return response.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'ai-providers'] });
			toast.success('Default AI provider updated');
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	// Modal state
	let showModal = $state(false);
	let editingProvider: AIProvider | null = $state(null);

	// Superforms setup
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import { aiProviderFormSchema } from '$lib/schemas/admin.js';

	const providerDefaults = defaults(aiProviderFormSchema);

	const {
		form,
		errors,
		reset: resetSuperform
	} = superForm(providerDefaults, {
		SPA: true,
		validators: zodClient(aiProviderFormSchema),
		resetForm: false,
		onUpdate({ form: f }) {
			if (!f.valid) return;
			if (editingProvider) {
				updateMutation.mutate({ id: editingProvider.id, ...f.data } as Partial<AIProvider> & {
					id: string;
				});
			} else {
				createProviderMutation.mutate(f.data as Omit<AIProvider, 'id'>);
			}
		}
	});

	function openCreateModal() {
		editingProvider = null;
		resetSuperform({
			data: {
				displayName: '',
				providerType: 'oci',
				apiEndpoint: '',
				modelId: '',
				apiKey: '',
				compartmentId: '',
				enabled: true
			}
		});
		showModal = true;
	}

	function openEditModal(provider: AIProvider) {
		editingProvider = provider;
		resetSuperform({
			data: {
				displayName: provider.displayName,
				providerType: provider.providerType,
				apiEndpoint: provider.apiEndpoint,
				modelId: provider.modelId,
				apiKey: '',
				compartmentId: provider.compartmentId || '',
				enabled: provider.enabled
			}
		});
		showModal = true;
	}

	function handleDelete(id: string) {
		if (confirm('Are you sure you want to delete this AI provider?')) {
			deleteMutation.mutate(id);
		}
	}

	function handleToggleEnabled(provider: AIProvider) {
		toggleEnabledMutation.mutate({
			id: provider.id,
			enabled: !provider.enabled
		});
	}

	function handleSetDefault(id: string) {
		setDefaultMutation.mutate(id);
	}

	function getProviderTypeLabel(type: string): string {
		const labels: Record<string, string> = {
			oci: 'OCI GenAI',
			openai: 'OpenAI',
			anthropic: 'Anthropic'
		};
		return labels[type] || type;
	}

	function getProviderIcon(type: string): string {
		const icons: Record<string, string> = {
			oci: '☁️',
			openai: '🤖',
			anthropic: '🧠'
		};
		return icons[type] || '🔮';
	}
</script>

<div class="models-page">
	<div class="page-header">
		<div class="header-content">
			<h1 class="page-title">AI Models</h1>
			<p class="page-description">Manage AI provider configurations and model settings</p>
		</div>
		<button class="btn-primary" onclick={openCreateModal}>
			<span class="btn-icon">+</span>
			Add AI Provider
		</button>
	</div>

	{#if $providersQuery.isLoading}
		<div class="loading-state">
			<div class="spinner"></div>
			<p>Loading AI providers...</p>
		</div>
	{:else if $providersQuery.error}
		<div class="error-state">
			<p class="error-message">❌ {$providersQuery.error.message}</p>
			<button class="btn-secondary" onclick={() => $providersQuery.refetch()}>Try Again</button>
		</div>
	{:else if $providersQuery.data && $providersQuery.data.length === 0}
		<div class="empty-state">
			<div class="empty-icon">🤖</div>
			<h2 class="empty-title">No AI providers configured</h2>
			<p class="empty-description">Add your first AI provider to start using AI-powered features</p>
			<button class="btn-primary" onclick={openCreateModal}>
				<span class="btn-icon">+</span>
				Add AI Provider
			</button>
		</div>
	{:else}
		<div class="providers-grid">
			{#each $providersQuery.data as provider (provider.id)}
				<div class="provider-card" class:disabled={!provider.enabled}>
					<div class="card-header">
						<div class="provider-title">
							<span class="provider-icon">{getProviderIcon(provider.providerType)}</span>
							<h3 class="provider-name">{provider.displayName}</h3>
						</div>
						<div class="card-actions">
							{#if provider.enabled}
								<button
									class="btn-icon-small"
									onclick={() => handleToggleEnabled(provider)}
									title="Disable provider"
								>
									👁️
								</button>
							{:else}
								<button
									class="btn-icon-small"
									onclick={() => handleToggleEnabled(provider)}
									title="Enable provider"
								>
									👁️‍🗨️
								</button>
							{/if}
							<button
								class="btn-icon-small"
								onclick={() => openEditModal(provider)}
								title="Edit provider"
							>
								✏️
							</button>
							<button
								class="btn-icon-small btn-danger"
								onclick={() => handleDelete(provider.id)}
								title="Delete provider"
							>
								🗑️
							</button>
						</div>
					</div>

					<div class="card-body">
						<div class="provider-info">
							<div class="info-row">
								<span class="info-label">Type:</span>
								<span class="info-value">{getProviderTypeLabel(provider.providerType)}</span>
							</div>
							<div class="info-row">
								<span class="info-label">Model:</span>
								<span class="info-value">{provider.modelId}</span>
							</div>
							<div class="info-row">
								<span class="info-label">Endpoint:</span>
								<span class="info-value info-truncate">{provider.apiEndpoint}</span>
							</div>
							{#if provider.compartmentId}
								<div class="info-row">
									<span class="info-label">Compartment:</span>
									<span class="info-value info-truncate">{provider.compartmentId}</span>
								</div>
							{/if}
						</div>

						<div class="card-footer">
							<div class="status-badges">
								{#if provider.enabled}
									<span class="badge badge-success">Enabled</span>
								{:else}
									<span class="badge badge-disabled">Disabled</span>
								{/if}
								{#if provider.isDefault}
									<span class="badge badge-primary">Default</span>
								{:else}
									<button
										class="badge badge-clickable"
										onclick={() => handleSetDefault(provider.id)}
										title="Set as default provider"
									>
										Set Default
									</button>
								{/if}
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if showModal}
	<div
		class="modal-overlay"
		role="button"
		tabindex="-1"
		onclick={() => (showModal = false)}
		onkeydown={(e) => {
			if (e.key === 'Escape') showModal = false;
		}}
	>
		<div
			class="modal-content"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="modal-header">
				<h2 class="modal-title">
					{editingProvider ? 'Edit AI Provider' : 'Add AI Provider'}
				</h2>
				<button class="modal-close" onclick={() => (showModal = false)}>×</button>
			</div>

			<form class="modal-form" method="POST">
				<div class="form-group">
					<label for="displayName" class="form-label">Display Name</label>
					<input
						id="displayName"
						type="text"
						class="form-input"
						class:form-error={$errors.displayName}
						bind:value={$form.displayName}
						placeholder="e.g., OCI Cohere Command R+"
					/>
					{#if $errors.displayName}<p class="field-error">{$errors.displayName}</p>{/if}
				</div>

				<div class="form-group">
					<label for="providerType" class="form-label">Provider Type</label>
					<select id="providerType" class="form-select" bind:value={$form.providerType}>
						<option value="oci">OCI GenAI</option>
						<option value="openai">OpenAI</option>
						<option value="anthropic">Anthropic</option>
					</select>
				</div>

				<div class="form-group">
					<label for="modelId" class="form-label">Model ID</label>
					<input
						id="modelId"
						type="text"
						class="form-input"
						class:form-error={$errors.modelId}
						bind:value={$form.modelId}
						placeholder="e.g., cohere.command-r-plus"
					/>
					{#if $errors.modelId}<p class="field-error">{$errors.modelId}</p>{/if}
				</div>

				<div class="form-group">
					<label for="apiEndpoint" class="form-label">API Endpoint</label>
					<input
						id="apiEndpoint"
						type="url"
						class="form-input"
						class:form-error={$errors.apiEndpoint}
						bind:value={$form.apiEndpoint}
						placeholder="https://..."
					/>
					{#if $errors.apiEndpoint}<p class="field-error">{$errors.apiEndpoint}</p>{/if}
				</div>

				<div class="form-group">
					<label for="apiKey" class="form-label">
						API Key {editingProvider ? '(leave blank to keep existing)' : ''}
					</label>
					<input
						id="apiKey"
						type="password"
						class="form-input"
						bind:value={$form.apiKey}
						placeholder="Enter API key"
					/>
				</div>

				{#if $form.providerType === 'oci'}
					<div class="form-group">
						<label for="compartmentId" class="form-label">Compartment OCID (Optional)</label>
						<input
							id="compartmentId"
							type="text"
							class="form-input"
							bind:value={$form.compartmentId}
							placeholder="ocid1.compartment..."
						/>
					</div>
				{/if}

				<div class="form-group">
					<label class="form-checkbox">
						<input type="checkbox" bind:checked={$form.enabled} />
						<span>Enable this provider</span>
					</label>
				</div>

				<div class="modal-actions">
					<button type="button" class="btn-secondary" onclick={() => (showModal = false)}>
						Cancel
					</button>
					<button
						type="submit"
						class="btn-primary"
						disabled={$createProviderMutation.isPending || $updateMutation.isPending}
					>
						{#if $createProviderMutation.isPending || $updateMutation.isPending}
							Saving...
						{:else}
							{editingProvider ? 'Update Provider' : 'Create Provider'}
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.models-page {
		max-width: 1200px;
		margin: 0 auto;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: var(--space-xl);
		padding-bottom: var(--space-lg);
		border-bottom: 1px solid var(--border-muted);
	}

	.header-content {
		flex: 1;
	}

	.page-title {
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
	}

	.page-description {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
	}

	.btn-primary {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		padding: var(--space-sm) var(--space-lg);
		background: var(--accent-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
		box-shadow: 0 0 20px -5px var(--accent-primary);
	}

	.btn-primary:hover {
		background: var(--accent-bright);
		box-shadow: 0 0 30px -5px var(--accent-primary);
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
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-secondary:hover {
		background: var(--bg-tertiary);
	}

	.btn-icon {
		font-size: var(--text-lg);
	}

	.btn-icon-small {
		padding: var(--space-xs);
		background: transparent;
		border: none;
		cursor: pointer;
		font-size: var(--text-lg);
		opacity: 0.7;
		transition: opacity var(--transition-fast);
	}

	.btn-icon-small:hover {
		opacity: 1;
	}

	.btn-danger:hover {
		opacity: 1;
		filter: brightness(1.2);
	}

	.loading-state,
	.error-state,
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-xxl);
		text-align: center;
		min-height: 400px;
	}

	.spinner {
		width: 48px;
		height: 48px;
		border: 4px solid var(--border-muted);
		border-top-color: var(--accent-primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.error-message {
		color: var(--fg-error);
		margin-bottom: var(--space-md);
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: var(--space-lg);
	}

	.empty-title {
		font-size: var(--text-xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: var(--space-sm);
	}

	.empty-description {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
		margin-bottom: var(--space-xl);
		max-width: 400px;
	}

	.providers-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: var(--space-lg);
	}

	.provider-card {
		background: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: var(--space-lg);
		transition: all var(--transition-normal);
	}

	.provider-card:hover {
		border-color: var(--accent-muted);
		box-shadow: 0 0 20px -5px var(--accent-muted);
	}

	.provider-card.disabled {
		opacity: 0.6;
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: var(--space-md);
	}

	.provider-title {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		flex: 1;
	}

	.provider-icon {
		font-size: 1.5rem;
	}

	.provider-name {
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--fg-primary);
	}

	.card-actions {
		display: flex;
		gap: var(--space-xs);
	}

	.card-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.provider-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
	}

	.info-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-md);
	}

	.info-label {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		flex-shrink: 0;
	}

	.info-value {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
		text-align: right;
	}

	.info-truncate {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-footer {
		padding-top: var(--space-md);
		border-top: 1px solid var(--border-muted);
	}

	.status-badges {
		display: flex;
		gap: var(--space-xs);
		flex-wrap: wrap;
	}

	.badge {
		padding: var(--space-xs) var(--space-sm);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.badge-success {
		background: oklch(0.7 0.15 145 / 0.2);
		color: oklch(0.8 0.15 145);
	}

	.badge-disabled {
		background: var(--bg-tertiary);
		color: var(--fg-tertiary);
	}

	.badge-primary {
		background: var(--accent-muted);
		color: var(--accent-bright);
	}

	.badge-clickable {
		background: var(--bg-tertiary);
		color: var(--fg-secondary);
		border: 1px solid var(--border-default);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.badge-clickable:hover {
		background: var(--accent-muted);
		color: var(--accent-bright);
		border-color: var(--accent-muted);
	}

	.modal-overlay {
		position: fixed;
		inset: 0;
		background: oklch(0 0 0 / 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		backdrop-filter: blur(4px);
	}

	.modal-content {
		background: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		width: 90%;
		max-width: 600px;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 20px 60px -10px oklch(0 0 0 / 0.5);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-lg);
		border-bottom: 1px solid var(--border-muted);
	}

	.modal-title {
		font-size: var(--text-xl);
		font-weight: 700;
		color: var(--fg-primary);
	}

	.modal-close {
		background: none;
		border: none;
		font-size: 2rem;
		color: var(--fg-secondary);
		cursor: pointer;
		padding: 0;
		line-height: 1;
		transition: color var(--transition-fast);
	}

	.modal-close:hover {
		color: var(--fg-primary);
	}

	.modal-form {
		padding: var(--space-lg);
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}

	.form-label {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-primary);
	}

	.form-input,
	.form-select {
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
		transition: all var(--transition-fast);
	}

	.form-input:focus,
	.form-select:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px var(--accent-muted);
	}

	.form-checkbox {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		cursor: pointer;
	}

	.form-checkbox input[type='checkbox'] {
		width: 18px;
		height: 18px;
		cursor: pointer;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-md);
		padding-top: var(--space-lg);
		border-top: 1px solid var(--border-muted);
	}

	.field-error {
		color: oklch(0.7 0.2 25);
		font-size: var(--text-xs);
		margin-top: var(--space-xs);
	}

	.form-error {
		border-color: oklch(0.7 0.2 25) !important;
	}

	@media (max-width: 768px) {
		.providers-grid {
			grid-template-columns: 1fr;
		}

		.page-header {
			flex-direction: column;
			gap: var(--space-md);
		}

		.modal-content {
			width: 95%;
		}
	}
</style>
