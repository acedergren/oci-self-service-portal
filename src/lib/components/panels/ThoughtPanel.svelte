<script lang="ts">
  import { Collapsible, Spinner, Badge } from '$lib/components/ui/index.js';

  interface Props {
    isOpen?: boolean;
    thought?: string;
    isThinking?: boolean;
    ontoggle?: () => void;
  }

  let { isOpen = false, thought, isThinking = false, ontoggle }: Props = $props();
</script>

<Collapsible title="Thought" {isOpen} shortcut="t" {ontoggle}>
  {#snippet badge()}
    {#if isThinking}
      <Spinner variant="pulse" size="sm" />
    {/if}
  {/snippet}

  <div class="max-h-40 overflow-y-auto">
    {#if thought}
      <p class="text-secondary text-sm whitespace-pre-wrap">{thought}</p>
    {:else}
      <p class="text-tertiary text-sm italic">
        {isThinking ? 'Thinking...' : 'No active thought'}
      </p>
    {/if}
  </div>
</Collapsible>
