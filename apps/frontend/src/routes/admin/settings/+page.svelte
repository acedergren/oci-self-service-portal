<script lang="ts">
	import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import { portalSettingsFormSchema } from '$lib/schemas/admin.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	interface PortalSettings {
		id: string;
		portalName: string;
		primaryColor: string;
		accentColor: string;
		logoUrl: string | null;
		signupEnabled: boolean;
		requireEmailVerification: boolean;
		sessionTimeout: number;
		maxUploadSize: number;
		allowedDomains: string | null;
		maintenanceMode: boolean;
		maintenanceMessage: string | null;
		termsOfServiceUrl: string | null;
		privacyPolicyUrl: string | null;
	}

	const queryClient = useQueryClient();

	// Query for fetching portal settings
	const settingsQuery = createQuery(() => ({
		queryKey: ['admin', 'settings'],
		queryFn: async () => {
			const response = await fetch('/api/admin/settings');
			if (!response.ok) {
				throw new Error('Failed to fetch portal settings');
			}
			return response.json() as Promise<PortalSettings>;
		},
		initialData: data.initialSettings,
		enabled: typeof window !== 'undefined'
	}));

	// Mutation for updating settings
	const updateMutation = createMutation(() => ({
		mutationFn: async (updates: Partial<PortalSettings>) => {
			const response = await fetch('/api/admin/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updates)
			});
			if (!response.ok) throw new Error('Failed to update portal settings');
			return response.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
			toast.success('Portal settings updated successfully');
			isEditing = false;
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	// Superforms for validated editing
	const settingsDefaults = defaults(portalSettingsFormSchema);

	const { form, errors, reset } = superForm(settingsDefaults, {
		SPA: true,
		validators: zodClient(portalSettingsFormSchema),
		resetForm: false,
		onUpdate({ form: f }) {
			if (!f.valid) return;
			updateMutation.mutate(f.data);
		}
	});

	// Editing state
	let isEditing = $state(false);

	function startEditing() {
		if (settingsQuery.data) {
			reset({ data: { ...settingsQuery.data } });
			isEditing = true;
		}
	}

	function cancelEditing() {
		isEditing = false;
	}

	function handleToggleMaintenance() {
		if (settingsQuery.data) {
			updateMutation.mutate({
				maintenanceMode: !settingsQuery.data.maintenanceMode
			});
		}
	}
</script>

<div class="settings-page">
	<div class="page-header">
		<div class="header-content">
			<h1 class="page-title">Portal Settings</h1>
			<p class="page-description">Configure portal appearance, behavior, and policies</p>
		</div>
		{#if !isEditing}
			<button class="btn-primary" onclick={startEditing}>
				<span class="btn-icon">✏️</span>
				Edit Settings
			</button>
		{/if}
	</div>

	{#if settingsQuery.isLoading}
		<div class="loading-state">
			<div class="spinner"></div>
			<p>Loading portal settings...</p>
		</div>
	{:else if settingsQuery.error}
		<div class="error-state">
			<p class="error-message">❌ {settingsQuery.error.message}</p>
			<button class="btn-secondary" onclick={() => settingsQuery.refetch()}>Try Again</button>
		</div>
	{:else if settingsQuery.data}
		{#if isEditing}
			<form class="settings-form" method="POST">
				<div class="settings-section">
					<h2 class="section-title">General</h2>
					<div class="form-grid">
						<div class="form-group">
							<label for="portalName" class="form-label">Portal Name</label>
							<input
								id="portalName"
								type="text"
								class="form-input"
								class:form-error={$errors.portalName}
								bind:value={$form.portalName}
							/>
							{#if $errors.portalName}<p class="field-error">{$errors.portalName}</p>{/if}
						</div>

						<div class="form-group">
							<label for="logoUrl" class="form-label">Logo URL (Optional)</label>
							<input
								id="logoUrl"
								type="url"
								class="form-input"
								class:form-error={$errors.logoUrl}
								bind:value={$form.logoUrl}
							/>
							{#if $errors.logoUrl}<p class="field-error">{$errors.logoUrl}</p>{/if}
						</div>
					</div>
				</div>

				<div class="settings-section">
					<h2 class="section-title">Theme</h2>
					<div class="form-grid">
						<div class="form-group">
							<label for="primaryColor" class="form-label">Primary Color</label>
							<div class="color-input-group">
								<input
									id="primaryColor"
									type="color"
									class="form-color"
									bind:value={$form.primaryColor}
								/>
								<input
									type="text"
									class="form-input"
									class:form-error={$errors.primaryColor}
									bind:value={$form.primaryColor}
									placeholder="#000000"
								/>
							</div>
							{#if $errors.primaryColor}<p class="field-error">{$errors.primaryColor}</p>{/if}
						</div>

						<div class="form-group">
							<label for="accentColor" class="form-label">Accent Color</label>
							<div class="color-input-group">
								<input
									id="accentColor"
									type="color"
									class="form-color"
									bind:value={$form.accentColor}
								/>
								<input
									type="text"
									class="form-input"
									class:form-error={$errors.accentColor}
									bind:value={$form.accentColor}
									placeholder="#000000"
								/>
							</div>
							{#if $errors.accentColor}<p class="field-error">{$errors.accentColor}</p>{/if}
						</div>
					</div>
				</div>

				<div class="settings-section">
					<h2 class="section-title">Authentication</h2>
					<div class="form-grid">
						<div class="form-group">
							<label class="form-checkbox">
								<input type="checkbox" bind:checked={$form.signupEnabled} />
								<span>Enable self-service signup</span>
							</label>
						</div>

						<div class="form-group">
							<label class="form-checkbox">
								<input type="checkbox" bind:checked={$form.requireEmailVerification} />
								<span>Require email verification</span>
							</label>
						</div>

						<div class="form-group">
							<label for="sessionTimeout" class="form-label">Session Timeout (minutes)</label>
							<input
								id="sessionTimeout"
								type="number"
								class="form-input"
								class:form-error={$errors.sessionTimeout}
								bind:value={$form.sessionTimeout}
								min="5"
								max="1440"
							/>
							{#if $errors.sessionTimeout}<p class="field-error">{$errors.sessionTimeout}</p>{/if}
						</div>

						<div class="form-group">
							<label for="allowedDomains" class="form-label"
								>Allowed Email Domains (comma-separated, optional)</label
							>
							<input
								id="allowedDomains"
								type="text"
								class="form-input"
								bind:value={$form.allowedDomains}
								placeholder="example.com, company.org"
							/>
						</div>
					</div>
				</div>

				<div class="settings-section">
					<h2 class="section-title">Uploads</h2>
					<div class="form-grid">
						<div class="form-group">
							<label for="maxUploadSize" class="form-label">Max Upload Size (MB)</label>
							<input
								id="maxUploadSize"
								type="number"
								class="form-input"
								class:form-error={$errors.maxUploadSize}
								bind:value={$form.maxUploadSize}
								min="1"
								max="100"
							/>
							{#if $errors.maxUploadSize}<p class="field-error">{$errors.maxUploadSize}</p>{/if}
						</div>
					</div>
				</div>

				<div class="settings-section">
					<h2 class="section-title">Maintenance Mode</h2>
					<div class="form-grid">
						<div class="form-group">
							<label class="form-checkbox">
								<input type="checkbox" bind:checked={$form.maintenanceMode} />
								<span>Enable maintenance mode</span>
							</label>
						</div>

						<div class="form-group">
							<label for="maintenanceMessage" class="form-label"
								>Maintenance Message (Optional)</label
							>
							<textarea
								id="maintenanceMessage"
								class="form-textarea"
								bind:value={$form.maintenanceMessage}
								rows="3"
								placeholder="We're performing scheduled maintenance. Please check back soon."
							></textarea>
						</div>
					</div>
				</div>

				<div class="settings-section">
					<h2 class="section-title">Legal</h2>
					<div class="form-grid">
						<div class="form-group">
							<label for="termsOfServiceUrl" class="form-label"
								>Terms of Service URL (Optional)</label
							>
							<input
								id="termsOfServiceUrl"
								type="url"
								class="form-input"
								class:form-error={$errors.termsOfServiceUrl}
								bind:value={$form.termsOfServiceUrl}
								placeholder="https://..."
							/>
							{#if $errors.termsOfServiceUrl}<p class="field-error">
									{$errors.termsOfServiceUrl}
								</p>{/if}
						</div>

						<div class="form-group">
							<label for="privacyPolicyUrl" class="form-label">Privacy Policy URL (Optional)</label>
							<input
								id="privacyPolicyUrl"
								type="url"
								class="form-input"
								class:form-error={$errors.privacyPolicyUrl}
								bind:value={$form.privacyPolicyUrl}
								placeholder="https://..."
							/>
							{#if $errors.privacyPolicyUrl}<p class="field-error">
									{$errors.privacyPolicyUrl}
								</p>{/if}
						</div>
					</div>
				</div>

				<div class="form-actions">
					<button type="button" class="btn-secondary" onclick={cancelEditing}>Cancel</button>
					<button type="submit" class="btn-primary" disabled={updateMutation.isPending}>
						{#if updateMutation.isPending}
							Saving...
						{:else}
							Save Settings
						{/if}
					</button>
				</div>
			</form>
		{:else}
			<div class="settings-view">
				<div class="settings-section">
					<h2 class="section-title">General</h2>
					<div class="info-grid">
						<div class="info-item">
							<span class="info-label">Portal Name</span>
							<span class="info-value">{settingsQuery.data.portalName}</span>
						</div>
						{#if settingsQuery.data.logoUrl}
							<div class="info-item">
								<span class="info-label">Logo URL</span>
								<!-- eslint-disable svelte/no-navigation-without-resolve -- external link -->
								<a
									href={settingsQuery.data.logoUrl}
									class="info-link"
									target="_blank"
									rel="noopener noreferrer"
								>
									{settingsQuery.data.logoUrl}
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							</div>
						{/if}
					</div>
				</div>

				<div class="settings-section">
					<h2 class="section-title">Theme</h2>
					<div class="info-grid">
						<div class="info-item">
							<span class="info-label">Primary Color</span>
							<div class="color-preview">
								<div
									class="color-swatch"
									style="background-color: {settingsQuery.data.primaryColor}"
								></div>
								<span class="info-value">{settingsQuery.data.primaryColor}</span>
							</div>
						</div>
						<div class="info-item">
							<span class="info-label">Accent Color</span>
							<div class="color-preview">
								<div
									class="color-swatch"
									style="background-color: {settingsQuery.data.accentColor}"
								></div>
								<span class="info-value">{settingsQuery.data.accentColor}</span>
							</div>
						</div>
					</div>
				</div>

				<div class="settings-section">
					<h2 class="section-title">Authentication</h2>
					<div class="info-grid">
						<div class="info-item">
							<span class="info-label">Self-service Signup</span>
							<span
								class="badge {settingsQuery.data.signupEnabled
									? 'badge-success'
									: 'badge-disabled'}"
							>
								{settingsQuery.data.signupEnabled ? 'Enabled' : 'Disabled'}
							</span>
						</div>
						<div class="info-item">
							<span class="info-label">Email Verification</span>
							<span
								class="badge {settingsQuery.data.requireEmailVerification
									? 'badge-success'
									: 'badge-disabled'}"
							>
								{settingsQuery.data.requireEmailVerification ? 'Required' : 'Optional'}
							</span>
						</div>
						<div class="info-item">
							<span class="info-label">Session Timeout</span>
							<span class="info-value">{settingsQuery.data.sessionTimeout} minutes</span>
						</div>
						{#if settingsQuery.data.allowedDomains}
							<div class="info-item">
								<span class="info-label">Allowed Email Domains</span>
								<span class="info-value">{settingsQuery.data.allowedDomains}</span>
							</div>
						{/if}
					</div>
				</div>

				<div class="settings-section">
					<h2 class="section-title">Uploads</h2>
					<div class="info-grid">
						<div class="info-item">
							<span class="info-label">Max Upload Size</span>
							<span class="info-value">{settingsQuery.data.maxUploadSize} MB</span>
						</div>
					</div>
				</div>

				<div class="settings-section">
					<div class="section-header-with-action">
						<h2 class="section-title">Maintenance Mode</h2>
						<button
							class="btn-toggle"
							class:active={settingsQuery.data.maintenanceMode}
							onclick={handleToggleMaintenance}
							disabled={updateMutation.isPending}
						>
							{settingsQuery.data.maintenanceMode ? 'Disable' : 'Enable'}
						</button>
					</div>
					<div class="info-grid">
						<div class="info-item">
							<span class="info-label">Status</span>
							<span
								class="badge {settingsQuery.data.maintenanceMode
									? 'badge-warning'
									: 'badge-success'}"
							>
								{settingsQuery.data.maintenanceMode ? 'Active' : 'Inactive'}
							</span>
						</div>
						{#if settingsQuery.data.maintenanceMessage}
							<div class="info-item">
								<span class="info-label">Message</span>
								<span class="info-value">{settingsQuery.data.maintenanceMessage}</span>
							</div>
						{/if}
					</div>
				</div>

				<div class="settings-section">
					<h2 class="section-title">Legal</h2>
					<div class="info-grid">
						{#if settingsQuery.data.termsOfServiceUrl}
							<div class="info-item">
								<span class="info-label">Terms of Service</span>
								<!-- eslint-disable svelte/no-navigation-without-resolve -- external link -->
								<a
									href={settingsQuery.data.termsOfServiceUrl}
									class="info-link"
									target="_blank"
									rel="noopener noreferrer"
								>
									{settingsQuery.data.termsOfServiceUrl}
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							</div>
						{/if}
						{#if settingsQuery.data.privacyPolicyUrl}
							<div class="info-item">
								<span class="info-label">Privacy Policy</span>
								<!-- eslint-disable svelte/no-navigation-without-resolve -- external link -->
								<a
									href={settingsQuery.data.privacyPolicyUrl}
									class="info-link"
									target="_blank"
									rel="noopener noreferrer"
								>
									{settingsQuery.data.privacyPolicyUrl}
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.settings-page {
		max-width: 900px;
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

	.btn-toggle {
		padding: var(--space-xs) var(--space-md);
		background: var(--bg-tertiary);
		color: var(--fg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-toggle:hover {
		background: var(--bg-elevated);
		color: var(--fg-primary);
	}

	.btn-toggle.active {
		background: var(--accent-muted);
		color: var(--accent-bright);
		border-color: var(--accent-muted);
	}

	.btn-toggle:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-icon {
		font-size: var(--text-lg);
	}

	.loading-state,
	.error-state {
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

	.settings-view,
	.settings-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-xl);
	}

	.settings-section {
		background: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: var(--space-lg);
	}

	.section-title {
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: var(--space-md);
	}

	.section-header-with-action {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-md);
	}

	.section-header-with-action .section-title {
		margin-bottom: 0;
	}

	.info-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: var(--space-md);
	}

	.info-item {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}

	.info-label {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.info-value {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
	}

	.info-link {
		font-size: var(--text-sm);
		color: var(--accent-primary);
		text-decoration: none;
		transition: color var(--transition-fast);
	}

	.info-link:hover {
		color: var(--accent-bright);
		text-decoration: underline;
	}

	.color-preview {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
	}

	.color-swatch {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-default);
	}

	.badge {
		display: inline-block;
		padding: var(--space-xs) var(--space-sm);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		width: fit-content;
	}

	.badge-success {
		background: oklch(0.7 0.15 145 / 0.2);
		color: oklch(0.8 0.15 145);
	}

	.badge-disabled {
		background: var(--bg-tertiary);
		color: var(--fg-tertiary);
	}

	.badge-warning {
		background: oklch(0.7 0.15 60 / 0.2);
		color: oklch(0.8 0.15 60);
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
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
	.form-textarea {
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
		transition: all var(--transition-fast);
		font-family: inherit;
	}

	.form-input:focus,
	.form-textarea:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px var(--accent-muted);
	}

	.form-textarea {
		resize: vertical;
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

	.color-input-group {
		display: flex;
		gap: var(--space-sm);
		align-items: center;
	}

	.form-color {
		width: 48px;
		height: 40px;
		padding: 4px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		cursor: pointer;
	}

	.form-color::-webkit-color-swatch-wrapper {
		padding: 0;
	}

	.form-color::-webkit-color-swatch {
		border: none;
		border-radius: calc(var(--radius-md) - 4px);
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
		box-shadow: 0 0 0 3px oklch(0.65 0.28 25 / 0.2) !important;
	}

	.color-input-group .form-input {
		flex: 1;
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-md);
		padding-top: var(--space-lg);
		border-top: 1px solid var(--border-muted);
	}

	@media (max-width: 768px) {
		.info-grid,
		.form-grid {
			grid-template-columns: 1fr;
		}

		.page-header {
			flex-direction: column;
			gap: var(--space-md);
		}
	}
</style>
