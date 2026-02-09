<script lang="ts">
	interface TestConnectionButtonProps {
		onTest: () => Promise<{ success: boolean; message?: string }>;
		disabled?: boolean;
	}

	let { onTest, disabled = false }: TestConnectionButtonProps = $props();

	let testing = $state(false);
	let result = $state<{ success: boolean; message?: string } | null>(null);

	async function handleTest() {
		testing = true;
		result = null;

		try {
			const response = await onTest();
			result = response;
		} catch (error) {
			result = {
				success: false,
				message: error instanceof Error ? error.message : 'Connection test failed'
			};
		} finally {
			testing = false;

			// Clear result after 5 seconds
			setTimeout(() => {
				result = null;
			}, 5000);
		}
	}
</script>

<div class="test-connection">
	<button type="button" class="btn test-btn" onclick={handleTest} disabled={disabled || testing}>
		{#if testing}
			<svg class="spinner" viewBox="0 0 24 24">
				<circle
					class="spinner-circle"
					cx="12"
					cy="12"
					r="10"
					stroke="currentColor"
					stroke-width="4"
					fill="none"
				/>
			</svg>
			Testing...
		{:else}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
			</svg>
			Test Connection
		{/if}
	</button>

	{#if result}
		<div class="result" class:success={result.success} class:error={!result.success}>
			{#if result.success}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<polyline points="20 6 9 17 4 12" />
				</svg>
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="10" />
					<line x1="15" y1="9" x2="9" y2="15" />
					<line x1="9" y1="9" x2="15" y2="15" />
				</svg>
			{/if}
			<span
				>{result.message || (result.success ? 'Connected successfully' : 'Connection failed')}</span
			>
		</div>
	{/if}
</div>

<style>
	.test-connection {
		display: flex;
		align-items: center;
		gap: var(--space-md);
	}

	.test-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-sm) var(--space-md);
		background-color: var(--bg-elevated);
		color: var(--fg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-weight: 500;
		font-size: var(--text-sm);
		transition: all var(--transition-fast);
		cursor: pointer;
	}

	.test-btn:hover:not(:disabled) {
		background-color: var(--bg-hover);
		border-color: var(--border-focused);
	}

	.test-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spinner {
		width: 16px;
		height: 16px;
		animation: spin 1s linear infinite;
	}

	.spinner-circle {
		stroke-dasharray: 60;
		stroke-dashoffset: 15;
		transform-origin: center;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.result {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		padding: var(--space-xs) var(--space-sm);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		animation: slide-in-up var(--transition-fast);
	}

	.result.success {
		color: var(--semantic-success);
		background-color: oklch(0.7 0.18 145 / 0.1);
	}

	.result.error {
		color: var(--semantic-error);
		background-color: oklch(0.65 0.2 25 / 0.1);
	}

	.result svg {
		flex-shrink: 0;
	}
</style>
