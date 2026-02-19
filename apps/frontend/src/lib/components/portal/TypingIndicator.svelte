<div class="typing-indicator">
	<span></span>
	<span></span>
	<span></span>
</div>

<style>
	.typing-indicator {
		display: flex;
		gap: 4px;
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-tertiary);
		border-radius: var(--radius-lg);
		border-top-left-radius: var(--radius-xs);
		width: fit-content;
	}

	.typing-indicator span {
		width: 8px;
		height: 8px;
		background: var(--fg-disabled);
		border-radius: var(--radius-full);
		animation: typing 1.4s infinite ease-in-out;
	}

	.typing-indicator span:nth-child(2) {
		animation-delay: 0.2s;
	}

	.typing-indicator span:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes typing {
		0%,
		60%,
		100% {
			transform: translateY(0);
			opacity: 0.4;
		}
		30% {
			transform: translateY(-4px);
			opacity: 1;
		}
	}
</style>
