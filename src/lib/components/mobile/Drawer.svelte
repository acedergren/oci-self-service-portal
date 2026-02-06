<!-- src/lib/components/mobile/Drawer.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    isOpen: boolean;
    side?: 'left' | 'right' | 'bottom';
    onclose: () => void;
    children: Snippet;
  }

  let { isOpen, side = 'left', onclose, children }: Props = $props();

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && isOpen) {
      onclose();
    }
  }

  const positionClasses: Record<string, string> = {
    left: 'left-0 top-0 h-full w-80 max-w-[85vw]',
    right: 'right-0 top-0 h-full w-80 max-w-[85vw]',
    bottom: 'bottom-0 left-0 right-0 max-h-[80vh] rounded-t-xl',
  };

  const transformClasses: Record<string, { open: string; closed: string }> = {
    left: { open: 'translate-x-0', closed: '-translate-x-full' },
    right: { open: 'translate-x-0', closed: 'translate-x-full' },
    bottom: { open: 'translate-y-0', closed: 'translate-y-full' },
  };
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <!-- Backdrop -->
  <button
    class="fixed inset-0 bg-primary/80 backdrop-blur-sm z-40 lg:hidden"
    onclick={onclose}
    aria-label="Close drawer"
  ></button>
{/if}

<!-- Drawer -->
<aside
  class="fixed {positionClasses[side]} bg-secondary border-default z-50 transform transition-transform duration-300 ease-out lg:hidden
    {side === 'left' ? 'border-r' : side === 'right' ? 'border-l' : 'border-t'}
    {isOpen ? transformClasses[side].open : transformClasses[side].closed}"
>
  <!-- Handle for bottom drawer -->
  {#if side === 'bottom'}
    <div class="flex justify-center py-2">
      <div class="w-12 h-1 bg-tertiary rounded-full"></div>
    </div>
  {/if}

  <div class="overflow-y-auto h-full safe-bottom">
    {@render children()}
  </div>
</aside>
