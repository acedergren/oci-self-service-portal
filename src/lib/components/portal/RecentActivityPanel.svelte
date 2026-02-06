<script lang="ts">
  import type { RecentActivityPanelProps } from './types.js';

  let { items, onViewAll }: RecentActivityPanelProps = $props();

  const iconPaths: Record<string, string> = {
    server: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"/>',
    database: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/>',
    network: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>',
  };

  function getIconForType(type: string): string {
    if (type === 'compute') return iconPaths.server;
    if (type === 'database') return iconPaths.database;
    return iconPaths.network;
  }
</script>

<div class="activity-panel">
  <div class="panel-header">
    <h2 class="panel-title">Recent Activity</h2>
    {#if onViewAll}
      <button class="panel-action" onclick={onViewAll}>View All</button>
    {/if}
  </div>
  <div class="activity-list">
    {#each items as item (item.id)}
      <div class="activity-item">
        <div class="activity-icon" data-type={item.type}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            {@html getIconForType(item.type)}
          </svg>
        </div>
        <div class="activity-details">
          <span class="activity-action">{item.action}</span>
          <span class="activity-id">{item.id} - {item.time}</span>
        </div>
        <span class="activity-status" data-status={item.status}>
          {item.status}
        </span>
      </div>
    {/each}
  </div>
</div>

<style>
  .activity-panel {
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

  .panel-header ~ * {
    padding: 1.5rem;
  }

  .panel-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--portal-teal-dark, #0F766E);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .panel-action {
    font-size: 0.8125rem;
    color: var(--portal-teal, #0D9488);
    background: transparent;
    border: none;
    cursor: pointer;
    font-weight: 500;
  }

  .panel-action:hover { text-decoration: underline; }

  .activity-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .activity-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--portal-light, #F1F5F9);
    border-radius: 8px;
  }

  .activity-icon {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .activity-icon[data-type="compute"] { background: rgba(13, 148, 136, 0.15); color: var(--portal-teal, #0D9488); }
  .activity-icon[data-type="database"] { background: rgba(79, 70, 229, 0.15); color: #4F46E5; }
  .activity-icon[data-type="networking"] { background: rgba(16, 185, 129, 0.15); color: #10B981; }

  .activity-icon svg { width: 16px; height: 16px; }

  .activity-details { flex: 1; min-width: 0; }
  .activity-action { display: block; font-size: 0.875rem; font-weight: 500; color: var(--portal-navy, #1E293B); }
  .activity-id { display: block; font-size: 0.75rem; color: var(--portal-slate, #64748B); }

  .activity-status {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.25rem 0.625rem;
    border-radius: 100px;
  }

  .activity-status[data-status="completed"] { background: rgba(16, 185, 129, 0.15); color: #059669; }
  .activity-status[data-status="pending"] { background: rgba(245, 158, 11, 0.15); color: #D97706; }
  .activity-status[data-status="failed"] { background: rgba(239, 68, 68, 0.15); color: #DC2626; }
</style>
