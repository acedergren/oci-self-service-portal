<script lang="ts">
	import { toast } from 'svelte-sonner';

	interface IDPData {
		type: 'idcs' | 'oidc';
		tenantUrl: string;
		clientId: string;
		clientSecret: string;
		pkce: boolean;
		adminGroups?: string;
		operatorGroups?: string;
	}

	interface AIProviderData {
		type: string;
		enabled: boolean;
		config: Record<string, unknown>;
		models: string[];
	}

	interface SettingsData {
		portalFeatures: Record<string, boolean>;
		toolCategories: Record<string, boolean>;
	}

	interface ReviewStepProps {
		data: {
			idp: IDPData | null;
			aiProviders: AIProviderData[];
			settings: SettingsData | null;
		};
		onComplete: () => Promise<void>;
		onEdit: (step: number) => void;
	}

	let { data, onComplete, onEdit }: ReviewStepProps = $props();

	let completing = $state(false);

	async function handleComplete() {
		completing = true;

		try {
			await onComplete();
			// Note: onComplete() navigates away on success, so completing state doesn't need reset
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to complete setup');
			completing = false;
		}
	}

	const enabledProviders = $derived(data.aiProviders?.filter((p) => p.enabled) || []);
	const enabledFeatures = $derived(
		data.settings?.portalFeatures
			? Object.keys(data.settings.portalFeatures).filter(
					(key) => data.settings!.portalFeatures[key]
				)
			: []
	);
	const enabledCategories = $derived(
		data.settings?.toolCategories
			? Object.keys(data.settings.toolCategories).filter(
					(key) => data.settings!.toolCategories[key]
				)
			: []
	);
</script>

<div class="review-step">
	<h2 class="step-title">Review & Launch</h2>
	<p class="step-description">
		Review your configuration before completing setup. You can edit any section by clicking the Edit
		button.
	</p>

	<div class="review-sections">
		<!-- Identity Provider -->
		<div class="review-section">
			<div class="section-header">
				<h3>Identity Provider</h3>
				<button type="button" class="btn-edit" onclick={() => onEdit(0)}>Edit</button>
			</div>

			{#if data.idp}
				<div class="review-content">
					<div class="review-item">
						<span class="item-label">Provider Type</span>
						<span class="item-value"
							>{data.idp.type === 'idcs' ? 'OCI Identity Domains' : 'Generic OIDC'}</span
						>
					</div>

					<div class="review-item">
						<span class="item-label">Tenant URL</span>
						<span class="item-value">{data.idp.tenantUrl}</span>
					</div>

					<div class="review-item">
						<span class="item-label">Client ID</span>
						<span class="item-value">{data.idp.clientId}</span>
					</div>

					<div class="review-item">
						<span class="item-label">PKCE Enabled</span>
						<span class="item-value">{data.idp.pkce ? 'Yes' : 'No'}</span>
					</div>

					{#if data.idp.type === 'idcs'}
						{#if data.idp.adminGroups}
							<div class="review-item">
								<span class="item-label">Admin Groups</span>
								<span class="item-value">{data.idp.adminGroups}</span>
							</div>
						{/if}

						{#if data.idp.operatorGroups}
							<div class="review-item">
								<span class="item-label">Operator Groups</span>
								<span class="item-value">{data.idp.operatorGroups}</span>
							</div>
						{/if}
					{/if}
				</div>
			{:else}
				<p class="empty-state">Not configured</p>
			{/if}
		</div>

		<!-- AI Providers -->
		<div class="review-section">
			<div class="section-header">
				<h3>AI Providers</h3>
				<button type="button" class="btn-edit" onclick={() => onEdit(1)}>Edit</button>
			</div>

			{#if enabledProviders.length > 0}
				<div class="review-content">
					{#each enabledProviders as provider (provider.type)}
						<div class="provider-card">
							<div class="provider-header">
								<span class="provider-name">{provider.type.toUpperCase()}</span>
								<span class="badge badge-success">Enabled</span>
							</div>

							{#if provider.type === 'oci'}
								<div class="provider-details">
									<div class="detail-item">
										<span>Region:</span>
										<span>{provider.config.region}</span>
									</div>
									{#if provider.config.compartmentId}
										<div class="detail-item">
											<span>Compartment:</span>
											<span>{String(provider.config.compartmentId).slice(0, 30)}...</span>
										</div>
									{/if}
								</div>
							{/if}

							{#if provider.models.length > 0}
								<div class="models-list">
									<span class="models-label">Models:</span>
									<div class="models-tags">
										{#each provider.models as model (model)}
											<span class="model-tag">{model}</span>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p class="empty-state">No providers enabled (can configure later)</p>
			{/if}
		</div>

		<!-- Features & Tools -->
		<div class="review-section">
			<div class="section-header">
				<h3>Features & Tools</h3>
				<button type="button" class="btn-edit" onclick={() => onEdit(2)}>Edit</button>
			</div>

			{#if data.settings}
				<div class="review-content">
					<div class="feature-group">
						<h4>Portal Features</h4>
						<div class="tag-list">
							{#each enabledFeatures as feature (feature)}
								<span class="feature-tag">{feature}</span>
							{/each}
						</div>
					</div>

					<div class="feature-group">
						<h4>Tool Categories</h4>
						<div class="tag-list">
							{#each enabledCategories as category (category)}
								<span class="feature-tag">{category}</span>
							{/each}
						</div>
					</div>
				</div>
			{:else}
				<p class="empty-state">Default configuration (can customize later)</p>
			{/if}
		</div>
	</div>

	<div class="complete-section">
		<div class="complete-info">
			<h3>Ready to Launch?</h3>
			<p>
				Once you complete setup, the admin console will be available at <code>/admin</code>. You'll
				be redirected to the login page to authenticate.
			</p>
		</div>

		<button type="button" class="btn-complete" onclick={handleComplete} disabled={completing}>
			{#if completing}
				<svg class="spinner" viewBox="0 0 24 24">
					<circle class="spinner-circle" cx="12" cy="12" r="10" />
				</svg>
				Completing Setup...
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
					<polyline points="22 4 12 14.01 9 11.01" />
				</svg>
				Complete Setup
			{/if}
		</button>
	</div>
</div>

<style>
	.review-step {
		width: 100%;
		max-width: 900px;
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

	.review-sections {
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
		margin-bottom: var(--space-xxl);
	}

	.review-section {
		background-color: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-md) var(--space-lg);
		background-color: var(--bg-elevated);
		border-bottom: 1px solid var(--border-muted);
	}

	.section-header h3 {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg-primary);
	}

	.btn-edit {
		padding: var(--space-xs) var(--space-md);
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--fg-secondary);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-edit:hover {
		border-color: var(--accent-primary);
		color: var(--accent-primary);
	}

	.review-content {
		padding: var(--space-lg);
	}

	.review-item {
		display: flex;
		justify-content: space-between;
		align-items: start;
		padding: var(--space-sm) 0;
		border-bottom: 1px solid var(--border-muted);
	}

	.review-item:last-child {
		border-bottom: none;
	}

	.item-label {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-secondary);
		flex: 0 0 150px;
	}

	.item-value {
		font-size: var(--text-sm);
		color: var(--fg-primary);
		text-align: right;
		word-break: break-word;
	}

	.empty-state {
		padding: var(--space-lg);
		text-align: center;
		font-size: var(--text-sm);
		color: var(--fg-tertiary);
		font-style: italic;
	}

	.provider-card {
		padding: var(--space-md);
		background-color: var(--bg-tertiary);
		border: 1px solid var(--border-muted);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-md);
	}

	.provider-card:last-child {
		margin-bottom: 0;
	}

	.provider-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-sm);
	}

	.provider-name {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--fg-primary);
	}

	.provider-details {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		margin-bottom: var(--space-sm);
	}

	.detail-item {
		display: flex;
		justify-content: space-between;
		font-size: var(--text-xs);
		color: var(--fg-secondary);
	}

	.models-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}

	.models-label {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--fg-secondary);
	}

	.models-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
	}

	.model-tag {
		padding: 2px 8px;
		background-color: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: var(--fg-secondary);
	}

	.feature-group {
		margin-bottom: var(--space-lg);
	}

	.feature-group:last-child {
		margin-bottom: 0;
	}

	.feature-group h4 {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: var(--space-sm);
	}

	.tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
	}

	.feature-tag {
		padding: 4px 12px;
		background-color: var(--bg-tertiary);
		border: 1px solid var(--border-muted);
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		color: var(--fg-primary);
		text-transform: capitalize;
	}

	.complete-section {
		background-color: var(--bg-elevated);
		border: 2px solid var(--accent-primary);
		border-radius: var(--radius-lg);
		padding: var(--space-xl);
		text-align: center;
	}

	.complete-info {
		margin-bottom: var(--space-xl);
	}

	.complete-info h3 {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: var(--space-sm);
	}

	.complete-info p {
		font-size: var(--text-base);
		color: var(--fg-secondary);
		line-height: 1.6;
	}

	.complete-info code {
		padding: 2px 6px;
		background-color: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		font-family: ui-monospace, monospace;
		font-size: 0.9em;
		color: var(--accent-primary);
	}

	.btn-complete {
		display: inline-flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-md) var(--space-xxl);
		background-color: var(--accent-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: var(--text-lg);
		cursor: pointer;
		transition: all var(--transition-fast);
		box-shadow: 0 0 30px -10px var(--accent-primary);
		animation: bioluminescent-pulse 3s ease-in-out infinite;
	}

	.btn-complete:hover:not(:disabled) {
		background-color: var(--accent-secondary);
		transform: scale(1.05);
		box-shadow: 0 0 40px -5px var(--accent-primary);
	}

	.btn-complete:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		animation: none;
	}

	.spinner {
		width: 20px;
		height: 20px;
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
</style>
