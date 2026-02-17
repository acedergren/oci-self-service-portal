<script lang="ts">
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import SecretInput from '../shared/SecretInput.svelte';
	import TestConnectionButton from '../shared/TestConnectionButton.svelte';
	import { setupIdpSchema, type SetupIdpFormData } from '$lib/schemas/admin.js';

	interface IdentityStepProps {
		data: SetupIdpFormData | null;
		onNext: () => void;
	}

	let { data = $bindable(null), onNext }: IdentityStepProps = $props();

	const formDefaults = defaults(zod4(setupIdpSchema));

	const { form, errors, submitting, validateForm } = superForm(
		data ? { ...formDefaults, data: { ...formDefaults.data, ...data } } : formDefaults,
		{
			SPA: true,
			validators: zod4Client(setupIdpSchema),
			onUpdate({ form: f }) {
				if (!f.valid) return;
				data = f.data;
				onNext();
			}
		}
	);

	async function testConnection() {
		try {
			const response = await fetch('/api/setup/idp/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify($form)
			});

			const result = await response.json();

			if (!response.ok) {
				return { success: false, message: result.message || 'Test failed' };
			}

			return { success: true, message: 'Connection successful' };
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Connection test failed'
			};
		}
	}

	async function handleSave(e: SubmitEvent) {
		e.preventDefault();

		const result = await validateForm({ update: true });
		if (!result.valid) {
			toast.error('Please fill in all required fields');
			return;
		}

		try {
			const response = await fetch('/api/setup/idp', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify($form)
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.message || 'Failed to save configuration');
			}

			toast.success('Identity provider configured successfully');
			data = $form;
			onNext();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to save configuration');
		}
	}
</script>

<div class="identity-step">
	<h2 class="step-title">Identity Provider</h2>
	<p class="step-description">
		Configure how users will authenticate. Required for admin console access.
	</p>

	<!-- Provider type selector -->
	<div class="provider-cards">
		<button
			type="button"
			class="provider-card"
			class:selected={$form.type === 'idcs'}
			onclick={() => ($form.type = 'idcs')}
		>
			<div class="card-header">
				<h3>OCI Identity Domains</h3>
				<span class="badge badge-accent">Recommended</span>
			</div>
			<p class="card-description">Native integration with Oracle Cloud Infrastructure IAM</p>
		</button>

		<button
			type="button"
			class="provider-card"
			class:selected={$form.type === 'oidc'}
			onclick={() => ($form.type = 'oidc')}
		>
			<div class="card-header">
				<h3>Generic OIDC</h3>
			</div>
			<p class="card-description">Any OpenID Connect compatible provider</p>
		</button>
	</div>

	<!-- Configuration form -->
	<form class="config-form" onsubmit={handleSave}>
		<div class="form-group">
			<label for="tenantUrl">
				{$form.type === 'idcs' ? 'Tenant URL' : 'Issuer URL'}
				<span class="required">*</span>
			</label>
			<input
				type="url"
				id="tenantUrl"
				name="tenantUrl"
				bind:value={$form.tenantUrl}
				placeholder="https://idcs-xxx.identity.oraclecloud.com"
				class="form-input"
				class:input-error={$errors.tenantUrl}
			/>
			{#if $errors.tenantUrl}
				<p class="form-error">{$errors.tenantUrl[0]}</p>
			{/if}
		</div>

		<div class="form-row">
			<div class="form-group">
				<label for="clientId">
					Client ID
					<span class="required">*</span>
				</label>
				<input
					type="text"
					id="clientId"
					name="clientId"
					bind:value={$form.clientId}
					placeholder="client-id-here"
					class="form-input"
					class:input-error={$errors.clientId}
				/>
				{#if $errors.clientId}
					<p class="form-error">{$errors.clientId[0]}</p>
				{/if}
			</div>

			<div class="form-group">
				<label for="clientSecret">
					Client Secret
					<span class="required">*</span>
				</label>
				<SecretInput
					bind:value={$form.clientSecret}
					placeholder="client-secret-here"
					name="clientSecret"
					onInput={(val) => ($form.clientSecret = val)}
				/>
				{#if $errors.clientSecret}
					<p class="form-error">{$errors.clientSecret[0]}</p>
				{/if}
			</div>
		</div>

		<div class="form-group">
			<label for="scopes">OAuth Scopes</label>
			<input
				type="text"
				id="scopes"
				name="scopes"
				bind:value={$form.scopes}
				placeholder="openid profile email"
				class="form-input"
			/>
			<p class="form-hint">Space-separated list of OAuth 2.0 scopes</p>
		</div>

		<div class="form-group">
			<label class="checkbox-label">
				<input type="checkbox" name="pkce" bind:checked={$form.pkce} />
				<span>Enable PKCE (Proof Key for Code Exchange)</span>
			</label>
			<p class="form-hint">Recommended for enhanced security</p>
		</div>

		{#if $form.type === 'idcs'}
			<div class="form-divider"></div>

			<h3 class="section-title">Group Mapping</h3>
			<p class="section-description">
				Map IDCS groups to portal roles. Users in these groups will automatically be granted the
				corresponding permissions.
			</p>

			<div class="form-group">
				<label for="adminGroups">Admin Groups</label>
				<input
					type="text"
					id="adminGroups"
					name="adminGroups"
					bind:value={$form.adminGroups}
					placeholder="portal-admins, cloud-admins"
					class="form-input"
				/>
				<p class="form-hint">Comma-separated IDCS group names (full admin access)</p>
			</div>

			<div class="form-group">
				<label for="operatorGroups">Operator Groups</label>
				<input
					type="text"
					id="operatorGroups"
					name="operatorGroups"
					bind:value={$form.operatorGroups}
					placeholder="portal-operators, cloud-ops"
					class="form-input"
				/>
				<p class="form-hint">Comma-separated IDCS group names (execute tools & workflows)</p>
			</div>
		{/if}

		<div class="form-actions">
			<TestConnectionButton onTest={testConnection} disabled={$submitting} />

			<button type="submit" class="btn btn-primary" disabled={$submitting}>
				{#if $submitting}
					<svg class="spinner" viewBox="0 0 24 24">
						<circle class="spinner-circle" cx="12" cy="12" r="10" />
					</svg>
					Saving...
				{:else}
					Save & Continue
				{/if}
			</button>
		</div>
	</form>
</div>

<style>
	.identity-step {
		width: 100%;
		max-width: 800px;
		margin: 0 auto;
		padding: var(--space-xl);
		animation: slide-in-up var(--transition-normal);
	}

	.step-title {
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: var(--space-sm);
	}

	.step-description {
		font-size: var(--text-base);
		color: var(--fg-secondary);
		margin-bottom: var(--space-xl);
	}

	.provider-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: var(--space-md);
		margin-bottom: var(--space-xl);
	}

	.provider-card {
		padding: var(--space-lg);
		background-color: var(--bg-secondary);
		border: 2px solid var(--border-default);
		border-radius: var(--radius-lg);
		text-align: left;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.provider-card:hover {
		border-color: var(--border-focused);
		background-color: var(--bg-elevated);
	}

	.provider-card.selected {
		border-color: var(--accent-primary);
		background-color: var(--bg-elevated);
		box-shadow: 0 0 20px -5px var(--accent-primary);
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-sm);
	}

	.card-header h3 {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg-primary);
	}

	.card-description {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
	}

	.config-form {
		background-color: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: var(--space-xl);
	}

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

	.required {
		color: var(--semantic-error);
	}

	.form-input {
		width: 100%;
		padding: var(--space-sm) var(--space-md);
		background-color: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
		transition: all var(--transition-fast);
	}

	.form-input:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 2px oklch(0.78 0.22 45 / 0.2);
	}

	.form-input::placeholder {
		color: var(--fg-tertiary);
	}

	.form-input.input-error {
		border-color: var(--semantic-error);
	}

	.form-hint {
		margin-top: var(--space-xs);
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
	}

	.form-error {
		margin-top: var(--space-xs);
		font-size: var(--text-xs);
		color: var(--semantic-error);
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
		background-color: var(--border-muted);
		margin: var(--space-xl) 0;
	}

	.section-title {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
	}

	.section-description {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
		margin-bottom: var(--space-lg);
	}

	.form-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: var(--space-xl);
		padding-top: var(--space-lg);
		border-top: 1px solid var(--border-muted);
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-sm) var(--space-xl);
		background-color: var(--accent-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: var(--text-base);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-primary:hover:not(:disabled) {
		background-color: var(--accent-secondary);
		box-shadow: 0 0 20px -5px var(--accent-primary);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spinner {
		width: 16px;
		height: 16px;
		animation: spin 1s linear infinite;
	}

	.spinner-circle {
		stroke: currentColor;
		stroke-width: 4;
		fill: none;
		stroke-dasharray: 60;
		stroke-dashoffset: 15;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 768px) {
		.form-row {
			grid-template-columns: 1fr;
		}
	}
</style>
