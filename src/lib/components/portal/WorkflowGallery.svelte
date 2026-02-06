<script lang="ts">
  import WorkflowCard from './WorkflowCard.svelte';
  import type { WorkflowGalleryProps } from './types.js';

  let { workflows, onStart }: WorkflowGalleryProps = $props();
</script>

<section class="workflows-section">
  <div class="workflows-header">
    <h2 class="workflows-title">Guided Workflows</h2>
    <p class="workflows-subtitle">AI-assisted multi-step operations for common tasks</p>
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
    margin-bottom: 1.5rem;
  }

  .workflows-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--portal-navy, #1E293B);
    margin-bottom: 0.25rem;
  }

  .workflows-subtitle {
    font-size: 0.875rem;
    color: var(--portal-slate, #64748B);
  }

  .workflows-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }

  @media (max-width: 768px) {
    .workflows-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
