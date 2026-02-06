# Self-Service Portal UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use @executing-plans to implement this plan task-by-task.

**Goal:** Fix critical navigation and UX issues in the self-service portal to create a cohesive, AI-agent-driven replacement for ServiceNow.

**Architecture:**

- Consolidate AI chat into a unified modal/sidebar (not separate full-page app)
- Add loading states and feedback for all operations
- Fix the broken search box and unify AI access points
- Maintain the portal theme throughout all user interactions

**Tech Stack:** SvelteKit, TypeScript, Tailwind CSS, shadcn-svelte components

---

## Phase 1: Planning & Assessment

### Task 1: Analyze Current Codebase Structure

**Files:**

- Read: `src/routes/+page.svelte`
- Read: `src/routes/api/chat/+server.ts`
- Read: `src/lib/components/` (all components)

**Step 1: Understand the current portal structure**

Run: `ls -la src/routes/ && ls -la src/lib/components/`

Expected: See all route files and component organization

**Step 2: Examine the main page layout**

Run: `head -50 src/routes/+page.svelte`

Expected: See the main layout structure, navigation setup, and component composition

**Step 3: Review API endpoints**

Run: `head -100 src/routes/api/chat/+server.ts`

Expected: Understand how chat messages are handled

**Step 4: Document findings**

Create: `docs/PORTAL_STRUCTURE.md` with:

- Current component hierarchy
- Route structure
- Data flow for AI chat
- Identified integration points

**Step 5: Commit**

```bash
git add docs/PORTAL_STRUCTURE.md
git commit -m "docs: analyze self-service portal structure"
```

---

## Phase 2: Fix Search Functionality

### Task 2: Debug & Fix Main Search Box

**Files:**

- Modify: `src/routes/+page.svelte` (search box component)
- Modify: `src/lib/components/ui/SearchBox.svelte` (if exists, or create)
- Create: `src/tests/search-box.test.ts`

**Step 1: Write failing test for search functionality**

Create: `src/tests/search-box.test.ts`

```typescript
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import SearchBox from '../lib/components/ui/SearchBox.svelte';

describe('SearchBox', () => {
	it('should open AI dialog when user submits search query', async () => {
		const { getByPlaceholderText, getByText } = render(SearchBox);
		const input = getByPlaceholderText(/Ask AI/i);

		fireEvent.change(input, { target: { value: 'List my instances' } });
		fireEvent.submit(input.closest('form'));

		await waitFor(() => {
			expect(getByText(/Executing/i)).toBeInTheDocument();
		});
	});

	it('should show loading state while processing', async () => {
		const { getByPlaceholderText } = render(SearchBox);
		const input = getByPlaceholderText(/Ask AI/i);

		fireEvent.change(input, { target: { value: 'test query' } });
		fireEvent.submit(input.closest('form'));

		await waitFor(() => {
			expect(document.querySelector('[data-testid="loading-spinner"]')).toBeInTheDocument();
		});
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/tests/search-box.test.ts`

Expected: FAIL - SearchBox component doesn't exist or doesn't open dialog

**Step 3: Create SearchBox component**

Create: `src/lib/components/ui/SearchBox.svelte`

```svelte
<script lang="ts">
	import { aiDialogOpen } from '$lib/stores/ui';
	import LoadingSpinner from './LoadingSpinner.svelte';

	let query = '';
	let loading = false;

	async function handleSubmit() {
		if (!query.trim()) return;

		loading = true;
		try {
			// Send query to AI chat endpoint
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: query })
			});

			if (response.ok) {
				// Open dialog and display response
				aiDialogOpen.set(true);
				query = '';
			}
		} finally {
			loading = false;
		}
	}
</script>

<form on:submit|preventDefault={handleSubmit} class="w-full">
	<div class="relative">
		<input
			type="text"
			bind:value={query}
			placeholder="Ask AI: &quot;List my running instances&quot; or &quot;Create a new database&quot;..."
			disabled={loading}
			class="w-full px-4 py-3 pl-10 pr-12 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
		/>

		{#if loading}
			<div class="absolute right-3 top-1/2 -translate-y-1/2">
				<LoadingSpinner size="sm" />
			</div>
		{:else}
			<button
				type="submit"
				disabled={!query.trim()}
				class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-teal-600 disabled:opacity-50"
			>
				<span class="text-sm text-gray-400">Enter to search</span>
			</button>
		{/if}
	</div>
</form>

<style>
	form :global(input:disabled) {
		background-color: #f5f5f5;
	}
</style>
```

**Step 4: Update main page to use new SearchBox**

Modify: `src/routes/+page.svelte`

Replace the existing search input section with:

```svelte
<script lang="ts">
	import SearchBox from '$lib/components/ui/SearchBox.svelte';
	// ... other imports
</script>

<div class="mt-8 mb-12">
	<SearchBox />
</div>
```

**Step 5: Run test to verify it passes**

Run: `npm run test -- src/tests/search-box.test.ts`

Expected: PASS - SearchBox opens dialog on submit with loading state

**Step 6: Test manually**

Run: `npm run dev`

Navigate: `http://localhost:5173/self-service`

Test: Type in search box, press Enter, verify dialog opens with loading indicator

**Step 7: Commit**

```bash
git add src/lib/components/ui/SearchBox.svelte src/routes/+page.svelte src/tests/search-box.test.ts
git commit -m "feat: implement functional search box with loading state"
```

---

## Phase 3: Add Loading States & Feedback

### Task 3: Create LoadingSpinner Component

**Files:**

- Create: `src/lib/components/ui/LoadingSpinner.svelte`
- Create: `src/tests/loading-spinner.test.ts`

**Step 1: Write test for LoadingSpinner**

Create: `src/tests/loading-spinner.test.ts`

```typescript
import { render } from '@testing-library/svelte';
import LoadingSpinner from '../lib/components/ui/LoadingSpinner.svelte';

describe('LoadingSpinner', () => {
	it('renders spinner with default size', () => {
		const { container } = render(LoadingSpinner);
		expect(container.querySelector('[data-testid="spinner"]')).toBeInTheDocument();
	});

	it('accepts size prop', () => {
		const { container } = render(LoadingSpinner, { props: { size: 'lg' } });
		expect(container.querySelector('[data-testid="spinner"].spinner-lg')).toBeInTheDocument();
	});

	it('shows optional loading text', () => {
		const { getByText } = render(LoadingSpinner, { props: { text: 'Processing...' } });
		expect(getByText('Processing...')).toBeInTheDocument();
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/tests/loading-spinner.test.ts`

Expected: FAIL - LoadingSpinner doesn't exist

**Step 3: Create LoadingSpinner component**

Create: `src/lib/components/ui/LoadingSpinner.svelte`

```svelte
<script lang="ts">
	export let size: 'sm' | 'md' | 'lg' = 'md';
	export let text: string | null = null;

	const sizeClasses = {
		sm: 'w-4 h-4',
		md: 'w-6 h-6',
		lg: 'w-8 h-8'
	};
</script>

<div class="flex flex-col items-center justify-center gap-2">
	<div data-testid="spinner" class="{sizeClasses[size]} spinner-{size} animate-spin">
		<svg class="w-full h-full" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" opacity="0.2" />
			<path
				d="M12 2a10 10 0 0110 10"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-dasharray="0 60"
			/>
		</svg>
	</div>
	{#if text}
		<span class="text-sm text-gray-600">{text}</span>
	{/if}
</div>

<style>
	:global(.animate-spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/tests/loading-spinner.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/components/ui/LoadingSpinner.svelte src/tests/loading-spinner.test.ts
git commit -m "feat: create LoadingSpinner component for operation feedback"
```

---

### Task 4: Add Loading States to All Operations

**Files:**

- Modify: `src/lib/components/ui/ToolPanel.svelte`
- Modify: `src/routes/+page.svelte` (quick action buttons)
- Create: `src/tests/operations-feedback.test.ts`

**Step 1: Write test for operation feedback**

Create: `src/tests/operations-feedback.test.ts`

```typescript
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import ToolPanel from '../lib/components/ui/ToolPanel.svelte';

describe('Operation Feedback', () => {
	it('shows loading state while executing action', async () => {
		const { getByText, container } = render(ToolPanel);
		const button = getByText(/List my instances/i);

		fireEvent.click(button);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="loading-spinner"]')).toBeInTheDocument();
		});
	});

	it('disables buttons while loading', async () => {
		const { getByText } = render(ToolPanel);
		const button = getByText(/Check databases/i);

		fireEvent.click(button);

		await waitFor(() => {
			expect(button).toBeDisabled();
		});
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/tests/operations-feedback.test.ts`

Expected: FAIL - Buttons don't show loading state

**Step 3: Update quick action buttons in ToolPanel**

Modify: `src/lib/components/ui/ToolPanel.svelte`

```svelte
<script lang="ts">
	import LoadingSpinner from './LoadingSpinner.svelte';
	import { aiDialogOpen } from '$lib/stores/ui';

	let loadingAction: string | null = null;

	async function executeAction(action: string, command: string) {
		loadingAction = action;
		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: command })
			});

			if (response.ok) {
				aiDialogOpen.set(true);
			}
		} finally {
			loadingAction = null;
		}
	}
</script>

<div class="flex flex-wrap gap-2 mb-6">
	{#each [{ label: 'List my instances', cmd: 'List my running compute instances' }, { label: 'Check databases', cmd: 'Show me all my databases' }, { label: 'View compartments', cmd: 'List all compartments' }, { label: 'Network overview', cmd: 'Show network configuration' }] as action}
		<button
			on:click={() => executeAction(action.label, action.cmd)}
			disabled={loadingAction !== null}
			class="px-4 py-2 bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
		>
			{#if loadingAction === action.label}
				<LoadingSpinner size="sm" />
			{/if}
			{action.label}
		</button>
	{/each}
</div>
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/tests/operations-feedback.test.ts`

Expected: PASS

**Step 5: Test manually**

Run: `npm run dev`

Test: Click quick action buttons, verify loading spinner appears and button disables

**Step 6: Commit**

```bash
git add src/lib/components/ui/ToolPanel.svelte src/tests/operations-feedback.test.ts
git commit -m "feat: add loading states to quick action buttons"
```

---

## Phase 4: Unify AI Chat Navigation

### Task 5: Convert AI Chat to Modal/Sidebar (Not Full-Page)

**Files:**

- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/components/ui/ModelPicker.svelte` (rename/repurpose to AIDialog)
- Create: `src/lib/components/ui/AIDialog.svelte` (unified AI interface)
- Modify: `src/lib/stores/ui.ts` (add dialog state management)
- Create: `src/tests/ai-dialog.test.ts`

**Step 1: Write test for unified AI dialog**

Create: `src/tests/ai-dialog.test.ts`

```typescript
import { render } from '@testing-library/svelte';
import AIDialog from '../lib/components/ui/AIDialog.svelte';
import { aiDialogOpen } from '../lib/stores/ui';

describe('AIDialog', () => {
	it('opens when aiDialogOpen store is true', async () => {
		const { container } = render(AIDialog);

		aiDialogOpen.set(true);

		expect(container.querySelector('[data-testid="ai-dialog"]')).toBeInTheDocument();
	});

	it('closes when close button is clicked', async () => {
		const { getByTestId } = render(AIDialog);

		aiDialogOpen.set(true);

		const closeBtn = getByTestId('close-button');
		closeBtn.click();

		expect(closeBtn).not.toBeInTheDocument();
	});

	it('maintains portal theme consistency', async () => {
		const { container } = render(AIDialog);

		aiDialogOpen.set(true);

		const dialog = container.querySelector('[data-testid="ai-dialog"]');
		expect(dialog).toHaveClass('bg-white'); // Not dark theme
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/tests/ai-dialog.test.ts`

Expected: FAIL

**Step 3: Create unified AIDialog component**

Create: `src/lib/components/ui/AIDialog.svelte`

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { aiDialogOpen } from '$lib/stores/ui';
	import LoadingSpinner from './LoadingSpinner.svelte';

	let messages: Array<{ role: 'user' | 'assistant'; content: string; executing?: boolean }> = [];
	let input = '';
	let scrollContainer: HTMLElement;
	let loading = false;

	onMount(() => {
		// Subscribe to dialog state changes
		return aiDialogOpen.subscribe((isOpen) => {
			if (isOpen && scrollContainer) {
				setTimeout(() => {
					scrollContainer.scrollTop = scrollContainer.scrollHeight;
				}, 0);
			}
		});
	});

	async function sendMessage() {
		if (!input.trim()) return;

		const userMessage = input;
		messages = [...messages, { role: 'user', content: userMessage }];
		input = '';
		loading = true;

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: userMessage, conversationId: 'main' })
			});

			if (response.ok) {
				const data = await response.json();
				messages = [
					...messages,
					{ role: 'assistant', content: data.response, executing: data.executing }
				];

				if (scrollContainer) {
					scrollContainer.scrollTop = scrollContainer.scrollHeight;
				}
			}
		} finally {
			loading = false;
		}
	}

	function closeDialog() {
		aiDialogOpen.set(false);
	}
</script>

{#if $aiDialogOpen}
	<div class="fixed inset-0 bg-black/50 z-40" on:click={closeDialog} />

	<div
		data-testid="ai-dialog"
		class="fixed right-0 top-0 bottom-0 w-96 bg-white shadow-lg z-50 flex flex-col"
	>
		<!-- Header -->
		<div class="border-b p-4 flex items-center justify-between">
			<h2 class="text-lg font-semibold">AI Assistant</h2>
			<button
				data-testid="close-button"
				on:click={closeDialog}
				class="text-gray-500 hover:text-gray-700"
			>
				✕
			</button>
		</div>

		<!-- Messages -->
		<div bind:this={scrollContainer} class="flex-1 overflow-y-auto p-4 space-y-4">
			{#each messages as msg}
				<div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
					<div
						class="max-w-xs px-4 py-2 rounded-lg {msg.role === 'user'
							? 'bg-teal-600 text-white'
							: 'bg-gray-100 text-gray-800'}"
					>
						<p class="text-sm">{msg.content}</p>
						{#if msg.executing}
							<div class="mt-2 flex items-center gap-2">
								<LoadingSpinner size="sm" />
								<span class="text-xs opacity-75">Executing...</span>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		<!-- Input -->
		<div class="border-t p-4 flex gap-2">
			<input
				bind:value={input}
				on:keydown={(e) => e.key === 'Enter' && sendMessage()}
				placeholder="Ask about your resources..."
				disabled={loading}
				class="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-100"
			/>
			<button
				on:click={sendMessage}
				disabled={!input.trim() || loading}
				class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{#if loading}
					<LoadingSpinner size="sm" />
				{:else}
					Send
				{/if}
			</button>
		</div>
	</div>
{/if}

<style>
	:global(.fixed) {
		position: fixed;
	}
</style>
```

**Step 4: Update main page to use AIDialog**

Modify: `src/routes/+page.svelte`

Add at the bottom of the component:

```svelte
<script lang="ts">
	import AIDialog from '$lib/components/ui/AIDialog.svelte';
	// ... other imports
</script>

<!-- ... existing content ... -->

<AIDialog />
```

**Step 5: Update store**

Modify: `src/lib/stores/ui.ts` (or create if doesn't exist)

```typescript
import { writable } from 'svelte/store';

export const aiDialogOpen = writable(false);
export const currentTab = writable('home');
```

**Step 6: Remove Services and AI Chat tabs (or repurpose them)**

Modify: `src/routes/+page.svelte`

Replace tabs with:

```svelte
<nav class="flex gap-4 border-b">
	<a href="/self-service" class="px-4 py-2 border-b-2 border-teal-600">Home</a>
	<!-- Services and AI Chat tabs removed - moved to modal -->
</nav>
```

**Step 7: Run test to verify it passes**

Run: `npm run test -- src/tests/ai-dialog.test.ts`

Expected: PASS

**Step 8: Test manually**

Run: `npm run dev`

Test:

- Click "Ask AI Assistant" - dialog opens on right side
- Click search box and submit - same dialog opens
- Click close button - dialog closes
- Verify theme is consistent (light, not dark)

**Step 9: Commit**

```bash
git add src/lib/components/ui/AIDialog.svelte src/lib/stores/ui.ts src/routes/+page.svelte src/tests/ai-dialog.test.ts
git commit -m "feat: unify AI chat into modal sidebar with portal theme consistency"
```

---

## Phase 5: Fix Navigation & Cleanup

### Task 6: Remove Broken Navigation Elements

**Files:**

- Modify: `src/routes/+page.svelte` (remove Services/AI Chat tabs)
- Create: `src/tests/navigation.test.ts`

**Step 1: Write test for navigation**

Create: `src/tests/navigation.test.ts`

```typescript
import { render, fireEvent } from '@testing-library/svelte';
import Page from '../routes/+page.svelte';

describe('Navigation', () => {
	it('does not have broken Services tab', () => {
		const { queryByText } = render(Page);
		expect(queryByText(/Services/i)).not.toBeInTheDocument();
	});

	it('AI Chat is accessible via button not tab navigation', () => {
		const { getByText } = render(Page);
		expect(getByText('Ask AI Assistant')).toBeInTheDocument();
	});

	it('maintains portal theme throughout', () => {
		const { container } = render(Page);
		// Verify no dark theme elements are present in main view
		expect(container.querySelector('.bg-gray-900')).not.toBeInTheDocument();
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/tests/navigation.test.ts`

Expected: FAIL (Services tab still exists)

**Step 3: Clean up navigation in main page**

Modify: `src/routes/+page.svelte`

```svelte
<!-- Remove this entire section if it exists: -->
<!-- <nav class="flex gap-4">
  <a href="/">Home</a>
  <a href="/services">Services</a>
  <a href="/ai-chat">AI Chat</a>
</nav> -->

<!-- Keep only: -->
<div class="flex items-center justify-between p-4 border-b">
	<h1 class="text-2xl font-bold">Cloud Portal</h1>
	<!-- Only main navigation or branding here -->
</div>
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/tests/navigation.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/routes/+page.svelte src/tests/navigation.test.ts
git commit -m "fix: remove broken navigation tabs, simplify header"
```

---

### Task 7: Add Error Handling & Feedback

**Files:**

- Modify: `src/lib/components/ui/AIDialog.svelte`
- Modify: `src/routes/api/chat/+server.ts`
- Create: `src/tests/error-handling.test.ts`

**Step 1: Write test for error handling**

Create: `src/tests/error-handling.test.ts`

```typescript
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import AIDialog from '../lib/components/ui/AIDialog.svelte';

describe('Error Handling', () => {
	it('shows error message on API failure', async () => {
		// Mock fetch to fail
		global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500 }));

		const { getByText, getByPlaceholderText } = render(AIDialog);
		const input = getByPlaceholderText(/Ask about/i);

		fireEvent.change(input, { target: { value: 'test' } });
		fireEvent.click(getByText('Send'));

		await waitFor(() => {
			expect(getByText(/error|failed/i)).toBeInTheDocument();
		});
	});

	it('shows error message in chat for failed operations', async () => {
		global.fetch = jest.fn(() =>
			Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve({
						error: 'Failed to list instances',
						executing: false
					})
			})
		);

		const { getByText, getByPlaceholderText } = render(AIDialog);

		fireEvent.change(getByPlaceholderText(/Ask about/i), { target: { value: 'list' } });
		fireEvent.click(getByText('Send'));

		await waitFor(() => {
			expect(getByText(/Failed to list/i)).toBeInTheDocument();
		});
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/tests/error-handling.test.ts`

Expected: FAIL - No error handling in AIDialog

**Step 3: Update AIDialog with error handling**

Modify: `src/lib/components/ui/AIDialog.svelte`

Add error state and display:

```svelte
<script lang="ts">
	// ... existing code ...
	let error: string | null = null;

	async function sendMessage() {
		if (!input.trim()) return;

		const userMessage = input;
		messages = [...messages, { role: 'user', content: userMessage }];
		input = '';
		loading = true;
		error = null;

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: userMessage })
			});

			if (!response.ok) {
				throw new Error(`API Error: ${response.status}`);
			}

			const data = await response.json();

			if (data.error) {
				error = data.error;
				messages = [...messages, { role: 'assistant', content: `Error: ${data.error}` }];
			} else {
				messages = [...messages, { role: 'assistant', content: data.response }];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
			messages = [...messages, { role: 'assistant', content: `Error: ${error}` }];
		} finally {
			loading = false;
		}
	}
</script>

<!-- In template, add error display: -->
{#if error}
	<div class="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
		{error}
	</div>
{/if}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/tests/error-handling.test.ts`

Expected: PASS

**Step 5: Test manually**

Run: `npm run dev`

Test: Try operations with network errors to verify error message appears

**Step 6: Commit**

```bash
git add src/lib/components/ui/AIDialog.svelte src/tests/error-handling.test.ts
git commit -m "feat: add error handling and user feedback"
```

---

## Phase 6: Testing & Validation

### Task 8: End-to-End Testing

**Files:**

- Create: `src/tests/e2e/portal.spec.ts`

**Step 1: Write E2E test**

Create: `src/tests/e2e/portal.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Self-Service Portal', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('http://localhost:5173/self-service');
	});

	test('complete user flow: search > dialog > close', async ({ page }) => {
		// Type in search box
		await page.fill('input[placeholder*="Ask AI"]', 'List my instances');

		// Submit
		await page.press('input[placeholder*="Ask AI"]', 'Enter');

		// Wait for dialog
		await expect(page.locator('[data-testid="ai-dialog"]')).toBeVisible();

		// Verify loading state
		await expect(page.locator('[data-testid="loading-spinner"]')).toBeVisible();

		// Wait for response
		await page.waitForTimeout(2000);

		// Close dialog
		await page.click('[data-testid="close-button"]');

		// Verify closed
		await expect(page.locator('[data-testid="ai-dialog"]')).not.toBeVisible();
	});

	test('quick action button opens dialog', async ({ page }) => {
		// Click quick action
		await page.click('button:has-text("List my instances")');

		// Dialog should open
		await expect(page.locator('[data-testid="ai-dialog"]')).toBeVisible();
	});

	test('no broken navigation tabs exist', async ({ page }) => {
		// Verify no Services tab
		await expect(page.locator('text=Services')).not.toBeVisible();

		// Verify theme is light (not dark)
		const body = page.locator('body');
		await expect(body).not.toHaveClass(/dark/);
	});
});
```

**Step 2: Run E2E tests**

Run: `npm run test:e2e`

Expected: PASS

**Step 3: Commit**

```bash
git add src/tests/e2e/portal.spec.ts
git commit -m "test: add end-to-end tests for portal workflow"
```

---

### Task 9: Documentation & Final Review

**Files:**

- Create: `docs/PORTAL_IMPROVEMENTS_COMPLETE.md`
- Modify: `README.md` (if applicable)

**Step 1: Document improvements**

Create: `docs/PORTAL_IMPROVEMENTS_COMPLETE.md`

```markdown
# Portal Improvements - Completion Summary

## Issues Fixed

### 1. Search Functionality

- ✅ Implemented functional search box
- ✅ Added loading states
- ✅ Integrated with AI dialog

### 2. Navigation Consistency

- ✅ Removed broken Services/AI Chat tabs
- ✅ Unified AI access into single modal
- ✅ Maintained portal theme throughout

### 3. User Feedback

- ✅ Added loading spinners for operations
- ✅ Added error handling with user messages
- ✅ Disabled buttons during operations

### 4. Architecture

- ✅ AI chat is now a modal sidebar (not separate app)
- ✅ Consistent light theme throughout
- ✅ Clear navigation and entry points

## Testing

- ✅ Unit tests for all components
- ✅ Integration tests for operations
- ✅ E2E tests for complete workflows

## Files Modified

- src/routes/+page.svelte
- src/lib/components/ui/
- src/lib/stores/ui.ts
- src/routes/api/chat/+server.ts

## Next Steps

1. Deploy to staging
2. User acceptance testing
3. Gather feedback
4. Iterate on remaining UX improvements
```

**Step 2: Final commit**

```bash
git add docs/PORTAL_IMPROVEMENTS_COMPLETE.md
git commit -m "docs: document portal improvements and completion status"
```

---

## Success Criteria

- ✅ Search box is functional and shows loading states
- ✅ AI chat is unified into a modal/sidebar (not separate full-page app)
- ✅ No broken navigation tabs
- ✅ Portal theme is consistent throughout
- ✅ All operations show loading feedback
- ✅ Error messages are user-friendly
- ✅ Tests pass (unit, integration, E2E)
- ✅ Code follows project conventions
- ✅ Changes committed with clear messages
