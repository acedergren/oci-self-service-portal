<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { browser } from '$app/environment';

	interface ModelInfo {
		id: string;
		name: string;
		provider: string;
	}

	interface ChatMessage {
		role: 'user' | 'assistant';
		content: string;
	}

	// State
	let selectedModel = $state('');
	let systemPrompt = $state('');
	let userInput = $state('');
	let messages = $state<ChatMessage[]>([]);
	let isStreaming = $state(false);
	let tokenUsage = $state<{ prompt: number; completion: number } | null>(null);
	let latencyMs = $state<number | null>(null);

	const modelsQuery = createQuery<{ models: ModelInfo[] }>(() => ({
		queryKey: ['models'],
		queryFn: async () => {
			const res = await fetch('/api/models');
			if (!res.ok) throw new Error('Failed to fetch models');
			return res.json();
		},
		enabled: browser
	}));

	const models = $derived($modelsQuery.data?.models ?? []);

	async function sendMessage() {
		if (!userInput.trim() || isStreaming) return;

		const text = userInput.trim();
		userInput = '';
		messages = [...messages, { role: 'user', content: text }];

		isStreaming = true;
		const start = performance.now();
		let assistantContent = '';

		try {
			const body: Record<string, unknown> = {
				messages: messages.map((m) => ({ role: m.role, content: m.content }))
			};
			if (selectedModel) body.model = selectedModel;
			if (systemPrompt.trim()) body.system = systemPrompt.trim();

			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Chat failed' }));
				throw new Error(err.message || `HTTP ${res.status}`);
			}

			// Stream response
			const reader = res.body?.getReader();
			const decoder = new TextDecoder();

			if (reader) {
				messages = [...messages, { role: 'assistant', content: '' }];
				const assistantIdx = messages.length - 1;

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const chunk = decoder.decode(value, { stream: true });
					// Parse SSE data lines
					for (const line of chunk.split('\n')) {
						if (line.startsWith('0:')) {
							// AI SDK text token format: 0:"text"
							try {
								const text = JSON.parse(line.slice(2));
								assistantContent += text;
								messages[assistantIdx] = { role: 'assistant', content: assistantContent };
								messages = [...messages]; // trigger reactivity
							} catch {
								// Skip non-JSON lines
							}
						} else if (line.startsWith('d:')) {
							// AI SDK done message with usage
							try {
								const data = JSON.parse(line.slice(2));
								if (data.usage) {
									tokenUsage = {
										prompt: data.usage.promptTokens ?? 0,
										completion: data.usage.completionTokens ?? 0
									};
								}
							} catch {
								// Skip
							}
						}
					}
				}
			}
		} catch (err) {
			messages = [
				...messages,
				{
					role: 'assistant',
					content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`
				}
			];
		} finally {
			isStreaming = false;
			latencyMs = Math.round(performance.now() - start);
		}
	}

	function clearChat() {
		messages = [];
		tokenUsage = null;
		latencyMs = null;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
	}
</script>

<svelte:head>
	<title>Agent Playground - Admin Console</title>
</svelte:head>

<div class="admin-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Agent Playground</h1>
			<p class="page-description">Test the CloudAdvisor agent with different models and prompts</p>
		</div>
		<button type="button" class="btn-clear" onclick={clearChat} disabled={messages.length === 0}>
			Clear Chat
		</button>
	</div>

	<div class="playground-layout">
		<!-- Sidebar: Config -->
		<aside class="config-panel">
			<div class="config-section">
				<label class="config-label" for="model-select">Model</label>
				<select id="model-select" class="config-select" bind:value={selectedModel}>
					<option value="">Default</option>
					{#each models as model}
						<option value={model.id}>{model.name} ({model.provider})</option>
					{/each}
				</select>
			</div>

			<div class="config-section">
				<label class="config-label" for="system-prompt">System Prompt Override</label>
				<textarea
					id="system-prompt"
					class="config-textarea"
					placeholder="Leave empty to use the default CloudAdvisor prompt..."
					rows="8"
					bind:value={systemPrompt}
				></textarea>
			</div>

			<!-- Metrics -->
			{#if tokenUsage || latencyMs}
				<div class="metrics-panel">
					<h3 class="config-label">Request Metrics</h3>
					{#if latencyMs}
						<div class="metric-row">
							<span class="metric-key">Latency</span>
							<span class="metric-val">{latencyMs.toLocaleString()}ms</span>
						</div>
					{/if}
					{#if tokenUsage}
						<div class="metric-row">
							<span class="metric-key">Prompt tokens</span>
							<span class="metric-val">{tokenUsage.prompt.toLocaleString()}</span>
						</div>
						<div class="metric-row">
							<span class="metric-key">Completion tokens</span>
							<span class="metric-val">{tokenUsage.completion.toLocaleString()}</span>
						</div>
						<div class="metric-row total">
							<span class="metric-key">Total tokens</span>
							<span class="metric-val"
								>{(tokenUsage.prompt + tokenUsage.completion).toLocaleString()}</span
							>
						</div>
					{/if}
				</div>
			{/if}
		</aside>

		<!-- Main: Chat -->
		<div class="chat-panel">
			<div class="messages-container">
				{#if messages.length === 0}
					<div class="empty-chat">
						<div class="empty-icon">🧪</div>
						<h2>Start a conversation</h2>
						<p>Type a message to test the CloudAdvisor agent</p>
					</div>
				{:else}
					{#each messages as msg, i (i)}
						<div
							class="message"
							class:user={msg.role === 'user'}
							class:assistant={msg.role === 'assistant'}
						>
							<div class="message-role">{msg.role === 'user' ? 'You' : 'CloudAdvisor'}</div>
							<div class="message-content">{msg.content}</div>
						</div>
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
					placeholder="Type a message..."
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
					{isStreaming ? 'Streaming...' : 'Send'}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	.admin-page {
		max-width: 1400px;
		height: calc(100dvh - var(--space-xxl) * 2);
		display: flex;
		flex-direction: column;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: start;
		margin-bottom: var(--space-lg);
		flex-shrink: 0;
	}

	.page-title {
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
	}

	.page-description {
		font-size: var(--text-base);
		color: var(--fg-secondary);
	}

	.btn-clear {
		padding: var(--space-sm) var(--space-lg);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-secondary);
		font-size: var(--text-sm);
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

	/* Layout */
	.playground-layout {
		display: grid;
		grid-template-columns: 300px 1fr;
		gap: var(--space-lg);
		flex: 1;
		min-height: 0;
	}

	/* Config Panel */
	.config-panel {
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: var(--space-lg);
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
		overflow-y: auto;
	}

	.config-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
	}

	.config-label {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--fg-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.config-select,
	.config-textarea {
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
	}

	.config-textarea {
		resize: vertical;
		font-family: var(--font-mono, monospace);
		line-height: 1.5;
	}

	.config-select:focus,
	.config-textarea:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	/* Metrics */
	.metrics-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		padding: var(--space-md);
		background: var(--bg-tertiary);
		border-radius: var(--radius-md);
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
		font-weight: 600;
	}

	.metric-row.total {
		padding-top: var(--space-xs);
		border-top: 1px solid var(--border-muted);
	}

	/* Chat Panel */
	.chat-panel {
		display: flex;
		flex-direction: column;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.messages-container {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-lg);
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.empty-chat {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		text-align: center;
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: var(--space-md);
	}

	.empty-chat h2 {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: var(--space-sm);
	}

	.empty-chat p {
		color: var(--fg-secondary);
	}

	.message {
		max-width: 80%;
		padding: var(--space-md) var(--space-lg);
		border-radius: var(--radius-md);
		animation: fadeIn 0.2s ease;
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
		margin-bottom: var(--space-xs);
		opacity: 0.7;
	}

	.message-content {
		font-size: var(--text-sm);
		line-height: 1.6;
		white-space: pre-wrap;
	}

	.streaming-indicator {
		display: flex;
		gap: 4px;
		padding: var(--space-md);
		align-self: flex-start;
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

	/* Input Area */
	.input-area {
		display: flex;
		gap: var(--space-sm);
		padding: var(--space-md);
		border-top: 1px solid var(--border-default);
		background: var(--bg-tertiary);
	}

	.chat-input {
		flex: 1;
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
		resize: none;
		line-height: 1.5;
	}

	.chat-input:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	.chat-input:disabled {
		opacity: 0.5;
	}

	.btn-send {
		padding: var(--space-sm) var(--space-lg);
		background: var(--accent-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
		align-self: flex-end;
	}

	.btn-send:hover:not(:disabled) {
		background: var(--accent-secondary);
		box-shadow: 0 0 20px -5px var(--accent-primary);
	}

	.btn-send:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	@media (max-width: 1024px) {
		.playground-layout {
			grid-template-columns: 1fr;
		}

		.config-panel {
			max-height: 200px;
		}
	}
</style>
