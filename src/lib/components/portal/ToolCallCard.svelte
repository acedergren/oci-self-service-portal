<script lang="ts">
  import { getToolState, formatToolName } from '$lib/utils/message-parts.js';
  import type { ToolCallCardProps } from './types.js';

  let { part, hideToolExecution = true }: ToolCallCardProps = $props();

  const uiState = $derived(getToolState(part.state));
  const toolResult = $derived(part.output as { success?: boolean; data?: unknown; error?: string } | undefined);
  const isComplete = $derived(toolResult !== undefined);

  /** Only render when: tool execution is shown, tool failed, or tool is still running */
  const shouldRender = $derived(
    !hideToolExecution || (toolResult && !toolResult.success) || !isComplete
  );
</script>

{#if shouldRender}
  <div class="tool-card" data-state={uiState}>
    <div class="tool-header">
      <span class="tool-name">{formatToolName(part.type)}</span>
      <span class="tool-status">
        {#if isComplete}
          {#if toolResult?.success === false}
            <span class="status-dot error"></span>
            Failed
          {:else}
            <span class="status-dot completed"></span>
            Completed
          {/if}
        {:else if uiState === 'running' || uiState === 'streaming'}
          <span class="status-dot running"></span>
          Executing...
        {:else}
          <span class="status-dot pending"></span>
          Pending
        {/if}
      </span>
    </div>
    {#if uiState === 'completed' && toolResult}
      <div class="tool-result">
        {#if toolResult.success}
          <pre class="result-data">{JSON.stringify(toolResult.data, null, 2).slice(0, 500)}{JSON.stringify(toolResult.data).length > 500 ? '...' : ''}</pre>
        {:else}
          <p class="result-error">{toolResult.error || 'Unknown error'}</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .tool-card {
    background: var(--portal-light, #F1F5F9);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    margin-bottom: 0.75rem;
    border-left: 3px solid var(--portal-teal, #0D9488);
  }

  .tool-card[data-state="call"] {
    border-left-color: var(--portal-warning, #F59E0B);
  }

  .tool-card[data-state="result"] {
    border-left-color: var(--portal-success, #10B981);
  }

  .tool-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .tool-name {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--portal-navy, #1E293B);
    font-family: 'JetBrains Mono', monospace;
  }

  .tool-status {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: var(--portal-slate, #64748B);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-dot.running {
    background: var(--portal-warning, #F59E0B);
    animation: blink 1s infinite;
  }

  .status-dot.completed {
    background: var(--portal-success, #10B981);
  }

  .status-dot.pending {
    background: var(--portal-gray, #94A3B8);
  }

  .status-dot.error {
    background: var(--portal-error, #EF4444);
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .tool-result {
    margin-top: 0.5rem;
  }

  .result-data {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    background: var(--portal-white, #FFFFFF);
    padding: 0.75rem;
    border-radius: 6px;
    overflow-x: auto;
    max-height: 200px;
    overflow-y: auto;
    color: var(--portal-navy-light, #334155);
  }

  .result-error {
    font-size: 0.8125rem;
    color: var(--portal-error, #EF4444);
  }
</style>
