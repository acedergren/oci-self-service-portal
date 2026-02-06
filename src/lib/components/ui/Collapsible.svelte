<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    isOpen?: boolean;
    shortcut?: string;
    badge?: Snippet;
    children: Snippet;
    ontoggle?: () => void;
  }

  let { title, isOpen = false, shortcut, badge, children, ontoggle }: Props = $props();

  function handleToggle() {
    ontoggle?.();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleToggle();
    }
  }
</script>

<div class="panel mb-2">
  <!-- Header -->
  <button
    class="panel-header w-full flex items-center justify-between rounded-t-md"
    onclick={handleToggle}
    onkeydown={handleKeydown}
    aria-expanded={isOpen}
  >
    <div class="flex items-center gap-2">
      <span class="text-tertiary transition-transform" class:rotate-90={isOpen}>
        ▶
      </span>
      <span class="text-primary font-medium">{title}</span>
      {#if badge}
        {@render badge()}
      {/if}
    </div>
    {#if shortcut}
      <span class="text-tertiary text-sm">[{shortcut}]</span>
    {/if}
  </button>

  <!-- Content -->
  {#if isOpen}
    <div class="panel-content animate-slide-in-up">
      {@render children()}
    </div>
  {/if}
</div>
