<script lang="ts">
	import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import { browser } from '$app/environment';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { idpFormSchema, type IdpFormData } from '$lib/schemas/admin.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const queryClient = useQueryClient();

	// Query for fetching IDPs
	const idpsQuery = createQuery(() => ({
		queryKey: ['admin', 'idp'],
		queryFn: async () => {
			const response = await fetch('/api/admin/idp');
			if (!response.ok) throw new Error('Failed to fetch IDPs');
			return response.json();
		},
		initialData: data.initialIdps,
		enabled: browser
	}));

	interface IDP {
		id: string;
		displayName: string;
		providerId: string;
		providerType: 'oidc' | 'idcs';
		clientId: string;
		issuerUrl: string;
		scopes: string;
		pkce: boolean;
		enabled: boolean;
		adminGroups?: string;
		operatorGroups?: string;
	}

	// State for create/edit modal
	let showModal = $state(false);
	let editingIdp = $state<IDP | null>(null);

	// Superforms setup — client-side validation with Zod
	const idpDefaults = defaults(zod4(idpFormSchema));

	const {
		form: formData,
		errors,
		validate: _validate,
		reset
	} = superForm(idpDefaults, {
		SPA: true,
		validators: zod4Client(idpFormSchema),
		resetForm: false,
		onUpdate({ form }) {
			if (!form.valid) return;
			if (editingIdp) {
				updateIdpMutation.mutate({ id: editingIdp.id, data: form.data });
			} else {
				createIdpMutation.mutate(form.data);
			}
		}
	});

	// Create IDP mutation
	const createIdpMutation = createMutation(() => ({
		mutationFn: async (data: IdpFormData) => {
			const response = await fetch('/api/admin/idp', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data)
			});
			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.message || 'Failed to create IDP');
			}
			return response.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'idp'] });
			toast.success('Identity provider created successfully');
			closeModal();
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	// Update IDP mutation
	const updateIdpMutation = createMutation(() => ({
		mutationFn: async ({ id, data }: { id: string; data: IdpFormData }) => {
			const response = await fetch(`/api/admin/idp/${id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data)
			});
			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.message || 'Failed to update IDP');
			}
			return response.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'idp'] });
			toast.success('Identity provider updated successfully');
			closeModal();
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	// Delete IDP mutation
	const deleteIdpMutation = createMutation(() => ({
		mutationFn: async (id: string) => {
			const response = await fetch(`/api/admin/idp/${id}`, {
				method: 'DELETE'
			});
			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.message || 'Failed to delete IDP');
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'idp'] });
			toast.success('Identity provider deleted successfully');
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	// Toggle IDP enabled status mutation
	const toggleIdpMutation = createMutation(() => ({
		mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
			const response = await fetch(`/api/admin/idp/${id}/toggle`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled })
			});
			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.message || 'Failed to toggle IDP');
			}
			return response.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'idp'] });
			toast.success('Identity provider status updated');
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	function openCreateModal() {
		editingIdp = null;
		reset({
			data: {
				displayName: '',
				providerId: '',
				providerType: 'oidc',
				clientId: '',
				clientSecret: '',
				issuerUrl: '',
				authorizationUrl: '',
				tokenUrl: '',
				userinfoUrl: '',
				scopes: 'openid profile email',
				pkce: true,
				adminGroups: '',
				operatorGroups: ''
			}
		});
		showModal = true;
	}

	function openEditModal(idp: IDP) {
		editingIdp = idp;
		reset({
			data: {
				displayName: idp.displayName || '',
				providerId: idp.providerId || '',
				providerType: idp.providerType || 'oidc',
				clientId: idp.clientId || '',
				clientSecret: '', // Don't pre-fill secret
				issuerUrl: idp.issuerUrl || '',
				authorizationUrl: '',
				tokenUrl: '',
				userinfoUrl: '',
				scopes: idp.scopes || 'openid profile email',
				pkce: idp.pkce ?? true,
				adminGroups: idp.adminGroups || '',
				operatorGroups: idp.operatorGroups || ''
			}
		});
		showModal = true;
	}

	function closeModal() {
		showModal = false;
		editingIdp = null;
	}

	function handleDelete(id: string) {
		if (confirm('Are you sure you want to delete this identity provider?')) {
			deleteIdpMutation.mutate(id);
		}
	}

	function handleToggle(id: string, currentEnabled: boolean) {
		toggleIdpMutation.mutate({ id, enabled: !currentEnabled });
	}

	const isLoading = $derived(idpsQuery.isLoading);
	const idps = $derived(idpsQuery.data || []);
</script>

<svelte:head>
	<title>Identity Providers - Admin Console</title>
</svelte:head>

<div class="admin-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Identity Providers</h1>
			<p class="page-description">Manage authentication providers for your portal</p>
		</div>
		<button type="button" class="btn-primary" onclick={openCreateModal}>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
			>
				<line x1="12" y1="5" x2="12" y2="19" />
				<line x1="5" y1="12" x2="19" y2="12" />
			</svg>
			Add Provider
		</button>
	</div>

	{#if isLoading}
		<div class="loading-state">
			<div class="spinner"></div>
			<p>Loading identity providers...</p>
		</div>
	{:else if idps.length === 0}
		<div class="empty-state">
			<div class="empty-icon">🔐</div>
			<h2>No identity providers configured</h2>
			<p>Add your first identity provider to enable authentication</p>
			<button type="button" class="btn-primary" onclick={openCreateModal}>Add Provider</button>
		</div>
	{:else}
		<div class="idps-grid">
			{#each idps as idp (idp.id)}
				<div class="idp-card">
					<div class="card-header">
						<div class="card-header-left">
							<h3 class="card-title">{idp.displayName}</h3>
							<span
								class="badge"
								class:badge-success={idp.enabled}
								class:badge-muted={!idp.enabled}
							>
								{idp.enabled ? 'Active' : 'Disabled'}
							</span>
						</div>
						<div class="card-actions">
							<button
								type="button"
								class="btn-icon"
								onclick={() => handleToggle(idp.id, idp.enabled)}
								title={idp.enabled ? 'Disable' : 'Enable'}
							>
								{#if idp.enabled}
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
										<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
										<path d="M7 11V7a5 5 0 0 1 10 0v4" />
									</svg>
								{:else}
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
										<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
										<path d="M7 11V7a5 5 0 0 1 9.9-1" />
									</svg>
								{/if}
							</button>
							<button
								type="button"
								class="btn-icon"
								onclick={() => openEditModal(idp)}
								title="Edit"
							>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
									<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
									<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
								</svg>
							</button>
							<button
								type="button"
								class="btn-icon btn-danger"
								onclick={() => handleDelete(idp.id)}
								title="Delete"
							>
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
						<div class="info-row">
							<span class="info-label">Provider ID:</span>
							<span class="info-value">{idp.providerId}</span>
						</div>
						<div class="info-row">
							<span class="info-label">Type:</span>
							<span class="info-value">{idp.providerType.toUpperCase()}</span>
						</div>
						<div class="info-row">
							<span class="info-label">Issuer:</span>
							<span class="info-value">{idp.issuerUrl || 'N/A'}</span>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Create/Edit Modal -->
{#if showModal}
	<div class="modal-backdrop" onclick={closeModal} role="presentation"></div>
	<div class="modal">
		<div class="modal-header">
			<h2>{editingIdp ? 'Edit' : 'Create'} Identity Provider</h2>
			<button type="button" class="btn-close" onclick={closeModal}>×</button>
		</div>

		<form class="modal-body" method="POST">
			<div class="form-group">
				<label for="displayName">Display Name</label>
				<input
					type="text"
					id="displayName"
					bind:value={$formData.displayName}
					placeholder="My SSO Provider"
					aria-invalid={$errors.displayName ? 'true' : undefined}
					class="form-input"
					class:form-error={$errors.displayName}
				/>
				{#if $errors.displayName}<p class="field-error">{$errors.displayName}</p>{/if}
			</div>

			<div class="form-group">
				<label for="providerId">Provider ID</label>
				<input
					type="text"
					id="providerId"
					bind:value={$formData.providerId}
					placeholder="my-sso"
					disabled={!!editingIdp}
					aria-invalid={$errors.providerId ? 'true' : undefined}
					class="form-input"
					class:form-error={$errors.providerId}
				/>
				{#if $errors.providerId}<p class="field-error">{$errors.providerId}</p>
				{:else}<p class="form-hint">
						Unique identifier for this provider (cannot be changed after creation)
					</p>
				{/if}
			</div>

			<div class="form-group">
				<label for="providerType">Provider Type</label>
				<select id="providerType" bind:value={$formData.providerType} class="form-select">
					<option value="oidc">Generic OIDC</option>
					<option value="idcs">OCI Identity Domains</option>
				</select>
			</div>

			<div class="form-row">
				<div class="form-group">
					<label for="clientId">Client ID</label>
					<input
						type="text"
						id="clientId"
						bind:value={$formData.clientId}
						aria-invalid={$errors.clientId ? 'true' : undefined}
						class="form-input"
						class:form-error={$errors.clientId}
					/>
					{#if $errors.clientId}<p class="field-error">{$errors.clientId}</p>{/if}
				</div>

				<div class="form-group">
					<label for="clientSecret">Client Secret</label>
					<input
						type="password"
						id="clientSecret"
						bind:value={$formData.clientSecret}
						class="form-input"
						placeholder={editingIdp ? 'Leave blank to keep existing' : ''}
					/>
				</div>
			</div>

			<div class="form-group">
				<label for="issuerUrl">Issuer URL</label>
				<input
					type="url"
					id="issuerUrl"
					bind:value={$formData.issuerUrl}
					placeholder="https://identity.example.com"
					aria-invalid={$errors.issuerUrl ? 'true' : undefined}
					class="form-input"
					class:form-error={$errors.issuerUrl}
				/>
				{#if $errors.issuerUrl}<p class="field-error">{$errors.issuerUrl}</p>{/if}
			</div>

			<div class="form-group">
				<label for="scopes">OAuth Scopes</label>
				<input
					type="text"
					id="scopes"
					bind:value={$formData.scopes}
					placeholder="openid profile email"
					class="form-input"
				/>
			</div>

			<div class="form-group">
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={$formData.pkce} />
					<span>Enable PKCE</span>
				</label>
			</div>

			{#if $formData.providerType === 'idcs'}
				<div class="form-divider"></div>

				<h3 class="section-title">Group Mapping (Optional)</h3>

				<div class="form-group">
					<label for="adminGroups">Admin Groups</label>
					<input
						type="text"
						id="adminGroups"
						bind:value={$formData.adminGroups}
						placeholder="portal-admins, cloud-admins"
						class="form-input"
					/>
				</div>

				<div class="form-group">
					<label for="operatorGroups">Operator Groups</label>
					<input
						type="text"
						id="operatorGroups"
						bind:value={$formData.operatorGroups}
						placeholder="portal-operators, cloud-ops"
						class="form-input"
					/>
				</div>
			{/if}

			<div class="modal-footer">
				<button type="button" class="btn-secondary" onclick={closeModal}>Cancel</button>
				<button
					type="submit"
					class="btn-primary"
					disabled={createIdpMutation.isPending || updateIdpMutation.isPending}
				>
					{#if createIdpMutation.isPending || updateIdpMutation.isPending}
						Saving...
					{:else}
						{editingIdp ? 'Update' : 'Create'}
					{/if}
				</button>
			</div>
		</form>
	</div>
{/if}

<style>
	/* Page layout */
	.admin-page {
		max-width: 1200px;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: start;
		margin-bottom: var(--space-xl);
	}

	.page-title {
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
	}

	.page-description {
		font-size: var(--text-base);
		color: var(--fg-secondary);
	}

	/* Loading & Empty states */
	.loading-state,
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-xxl);
		text-align: center;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 4px solid var(--border-muted);
		border-top-color: var(--accent-primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-bottom: var(--space-md);
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: var(--space-md);
	}

	.empty-state h2 {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: var(--space-sm);
	}

	.empty-state p {
		font-size: var(--text-base);
		color: var(--fg-secondary);
		margin-bottom: var(--space-lg);
	}

	/* IDP Grid */
	.idps-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: var(--space-lg);
	}

	.idp-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		overflow: hidden;
		transition: all var(--transition-fast);
	}

	.idp-card:hover {
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

	.card-body {
		padding: var(--space-lg);
		display: flex;
		flex-direction: column;
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
		word-break: break-all;
	}

	/* Buttons */
	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: var(--space-sm);
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

	.btn-icon:hover {
		background: var(--bg-primary);
		border-color: var(--border-focused);
		color: var(--fg-primary);
	}

	.btn-icon.btn-danger:hover {
		background: var(--semantic-error);
		border-color: var(--semantic-error);
		color: var(--fg-primary);
	}

	/* Badge */
	.badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.badge-success {
		background: var(--semantic-success);
		color: var(--bg-primary);
	}

	.badge-muted {
		background: var(--bg-tertiary);
		color: var(--fg-tertiary);
	}

	/* Modal */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: oklch(0 0 0 / 0.5);
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
		max-width: 600px;
		max-height: 90dvh;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		box-shadow: 0 20px 40px -10px oklch(0 0 0 / 0.3);
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

	/* Form styles */
	.form-group {
		margin-bottom: var(--space-lg);
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-md);
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
		transition: all var(--transition-fast);
	}

	.form-input:focus,
	.form-select:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 2px oklch(0.78 0.22 45 / 0.2);
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
		margin-top: var(--space-xs);
		font-size: var(--text-xs);
		color: var(--semantic-error, #ef4444);
		font-weight: 500;
	}

	.form-error {
		border-color: var(--semantic-error, #ef4444) !important;
	}

	.form-error:focus {
		box-shadow: 0 0 0 2px oklch(0.65 0.28 25 / 0.2) !important;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		cursor: pointer;
		font-weight: 400;
	}

	.checkbox-label input[type='checkbox'] {
		width: 18px;
		height: 18px;
		cursor: pointer;
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

	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (max-width: 768px) {
		.form-row {
			grid-template-columns: 1fr;
		}

		.idps-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
