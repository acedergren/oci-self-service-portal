<script lang="ts">
	import { toast } from 'svelte-sonner';
	import SecretInput from '../shared/SecretInput.svelte';
	import TestConnectionButton from '../shared/TestConnectionButton.svelte';

	interface AIProvider {
		type: 'oci' | 'openai' | 'anthropic' | 'google';
		enabled: boolean;
		config: Record<string, string>;
		models: string[];
	}

	interface AIModelsStepProps {
		data: AIProvider[];
		onNext: () => void;
		onSkip: () => void;
	}

	let { data = $bindable([]), onNext, onSkip }: AIModelsStepProps = $props();

	// Initialize with defaults
	if (data.length === 0) {
		data = [
			{
				type: 'oci',
				enabled: true,
				config: { region: 'us-chicago-1', compartmentId: '', authMethod: 'api_key' },
				models: []
			},
			{ type: 'openai', enabled: false, config: { apiKey: '' }, models: [] },
			{ type: 'anthropic', enabled: false, config: { apiKey: '' }, models: [] },
			{ type: 'google', enabled: false, config: { apiKey: '' }, models: [] }
		];
	}

	let expandedProvider = $state<string | null>('oci');
	let saving = $state(false);

	const providerInfo = {
		oci: {
			name: 'OCI GenAI',
			description: 'Oracle Cloud Generative AI service with enterprise-grade models',
			recommended: true,
			models: ['cohere.command-r-plus', 'meta.llama-3.1-70b-instruct']
		},
		openai: {
			name: 'OpenAI',
			description: 'GPT models from OpenAI',
			recommended: false,
			models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
		},
		anthropic: {
			name: 'Anthropic',
			description: 'Claude models from Anthropic',
			recommended: false,
			models: ['claude-opus-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5']
		},
		google: {
			name: 'Google AI',
			description: 'Gemini models from Google',
			recommended: false,
			models: ['gemini-2.0-flash-thinking', 'gemini-2.0-flash', 'gemini-1.5-pro']
		}
	};

	function toggleProvider(type: string) {
		expandedProvider = expandedProvider === type ? null : type;
	}

	async function testProvider(provider: AIProvider) {
		try {
			const response = await fetch('/api/setup/ai-provider/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(provider)
			});

			const result = await response.json();

			if (!response.ok) {
				return { success: false, message: result.message || 'Test failed' };
			}

			return { success: true, message: 'Provider configured correctly' };
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Connection test failed'
			};
		}
	}

	async function handleSave() {
		const enabledProviders = data.filter((p) => p.enabled);

		if (enabledProviders.length === 0) {
			toast.error('Please enable at least one AI provider or skip this step');
			return;
		}

		// Validate required fields for each enabled provider
		for (const provider of enabledProviders) {
			if (provider.type === 'oci') {
				if (!provider.config.compartmentId) {
					toast.error('OCI provider requires a Compartment OCID');
					return;
				}
			} else {
				// openai, anthropic, google
				if (!provider.config.apiKey) {
					toast.error(`${providerInfo[provider.type].name} requires an API Key`);
					return;
				}
			}
		}

		saving = true;

		try {
			const response = await fetch('/api/setup/ai-provider', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data)
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.message || 'Failed to save configuration');
			}

			toast.success('AI providers configured successfully');
			onNext();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to save configuration');
		} finally {
			saving = false;
		}
	}
</script>

<div class="ai-models-step">
	<div class="step-header">
		<div>
			<h2 class="step-title">AI Models</h2>
			<p class="step-description">
				Configure AI providers for chat, embeddings, and more. You can skip this and configure
				later.
			</p>
		</div>
		<button type="button" class="btn-skip" onclick={onSkip}>Skip for now</button>
	</div>

	<div class="providers-grid">
		{#each data as provider (provider.type)}
			{@const info = providerInfo[provider.type]}
			<div class="provider-card" class:expanded={expandedProvider === provider.type}>
				<button type="button" class="provider-header" onclick={() => toggleProvider(provider.type)}>
					<div class="provider-info">
						<div class="provider-name-row">
							<h3>{info.name}</h3>
							{#if info.recommended}
								<span class="badge badge-accent">Recommended</span>
							{/if}
						</div>
						<p class="provider-description">{info.description}</p>
					</div>

					<div class="provider-controls">
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<label class="toggle-label" onclick={(e) => e.stopPropagation()}>
							<input
								type="checkbox"
								bind:checked={provider.enabled}
								onclick={(e) => e.stopPropagation()}
								class="toggle-input"
							/>
							<span class="toggle-slider"></span>
						</label>

						<svg
							class="expand-icon"
							class:rotated={expandedProvider === provider.type}
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<polyline points="6 9 12 15 18 9" />
						</svg>
					</div>
				</button>

				{#if expandedProvider === provider.type && provider.enabled}
					<div class="provider-content">
						{#if provider.type === 'oci'}
							<div class="form-group">
								<label for="oci-region">Region</label>
								<select id="oci-region" bind:value={provider.config.region} class="form-select">
									<option value="us-chicago-1">US Chicago (us-chicago-1)</option>
									<option value="eu-frankfurt-1">EU Frankfurt (eu-frankfurt-1)</option>
									<option value="us-ashburn-1">US Ashburn (us-ashburn-1)</option>
									<option value="uk-london-1">UK London (uk-london-1)</option>
								</select>
							</div>

							<div class="form-group">
								<label for="oci-compartment">Compartment OCID</label>
								<input
									type="text"
									id="oci-compartment"
									bind:value={provider.config.compartmentId}
									placeholder="ocid1.compartment.oc1..."
									class="form-input"
								/>
							</div>

							<div class="form-group">
								<label for="oci-auth">Authentication Method</label>
								<select id="oci-auth" bind:value={provider.config.authMethod} class="form-select">
									<option value="api_key">API Key (from config file)</option>
									<option value="instance_principal">Instance Principal</option>
									<option value="resource_principal">Resource Principal</option>
								</select>
							</div>
						{:else}
							<div class="form-group">
								<label for="{provider.type}-key">API Key</label>
								<SecretInput
									bind:value={provider.config.apiKey}
									placeholder="Enter API key..."
									name="{provider.type}ApiKey"
									onInput={(val) => (provider.config.apiKey = val)}
								/>
							</div>
						{/if}

						<!-- Model selection -->
						<div class="form-group">
							<span class="form-label">Available Models</span>
							<div class="model-checklist">
								{#each info.models as model (model)}
									<label class="checkbox-label">
										<input
											type="checkbox"
											checked={provider.models.includes(model)}
											onchange={(e) => {
												if (e.currentTarget.checked) {
													provider.models = [...provider.models, model];
												} else {
													provider.models = provider.models.filter((m) => m !== model);
												}
											}}
										/>
										<span>{model}</span>
									</label>
								{/each}
							</div>
						</div>

						<div class="provider-actions">
							<TestConnectionButton onTest={() => testProvider(provider)} />
						</div>
					</div>
				{/if}
			</div>
		{/each}
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
	.ai-models-step {
		width: 100%;
		max-width: 900px;
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

	.providers-grid {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
		margin-bottom: var(--space-xl);
	}

	.provider-card {
		background-color: var(--bg-secondary);
		border: 2px solid var(--border-default);
		border-radius: var(--radius-lg);
		overflow: hidden;
		transition: all var(--transition-fast);
	}

	.provider-card.expanded {
		border-color: var(--accent-primary);
	}

	.provider-header {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-lg);
		background: transparent;
		border: none;
		text-align: left;
		cursor: pointer;
		transition: background-color var(--transition-fast);
	}

	.provider-header:hover {
		background-color: var(--bg-elevated);
	}

	.provider-info {
		flex: 1;
	}

	.provider-name-row {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		margin-bottom: var(--space-xs);
	}

	.provider-name-row h3 {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg-primary);
	}

	.provider-description {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
	}

	.provider-controls {
		display: flex;
		align-items: center;
		gap: var(--space-md);
	}

	.toggle-label {
		position: relative;
		display: inline-block;
		width: 48px;
		height: 26px;
	}

	.toggle-input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-slider {
		position: absolute;
		cursor: pointer;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: var(--bg-tertiary);
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

	.toggle-input:checked + .toggle-slider {
		background-color: var(--accent-primary);
		border-color: var(--accent-primary);
	}

	.toggle-input:checked + .toggle-slider:before {
		transform: translateX(22px);
		background-color: var(--bg-primary);
	}

	.expand-icon {
		transition: transform var(--transition-fast);
		color: var(--fg-secondary);
	}

	.expand-icon.rotated {
		transform: rotate(180deg);
	}

	.provider-content {
		padding: 0 var(--space-lg) var(--space-lg);
		border-top: 1px solid var(--border-muted);
	}

	.form-group {
		margin-top: var(--space-lg);
	}

	label,
	.form-label {
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
		background-color: var(--bg-primary);
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

	.model-checklist {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-xs);
		cursor: pointer;
		font-weight: 400;
	}

	.checkbox-label input[type='checkbox'] {
		width: 18px;
		height: 18px;
		cursor: pointer;
	}

	.provider-actions {
		margin-top: var(--space-lg);
		padding-top: var(--space-lg);
		border-top: 1px solid var(--border-muted);
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
</style>
