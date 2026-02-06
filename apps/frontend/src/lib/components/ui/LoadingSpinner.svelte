<script lang="ts">
	interface Props {
		size?: 'sm' | 'md' | 'lg';
		text?: string | null;
	}

	let { size = 'md', text = null }: Props = $props();

	const sizeClasses = {
		sm: 'w-4 h-4',
		md: 'w-6 h-6',
		lg: 'w-8 h-8'
	};
</script>

<div class="flex flex-col items-center justify-center gap-2">
	<div data-testid="loading-spinner" class="{sizeClasses[size]} spinner-{size} animate-spin">
		<svg class="w-full h-full" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" opacity="0.2" />
			<path
				d="M12 2a10 10 0 0110 10"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-dasharray="0 60"
			/>
		</svg>
	</div>
	{#if text}
		<span class="text-sm text-gray-600">{text}</span>
	{/if}
</div>

<style>
	:global(.animate-spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
