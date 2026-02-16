<script lang="ts">
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SetupStepper from './SetupStepper.svelte';
	import IdentityStep from './steps/IdentityStep.svelte';
	import AIModelsStep from './steps/AIModelsStep.svelte';
	import FeaturesStep from './steps/FeaturesStep.svelte';
	import ReviewStep from './steps/ReviewStep.svelte';

	let currentStep = $state(0);
	let completedSteps = $state<Set<number>>(new Set());
	let redirectTimeout: ReturnType<typeof setTimeout> | null = null;

	let stepData = $state<{
		idp: unknown;
		aiProviders: unknown[];
		settings: unknown;
	}>({
		idp: null,
		aiProviders: [],
		settings: null
	});

	onDestroy(() => {
		if (redirectTimeout) clearTimeout(redirectTimeout);
	});

	const steps = [
		{ name: 'Identity Provider', required: true },
		{ name: 'AI Models', required: false },
		{ name: 'Features', required: false },
		{ name: 'Review & Launch', required: true }
	];

	function nextStep() {
		completedSteps.add(currentStep);
		currentStep++;
	}

	function prevStep() {
		if (currentStep > 0) {
			currentStep--;
		}
	}

	function skipStep() {
		completedSteps.add(currentStep);
		currentStep++;
	}

	function editStep(step: number) {
		currentStep = step;
	}

	async function completeSetup() {
		try {
			const response = await fetch('/api/setup/complete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(stepData)
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.message || 'Failed to complete setup');
			}

			toast.success('Setup completed successfully! Redirecting to login...');

			// Redirect to login page after 1 second
			redirectTimeout = setTimeout(() => {
				goto(resolve('/login'), { replaceState: true });
			}, 1000);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to complete setup');
			throw error;
		}
	}
</script>

<div class="setup-wizard">
	<div class="wizard-header">
		<div class="logo">
			<div class="logo-diamond">&#9670;</div>
		</div>
		<h1 class="wizard-title">Admin Console Setup</h1>
		<p class="wizard-subtitle">Configure your OCI Self-Service Portal</p>
	</div>

	<div class="wizard-container">
		<SetupStepper {steps} {currentStep} {completedSteps} />

		<div class="wizard-content">
			{#if currentStep === 0}
				<IdentityStep bind:data={stepData.idp} onNext={nextStep} />
			{:else if currentStep === 1}
				<AIModelsStep bind:data={stepData.aiProviders} onNext={nextStep} onSkip={skipStep} />
			{:else if currentStep === 2}
				<FeaturesStep bind:data={stepData.settings} onNext={nextStep} onSkip={skipStep} />
			{:else if currentStep === 3}
				<ReviewStep data={stepData} onComplete={completeSetup} onEdit={editStep} />
			{/if}
		</div>

		<!-- Navigation hints -->
		{#if currentStep > 0 && currentStep < 3}
			<button type="button" class="btn-back" onclick={prevStep}>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<line x1="19" y1="12" x2="5" y2="12" />
					<polyline points="12 19 5 12 12 5" />
				</svg>
				Back
			</button>
		{/if}
	</div>
</div>

<style>
	.setup-wizard {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-xl);
		background: var(--bg-primary);
	}

	.wizard-header {
		text-align: center;
		margin-bottom: var(--space-xxl);
		animation: fade-up-stagger var(--transition-normal);
	}

	.logo {
		margin-bottom: var(--space-lg);
	}

	.logo-diamond {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		font-size: 2rem;
		color: var(--accent-primary);
		background: var(--bg-elevated);
		border-radius: var(--radius-lg);
		animation: bioluminescent-pulse 3s ease-in-out infinite;
	}

	.wizard-title {
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
	}

	.wizard-subtitle {
		font-size: var(--text-base);
		color: var(--fg-secondary);
	}

	.wizard-container {
		width: 100%;
		max-width: 1200px;
		position: relative;
	}

	.wizard-content {
		width: 100%;
		min-height: 500px;
	}

	.btn-back {
		position: absolute;
		top: var(--space-xl);
		left: 0;
		display: inline-flex;
		align-items: center;
		gap: var(--space-xs);
		padding: var(--space-sm) var(--space-md);
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-secondary);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-back:hover {
		border-color: var(--border-focused);
		color: var(--fg-primary);
		background-color: var(--bg-elevated);
	}

	@media (max-width: 768px) {
		.setup-wizard {
			padding: var(--space-md);
		}

		.wizard-container {
			max-width: 100%;
		}

		.btn-back {
			position: static;
			margin-bottom: var(--space-md);
		}
	}
</style>
