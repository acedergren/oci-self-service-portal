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
		gap: 0.75rem;
		margin-top: 1rem;
		flex-wrap: wrap;
	}

	.quick-label {
		color: var(--portal-slate, #64748b);
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.quick-link {
		color: var(--portal-teal, #0d9488);
		font-size: 0.8125rem;
		font-weight: 500;
		padding: 0.375rem 0.75rem;
		background: rgba(13, 148, 136, 0.08);
		border: none;
		border-radius: 100px;
		cursor: pointer;
		transition: all 0.15s ease;
		font-family: inherit;
	}

	.quick-link:hover {
		background: rgba(13, 148, 136, 0.15);
	}

	.quick-link:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.quick-link.loading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: rgba(13, 148, 136, 0.2);
	}

	.quick-link.loading .label-text {
		display: none;
	}
</style>
