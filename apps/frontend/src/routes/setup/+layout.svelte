<div class="setup-layout">
	<slot />
</div>

<style>
	.setup-layout {
		min-height: 100dvh;
		background: var(--bg-primary);
		/* Add subtle animated gradient for living ocean effect (dark mode only) */
		background-image:
			radial-gradient(ellipse at 20% 50%, oklch(0.18 0.08 220 / 0.3), transparent 50%),
			radial-gradient(ellipse at 80% 30%, oklch(0.15 0.06 180 / 0.25), transparent 50%),
			radial-gradient(ellipse at 50% 80%, oklch(0.14 0.05 260 / 0.2), transparent 50%);
		background-size: 200% 200%;
		animation: ocean-breathe 20s ease-in-out infinite;
	}

	/* Light theme removes animated background */
	:global([data-theme='light']) .setup-layout {
		background-image: none;
		animation: none;
	}

	@keyframes ocean-breathe {
		0%,
		100% {
			background-position: 0% 50%;
			filter: brightness(1);
		}
		25% {
			background-position: 50% 60%;
			filter: brightness(1.05);
		}
		50% {
			background-position: 100% 50%;
			filter: brightness(1);
		}
		75% {
			background-position: 50% 40%;
			filter: brightness(0.98);
		}
	}
</style>
