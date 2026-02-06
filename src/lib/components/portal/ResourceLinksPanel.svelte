<script lang="ts">
  import type { ResourceLinksPanelProps } from './types.js';

  let { links }: ResourceLinksPanelProps = $props();
</script>

<div class="resources-panel">
  <div class="panel-header">
    <h2 class="panel-title">Resources</h2>
  </div>
  <div class="resources-list">
    {#each links as link (link.label)}
      <a href={link.href} target="_blank" rel="external noopener noreferrer" class="resource-link">
        {link.label}
      </a>
    {/each}
  </div>
</div>

<style>
  .resources-panel {
    background: var(--portal-white, #FFFFFF);
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #E2E8F0;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    background: linear-gradient(135deg, rgba(13, 148, 136, 0.08), rgba(13, 148, 136, 0.15));
    border-bottom: 1px solid rgba(13, 148, 136, 0.2);
  }

  .panel-header ~ * { padding: 1.5rem; }

  .panel-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--portal-teal-dark, #0F766E);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .resources-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .resource-link {
    display: block;
    font-size: 0.875rem;
    color: var(--portal-teal, #0D9488);
    text-decoration: none;
    padding: 0.625rem 0;
    border-bottom: 1px solid #E2E8F0;
    transition: color 0.15s ease;
  }

  .resource-link:hover {
    color: var(--portal-teal-dark, #0F766E);
    text-decoration: underline;
  }

  .resource-link:last-child { border-bottom: none; }
</style>
