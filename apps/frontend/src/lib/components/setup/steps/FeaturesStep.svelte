<script lang="ts">
	import { toast } from 'svelte-sonner';

	interface FeaturesConfig {
		portalFeatures: {
			workflows: boolean;
			vectorSearch: boolean;
			blockchainAudit: boolean;
			cspComparison: boolean;
			mcpServer: boolean;
		};
		toolCategories: {
			compute: boolean;
			networking: boolean;
			database: boolean;
			storage: boolean;
			iam: boolean;
			monitoring: boolean;
			security: boolean;
			genai: boolean;
		};
	}

	interface FeaturesStepProps {
		data: FeaturesConfig | null;
		onNext: () => void;
		onSkip: () => void;
	}

	let {
		data = $bindable(null as FeaturesConfig | null),
		onNext,
		onSkip
	}: FeaturesStepProps = $props();

	// Initialize with defaults (all enabled)
	if (!data) {
		data = {
			portalFeatures: {
				workflows: true,
				vectorSearch: true,
				blockchainAudit: true,
				cspComparison: true,
				mcpServer: true
			},
			toolCategories: {
				compute: true,
				networking: true,
				database: true,
				storage: true,
				iam: true,
				monitoring: true,
				security: true,
				genai: true
			}
		};
	}

	let saving = $state(false);

	async function handleSave() {
		saving = true;

		try {
			const response = await fetch('/api/setup/features', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data)
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.message || 'Failed to save configuration');
			}

			toast.success('Features configured successfully');
			onNext();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to save configuration');
		} finally {
			saving = false;
		}
	}

	function toggleAllPortalFeatures() {
		if (!data) return;
		const allEnabled = Object.values(data.portalFeatures).every((v) => v);
		Object.keys(data.portalFeatures).forEach((key) => {
			data.portalFeatures[key as keyof typeof data.portalFeatures] = !allEnabled;
		});
	}

	function toggleAllToolCategories() {
		if (!data) return;
		const allEnabled = Object.values(data.toolCategories).every((v) => v);
		Object.keys(data.toolCategories).forEach((key) => {
			data.toolCategories[key as keyof typeof data.toolCategories] = !allEnabled;
		});
	}
</script>

<div class="features-step">
	<div class="step-header">
		<div>
			<h2 class="step-title">Features & Tools</h2>
			<p class="step-description">
				Enable portal features and tool categories. All features are enabled by default - you can
				customize or skip this step.
			</p>
		</div>
		<button type="button" class="btn-skip" onclick={onSkip}>Skip for now</button>
	</div>

	<div class="features-grid">
		<!-- Portal Features -->
		<div class="feature-section">
			<div class="section-header">
				<h3 class="section-title">Portal Features</h3>
				<button type="button" class="btn-toggle-all" onclick={toggleAllPortalFeatures}>
					Toggle All
				</button>
			</div>

			<div class="feature-list">
				<label class="feature-item">
					<div class="feature-info">
						<span class="feature-name">Visual Workflows</span>
						<span class="feature-description">Design and execute multi-step workflows</span>
					</div>
					<div class="toggle-wrapper">
						<input type="checkbox" bind:checked={data.portalFeatures.workflows} class="toggle" />
						<span class="toggle-slider"></span>
					</div>
				</label>

				<label class="feature-item">
					<div class="feature-info">
						<span class="feature-name">Vector Search</span>
						<span class="feature-description">Semantic search with Oracle 26AI</span>
					</div>
					<div class="toggle-wrapper">
						<input type="checkbox" bind:checked={data.portalFeatures.vectorSearch} class="toggle" />
						<span class="toggle-slider"></span>
					</div>
				</label>

				<label class="feature-item">
					<div class="feature-info">
						<span class="feature-name">Blockchain Audit</span>
						<span class="feature-description">Immutable audit trail with Oracle blockchain</span>
					</div>
					<div class="toggle-wrapper">
						<input
							type="checkbox"
							bind:checked={data.portalFeatures.blockchainAudit}
							class="toggle"
						/>
						<span class="toggle-slider"></span>
					</div>
				</label>

				<label class="feature-item">
					<div class="feature-info">
						<span class="feature-name">CSP Comparison</span>
						<span class="feature-description">Compare cloud pricing (OCI vs Azure)</span>
					</div>
					<div class="toggle-wrapper">
						<input
							type="checkbox"
							bind:checked={data.portalFeatures.cspComparison}
							class="toggle"
						/>
						<span class="toggle-slider"></span>
					</div>
				</label>

				<label class="feature-item">
					<div class="feature-info">
						<span class="feature-name">MCP Server</span>
						<span class="feature-description">Model Context Protocol integration</span>
					</div>
					<div class="toggle-wrapper">
						<input type="checkbox" bind:checked={data.portalFeatures.mcpServer} class="toggle" />
						<span class="toggle-slider"></span>
					</div>
				</label>
			</div>
		</div>

		<!-- Tool Categories -->
		<div class="feature-section">
			<div class="section-header">
				<h3 class="section-title">Tool Categories</h3>
				<button type="button" class="btn-toggle-all" onclick={toggleAllToolCategories}>
					Toggle All
				</button>
			</div>

			<div class="feature-list">
				<label class="feature-item">
					<div class="feature-info">
						<span class="feature-name">Compute</span>
						<span class="feature-description">Instances, autoscaling, instance pools</span>
					</div>
					<div class="toggle-wrapper">
						<input type="checkbox" bind:checked={data.toolCategories.compute} class="toggle" />
						<span class="toggle-slider"></span>
					</div>
				</label>

				<label class="feature-item">
					<div class="feature-info">
						<span class="feature-name">Networking</span>
						<span class="feature-description">VCN, subnets, load balancers, DNS</span>
					</div>
					<div class="toggle-wrapper">
						<input type="checkbox" bind:checked={data.toolCategories.networking} class="toggle" />
						<span class="toggle-slider"></span>
					</div>
				</label>

				<label class="feature-item">
					<div class="feature-info">
						<span class="feature-name">Database</span>
						<span class="feature-description">Autonomous DB, MySQL, PostgreSQL</span>
					</div>
					<div class="toggle-wrapper">
						<input type="checkbox" bind:checked={data.toolCategories.database} class="toggle" />
						<span class="toggle-slider"></span>
					</div>
				</label>

				<label class="feature-item">
					<div class="feature-info">
						<span class="feature-name">Storage</span>
						<span class="feature-description">Object Storage, Block Volumes, File Storage</span>
					</div>
					<div class="toggle-wrapper">
						<input type="checkbox" bind:checked={data.toolCategories.storage} class="toggle" />
						<span class="toggle-slider"></span>
					</div>
				</label>

				<label class="feature-item">
					<div class="feature-info">
						<span class="feature-name">IAM</span>
						<span class="feature-description">Users, groups, policies, dynamic groups</span>
					</div>
					<div class="toggle-wrapper">
						<input type="checkbox" bind:checked={data.toolCategories.iam} class="toggle" />
						<span class="toggle-slider"></span>
					</div>
				</label>

				<label class="feature-item">
					<div class="feature-info">
						<span class="feature-name">Monitoring</span>
						<span class="feature-description">Metrics, alarms, logging, notifications</span>
					</div>
					<div class="toggle-wrapper">
						<input type="checkbox" bind:checked={data.toolCategories.monitoring} class="toggle" />
						<span class="toggle-slider"></span>
					</div>
				</label>

				<label class="feature-item">
					<div class="feature-info">
						<span class="feature-name">Security</span>
						<span class="feature-description">WAF, Bastions, Vaults, Security Zones</span>
					</div>
					<div class="toggle-wrapper">
						<input type="checkbox" bind:checked={data.toolCategories.security} class="toggle" />
						<span class="toggle-slider"></span>
					</div>
				</label>

				<label class="feature-item">
					<div class="feature-info">
						<span class="feature-name">Generative AI</span>
						<span class="feature-description">GenAI endpoints, models, dedicated clusters</span>
					</div>
					<div class="toggle-wrapper">
						<input type="checkbox" bind:checked={data.toolCategories.genai} class="toggle" />
						<span class="toggle-slider"></span>
					</div>
				</label>
			</div>
		</div>
	</div>

	<div class="step-actions">
		<button type="button" class="btn-secondary" onclick={onSkip}>Skip for now</button>

		<button type="button" class="btn-primary" onclick={handleSave} disabled={saving}>
			{#if saving}
				<svg class="spinner" viewBox="0 0 24 24">
					<circle class="spinner-circle" cx="12" cy="12" r="10" />
				</svg>
				Saving...
			{:else}
				Save & Continue
			{/if}
		</button>
	</div>
</div>

<style>
	.features-step {
		width: 100%;
		max-width: 1000px;
		margin: 0 auto;
		padding: var(--space-xl);
		animation: slide-in-up var(--transition-normal);
	}

	.step-header {
		display: flex;
		justify-content: space-between;
		align-items: start;
		margin-bottom: var(--space-xl);
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
	}

	.btn-skip {
		padding: var(--space-sm) var(--space-md);
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-secondary);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-skip:hover {
		border-color: var(--border-focused);
		color: var(--fg-primary);
	}

	.features-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
		gap: var(--space-xl);
		margin-bottom: var(--space-xl);
	}

	.feature-section {
		background-color: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: var(--space-lg);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-lg);
		padding-bottom: var(--space-md);
		border-bottom: 1px solid var(--border-muted);
	}

	.section-title {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg-primary);
	}

	.btn-toggle-all {
		padding: var(--space-xs) var(--space-sm);
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--fg-secondary);
		font-size: var(--text-xs);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-toggle-all:hover {
		border-color: var(--accent-primary);
		color: var(--accent-primary);
	}

	.feature-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.feature-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-md);
		background-color: var(--bg-tertiary);
		border: 1px solid var(--border-muted);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.feature-item:hover {
		border-color: var(--border-default);
		background-color: var(--bg-primary);
	}

	.feature-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		flex: 1;
	}

	.feature-name {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--fg-primary);
	}

	.feature-description {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
	}

	.toggle-wrapper {
		position: relative;
		width: 48px;
		height: 26px;
		flex-shrink: 0;
	}

	.toggle {
		opacity: 0;
		width: 0;
		height: 0;
		position: absolute;
	}

	.toggle-slider {
		position: absolute;
		cursor: pointer;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: var(--bg-elevated);
		transition: var(--transition-fast);
		border-radius: 26px;
		border: 1px solid var(--border-default);
	}

	.toggle-slider:before {
		position: absolute;
		content: '';
		height: 18px;
		width: 18px;
		left: 3px;
		bottom: 3px;
		background-color: var(--fg-tertiary);
		transition: var(--transition-fast);
		border-radius: 50%;
	}

	.toggle:checked + .toggle-slider {
		background-color: var(--accent-primary);
		border-color: var(--accent-primary);
	}

	.toggle:checked + .toggle-slider:before {
		transform: translateX(22px);
		background-color: var(--bg-primary);
	}

	.step-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding-top: var(--space-lg);
		border-top: 1px solid var(--border-muted);
	}

	.btn-secondary {
		padding: var(--space-sm) var(--space-lg);
		background-color: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-secondary:hover {
		background-color: var(--bg-hover);
		border-color: var(--border-focused);
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

	@media (max-width: 1024px) {
		.features-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
