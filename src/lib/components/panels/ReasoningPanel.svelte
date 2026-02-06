<script lang="ts">
  import { Collapsible, Badge } from '$lib/components/ui/index.js';

  interface ReasoningStep {
    id: string;
    content: string;
    timestamp: number;
  }

  interface Props {
    isOpen?: boolean;
    steps?: ReasoningStep[];
    ontoggle?: () => void;
  }

  let { isOpen = false, steps = [], ontoggle }: Props = $props();
</script>

<Collapsible title="Reasoning" {isOpen} shortcut="r" {ontoggle}>
  {#snippet badge()}
    {#if steps.length > 0}
      <Badge variant="info">{steps.length}</Badge>
    {/if}
  {/snippet}

  <div class="max-h-60 overflow-y-auto space-y-2">
    {#if steps.length > 0}
      {#each steps as step, index (step.id)}
        <div class="flex gap-2 animate-slide-in-up">
          <span class="text-accent font-medium">{index + 1}.</span>
          <span class="text-secondary text-sm">{step.content}</span>
        </div>
      {/each}
    {:else}
      <p class="text-tertiary text-sm italic">No reasoning steps yet</p>
    {/if}
  </div>
</Collapsible>
