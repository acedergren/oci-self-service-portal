<script lang="ts">
	import type { PageData } from './$types';
	import { Spinner, Badge, ModelPicker, ApprovalDialog } from '$lib/components/ui/index.js';
	import MarkdownRenderer from '$lib/components/ui/MarkdownRenderer.svelte';
	import { ThoughtPanel, ToolPanel, AgentWorkflowPanel } from '$lib/components/panels/index.js';
	import type { AgentPlan } from '$lib/components/panels/index.js';
	import type { ToolCall } from '@portal/types/tools/types';
	import { inferApprovalLevel, requiresApproval } from '@portal/shared/tools/types';
	import { useQueryClient } from '@tanstack/svelte-query';
	import {
		useModels,
		useSessions,
		useCreateSession,
		useDeleteSession
	} from '@portal/shared/query/hooks';
	import { queryKeys, fetchSessionDetail } from '@portal/shared/query';
	import { BottomNav, Drawer } from '$lib/components/mobile/index.js';
	import { createChatContext } from '$lib/components/chat/ai-context.svelte.js';

	let { data }: { data: PageData } = $props();

	// TanStack Query hooks for server state
	const queryClient = useQueryClient();
	const modelsQuery = useModels();
	const sessionsQuery = useSessions();
	const createSessionMutation = useCreateSession();
	const deleteSessionMutation = useDeleteSession();

	// Derived state from queries (v6: runes — no $ prefix needed)
	const availableModels = $derived(modelsQuery.data?.models ?? []);
	const currentRegion = $derived(
		modelsQuery.data?.region ?? (modelsQuery.isPending ? 'loading...' : 'unknown')
	);
	const sessions = $derived(sessionsQuery.data?.sessions ?? data.sessions);

	// Local UI state (not server state)
	// localSessionId is intentionally local - we update it when user switches sessions
	// Initial value comes from server but is managed locally thereafter
	let localSessionId = $state<string | null>(null);
	let sidebarOpen = $state(true);

	// Sync initial session ID from server data (only on first load)
	$effect(() => {
		if (localSessionId === null && data.currentSessionId) {
			localSessionId = data.currentSessionId;
		}
	});
	let sidePanelOpen = $state(true);
	let input = $state('');

	// Panel state
	let thoughtOpen = $state(false);
	let toolsOpen = $state(true);
	let workflowOpen = $state(true);

	// Workflow state
	let currentWorkflowPlan = $state<AgentPlan | undefined>(undefined);

	// Model state
	let selectedModel = $state('meta.llama-3.3-70b-instruct');
	let modelPickerOpen = $state(false);

	// Theme state
	let theme = $state<'dark' | 'light'>('dark');

	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
		if (typeof document !== 'undefined') {
			document.documentElement.setAttribute('data-theme', theme);
		}
	}

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

	// Token usage state
	let sessionTokens = $state({ input: 0, output: 0, cost: 0 });

	// Refresh usage when streaming completes
	let previousStatus = $state<string | undefined>(undefined);
	$effect(() => {
		const status = chat.status;
		// When transitioning from streaming to ready, refresh data
		if (previousStatus === 'streaming' && status === 'ready') {
			refreshSessionData();
		}
		previousStatus = status;
	});

	async function refreshSessionData() {
		if (!localSessionId) return;

		// Invalidate sessions to refetch titles
		queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all() });

		// Fetch usage for current session
		try {
			const detail = await fetchSessionDetail(localSessionId);
			if (detail.usage) {
				sessionTokens = { input: 0, output: detail.usage.tokens, cost: detail.usage.cost };
			}
		} catch {
			// Ignore errors during refresh
		}
	}

	// Error notification state
	let errorNotification = $state<{ message: string; timestamp: number } | null>(null);

	// Show error notification to user
	function showError(message: string) {
		const ts = Date.now();
		errorNotification = { message, timestamp: ts };
		// Auto-dismiss after 5 seconds
		setTimeout(() => {
			if (errorNotification?.timestamp === ts) {
				errorNotification = null;
			}
		}, 5000);
	}

	function dismissError() {
		errorNotification = null;
	}

	// Custom fetch that injects the current model into request body
	const modelAwareFetch: typeof fetch = async (input, init) => {
		if (init?.body && typeof init.body === 'string') {
			try {
				const body = JSON.parse(init.body);
				body.model = selectedModel;
				init = { ...init, body: JSON.stringify(body) };
			} catch {
				// Not JSON, pass through
			}
		}
		return fetch(input, init);
	};

	// Create shared chat context — encapsulates Chat instance + derived state
	const ctx = createChatContext({ customFetch: modelAwareFetch });
	const { chat } = ctx;

	// Watch tool calls for ones that need approval
	$effect(() => {
		const calls = ctx.toolCalls;
		if (calls.length > 0 && !ctx.pendingApproval && !ctx.isExecutingApproval) {
			checkForPendingApprovals();
		}
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!input.trim()) return;

		const isFirstMessage = chat.messages.length === 0;

		// Simulate thinking state
		ctx.currentThought = 'Analyzing your request...';

		chat.sendMessage({ text: input });
		input = '';

		// Clear thought after a delay
		setTimeout(() => {
			ctx.currentThought = undefined;
		}, 2000);

		// Refresh session title after first message
		if (isFirstMessage) {
			setTimeout(() => {
				queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all() });
			}, 1000);
		}
	}

	async function handleNewSession() {
		const result = await createSessionMutation.mutateAsync();

		localSessionId = result.id;
		chat.messages = [];
		sessionTokens = { input: 0, output: 0, cost: 0 };

		// Clear agent state
		ctx.clearAgentState();
	}

	async function handleSelectSession(id: string) {
		try {
			const detail = await fetchSessionDetail(id);

			localSessionId = detail.session.id;

			// Load messages into chat
			chat.messages = detail.messages.map((msg, index) => ({
				id: `msg-${index}`,
				role: msg.role,
				parts: [{ type: 'text', text: msg.content }]
			}));

			// Update token usage
			if (detail.usage) {
				sessionTokens = { input: 0, output: detail.usage.tokens, cost: detail.usage.cost };
			}

			// Clear agent state
			ctx.clearAgentState();
		} catch (error) {
			console.error('Failed to load session:', error);
		}
	}

	async function handleDeleteSession(id: string) {
		await deleteSessionMutation.mutateAsync(id);

		if (id === localSessionId) {
			await handleNewSession();
		}
	}

	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
	}

	function toggleSidePanel() {
		sidePanelOpen = !sidePanelOpen;
	}

	const navItems = $derived([
		{ id: 'chat', label: 'Chat', icon: '💬' },
		{ id: 'sessions', label: 'Sessions', icon: '📝', badge: sessions.length },
		{
			id: 'tools',
			label: 'Tools',
			icon: '⚙',
			badge: ctx.toolCalls.filter((t) => t.status === 'running').length
		},
		{ id: 'settings', label: 'Settings', icon: '⚡' }
	]);

	function handleNavSelect(id: string) {
		mobileNavActive = id as typeof mobileNavActive;
		if (id === 'sessions') sessionDrawerOpen = true;
		if (id === 'tools') toolDrawerOpen = true;
	}

	async function handleToolApprove(toolCallId: string) {
		if (!ctx.pendingApproval || ctx.isExecutingApproval) return;

		ctx.isExecutingApproval = true;

		try {
			const response = await fetch('/api/tools/execute', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					toolCallId: ctx.pendingApproval.toolCallId,
					toolName: ctx.pendingApproval.toolName,
					args: ctx.pendingApproval.args,
					approved: true,
					sessionId: localSessionId
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`HTTP ${response.status}: ${errorText}`);
			}

			const result = await response.json();

			if (result.success) {
				// Tool executed successfully - could add the result to chat
				console.log('Tool executed:', result);
			} else {
				showError(`Tool execution failed: ${result.error || 'Unknown error'}`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			console.error('Failed to execute approved tool:', error);
			showError(`Failed to execute tool: ${message}`);
		} finally {
			ctx.isExecutingApproval = false;
			ctx.pendingApproval = undefined;
		}
	}

	async function handleToolReject(toolCallId: string) {
		if (!ctx.pendingApproval) return;

		// Log the rejection
		try {
			const response = await fetch('/api/tools/execute', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					toolCallId: ctx.pendingApproval.toolCallId,
					toolName: ctx.pendingApproval.toolName,
					args: ctx.pendingApproval.args,
					approved: false,
					sessionId: localSessionId
				})
			});

			if (!response.ok) {
				console.warn('Failed to log rejection:', response.status);
			}
		} catch (error) {
			console.error('Failed to log rejection:', error);
		}

		ctx.pendingApproval = undefined;
	}

	// Check tool calls for ones that need approval
	function checkForPendingApprovals() {
		// Guard against concurrent fetches (race condition fix)
		if (ctx.pendingApproval || ctx.fetchingApprovalFor) return;

		const calls = ctx.toolCalls;
		// Find any tool that's in 'pending' state and requires approval
		for (const call of calls) {
			if (call.status === 'pending') {
				// Use the proper approval level inference from types.ts
				const approvalLevel = inferApprovalLevel(call.name);

				if (requiresApproval(approvalLevel)) {
					// Set guard before async operation
					ctx.fetchingApprovalFor = call.id;
					// Fetch tool info to create approval request
					fetchToolApprovalInfo(call);
					return; // Only process one at a time
				}
			}
		}
	}

	async function fetchToolApprovalInfo(call: ToolCall) {
		try {
			const response = await fetch(`/api/tools/execute?toolName=${call.name}`);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`HTTP ${response.status}: ${errorText}`);
			}

			const info = await response.json();

			if (info.requiresApproval) {
				ctx.pendingApproval = {
					toolCallId: call.id,
					toolName: call.name,
					category: info.category,
					approvalLevel: info.approvalLevel,
					args: call.args,
					description: info.description,
					warningMessage: info.warning,
					estimatedImpact: info.impact,
					createdAt: Date.now()
				};
			}
		} catch (error) {
			console.error('Failed to fetch tool info:', error);
			showError(`Failed to get tool info for ${call.name}`);
		} finally {
			// Always clear the guard to allow future checks
			ctx.fetchingApprovalFor = null;
		}
	}

	// Keyboard shortcuts
	function handleKeydown(event: KeyboardEvent) {
		if (
			event.key === 't' &&
			!event.ctrlKey &&
			!event.metaKey &&
			document.activeElement?.tagName !== 'INPUT'
		) {
			event.preventDefault();
			thoughtOpen = !thoughtOpen;
		}
		if (
			event.key === 'o' &&
			!event.ctrlKey &&
			!event.metaKey &&
			document.activeElement?.tagName !== 'INPUT'
		) {
			event.preventDefault();
			toolsOpen = !toolsOpen;
		}
		if (
			event.key === 'w' &&
			!event.ctrlKey &&
			!event.metaKey &&
			document.activeElement?.tagName !== 'INPUT'
		) {
			event.preventDefault();
			workflowOpen = !workflowOpen;
		}
		if (
			event.key === 'm' &&
			!event.ctrlKey &&
			!event.metaKey &&
			document.activeElement?.tagName !== 'INPUT'
		) {
			event.preventDefault();
			modelPickerOpen = !modelPickerOpen;
		}

		if (ctx.pendingApproval) {
			if (event.key === 'y') {
				handleToolApprove(ctx.pendingApproval.toolCallId);
			} else if (event.key === 'n') {
				handleToolReject(ctx.pendingApproval.toolCallId);
			}
		}

		if ((event.ctrlKey || event.metaKey) && event.key === 'n') {
			event.preventDefault();
			handleNewSession();
		}
	}

	// Derived status flags — read from context for consistency
	const isLoading = $derived(ctx.isLoading);
	const isThinking = $derived(ctx.isThinking);
	const isStreaming = $derived(ctx.isStreaming);
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-[calc(100dvh-1.5rem)] bg-primary text-primary overflow-hidden">
	<!-- Session sidebar (desktop only) -->
	{#if sidebarOpen && !isMobile}
		<aside
			class="w-64 border-r border-default bg-secondary flex-shrink-0 hidden lg:flex flex-col animate-slide-in-right"
		>
			<div class="p-4 border-b border-muted">
				<div class="flex items-center gap-3">
					<div
						class="h-10 w-10 rounded-lg bg-accent flex items-center justify-center text-primary font-bold"
					>
						◆
					</div>
					<div>
						<h1 class="font-bold text-lg text-primary">OCI GenAI</h1>
						<p class="text-xs text-tertiary">Agentic Chat</p>
					</div>
				</div>
			</div>

			<!-- New Chat Button -->
			<div class="p-3">
				<button
					onclick={handleNewSession}
					class="w-full btn btn-secondary"
					disabled={createSessionMutation.isPending}
				>
					{#if createSessionMutation.isPending}
						<Spinner variant="ring" size="sm" />
					{:else}
						+ New Chat
					{/if}
				</button>
			</div>

			<!-- Sessions List -->
			<div class="flex-1 overflow-y-auto p-2 space-y-1">
				{#if sessionsQuery.isPending}
					<div class="flex items-center justify-center py-4">
						<Spinner variant="dots" />
					</div>
				{:else if sessionsQuery.isError}
					<div class="text-error text-sm px-3 py-2">Failed to load sessions</div>
				{:else}
					{#each sessions as session (session.id)}
						<button
							onclick={() => handleSelectSession(session.id)}
							class="w-full text-left px-3 py-2 text-sm rounded-lg transition-fast group {localSessionId ===
							session.id
								? 'bg-elevated border border-focused'
								: 'hover:bg-hover border border-transparent'}"
						>
							<div class="flex items-center justify-between">
								<span class="truncate text-primary">{session.title || 'New Chat'}</span>
								{#if localSessionId === session.id}
									<span class="text-accent">●</span>
								{/if}
							</div>
							<div class="flex items-center gap-2 mt-1">
								<Badge variant="default">{session.model.split('.').pop()}</Badge>
							</div>
						</button>
					{/each}
				{/if}
			</div>
		</aside>
	{/if}

	<!-- Mobile Session Drawer -->
	<Drawer isOpen={sessionDrawerOpen} side="left" onclose={() => (sessionDrawerOpen = false)}>
		<div class="p-4 border-b border-muted">
			<div class="flex items-center gap-3">
				<div
					class="h-10 w-10 rounded-lg bg-accent flex items-center justify-center text-primary font-bold"
				>
					◆
				</div>
				<div>
					<h1 class="font-bold text-lg text-primary">OCI GenAI</h1>
					<p class="text-xs text-tertiary">Agentic Chat</p>
				</div>
			</div>
		</div>

		<!-- New Chat Button -->
		<div class="p-3">
			<button
				onclick={handleNewSession}
				class="w-full btn btn-secondary"
				disabled={createSessionMutation.isPending}
			>
				{#if createSessionMutation.isPending}
					<Spinner variant="ring" size="sm" />
				{:else}
					+ New Chat
				{/if}
			</button>
		</div>

		<!-- Sessions List -->
		<div class="flex-1 overflow-y-auto p-2 space-y-1">
			{#if sessionsQuery.isPending}
				<div class="flex items-center justify-center py-4">
					<Spinner variant="dots" />
				</div>
			{:else if sessionsQuery.isError}
				<div class="text-error text-sm px-3 py-2">Failed to load sessions</div>
			{:else}
				{#each sessions as session (session.id)}
					<button
						onclick={() => {
							handleSelectSession(session.id);
							sessionDrawerOpen = false;
						}}
						class="w-full text-left px-3 py-2 text-sm rounded-lg transition-fast group {localSessionId ===
						session.id
							? 'bg-elevated border border-focused'
							: 'hover:bg-hover border border-transparent'}"
					>
						<div class="flex items-center justify-between">
							<span class="truncate text-primary">{session.title || 'New Chat'}</span>
							{#if localSessionId === session.id}
								<span class="text-accent">●</span>
							{/if}
						</div>
						<div class="flex items-center gap-2 mt-1">
							<Badge variant="default">{session.model.split('.').pop()}</Badge>
						</div>
					</button>
				{/each}
			{/if}
		</div>
	</Drawer>

	<!-- Main content area -->
	<main class="flex-1 flex overflow-hidden pb-16 lg:pb-0">
		<!-- Chat panel -->
		<div
			class="flex-1 flex flex-col min-h-0"
			style:width={sidePanelOpen ? 'var(--panel-chat)' : '100%'}
		>
			<!-- Header -->
			<header class="flex items-center justify-between p-4 border-b border-default bg-secondary">
				<div class="flex items-center gap-3">
					<span class="text-accent font-bold">◆</span>
					<button
						onclick={() => (modelPickerOpen = true)}
						class="hover:opacity-80 transition-fast cursor-pointer"
						title="Change model [m]"
					>
						<Badge variant="default">{selectedModel.split('.').pop()}</Badge>
					</button>
				</div>

				<div class="flex items-center gap-4">
					<!-- Status indicator -->
					<div class="flex items-center gap-2">
						{#if isThinking}
							<Spinner variant="pulse" color="var(--agent-thinking)" />
							<span class="text-thinking text-sm">Thinking</span>
						{:else if isStreaming}
							<Spinner variant="dots" color="var(--agent-streaming)" />
							<span class="text-streaming text-sm">Streaming</span>
						{:else}
							<span class="text-tertiary">○</span>
							<span class="text-tertiary text-sm">Ready</span>
						{/if}
					</div>

					<!-- Theme toggle -->
					<button
						onclick={toggleTheme}
						class="btn btn-secondary text-sm"
						aria-label="Toggle theme"
						title={theme === 'dark' ? 'Switch to Golden Hour' : 'Switch to Bioluminescence'}
					>
						{theme === 'dark' ? '☀' : '🌙'}
					</button>

					<!-- Toggle side panel -->
					<button
						onclick={toggleSidePanel}
						class="btn btn-secondary text-sm"
						aria-label="Toggle side panel"
					>
						{sidePanelOpen ? '◀' : '▶'}
					</button>
				</div>
			</header>

			<!-- Messages -->
			<div class="flex-1 overflow-y-auto p-4 space-y-4">
				{#if chat.messages.length === 0}
					<div class="flex items-center justify-center h-full">
						<div class="text-center space-y-4">
							<div class="text-6xl text-accent animate-pulse-glow">◆</div>
							<h2 class="text-xl font-semibold text-primary">OCI GenAI Agent</h2>
							<p class="text-secondary max-w-md">
								Manage your Oracle Cloud Infrastructure resources with natural language. Ask me to
								list instances, create VCNs, manage databases, and more.
							</p>
							<div class="flex flex-wrap justify-center gap-2 mt-4">
								<Badge variant="default">Compute</Badge>
								<Badge variant="default">Networking</Badge>
								<Badge variant="default">Storage</Badge>
								<Badge variant="default">Database</Badge>
								<Badge variant="default">Identity</Badge>
							</div>
						</div>
					</div>
				{:else}
					{#each chat.messages as message, index (index)}
						<div class="message flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
							<div
								class="max-w-[80%] rounded-lg px-4 py-3 {message.role === 'user'
									? 'message-user'
									: 'message-assistant'}"
							>
								<div class="flex items-center gap-2 mb-2">
									<span class={message.role === 'user' ? 'text-accent' : 'text-primary'}>
										{message.role === 'user' ? 'You' : 'Agent'}
									</span>
									{#if message.role === 'assistant' && index === chat.messages.length - 1 && isStreaming}
										<Spinner variant="dots" size="sm" color="var(--agent-streaming)" />
									{/if}
								</div>
								{#each message.parts as part, partIndex (partIndex)}
									{#if part.type === 'text'}
										<MarkdownRenderer content={part.text} class="text-primary" />
									{:else if part.type === 'reasoning'}
										<details class="mt-2 border border-muted rounded-lg overflow-hidden" open>
											<summary
												class="px-3 py-2 bg-elevated cursor-pointer text-secondary hover:text-primary flex items-center gap-2"
											>
												<span class="text-accent">💭</span>
												<span class="text-sm font-medium">Reasoning</span>
											</summary>
											<div class="px-3 py-2 text-sm text-secondary whitespace-pre-wrap bg-primary">
												{(part as { type: 'reasoning'; text: string }).text}
											</div>
										</details>
									{:else if part.type.startsWith('tool-') || part.type === 'dynamic-tool'}
										{@const toolPart = part as unknown as {
											type: string;
											toolCallId: string;
											state: string;
											input?: unknown;
											output?: unknown;
										}}
										{@const toolName =
											part.type === 'dynamic-tool' ? 'tool' : part.type.replace('tool-', '')}
										<div class="message-tool mt-2 rounded px-3 py-2 border border-muted">
											<div class="flex items-center gap-2">
												<span class="text-accent">⚙</span>
												<Badge variant="info">{toolName}</Badge>
												<span class="text-tertiary text-xs">
													{toolPart.state === 'result' ? '✓ completed' : toolPart.state}
												</span>
											</div>
											{#if toolPart.state === 'result' && toolPart.output}
												{@const result = toolPart.output as { success?: boolean; data?: unknown }}
												{#if result.success && result.data}
													<div class="mt-2 text-sm text-secondary">
														{#if Array.isArray((result.data as { data?: unknown[] }).data)}
															Found {(result.data as { data: unknown[] }).data.length} item(s)
														{:else}
															Operation completed successfully
														{/if}
													</div>
												{/if}
												<details class="mt-2" open>
													<summary class="cursor-pointer text-secondary text-sm hover:text-primary">
														View data
													</summary>
													<pre
														class="mt-2 p-2 bg-primary rounded text-xs overflow-x-auto max-h-64 overflow-y-auto">{JSON.stringify(
															toolPart.output,
															null,
															2
														)}</pre>
												</details>
											{/if}
										</div>
									{/if}
								{/each}
								{#if message.role === 'assistant' && index === chat.messages.length - 1 && isStreaming}
									<span class="inline-block w-2 h-4 bg-streaming animate-typing-cursor ml-1"></span>
								{/if}
							</div>
						</div>
					{/each}

					{#if isLoading && chat.messages.length > 0 && chat.messages[chat.messages.length - 1].role === 'user'}
						<div class="flex justify-start">
							<div class="message-assistant rounded-lg px-4 py-3">
								<div class="flex items-center gap-2">
									<Spinner variant="dots" />
									<span class="text-secondary">Thinking...</span>
								</div>
							</div>
						</div>
					{/if}
				{/if}
			</div>

			<!-- Input form -->
			<form onsubmit={handleSubmit} class="p-4 border-t border-default bg-secondary safe-bottom">
				<div class="flex gap-2 lg:gap-3">
					<input
						bind:value={input}
						placeholder="Ask about OCI resources or compare cloud costs..."
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
		</div>

		<!-- Side panel (thought, reasoning, tools) - desktop only -->
		{#if sidePanelOpen}
			<aside
				class="w-80 border-l border-default bg-secondary overflow-y-auto p-3 animate-slide-in-right hidden lg:block"
			>
				<ThoughtPanel
					isOpen={thoughtOpen}
					thought={ctx.currentThought}
					{isThinking}
					ontoggle={() => (thoughtOpen = !thoughtOpen)}
				/>

				<ToolPanel
					isOpen={toolsOpen}
					tools={ctx.toolCalls}
					pendingApproval={ctx.pendingApproval}
					ontoggle={() => (toolsOpen = !toolsOpen)}
					onapprove={handleToolApprove}
					onreject={handleToolReject}
				/>

				<AgentWorkflowPanel
					isOpen={workflowOpen}
					plan={currentWorkflowPlan}
					ontoggle={() => (workflowOpen = !workflowOpen)}
				/>
			</aside>
		{/if}
	</main>

	<!-- Mobile Tools Drawer -->
	<Drawer isOpen={toolDrawerOpen} side="bottom" onclose={() => (toolDrawerOpen = false)}>
		<div class="p-3">
			<ToolPanel
				isOpen={true}
				tools={ctx.toolCalls}
				pendingApproval={ctx.pendingApproval}
				ontoggle={() => {}}
				onapprove={handleToolApprove}
				onreject={handleToolReject}
			/>
		</div>
	</Drawer>

	<!-- Mobile Bottom Navigation -->
	{#if isMobile}
		<BottomNav items={navItems} activeId={mobileNavActive} onselect={handleNavSelect} />
	{/if}
</div>

<!-- Model Picker -->
<ModelPicker
	isOpen={modelPickerOpen}
	currentModel={selectedModel}
	models={availableModels}
	region={currentRegion}
	onselect={(model) => (selectedModel = model)}
	onclose={() => (modelPickerOpen = false)}
/>

<!-- Approval Dialog for destructive operations -->
{#if ctx.pendingApproval}
	{@const approval = ctx.pendingApproval}
	<ApprovalDialog
		{approval}
		onApprove={() => handleToolApprove(approval.toolCallId)}
		onReject={() => handleToolReject(approval.toolCallId)}
	/>
{/if}

<!-- Error notification toast -->
{#if errorNotification}
	<div class="fixed top-4 right-4 z-50 animate-slide-in-right">
		<div
			class="bg-error/90 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 max-w-md"
		>
			<span class="text-lg">!</span>
			<span class="flex-1 text-sm">{errorNotification.message}</span>
			<button
				onclick={dismissError}
				class="text-white/80 hover:text-white"
				aria-label="Dismiss error"
			>
				x
			</button>
		</div>
	</div>
{/if}

<!-- Status bar -->
<footer
	class="fixed bottom-0 left-0 right-0 h-6 bg-tertiary border-t border-muted px-4 flex items-center justify-between text-xs text-tertiary"
>
	<div class="flex items-center gap-4">
		<span>[t] thought</span>
		<span>[o] tools</span>
		<span>[w] workflow</span>
		<span>[m] model</span>
		{#if ctx.pendingApproval}
			<span class="text-warning">[y] approve [n] reject</span>
		{/if}
	</div>
	<div class="flex items-center gap-4">
		{#if sessionTokens.input > 0 || sessionTokens.output > 0}
			<span class="text-secondary">{sessionTokens.input + sessionTokens.output} tokens</span>
			{#if sessionTokens.cost > 0}
				<span class="text-accent">${sessionTokens.cost.toFixed(4)}</span>
			{/if}
		{/if}
		<span>{currentRegion}</span>
	</div>
</footer>
