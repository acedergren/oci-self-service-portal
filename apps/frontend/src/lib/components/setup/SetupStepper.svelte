<script lang="ts">
	interface Step {
		name: string;
		required: boolean;
	}

	interface SetupStepperProps {
		steps: Step[];
		currentStep: number;
		completedSteps: Set<number>;
	}

	let { steps, currentStep, completedSteps }: SetupStepperProps = $props();
</script>

<div class="stepper">
	{#each steps as step, index (index)}
		{@const isCompleted = completedSteps.has(index)}
		{@const isCurrent = index === currentStep}
		{@const isPast = index < currentStep}

		<div class="step" class:completed={isCompleted || isPast} class:current={isCurrent}>
			<div class="step-indicator">
				{#if isCompleted || isPast}
					<!-- Checkmark -->
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="3"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="20 6 9 17 4 12" />
					</svg>
				{:else}
					<span class="step-number">{index + 1}</span>
				{/if}
			</div>

			<div class="step-content">
				<div class="step-name">{step.name}</div>
				{#if !step.required}
					<div class="step-label">Optional</div>
				{/if}
			</div>
		</div>

		{#if index < steps.length - 1}
			<div
				class="step-connector"
				class:completed={isPast || (isCompleted && index < currentStep)}
			></div>
		{/if}
	{/each}
</div>

<style>
	.stepper {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-lg) 0;
		margin-bottom: var(--space-xl);
	}

	.step {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		flex: 1;
		min-width: 0;
	}

	.step-indicator {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		border-radius: 50%;
		background-color: var(--bg-elevated);
		border: 2px solid var(--border-default);
		color: var(--fg-tertiary);
		font-weight: 600;
		transition: all var(--transition-normal);
	}

	.step.current .step-indicator {
		border-color: var(--accent-primary);
		background-color: var(--accent-primary);
		color: var(--bg-primary);
		box-shadow: 0 0 20px -5px var(--accent-primary);
	}

	.step.completed .step-indicator {
		border-color: var(--semantic-success);
		background-color: var(--semantic-success);
		color: var(--bg-primary);
	}

	.step-number {
		font-size: var(--text-sm);
	}

	.step-content {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.step-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color var(--transition-fast);
	}

	.step.current .step-name {
		color: var(--fg-primary);
	}

	.step.completed .step-name {
		color: var(--fg-secondary);
	}

	.step-label {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
	}

	.step-connector {
		flex: 1;
		height: 2px;
		background-color: var(--border-default);
		transition: background-color var(--transition-normal);
	}

	.step-connector.completed {
		background-color: var(--semantic-success);
	}

	/* Mobile responsive */
	@media (max-width: 768px) {
		.stepper {
			overflow-x: auto;
			padding-bottom: var(--space-md);
		}

		.step-name {
			font-size: var(--text-xs);
		}

		.step-indicator {
			width: 32px;
			height: 32px;
		}
	}
</style>
