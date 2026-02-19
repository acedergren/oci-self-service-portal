<script lang="ts">
	import { getWorkflowIconSvg } from '@portal/shared/workflows/index';
	import type { WorkflowCardProps } from './types.js';

	let { workflow, onStart }: WorkflowCardProps = $props();
</script>

<button class="workflow-card" onclick={() => onStart(workflow)}>
	<div class="workflow-icon">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- safe: hardcoded SVG lookup -->
		{@html getWorkflowIconSvg(workflow.icon)}
	</div>
	<div class="workflow-content">
		<h3 class="workflow-name">{workflow.name}</h3>
		<p class="workflow-description">{workflow.description}</p>
		<div class="workflow-meta">
			<span class="workflow-steps">{workflow.steps.length} steps</span>
			<span class="workflow-time">~{workflow.estimatedDuration} min</span>
		</div>
	</div>
	<span class="workflow-cta">Start with Charlie →</span>
</button>

<style>
	.workflow-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1.25rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		cursor: pointer;
		text-align: left;
		transition: all var(--transition-normal);
		font-family: inherit;
	}

	.workflow-card:hover {
		border-color: var(--accent-primary);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent-primary) 15%, transparent);
		transform: translateY(-2px);
	}

	.workflow-icon {
		font-size: 2rem;
		flex-shrink: 0;
	}

	.workflow-content {
		flex: 1;
		min-width: 0;
	}

	.workflow-name {
		font-size: 1rem;
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: 0.25rem;
	}

	.workflow-description {
		font-size: 0.8125rem;
		color: var(--fg-tertiary);
		margin-bottom: 0.5rem;
		line-height: 1.4;
	}

	.workflow-meta {
		display: flex;
		gap: 1rem;
		font-size: 0.75rem;
		color: var(--fg-disabled);
	}

	.workflow-cta {
		color: var(--accent-primary);
		font-size: var(--text-xs, 0.75rem);
		font-weight: 500;
		white-space: nowrap;
		opacity: 0;
		transform: translateX(-4px);
		transition: all var(--transition-normal);
	}

	.workflow-card:hover .workflow-cta {
		opacity: 1;
		transform: translateX(0);
	}

	@media (max-width: 768px) {
		.workflow-cta {
			opacity: 1;
			transform: translateX(0);
		}
	}
</style>
