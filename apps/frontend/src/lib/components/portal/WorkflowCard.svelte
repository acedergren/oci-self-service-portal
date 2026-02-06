<script lang="ts">
	import { getWorkflowIconSvg } from '@portal/shared/workflows/index.js';
	import type { WorkflowCardProps } from './types.js';

	let { workflow, onStart }: WorkflowCardProps = $props();
</script>

<button class="workflow-card" onclick={() => onStart(workflow)}>
	<div class="workflow-icon">
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
	<span class="workflow-arrow">&rarr;</span>
</button>

<style>
	.workflow-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1.25rem;
		background: var(--portal-white, #ffffff);
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		cursor: pointer;
		text-align: left;
		transition: all 0.2s ease;
		font-family: inherit;
	}

	.workflow-card:hover {
		border-color: var(--portal-teal, #0d9488);
		box-shadow: 0 4px 12px rgba(13, 148, 136, 0.15);
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
		color: var(--portal-navy, #1e293b);
		margin-bottom: 0.25rem;
	}

	.workflow-description {
		font-size: 0.8125rem;
		color: var(--portal-slate, #64748b);
		margin-bottom: 0.5rem;
		line-height: 1.4;
	}

	.workflow-meta {
		display: flex;
		gap: 1rem;
		font-size: 0.75rem;
		color: var(--portal-gray, #94a3b8);
	}

	.workflow-arrow {
		color: var(--portal-teal, #0d9488);
		font-size: 1.25rem;
		opacity: 0;
		transform: translateX(-4px);
		transition: all 0.2s ease;
	}

	.workflow-card:hover .workflow-arrow {
		opacity: 1;
		transform: translateX(0);
	}
</style>
