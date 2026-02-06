<div class="typing-indicator">
	<span></span>
	<span></span>
	<span></span>
</div>

<style>
	.typing-indicator {
		display: flex;
		gap: 4px;
		padding: 0.75rem 1rem;
		background: var(--portal-light, #f1f5f9);
		border-radius: 12px;
		border-top-left-radius: 4px;
		width: fit-content;
	}

	.typing-indicator span {
		width: 8px;
		height: 8px;
		background: var(--portal-gray, #94a3b8);
		border-radius: 50%;
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
