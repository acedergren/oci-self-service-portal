<script lang="ts">
	import { LoadingSpinner } from '@portal/ui';
	import type { QuickActionBarProps } from './types.js';

	let { actions, loadingAction, onAction }: QuickActionBarProps = $props();
</script>

<div class="quick-links">
	<span class="quick-label">Quick actions:</span>
	{#each actions as action (action.label)}
		<button
			type="button"
			class="quick-link"
			disabled={loadingAction !== null}
			onclick={() => onAction(action.prompt)}
			class:loading={loadingAction === action.prompt}
		>
			{#if loadingAction === action.prompt}
				<LoadingSpinner size="sm" />
			{/if}
			<span class="label-text">{action.label}</span>
		</button>
	{/each}
</div>

<style>
	.quick-links {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		margin-top: var(--space-md);
		flex-wrap: wrap;
	}

	.quick-label {
		color: var(--fg-tertiary);
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.quick-link {
		color: var(--accent-primary);
		font-size: var(--text-sm);
		font-weight: 500;
		padding: var(--space-xs) var(--space-sm);
		background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
		border: none;
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: all var(--transition-fast);
		font-family: inherit;
	}

	.quick-link:hover {
		background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
	}

	.quick-link:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.quick-link.loading {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
	}

	.quick-link.loading .label-text {
		display: none;
	}
</style>
