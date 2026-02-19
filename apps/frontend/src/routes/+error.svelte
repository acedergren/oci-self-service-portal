<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	const friendlyMessages: Record<number, string> = {
		404: "This page doesn't exist.",
		403: "You don't have permission to view this page.",
		401: 'You need to sign in to access this page.',
		500: 'Something went wrong on our end.',
		503: 'The service is temporarily unavailable.'
	};

	let message = $derived(friendlyMessages[page.status] ?? 'An unexpected error occurred.');
</script>

<div class="error-page">
	<div class="error-card glass animate-slide-in-up">
		<div class="error-brand">
			<span class="brand-logo">CloudNow</span>
		</div>

		<div class="error-code">{page.status}</div>

		<p class="error-friendly">{message}</p>

		{#if page.error?.message && page.status !== 404}
			<p class="error-detail">{page.error.message}</p>
		{/if}

		<div class="error-actions">
			<a href={resolve('/')} class="btn-primary">Go Home</a>
			<a href={resolve('/chat')} class="btn-secondary">Ask Charlie</a>
		</div>
	</div>
</div>

<style>
	.error-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-lg);
	}

	.error-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-md);
		padding: var(--space-xl) var(--space-xxl);
		border-radius: var(--radius-xl);
		max-width: 480px;
		width: 100%;
		text-align: center;
	}

	.error-brand {
		margin-bottom: var(--space-sm);
	}

	.brand-logo {
		font-size: var(--text-xl);
		font-weight: 700;
		color: var(--accent-primary);
		letter-spacing: -0.02em;
	}

	.error-code {
		font-size: clamp(4rem, 8vw, 6rem);
		font-weight: 800;
		line-height: 1;
		color: var(--fg-primary);
		letter-spacing: -0.04em;
	}

	.error-friendly {
		font-size: var(--text-lg);
		color: var(--fg-secondary);
		margin: 0;
	}

	.error-detail {
		font-size: var(--text-sm);
		color: var(--fg-tertiary);
		margin: 0;
		font-family: 'JetBrains Mono', monospace;
		background: var(--bg-tertiary);
		padding: var(--space-sm) var(--space-md);
		border-radius: var(--radius-md);
		border: 1px solid var(--border-muted);
		word-break: break-word;
	}

	.error-actions {
		display: flex;
		gap: var(--space-sm);
		flex-wrap: wrap;
		justify-content: center;
		margin-top: var(--space-sm);
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		padding: var(--space-sm) var(--space-lg);
		background: var(--accent-primary);
		color: #ffffff;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 600;
		text-decoration: none;
		transition: all var(--transition-fast);
	}

	.btn-primary:hover {
		background: var(--accent-secondary);
		transform: translateY(-1px);
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		padding: var(--space-sm) var(--space-lg);
		background: transparent;
		color: var(--fg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
		text-decoration: none;
		transition: all var(--transition-fast);
	}

	.btn-secondary:hover {
		background: var(--bg-hover);
		color: var(--fg-primary);
		border-color: var(--border-focused);
	}

	@media (max-width: 480px) {
		.error-card {
			padding: var(--space-lg);
		}

		.error-actions {
			flex-direction: column;
			width: 100%;
		}

		.btn-primary,
		.btn-secondary {
			justify-content: center;
		}
	}
</style>
