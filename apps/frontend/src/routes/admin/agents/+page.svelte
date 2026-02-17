<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { browser } from '$app/environment';
	import {
		parseStreamLine,
		createToolTimelineState,
		updateToolTimeline,
		buildChatRequestPayload,
		type ToolTimelineState
	} from './streaming.js';

	interface AgentInfo {
		id: string;
		name: string;
		description?: string;
		model?: string;
		systemPrompt?: string;
	}

	interface AgentListResponse {
		agents?: AgentInfo[];
		data?: AgentInfo[];
	}

	function normalizeAgentsResponse(payload?: AgentListResponse | null): AgentInfo[] {
		if (!payload) return [];
		if (Array.isArray(payload.agents)) return payload.agents;
		if (Array.isArray(payload.data)) return payload.data;
		return [];
	}

	type TextMessage = {
		role: 'user' | 'assistant';
		content: string;
	};

	type ToolMessage = {
		role: 'tool';
		toolCallId: string;
	};

	type ChatMessage = TextMessage | ToolMessage;

	const agentsQuery = createQuery<AgentListResponse>(() => ({
		queryKey: ['admin', 'agents'],
		queryFn: async () => {
			const res = await fetch('/api/mastra/agents');
			if (!res.ok) throw new Error('Failed to fetch agents');
			return res.json();
		},
		enabled: browser
	}));

	const agents = $derived(normalizeAgentsResponse(agentsQuery.data));
	let selectedAgentId = $state<string | null>(null);
	let latestSeededAgentId: string | null = null;

	$effect(() => {
		if (!selectedAgentId && agents.length > 0) {
			selectedAgentId = agents[0].id;
		}
	});

	const selectedAgent = $derived(
		(agents.find((agent) => agent.id === selectedAgentId) ?? null) as AgentInfo | null
	);

	let messages = $state<ChatMessage[]>([]);
	let history = $state<TextMessage[]>([]);
	let userInput = $state('');
	let systemPrompt = $state('');
	let selectedModel = $state('');
	let temperature = $state(1);
	let topP = $state(1);
	let isStreaming = $state(false);
	let streamingError = $state<string | null>(null);
	let tokenUsage = $state<{ prompt: number; completion: number } | null>(null);
	let latencyMs = $state<number | null>(null);
	let toolTimeline = $state<ToolTimelineState>(createToolTimelineState());
	let toolMessageOrder = $state<Record<string, number>>({});
	let sidebarOpen = $state(false);

	$effect(() => {
		if (selectedAgent && latestSeededAgentId !== selectedAgent.id) {
			selectedModel = selectedAgent.model ?? '';
			if (selectedAgent.systemPrompt) {
				systemPrompt = selectedAgent.systemPrompt;
			}
			latestSeededAgentId = selectedAgent.id;
		}
	});

	function selectAgent(agentId: string) {
		if (selectedAgentId === agentId) return;
		selectedAgentId = agentId;
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	function onTemperatureInput(event: Event) {
		const next = (event.currentTarget as HTMLInputElement).valueAsNumber;
		temperature = clamp(Number.isFinite(next) ? next : 1, 0, 2);
	}

	function onTopPInput(event: Event) {
		const next = (event.currentTarget as HTMLInputElement).valueAsNumber;
		topP = clamp(Number.isFinite(next) ? next : 1, 0, 1);
	}

	function resetStreamingState() {
		toolTimeline = createToolTimelineState();
		toolMessageOrder = {};
		streamingError = null;
		tokenUsage = null;
		latencyMs = null;
	}

	async function sendMessage() {
		if (!selectedAgentId) {
			streamingError = 'Select an agent before sending a message.';
			return;
		}
		if (!userInput.trim() || isStreaming) return;

		const text = userInput.trim();
		userInput = '';
		resetStreamingState();

		const userMessage: TextMessage = { role: 'user', content: text };
		messages = [...messages, userMessage];
		history = [...history, userMessage];

		isStreaming = true;
		const start = performance.now();

		const payload = buildChatRequestPayload(history, {
			agentId: selectedAgentId,
			model: selectedModel || selectedAgent?.model,
			systemPrompt,
			temperature,
			topP
		});

		let assistantContent = '';
		let assistantHistoryIndex = -1;
		let assistantMessageIndex = -1;

		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			if (!res.ok || !res.body) {
				const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
				throw new Error(err.message || 'Chat failed');
			}

			history = [...history, { role: 'assistant', content: '' }];
			assistantHistoryIndex = history.length - 1;
			messages = [...messages, { role: 'assistant', content: '' }];
			assistantMessageIndex = messages.length - 1;

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const rawLine of lines) {
					const event = parseStreamLine(rawLine);
					if (!event) continue;
					const now = performance.now();

					if (event.type === 'text') {
						assistantContent += event.text;
						history[assistantHistoryIndex] = { role: 'assistant', content: assistantContent };
						history = [...history];
						messages[assistantMessageIndex] = { role: 'assistant', content: assistantContent };
						messages = [...messages];
						continue;
					}

					if (event.type === 'usage') {
						tokenUsage = {
							prompt: event.usage.promptTokens ?? 0,
							completion: event.usage.completionTokens ?? 0
						};
						continue;
					}

					toolTimeline = updateToolTimeline(toolTimeline, event, now);
					const entryId = event.type === 'toolCall' ? event.call.id : event.result.id;
					if (!(entryId in toolMessageOrder)) {
						toolMessageOrder = { ...toolMessageOrder, [entryId]: messages.length };
						messages = [...messages, { role: 'tool', toolCallId: entryId }];
					} else {
						messages = [...messages];
					}
				}
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Unexpected chat error';
			streamingError = errorMessage;
			const fallbackMessage: TextMessage = { role: 'assistant', content: `Error: ${errorMessage}` };
			messages = [...messages, fallbackMessage];
			history = [...history, fallbackMessage];
		} finally {
			isStreaming = false;
			latencyMs = Math.round(performance.now() - start);
		}
	}

	function clearChat() {
		messages = [];
		history = [];
		resetStreamingState();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
	}

	function formatJson(value: unknown): string {
		return JSON.stringify(value ?? {}, null, 2);
	}

	function formatDuration(
		entry: ReturnType<typeof createToolTimelineState>['entries'][string]
	): string {
		if (entry.durationMs != null) {
			return `${(entry.durationMs / 1000).toFixed(2)}s`;
		}
		return 'Running…';
	}

	const totalTokens = $derived(tokenUsage ? tokenUsage.prompt + tokenUsage.completion : 0);
</script>

<svelte:head>
	<title>Agent Playground - Admin Console</title>
</svelte:head>

<div class="admin-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Agent Playground</h1>
			<p class="page-description">
				Explore registered Mastra agents, inspect tool calls, and tune inference parameters in real
				time.
			</p>
		</div>
		<div class="header-actions">
			<button type="button" class="btn-clear" onclick={clearChat} disabled={messages.length === 0}>
				Clear Chat
			</button>
			<button
				type="button"
				class="mobile-sidebar-trigger"
				aria-pressed={sidebarOpen}
				aria-expanded={sidebarOpen}
				aria-controls="agent-playground-sidebar"
				onclick={() => (sidebarOpen = !sidebarOpen)}
			>
				{sidebarOpen ? 'Hide agents' : 'Show agents'}
			</button>
		</div>
	</div>

	<div class="playground-layout">
		<aside id="agent-playground-sidebar" class="agents-panel" class:mobile-open={sidebarOpen}>
			<div class="panel-heading">
				<h2>Agents</h2>
				{#if agentsQuery.isFetching}
					<span class="fetching">Refreshing…</span>
				{/if}
				<button
					type="button"
					class="toggle-sidebar"
					aria-controls="agent-playground-sidebar"
					aria-expanded={sidebarOpen}
					onclick={() => (sidebarOpen = !sidebarOpen)}
				>
					{sidebarOpen ? 'Hide' : 'Show'}
				</button>
			</div>

			{#if agentsQuery.isLoading}
				<div class="loading">Loading agents…</div>
			{:else if agents.length === 0}
				<div class="empty-agents">
					<p>No agents registered.</p>
				</div>
			{:else}
				<div class="agent-list">
					{#each agents as agent (agent.id)}
						<button
							type="button"
							class="agent-item"
							class:selected={agent.id === selectedAgentId}
							onclick={() => selectAgent(agent.id)}
						>
							<div class="agent-name">{agent.name}</div>
							<p class="agent-meta">{agent.model ?? 'Default model'}</p>
							{#if agent.description}
								<p class="agent-description">{agent.description}</p>
							{/if}
						</button>
					{/each}
				</div>
			{/if}

			<div class="config-section">
				<label class="config-label" for="temperature-slider">
					Temperature <span>{temperature.toFixed(1)}</span>
				</label>
				<input
					id="temperature-slider"
					type="range"
					min="0"
					max="2"
					step="0.1"
					value={temperature}
					oninput={onTemperatureInput}
				/>
			</div>

			<div class="config-section">
				<label class="config-label" for="top-p-slider">
					Top-P <span>{topP.toFixed(2)}</span>
				</label>
				<input
					id="top-p-slider"
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={topP}
					oninput={onTopPInput}
				/>
			</div>

			<div class="config-section">
				<label class="config-label" for="model-override">Model Override</label>
				<input
					id="model-override"
					type="text"
					placeholder="Use agent default"
					class="config-input"
					bind:value={selectedModel}
				/>
			</div>

			<div class="config-section">
				<label class="config-label" for="system-prompt">System Prompt</label>
				<textarea
					id="system-prompt"
					class="config-textarea"
					rows="6"
					placeholder="Override the agent's default system prompt"
					bind:value={systemPrompt}
				></textarea>
			</div>

			<div class="metrics-panel">
				<h3 class="config-label">Request Metrics</h3>
				<div class="metric-row">
					<span class="metric-key">Latency</span>
					<span class="metric-val">{latencyMs ? `${latencyMs}ms` : '—'}</span>
				</div>
				<div class="metric-row">
					<span class="metric-key">Prompt tokens</span>
					<span class="metric-val">{tokenUsage ? tokenUsage.prompt.toLocaleString() : '—'}</span>
				</div>
				<div class="metric-row">
					<span class="metric-key">Completion tokens</span>
					<span class="metric-val">{tokenUsage ? tokenUsage.completion.toLocaleString() : '—'}</span
					>
				</div>
				<div class="metric-row total">
					<span class="metric-key">Total tokens</span>
					<span class="metric-val">{tokenUsage ? totalTokens.toLocaleString() : '—'}</span>
				</div>
			</div>
		</aside>

		<div class="chat-panel">
			{#if streamingError}
				<div class="error-banner">{streamingError}</div>
			{/if}
			<div class="messages-container">
				{#if messages.length === 0}
					<div class="empty-chat">
						<div class="empty-icon">🧪</div>
						<h2>Start a conversation</h2>
						<p>Select an agent and type a prompt to begin testing.</p>
					</div>
				{:else}
					{#each messages as msg, i (i)}
						{#if msg.role === 'tool'}
							{#if toolTimeline.entries[msg.toolCallId]}
								{@const entry = toolTimeline.entries[msg.toolCallId]}
								<div class="tool-card" data-status={entry.status}>
									<div class="tool-card__header">
										<div>
											<div class="tool-card__title">{entry.tool}</div>
											<div class="tool-card__status">{entry.status}</div>
										</div>
										<div class="tool-card__duration">{formatDuration(entry)}</div>
									</div>
									<details>
										<summary>Arguments</summary>
										<pre>{formatJson(entry.args)}</pre>
									</details>
									{#if entry.result}
										<details open={entry.status !== 'running'}>
											<summary>Result</summary>
											<pre>{formatJson(entry.result)}</pre>
										</details>
									{/if}
									{#if entry.error}
										<details open>
											<summary>Error</summary>
											<pre>{formatJson(entry.error)}</pre>
										</details>
									{/if}
								</div>
							{:else}
								<div class="tool-card" data-status="running">
									<div class="tool-card__title">Resolving tool call…</div>
								</div>
							{/if}
						{:else}
							<div
								class="message"
								class:user={msg.role === 'user'}
								class:assistant={msg.role === 'assistant'}
							>
								<div class="message-role">{msg.role === 'user' ? 'You' : 'Agent'}</div>
								<div class="message-content">{msg.content}</div>
							</div>
						{/if}
					{/each}
					{#if isStreaming}
						<div class="streaming-indicator">
							<span class="dot"></span>
							<span class="dot"></span>
							<span class="dot"></span>
						</div>
					{/if}
				{/if}
			</div>

			<div class="input-area">
				<textarea
					class="chat-input"
					placeholder="Type a message…"
					rows="2"
					bind:value={userInput}
					onkeydown={handleKeydown}
					disabled={isStreaming}
				></textarea>
				<button
					type="button"
					class="btn-send"
					disabled={!userInput.trim() || isStreaming}
					onclick={sendMessage}
				>
					{isStreaming ? 'Streaming…' : 'Send'}
				</button>
			</div>
		</div>
	</div>
	<div
		class="sidebar-backdrop"
		data-open={sidebarOpen}
		aria-hidden={!sidebarOpen}
		onclick={() => (sidebarOpen = false)}
	></div>
</div>

<style>
	:global(body) {
		background: var(--bg-primary);
	}

	.admin-page {
		max-width: 1400px;
		height: calc(100dvh - var(--space-xxl) * 2);
		display: flex;
		flex-direction: column;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: var(--space-lg);
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
	}

	.page-title {
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
	}

	.page-description {
		color: var(--fg-secondary);
		max-width: 720px;
	}

	.btn-clear {
		padding: var(--space-sm) var(--space-lg);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-secondary);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-clear:hover:not(:disabled) {
		background: var(--bg-elevated);
		color: var(--fg-primary);
	}

	.btn-clear:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.mobile-sidebar-trigger {
		display: none;
		padding: var(--space-sm) var(--space-md);
		border-radius: var(--radius-md);
		border: 1px solid var(--accent-primary);
		background: transparent;
		color: var(--accent-primary);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.mobile-sidebar-trigger[aria-pressed='true'] {
		background: var(--accent-primary);
		color: var(--bg-primary);
	}

	.playground-layout {
		display: grid;
		grid-template-columns: 320px 1fr;
		gap: var(--space-lg);
		flex: 1;
		min-height: 0;
	}

	.sidebar-backdrop {
		display: none;
	}

	.agents-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: var(--space-lg);
	}

	.panel-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
	}

	.panel-heading h2 {
		font-size: var(--text-base);
		margin: 0;
	}

	.fetching {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
	}

	.toggle-sidebar {
		display: none;
	}

	.loading,
	.empty-agents {
		padding: var(--space-lg) 0;
		color: var(--fg-tertiary);
		font-size: var(--text-sm);
	}

	.agent-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		max-height: 320px;
		overflow-y: auto;
	}

	.agent-item {
		text-align: left;
		width: 100%;
		border: 1px solid var(--border-default);
		background: var(--bg-tertiary);
		border-radius: var(--radius-md);
		padding: var(--space-md);
		cursor: pointer;
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.agent-item.selected {
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-primary) 60%, transparent);
	}

	.agent-name {
		font-weight: 600;
		color: var(--fg-primary);
	}

	.agent-meta {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		margin: 2px 0;
	}

	.agent-description {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
		margin: 0;
	}

	.config-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}

	.config-label {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-tertiary);
		display: flex;
		justify-content: space-between;
	}

	.config-input,
	.config-textarea {
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: var(--space-sm) var(--space-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
	}

	.config-textarea {
		font-family: var(--font-mono, monospace);
		resize: vertical;
	}

	.metrics-panel {
		padding: var(--space-md);
		background: var(--bg-tertiary);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}

	.metric-row {
		display: flex;
		justify-content: space-between;
		font-size: var(--text-xs);
	}

	.metric-key {
		color: var(--fg-tertiary);
	}

	.metric-val {
		font-family: var(--font-mono, monospace);
		color: var(--fg-primary);
	}

	.metric-row.total {
		border-top: 1px solid var(--border-muted);
		padding-top: var(--space-xs);
	}

	.chat-panel {
		display: flex;
		flex-direction: column;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		overflow: hidden;
		min-height: 0;
	}

	.error-banner {
		background: color-mix(in oklch, var(--status-error, oklch(0.7 0.25 30)) 15%, transparent);
		color: var(--status-error, oklch(0.7 0.25 30));
		padding: var(--space-sm) var(--space-md);
		font-size: var(--text-sm);
	}

	.messages-container {
		flex: 1;
		padding: var(--space-lg);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.empty-chat {
		text-align: center;
		color: var(--fg-secondary);
		margin-top: 15vh;
	}

	.empty-icon {
		font-size: 3.5rem;
		margin-bottom: var(--space-md);
	}

	.message {
		max-width: 80%;
		padding: var(--space-md) var(--space-lg);
		border-radius: var(--radius-md);
		animation: fadeIn 0.2s ease;
	}

	.message.user {
		align-self: flex-end;
		background: var(--accent-primary);
		color: var(--bg-primary);
	}

	.message.assistant {
		align-self: flex-start;
		background: var(--bg-elevated);
		color: var(--fg-primary);
	}

	.message-role {
		font-size: var(--text-xs);
		font-weight: 600;
		margin-bottom: var(--space-xxs);
		opacity: 0.7;
	}

	.message-content {
		white-space: pre-wrap;
		line-height: 1.6;
	}

	.tool-card {
		border: 1px solid var(--border-default);
		border-left: 4px solid var(--fg-tertiary);
		border-radius: var(--radius-md);
		padding: var(--space-md);
		background: var(--bg-tertiary);
		max-width: 620px;
	}

	.tool-card[data-status='success'] {
		border-left-color: var(--status-success, oklch(0.75 0.2 155));
	}

	.tool-card[data-status='error'] {
		border-left-color: var(--status-error, oklch(0.7 0.25 30));
	}

	.tool-card__header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-md);
	}

	.tool-card__title {
		font-weight: 600;
		color: var(--fg-primary);
	}

	.tool-card__status {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-tertiary);
	}

	.tool-card__duration {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs);
		color: var(--fg-secondary);
	}

	details {
		background: var(--bg-secondary);
		border-radius: var(--radius-sm);
		margin-top: var(--space-sm);
		padding: var(--space-sm) var(--space-md);
	}

	pre {
		margin-top: var(--space-xs);
		font-size: var(--text-xs);
		white-space: pre-wrap;
	}

	.streaming-indicator {
		display: flex;
		gap: 4px;
		padding: var(--space-md);
	}

	.dot {
		width: 8px;
		height: 8px;
		background: var(--fg-tertiary);
		border-radius: 50%;
		animation: bounce 1.2s ease-in-out infinite;
	}

	.dot:nth-child(2) {
		animation-delay: 0.2s;
	}

	.dot:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes bounce {
		0%,
		80%,
		100% {
			transform: translateY(0);
		}
		40% {
			transform: translateY(-6px);
		}
	}

	.input-area {
		display: flex;
		gap: var(--space-sm);
		padding: var(--space-md);
		background: var(--bg-tertiary);
		border-top: 1px solid var(--border-default);
	}

	.chat-input {
		flex: 1;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		background: var(--bg-secondary);
		color: var(--fg-primary);
		padding: var(--space-sm) var(--space-md);
		font-size: var(--text-sm);
		resize: none;
	}

	.btn-send {
		padding: var(--space-sm) var(--space-lg);
		background: var(--accent-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-send:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (max-width: 1024px) {
		.playground-layout {
			grid-template-columns: 1fr;
		}

		.header-actions {
			flex-direction: column;
			align-items: stretch;
			gap: var(--space-xs);
		}

		.mobile-sidebar-trigger {
			display: inline-flex;
			align-items: center;
			justify-content: center;
		}

		.sidebar-backdrop {
			display: block;
			position: fixed;
			inset: 0;
			background: color-mix(in oklch, var(--fg-primary) 15%, transparent);
			opacity: 0;
			pointer-events: none;
			transition: opacity 0.3s ease;
			z-index: 4;
		}

		.sidebar-backdrop[data-open='true'] {
			opacity: 0.45;
			pointer-events: auto;
		}

		.agents-panel {
			position: fixed;
			top: calc(var(--space-xxl) + var(--space-sm));
			left: var(--space-sm);
			width: min(360px, calc(100vw - (var(--space-sm) + var(--space-sm))));
			height: calc(100dvh - var(--space-xxl) - var(--space-lg) - var(--space-md));
			box-shadow: 0 20px 45px rgba(0, 0, 0, 0.35);
			border-radius: var(--radius-lg);
			overflow-y: auto;
			transform: translateX(-110%);
			transition: transform 0.3s ease;
			z-index: 5;
		}

		.agents-panel.mobile-open {
			transform: translateX(0);
		}

		.toggle-sidebar {
			display: inline-flex;
		}

		.chat-panel {
			grid-column: 1 / -1;
		}
	}
</style>
