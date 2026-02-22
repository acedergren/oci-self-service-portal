<script lang="ts">
	interface Props {
		open: boolean;
		title: string;
		message: string;
		confirmLabel?: string;
		variant?: 'danger' | 'warning' | 'default';
		onConfirm: () => void;
		onCancel: () => void;
	}

	let {
		open,
		title,
		message,
		confirmLabel = 'Confirm',
		variant = 'default',
		onConfirm,
		onCancel
	}: Props = $props();

	$effect(() => {
		if (!open) return;
		function handleKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				onCancel();
			}
		}
		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="confirm-overlay" onkeydown={() => {}} onclick={onCancel}>
		<div
			class="confirm-dialog glass"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="confirm-title"
			aria-describedby="confirm-message"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={() => {}}
		>
			<div
				class="confirm-header"
				class:danger={variant === 'danger'}
				class:warning={variant === 'warning'}
			>
				<div class="confirm-icon">
					{#if variant === 'danger'}
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							class="icon icon-danger"
						>
							<circle cx="12" cy="12" r="10" />
							<line x1="15" y1="9" x2="9" y2="15" />
							<line x1="9" y1="9" x2="15" y2="15" />
						</svg>
					{:else if variant === 'warning'}
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							class="icon icon-warning"
						>
							<path
								d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
							/>
							<line x1="12" y1="9" x2="12" y2="13" />
							<line x1="12" y1="17" x2="12.01" y2="17" />
						</svg>
					{:else}
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							class="icon icon-default"
						>
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="16" x2="12" y2="12" />
							<line x1="12" y1="8" x2="12.01" y2="8" />
						</svg>
					{/if}
				</div>
				<h2 id="confirm-title" class="confirm-title">{title}</h2>
			</div>

			<div class="confirm-body">
				<p id="confirm-message" class="confirm-message">{message}</p>
			</div>

			<div class="confirm-actions">
				<button class="btn btn-secondary" onclick={onCancel}>Cancel</button>
				<button
					class="btn"
					class:btn-danger={variant === 'danger'}
					class:btn-primary={variant !== 'danger'}
					onclick={onConfirm}
				>
					{confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.confirm-overlay {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, black 60%, transparent);
		backdrop-filter: blur(4px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		animation: fadeIn 0.15s ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.confirm-dialog {
		width: 100%;
		max-width: 440px;
		border-radius: var(--radius-xl);
		overflow: hidden;
		animation: slideUp 0.2s ease;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(12px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.confirm-header {
		display: flex;
		align-items: center;
		gap: var(--space-md);
		padding: var(--space-lg) var(--space-lg) 0;
	}

	.confirm-icon {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		border-radius: var(--radius-lg);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-tertiary);
	}

	.confirm-header.danger .confirm-icon {
		background: color-mix(in srgb, var(--semantic-error) 15%, transparent);
	}

	.confirm-header.warning .confirm-icon {
		background: color-mix(in srgb, var(--semantic-warning) 15%, transparent);
	}

	.icon {
		width: 22px;
		height: 22px;
	}

	.icon-danger {
		color: var(--semantic-error);
	}

	.icon-warning {
		color: var(--semantic-warning);
	}

	.icon-default {
		color: var(--accent-primary);
	}

	.confirm-title {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg-primary);
		margin: 0;
	}

	.confirm-body {
		padding: var(--space-md) var(--space-lg);
	}

	.confirm-message {
		color: var(--fg-secondary);
		font-size: var(--text-sm);
		line-height: 1.5;
		margin: 0;
	}

	.confirm-actions {
		display: flex;
		gap: var(--space-sm);
		padding: 0 var(--space-lg) var(--space-lg);
		justify-content: flex-end;
	}
</style>
