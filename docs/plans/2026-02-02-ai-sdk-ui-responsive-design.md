# AI SDK UI Improvements & Responsive Design Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the GUI to leverage AI SDK UI tool streaming features and implement a modern mobile-first responsive design.

**Architecture:**
- Phase 4: Connect ToolPanel to live message tool parts from AI SDK Chat, handle streaming states (`input-streaming`, `input-available`, `result`), and add message metadata display
- Phase 5: Implement mobile-first responsive layout with bottom navigation, container queries, fluid typography, and touch-optimized interactions

**Tech Stack:** Svelte 5, TailwindCSS 4, AI SDK 6, @ai-sdk/svelte

---

## Phase 4: AI SDK UI Improvements

### Task 1: Extract Tool Parts from Messages

**Files:**
- Create: `src/lib/utils/message-parts.ts`
- Test: `src/tests/message-parts.test.ts`

**Step 1: Write the failing test**

```typescript
// src/tests/message-parts.test.ts
import { describe, test, expect } from 'vitest';
import { extractToolParts, getToolState, formatToolName } from '$lib/utils/message-parts.js';

describe('message-parts utilities', () => {
  describe('extractToolParts', () => {
    test('extracts tool parts from message parts array', () => {
      const parts = [
        { type: 'text', text: 'Let me check that' },
        { type: 'tool-list_instances', toolCallId: 'tc1', state: 'result', output: { success: true } },
        { type: 'text', text: 'Found 3 instances' },
      ];

      const toolParts = extractToolParts(parts);

      expect(toolParts).toHaveLength(1);
      expect(toolParts[0].toolCallId).toBe('tc1');
    });

    test('returns empty array when no tool parts', () => {
      const parts = [{ type: 'text', text: 'Hello' }];
      expect(extractToolParts(parts)).toEqual([]);
    });
  });

  describe('getToolState', () => {
    test('returns streaming for input-streaming state', () => {
      expect(getToolState('input-streaming')).toBe('streaming');
    });

    test('returns pending for input-available state', () => {
      expect(getToolState('input-available')).toBe('pending');
    });

    test('returns completed for result state', () => {
      expect(getToolState('result')).toBe('completed');
    });
  });

  describe('formatToolName', () => {
    test('removes tool- prefix and formats name', () => {
      expect(formatToolName('tool-list_instances')).toBe('list_instances');
    });

    test('returns dynamic-tool as is', () => {
      expect(formatToolName('dynamic-tool')).toBe('dynamic-tool');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd oci-ai-chat && pnpm test src/tests/message-parts.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/lib/utils/message-parts.ts
export interface ToolPart {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  title?: string;
}

/**
 * Extract tool parts from a message parts array
 */
export function extractToolParts(parts: Array<{ type: string; [key: string]: unknown }>): ToolPart[] {
  return parts
    .filter((part) => part.type.startsWith('tool-') || part.type === 'dynamic-tool')
    .map((part) => ({
      type: part.type,
      toolCallId: part.toolCallId as string,
      state: part.state as string,
      input: part.input,
      output: part.output,
      title: part.title as string | undefined,
    }));
}

/**
 * Map AI SDK tool states to UI states
 */
export function getToolState(aiSdkState: string): 'streaming' | 'pending' | 'running' | 'completed' | 'error' {
  switch (aiSdkState) {
    case 'input-streaming':
      return 'streaming';
    case 'input-available':
      return 'pending';
    case 'result':
      return 'completed';
    default:
      return 'running';
  }
}

/**
 * Format tool type to display name
 */
export function formatToolName(toolType: string): string {
  if (toolType === 'dynamic-tool') return toolType;
  return toolType.replace('tool-', '');
}
```

**Step 4: Run test to verify it passes**

Run: `cd oci-ai-chat && pnpm test src/tests/message-parts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/utils/message-parts.ts src/tests/message-parts.test.ts
git commit -m "feat(utils): add message parts extraction utilities for tool handling"
```

---

### Task 2: Connect ToolPanel to Live Message Data

**Files:**
- Modify: `src/routes/+page.svelte:77-81` (agent state section)
- Modify: `src/routes/+page.svelte:500-510` (ToolPanel props)

**Step 1: Import utilities and derive tool state from messages**

Add to `+page.svelte` script section after line 15:

```typescript
import { extractToolParts, getToolState, formatToolName, type ToolPart } from '$lib/utils/message-parts.js';
```

**Step 2: Replace simulated toolCalls with derived state**

Replace lines 77-81:

```typescript
// Agent state - derived from live message data
let currentThought = $state<string | undefined>(undefined);
let reasoningSteps = $state<Array<{ id: string; content: string; timestamp: number }>>([]);
let pendingApproval = $state<ToolCall | undefined>(undefined);

// Derive tool calls from the last assistant message
const toolCalls = $derived((() => {
  const messages = chat.messages;
  if (messages.length === 0) return [];

  // Get all tool parts from all assistant messages
  const allToolParts: ToolCall[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    const parts = extractToolParts(msg.parts as Array<{ type: string; [key: string]: unknown }>);
    for (const part of parts) {
      allToolParts.push({
        id: part.toolCallId,
        name: formatToolName(part.type),
        args: (part.input ?? {}) as Record<string, unknown>,
        status: getToolState(part.state),
        startedAt: Date.now(),
        completedAt: part.state === 'result' ? Date.now() : undefined,
      });
    }
  }
  return allToolParts;
})());
```

**Step 3: Update ToolPanel to use derived tools**

Update line ~502:

```svelte
<ToolPanel
  isOpen={toolsOpen}
  tools={toolCalls()}
  {pendingApproval}
  ontoggle={() => (toolsOpen = !toolsOpen)}
  onapprove={handleToolApprove}
  onreject={handleToolReject}
/>
```

**Step 4: Run type check**

Run: `cd oci-ai-chat && pnpm run check 2>&1 | grep -E "page.svelte"`
Expected: No new errors from page.svelte changes

**Step 5: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(chat): connect ToolPanel to live message tool parts"
```

---

### Task 3: Add Tool Streaming Indicator

**Files:**
- Modify: `src/lib/components/panels/ToolPanel.svelte`

**Step 1: Add streaming state support**

Update `statusColors` and `statusIcons` in ToolPanel.svelte (around line 25-39):

```typescript
const statusColors: Record<string, string> = {
  pending: 'text-tertiary',
  awaiting_approval: 'text-warning',
  running: 'text-executing',
  streaming: 'text-streaming',
  completed: 'text-success',
  error: 'text-error',
};

const statusIcons: Record<string, string> = {
  pending: '○',
  awaiting_approval: '?',
  running: '●',
  streaming: '◐',
  completed: '✓',
  error: '✗',
};
```

**Step 2: Update badge to show streaming count**

Update badge snippet (around line 48-57):

```svelte
{#snippet badge()}
  <div class="flex items-center gap-1">
    {#if runningCount > 0}
      <Spinner size="sm" />
      <Badge variant="info">{runningCount}</Badge>
    {:else if tools.filter(t => t.status === 'streaming').length > 0}
      <Spinner size="sm" variant="dots" />
      <Badge variant="accent">streaming</Badge>
    {:else if tools.length > 0}
      <Badge variant="default">{tools.length}</Badge>
    {/if}
  </div>
{/snippet}
```

**Step 3: Update runningCount to include streaming**

```typescript
const runningCount = $derived(tools.filter((t) => t.status === 'running' || t.status === 'streaming').length);
```

**Step 4: Test manually**

Run: `cd oci-ai-chat && pnpm dev`
Visit: http://localhost:5173
Test: Send a message that triggers tool calls, observe streaming indicator

**Step 5: Commit**

```bash
git add src/lib/components/panels/ToolPanel.svelte
git commit -m "feat(ToolPanel): add streaming state support for tool invocations"
```

---

## Phase 5: Responsive Mobile-First Design

### Task 4: Add Fluid Typography and Spacing

**Files:**
- Modify: `src/app.css`

**Step 1: Add fluid typography scale**

Add after `:root {` (around line 10):

```css
/* Fluid typography scale */
--text-xs: clamp(0.625rem, 0.5rem + 0.5vw, 0.75rem);
--text-sm: clamp(0.75rem, 0.625rem + 0.5vw, 0.875rem);
--text-base: clamp(0.875rem, 0.75rem + 0.5vw, 1rem);
--text-lg: clamp(1rem, 0.875rem + 0.5vw, 1.125rem);
--text-xl: clamp(1.125rem, 1rem + 0.5vw, 1.25rem);
--text-2xl: clamp(1.25rem, 1rem + 1vw, 1.5rem);
--text-hero: clamp(2rem, 1.5rem + 2.5vw, 4rem);

/* Fluid spacing */
--space-fluid-xs: clamp(0.125rem, 0.1rem + 0.25vw, 0.25rem);
--space-fluid-sm: clamp(0.25rem, 0.2rem + 0.5vw, 0.5rem);
--space-fluid-md: clamp(0.5rem, 0.4rem + 0.75vw, 1rem);
--space-fluid-lg: clamp(0.75rem, 0.5rem + 1vw, 1.5rem);
--space-fluid-xl: clamp(1rem, 0.75rem + 1.5vw, 2rem);
```

**Step 2: Add mobile breakpoint utilities**

Add after the utility classes (around line 153):

```css
/* Mobile-first responsive utilities */
@layer utilities {
  /* Safe area insets for mobile */
  .safe-top { padding-top: env(safe-area-inset-top, 0); }
  .safe-bottom { padding-bottom: env(safe-area-inset-bottom, 0); }
  .safe-left { padding-left: env(safe-area-inset-left, 0); }
  .safe-right { padding-right: env(safe-area-inset-right, 0); }

  /* Dynamic viewport height */
  .h-dvh { height: 100dvh; }
  .min-h-dvh { min-height: 100dvh; }

  /* Touch-friendly sizing */
  .touch-target { min-height: 44px; min-width: 44px; }
}

/* Container queries */
@container (max-width: 400px) {
  .container-sm\:p-2 { padding: 0.5rem; }
  .container-sm\:text-sm { font-size: var(--text-sm); }
}
```

**Step 3: Commit**

```bash
git add src/app.css
git commit -m "feat(css): add fluid typography, spacing, and mobile utilities"
```

---

### Task 5: Create Mobile Bottom Navigation Component

**Files:**
- Create: `src/lib/components/mobile/BottomNav.svelte`
- Create: `src/lib/components/mobile/index.ts`

**Step 1: Create BottomNav component**

```svelte
<!-- src/lib/components/mobile/BottomNav.svelte -->
<script lang="ts">
  interface NavItem {
    id: string;
    label: string;
    icon: string;
    badge?: number;
  }

  interface Props {
    items: NavItem[];
    activeId: string;
    onselect: (id: string) => void;
  }

  let { items, activeId, onselect }: Props = $props();
</script>

<nav
  class="fixed bottom-0 left-0 right-0 h-16 bg-secondary border-t border-default safe-bottom lg:hidden z-40"
>
  <div class="flex h-full items-center justify-around px-2">
    {#each items as item (item.id)}
      <button
        class="flex flex-col items-center justify-center touch-target px-3 py-1 rounded-lg transition-fast {activeId === item.id
          ? 'text-accent bg-elevated'
          : 'text-secondary hover:text-primary hover:bg-hover'}"
        onclick={() => onselect(item.id)}
      >
        <span class="text-xl">{item.icon}</span>
        <span class="text-xs mt-0.5">{item.label}</span>
        {#if item.badge && item.badge > 0}
          <span
            class="absolute -top-1 -right-1 bg-accent text-primary text-xs rounded-full w-5 h-5 flex items-center justify-center"
          >
            {item.badge > 9 ? '9+' : item.badge}
          </span>
        {/if}
      </button>
    {/each}
  </div>
</nav>
```

**Step 2: Create index.ts export**

```typescript
// src/lib/components/mobile/index.ts
export { default as BottomNav } from './BottomNav.svelte';
```

**Step 3: Commit**

```bash
git add src/lib/components/mobile/
git commit -m "feat(mobile): add BottomNav component for mobile navigation"
```

---

### Task 6: Create Mobile Drawer Component

**Files:**
- Create: `src/lib/components/mobile/Drawer.svelte`

**Step 1: Create Drawer component**

```svelte
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
  />
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
      <div class="w-12 h-1 bg-tertiary rounded-full" />
    </div>
  {/if}

  <div class="overflow-y-auto h-full safe-bottom">
    {@render children()}
  </div>
</aside>
```

**Step 2: Export from index**

Update `src/lib/components/mobile/index.ts`:

```typescript
export { default as BottomNav } from './BottomNav.svelte';
export { default as Drawer } from './Drawer.svelte';
```

**Step 3: Commit**

```bash
git add src/lib/components/mobile/
git commit -m "feat(mobile): add Drawer component for slide-out panels"
```

---

### Task 7: Implement Responsive Layout in Page

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Add mobile imports and state**

Add after line 15 imports:

```typescript
import { BottomNav, Drawer } from '$lib/components/mobile/index.js';

// Mobile navigation state
let mobileNavActive = $state<'chat' | 'sessions' | 'tools' | 'settings'>('chat');
let sessionDrawerOpen = $state(false);
let toolDrawerOpen = $state(false);

// Responsive breakpoint detection
let isMobile = $state(false);

// Check for mobile on mount
$effect(() => {
  const mediaQuery = window.matchMedia('(max-width: 1023px)');
  isMobile = mediaQuery.matches;

  const handler = (e: MediaQueryListEvent) => {
    isMobile = e.matches;
  };
  mediaQuery.addEventListener('change', handler);
  return () => mediaQuery.removeEventListener('change', handler);
});

const navItems = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'sessions', label: 'Sessions', icon: '📝', badge: sessions.length },
  { id: 'tools', label: 'Tools', icon: '⚙', badge: toolCalls().filter(t => t.status === 'running').length },
  { id: 'settings', label: 'Settings', icon: '⚡' },
];

function handleNavSelect(id: string) {
  mobileNavActive = id as typeof mobileNavActive;
  if (id === 'sessions') sessionDrawerOpen = true;
  if (id === 'tools') toolDrawerOpen = true;
}
```

**Step 2: Update main container for mobile**

Replace the main `<div class="flex h-screen...">` container:

```svelte
<div class="flex h-dvh bg-primary text-primary overflow-hidden">
  <!-- Desktop: Session sidebar -->
  {#if sidebarOpen && !isMobile}
    <aside class="w-64 border-r border-default bg-secondary flex-shrink-0 hidden lg:flex flex-col">
      <!-- ... existing sidebar content ... -->
    </aside>
  {/if}

  <!-- Mobile: Session drawer -->
  <Drawer isOpen={sessionDrawerOpen && isMobile} side="left" onclose={() => (sessionDrawerOpen = false)}>
    <div class="p-4">
      <h2 class="text-lg font-bold mb-4">Sessions</h2>
      <!-- Sessions list content from sidebar -->
    </div>
  </Drawer>

  <!-- Mobile: Tools drawer -->
  <Drawer isOpen={toolDrawerOpen && isMobile} side="bottom" onclose={() => (toolDrawerOpen = false)}>
    <div class="p-4 max-h-[60vh] overflow-y-auto">
      <ToolPanel
        isOpen={true}
        tools={toolCalls()}
        {pendingApproval}
        ontoggle={() => (toolDrawerOpen = false)}
        onapprove={handleToolApprove}
        onreject={handleToolReject}
      />
    </div>
  </Drawer>

  <!-- Main content area -->
  <main class="flex-1 flex overflow-hidden pb-16 lg:pb-0">
    <!-- ... existing chat panel ... -->
  </main>

  <!-- Mobile: Bottom navigation -->
  {#if isMobile}
    <BottomNav items={navItems} activeId={mobileNavActive} onselect={handleNavSelect} />
  {/if}
</div>
```

**Step 3: Add touch-friendly input on mobile**

Update the input form section:

```svelte
<form onsubmit={handleSubmit} class="p-4 border-t border-default bg-secondary safe-bottom">
  <div class="flex gap-2 lg:gap-3">
    <input
      bind:value={input}
      placeholder="Ask about OCI resources..."
      class="chat-input flex-1 px-3 lg:px-4 py-3 rounded-lg text-base"
      disabled={isLoading}
    />
    <button
      type="submit"
      disabled={isLoading || !input.trim()}
      class="btn btn-primary px-4 lg:px-6 touch-target"
    >
      {#if isLoading}
        <Spinner variant="ring" size="sm" color="var(--bg-primary)" />
      {:else}
        <span class="lg:hidden">→</span>
        <span class="hidden lg:inline">Send</span>
      {/if}
    </button>
  </div>
</form>
```

**Step 4: Test on mobile**

Run: `cd oci-ai-chat && pnpm dev`
Test: Use browser DevTools to test mobile layout (375px, 768px, 1024px)

**Step 5: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(layout): implement responsive mobile-first layout with bottom nav and drawers"
```

---

### Task 8: Add Glassmorphism and Atmospheric Depth

**Files:**
- Modify: `src/app.css`

**Step 1: Add glassmorphism panel styles**

Add after `.panel` styles (around line 220):

```css
/* Glassmorphism panels */
.panel-glass {
  background: oklch(0.18 0.025 260 / 0.8);
  backdrop-filter: blur(12px) saturate(1.2);
  border: 1px solid oklch(0.30 0.03 260 / 0.5);
  border-radius: var(--radius-lg);
}

/* Atmospheric background */
.bg-atmosphere {
  background:
    radial-gradient(ellipse at 20% 80%, oklch(0.25 0.08 200 / 0.3), transparent 50%),
    radial-gradient(ellipse at 80% 20%, oklch(0.20 0.06 40 / 0.2), transparent 40%),
    var(--bg-primary);
}

/* Gradient mesh for hero sections */
.gradient-mesh {
  background:
    radial-gradient(at 40% 20%, oklch(0.30 0.10 200 / 0.4) 0px, transparent 50%),
    radial-gradient(at 80% 0%, oklch(0.25 0.08 40 / 0.3) 0px, transparent 50%),
    radial-gradient(at 0% 50%, oklch(0.20 0.06 260 / 0.2) 0px, transparent 50%);
}
```

**Step 2: Add orchestrated motion animations**

Add after existing animations:

```css
/* Staggered fade-up animation */
@keyframes fade-up-stagger {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fade-up {
  animation: fade-up-stagger var(--transition-normal) ease-out forwards;
}

/* Stagger delays for lists */
.stagger-1 { animation-delay: 50ms; }
.stagger-2 { animation-delay: 100ms; }
.stagger-3 { animation-delay: 150ms; }
.stagger-4 { animation-delay: 200ms; }
.stagger-5 { animation-delay: 250ms; }

/* Smooth streaming pulse */
@keyframes stream-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--agent-streaming); }
  50% { box-shadow: 0 0 20px 4px oklch(0.72 0.16 160 / 0.3); }
}

.animate-stream-pulse {
  animation: stream-pulse 2s ease-in-out infinite;
}
```

**Step 3: Commit**

```bash
git add src/app.css
git commit -m "feat(css): add glassmorphism panels and atmospheric depth effects"
```

---

### Task 9: Final Integration Test

**Files:**
- None (manual testing)

**Step 1: Run all tests**

Run: `cd oci-ai-chat && pnpm test`
Expected: All tests pass

**Step 2: Run type check**

Run: `cd oci-ai-chat && pnpm run check 2>&1 | grep -E "Error|found"`
Expected: Only pre-existing errors in registry.ts and +server.ts

**Step 3: Manual testing checklist**

- [ ] Desktop (1024px+): Full 3-column layout
- [ ] Tablet (768px): Sidebar slides in
- [ ] Mobile (375px): Bottom nav visible, drawers work
- [ ] Touch targets are 44px minimum
- [ ] Models load via TanStack Query
- [ ] Sessions list updates with query invalidation
- [ ] Tool panel shows live tool invocations
- [ ] Keyboard shortcuts work (t, r, o, m)

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete AI SDK UI and responsive design upgrade"
```

---

## Summary

| Task | Description | Estimated Time |
|------|-------------|----------------|
| 1 | Extract tool parts utilities | 10 min |
| 2 | Connect ToolPanel to live data | 15 min |
| 3 | Add tool streaming indicator | 10 min |
| 4 | Add fluid typography/spacing | 10 min |
| 5 | Create BottomNav component | 15 min |
| 6 | Create Drawer component | 15 min |
| 7 | Implement responsive layout | 30 min |
| 8 | Add glassmorphism/atmosphere | 10 min |
| 9 | Final integration test | 15 min |

**Total: ~2 hours**
