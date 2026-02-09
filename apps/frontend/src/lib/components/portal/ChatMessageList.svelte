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
			<div class="message-avatar assistant">
				<svg viewBox="0 0 24 24" fill="currentColor">
					<path
						d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
					/>
				</svg>
			</div>
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
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-height: 150px;
	}

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

	.message-avatar.assistant {
		background: linear-gradient(
			135deg,
			var(--portal-teal, #0d9488),
			var(--portal-teal-dark, #0f766e)
		);
		color: white;
	}

	.message-avatar svg {
		width: 18px;
		height: 18px;
	}

	.message-content {
		flex: 1;
		min-width: 0;
	}
</style>
