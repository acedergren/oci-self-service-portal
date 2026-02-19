<script lang="ts">
	import ChatMessage from './ChatMessage.svelte';
	import TypingIndicator from './TypingIndicator.svelte';
	import type { ChatMessageListProps } from './types.js';

	let { messages, chatStatus, hideToolExecution = true }: ChatMessageListProps = $props();

	const isActive = $derived(chatStatus === 'streaming' || chatStatus === 'submitted');

	/** Show standalone typing indicator when waiting for first assistant response */
	const showWaitingIndicator = $derived(
		isActive && (messages.length === 0 || messages[messages.length - 1].role === 'user')
	);
</script>

<div class="message-list">
	{#each messages as message, index (message.id)}
		<ChatMessage
			{message}
			isLastMessage={index === messages.length - 1}
			isStreaming={isActive}
			{hideToolExecution}
		/>
	{/each}

	{#if showWaitingIndicator}
		<div class="message" data-role="assistant">
			<div class="message-avatar assistant" aria-label="Charlie">C</div>
			<div class="message-content">
				<TypingIndicator />
			</div>
		</div>
	{/if}
</div>

<style>
	.message-list {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-lg);
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
		min-height: 150px;
	}

	.message {
		display: flex;
		gap: var(--space-sm);
	}

	.message-avatar {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-full);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.message-avatar.assistant {
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		color: white;
	}

	.message-content {
		flex: 1;
		min-width: 0;
	}
</style>
