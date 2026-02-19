<script lang="ts">
	import WorkflowCard from './WorkflowCard.svelte';
	import type { WorkflowGalleryProps } from './types.js';

	let { workflows, onStart }: WorkflowGalleryProps = $props();
</script>

<section class="workflows-section">
	<div class="workflows-header">
		<h2 class="workflows-title">Guided Workflows</h2>
		<p class="workflows-subtitle">AI-assisted multi-step operations with Charlie</p>
	</div>
	<div class="workflows-grid">
		{#each workflows as workflow (workflow.id)}
			<WorkflowCard {workflow} {onStart} />
		{/each}
	</div>
</section>

<style>
	.workflows-section {
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem;
	}

	.workflows-header {
		margin-bottom: var(--space-lg);
	}

	.workflows-title {
		font-size: var(--text-xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
	}

	.workflows-subtitle {
		font-size: var(--text-sm);
		color: var(--fg-tertiary);
	}

	.workflows-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-md);
	}

	@media (max-width: 768px) {
		.workflows-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
