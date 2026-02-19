<script lang="ts">
	import type { ChatInputProps } from './types.js';

	let {
		disabled = false,
		placeholder = 'Ask Charlie anything about your cloud...',
		onSubmit
	}: ChatInputProps = $props();

	function handleSubmit(e: Event) {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const input = form.querySelector('input') as HTMLInputElement;
		const text = input.value.trim();

		if (text) {
			onSubmit(text);
			input.value = '';
		}
	}
</script>

<form class="chat-input" onsubmit={handleSubmit}>
	<input type="text" {placeholder} {disabled} />
	<button type="submit" {disabled} aria-label="Send message">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
			/>
		</svg>
	</button>
</form>

<style>
	.chat-input {
		display: flex;
		gap: 0.75rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--border-default);
	}

	.chat-input input {
		flex: 1;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border-default);
		border-radius: 8px;
		font-size: 0.9375rem;
		color: var(--fg-primary);
		outline: none;
		transition: border-color var(--transition-fast);
		font-family: inherit;
	}

	.chat-input input:focus {
		border-color: var(--border-focused);
	}

	.chat-input input::placeholder {
		color: var(--fg-disabled);
	}

	.chat-input button {
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		color: white;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.chat-input button:hover:not(:disabled) {
		transform: scale(1.05);
	}

	.chat-input button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.chat-input button svg {
		width: 20px;
		height: 20px;
	}
</style>
