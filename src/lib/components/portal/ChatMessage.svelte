<script lang="ts">
  import MarkdownRenderer from '$lib/components/ui/MarkdownRenderer.svelte';
  import { extractToolParts } from '$lib/utils/message-parts.js';
  import ToolCallCard from './ToolCallCard.svelte';
  import TypingIndicator from './TypingIndicator.svelte';
  import type { ChatMessageProps, ChatToolPart } from './types.js';

  let {
    message,
    isLastMessage,
    isStreaming,
    hideToolExecution = true,
  }: ChatMessageProps = $props();

  function getMessageText(msg: typeof message): string {
    if (!msg.parts) return '';
    return msg.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join('\n');
  }

  function getToolParts(msg: typeof message): ChatToolPart[] {
    if (!msg.parts) return [];
    return extractToolParts(msg.parts as Array<{ type: string; [key: string]: unknown }>);
  }

  const text = $derived(getMessageText(message));
  const toolParts = $derived(getToolParts(message));
  const isCurrentlyStreaming = $derived(isLastMessage && isStreaming);
</script>

<div class="message" data-role={message.role}>
  {#if message.role === 'user'}
    <div class="message-avatar user">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>
    </div>
    <div class="message-content">
      <p>{text}</p>
    </div>
  {:else}
    <div class="message-avatar assistant">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
    </div>
    <div class="message-content">
      {#each toolParts as part (part.toolCallId)}
        <ToolCallCard {part} {hideToolExecution} />
      {/each}

      {#if text}
        <MarkdownRenderer content={text} class="assistant-text" />
      {/if}

      {#if isCurrentlyStreaming}
        <TypingIndicator />
      {/if}
    </div>
  {/if}
</div>

<style>
  .message {
    display: flex;
    gap: 0.75rem;
  }

  .message-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .message-avatar.user {
    background: var(--portal-light, #F1F5F9);
    color: var(--portal-slate, #64748B);
  }

  .message-avatar.assistant {
    background: linear-gradient(135deg, var(--portal-teal, #0D9488), var(--portal-teal-dark, #0F766E));
    color: white;
  }

  .message-avatar svg {
    width: 18px;
    height: 18px;
  }

  .message-content {
    flex: 1;
    min-width: 0;
  }

  .message[data-role="user"] .message-content p {
    background: var(--portal-light, #F1F5F9);
    padding: 0.75rem 1rem;
    border-radius: 12px;
    border-top-left-radius: 4px;
    font-size: 0.9375rem;
    color: var(--portal-navy, #1E293B);
    display: inline-block;
  }

  .message-content :global(.assistant-text) {
    font-size: 0.9375rem;
    color: var(--portal-navy, #1E293B);
    line-height: 1.6;
  }
</style>
