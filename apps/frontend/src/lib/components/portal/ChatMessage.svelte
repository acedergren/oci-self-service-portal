<script lang="ts">
	import MarkdownRenderer from '$lib/components/ui/MarkdownRenderer.svelte';
	import { extractToolParts } from '$lib/utils/message-parts.js';
	import { tryGetChatContext } from '$lib/components/chat/ai-context.svelte.js';
	import ToolCallCard from './ToolCallCard.svelte';
	import TypingIndicator from './TypingIndicator.svelte';
	import type { ChatMessageProps, ChatToolPart } from './types.js';

	let {
		message,
		isLastMessage,
		isStreaming,
		hideToolExecution = true
	}: ChatMessageProps = $props();

	// Safely access ChatContext for tool progress (undefined if not in provider tree)
	const chatCtx = tryGetChatContext();

	function getMessageText(msg: typeof message): string {
		if (!msg.parts) return '';
		return msg.parts
			.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
			.map((p) => p.text)
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
				<path
					d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
				/>
			</svg>
		</div>
		<div class="message-content">
			<p>{text}</p>
		</div>
	{:else}
		<div class="message-avatar assistant">
			<span class="charlie-letter">C</span>
		</div>
		<div class="message-content">
			{#each toolParts as part (part.toolCallId)}
				<ToolCallCard
					{part}
					{hideToolExecution}
					progress={chatCtx?.getToolProgress(part.toolCallId)}
				/>
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
		background: var(--bg-tertiary);
		color: var(--fg-tertiary);
	}

	.message-avatar.assistant {
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
	}

	.charlie-letter {
		color: white;
		font-weight: 700;
		font-size: var(--text-xs, 0.75rem);
		line-height: 1;
	}

	.message-avatar svg {
		width: 18px;
		height: 18px;
	}

	.message-content {
		flex: 1;
		min-width: 0;
	}

	.message[data-role='user'] .message-content p {
		background: color-mix(in srgb, var(--accent-primary) 8%, var(--bg-primary));
		padding: 0.75rem 1rem;
		border-radius: 12px;
		border-top-left-radius: 4px;
		font-size: 0.9375rem;
		color: var(--fg-primary);
		display: inline-block;
	}

	.message-content :global(.assistant-text) {
		font-size: 0.9375rem;
		color: var(--fg-primary);
		line-height: 1.6;
	}
</style>
