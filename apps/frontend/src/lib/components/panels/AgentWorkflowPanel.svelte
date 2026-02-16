<script lang="ts">
	import { Collapsible, Spinner, Badge } from '$lib/components/ui/index.js';
	import type { AgentPlan, WorkflowStepStatus } from './types.js';

	interface Props {
		isOpen?: boolean;
		plan?: AgentPlan;
		ontoggle?: () => void;
	}

	let { isOpen = true, plan, ontoggle }: Props = $props();

	const completedCount = $derived(plan?.steps.filter((s) => s.status === 'completed').length ?? 0);
	const totalSteps = $derived(plan?.steps.length ?? 0);
	const progress = $derived(totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0);

	const statusConfig: Record<WorkflowStepStatus, { icon: string; color: string; bg: string }> = {
		pending: { icon: '○', color: 'text-tertiary', bg: 'bg-tertiary' },
		planning: { icon: '◐', color: 'text-info', bg: 'bg-info/20' },
		running: { icon: '●', color: 'text-executing', bg: 'bg-executing/20' },
		completed: { icon: '✓', color: 'text-success', bg: 'bg-success/20' },
		error: { icon: '✗', color: 'text-error', bg: 'bg-error/20' },
		skipped: { icon: '⊘', color: 'text-tertiary', bg: 'bg-tertiary' }
	};

	const planStatusConfig: Record<
		string,
		{ label: string; variant: 'default' | 'info' | 'success' | 'error' | 'warning' }
	> = {
		idle: { label: 'Ready', variant: 'default' },
		planning: { label: 'Planning...', variant: 'info' },
		executing: { label: 'Executing', variant: 'warning' },
		completed: { label: 'Complete', variant: 'success' },
		error: { label: 'Failed', variant: 'error' }
	};
</script>

<Collapsible title="Agent Workflow" {isOpen} shortcut="w" {ontoggle}>
	{#snippet badge()}
		<div class="flex items-center gap-2">
			{#if plan?.status === 'planning'}
				<Spinner size="sm" variant="pulse" />
				<Badge variant="info">Planning</Badge>
			{:else if plan?.status === 'executing'}
				<Spinner size="sm" />
				<Badge variant="warning">{completedCount}/{totalSteps}</Badge>
			{:else if plan?.status === 'completed'}
				<Badge variant="success">Done</Badge>
			{:else if plan}
				<Badge variant="default">{totalSteps} steps</Badge>
			{/if}
		</div>
	{/snippet}

	<div class="space-y-4">
		{#if plan}
			<!-- Plan Header -->
			<div class="plan-header">
				<div class="flex items-center justify-between mb-2">
					<h4 class="font-medium text-primary">{plan.name}</h4>
					<Badge variant={planStatusConfig[plan.status]?.variant ?? 'default'}>
						{planStatusConfig[plan.status]?.label ?? plan.status}
					</Badge>
				</div>
				<p class="text-sm text-secondary mb-3">{plan.description}</p>

				<!-- Progress Bar -->
				{#if plan.status === 'executing' || plan.status === 'completed'}
					<div class="progress-bar">
						<div class="progress-track">
							<div
								class="progress-fill"
								class:completed={plan.status === 'completed'}
								style="width: {progress}%"
							></div>
						</div>
						<span class="text-xs text-tertiary ml-2">{progress}%</span>
					</div>
				{/if}
			</div>

			<!-- Steps Timeline -->
			<div class="steps-timeline">
				{#each plan.steps as step, index (step.id)}
					{@const config = statusConfig[step.status]}
					{@const isActive = step.status === 'running' || step.status === 'planning'}
					{@const isLast = index === plan.steps.length - 1}

					<div class="step-item" class:active={isActive}>
						<!-- Connector Line -->
						{#if !isLast}
							<div class="step-connector" class:completed={step.status === 'completed'}></div>
						{/if}

						<!-- Step Icon -->
						<div class="step-icon {config.bg}">
							{#if isActive}
								<Spinner size="sm" />
							{:else}
								<span class={config.color}>{config.icon}</span>
							{/if}
						</div>

						<!-- Step Content -->
						<div class="step-content">
							<div class="flex items-center gap-2">
								<span class="step-number">Step {index + 1}</span>
								<span class="step-name" class:active={isActive}>{step.name}</span>
								{#if step.duration}
									<span class="text-xs text-tertiary">{step.duration}ms</span>
								{/if}
							</div>
							<p class="step-description">{step.description}</p>

							{#if step.toolName}
								<div class="step-tool">
									<Badge variant="default">{step.toolName}</Badge>
								</div>
							{/if}

							{#if step.result && step.status === 'completed'}
								<div class="step-result">
									<span class="text-success text-xs">✓ {step.result}</span>
								</div>
							{/if}

							{#if step.status === 'error' && step.result}
								<div class="step-result">
									<span class="text-error text-xs">✗ {step.result}</span>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			<!-- Timing Info -->
			{#if plan.completedAt && plan.startedAt}
				<div class="text-xs text-tertiary text-right">
					Total time: {((plan.completedAt - plan.startedAt) / 1000).toFixed(1)}s
				</div>
			{/if}
		{:else}
			<!-- Empty State -->
			<div class="empty-state">
				<div class="empty-icon">🤖</div>
				<p class="text-secondary text-sm">No active workflow</p>
				<p class="text-tertiary text-xs">Start a complex task to see the agent's plan</p>
			</div>
		{/if}
	</div>
</Collapsible>

<style>
	.plan-header {
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border-default);
	}

	.progress-bar {
		display: flex;
		align-items: center;
	}

	.progress-track {
		flex: 1;
		height: 4px;
		background: var(--bg-tertiary);
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-executing);
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.progress-fill.completed {
		background: var(--color-success);
	}

	.steps-timeline {
		position: relative;
		padding-left: 0.5rem;
	}

	.step-item {
		position: relative;
		display: flex;
		gap: 0.75rem;
		padding-bottom: 1rem;
	}

	.step-item:last-child {
		padding-bottom: 0;
	}

	.step-connector {
		position: absolute;
		left: 11px;
		top: 24px;
		bottom: -4px;
		width: 2px;
		background: var(--border-default);
	}

	.step-connector.completed {
		background: var(--color-success);
	}

	.step-icon {
		flex-shrink: 0;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		z-index: 1;
	}

	.step-content {
		flex: 1;
		min-width: 0;
	}

	.step-number {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
	}

	.step-name {
		font-size: 0.875rem;
		color: var(--text-secondary);
	}

	.step-name.active {
		color: var(--text-primary);
		font-weight: 500;
	}

	.step-description {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-top: 0.125rem;
	}

	.step-tool {
		margin-top: 0.25rem;
	}

	.step-result {
		margin-top: 0.25rem;
		padding: 0.25rem 0.5rem;
		background: var(--bg-tertiary);
		border-radius: 4px;
	}

	.step-item.active {
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.7;
		}
	}

	.empty-state {
		text-align: center;
		padding: 1.5rem;
	}

	.empty-icon {
		font-size: 2rem;
		margin-bottom: 0.5rem;
		opacity: 0.5;
	}
</style>
