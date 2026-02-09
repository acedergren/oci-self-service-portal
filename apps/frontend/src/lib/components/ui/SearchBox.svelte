<script lang="ts">
	import LoadingSpinner from './LoadingSpinner.svelte';

	interface Props {
		onSubmit?: (query: string) => void;
	}

	let { onSubmit }: Props = $props();
	let query = $state('');
	let loading = $state(false);

	async function handleSubmit() {
		if (!query.trim()) return;

		loading = true;
		try {
			// Send query to AI chat endpoint
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: query, messages: [] })
			});

			if (response.ok) {
				// Notify parent component of successful submission
				if (onSubmit) {
					onSubmit(query);
				}
				query = '';
			} else {
				console.error('Chat API error:', response.status);
			}
		} finally {
			loading = false;
		}
	}
</script>

<form on:submit|preventDefault={handleSubmit} class="w-full">
	<div class="relative">
		<input
			type="text"
			bind:value={query}
			placeholder="Ask AI: &quot;List my running instances&quot; or &quot;Create a new database&quot;..."
			disabled={loading}
			class="w-full px-4 py-3 pl-10 pr-12 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-100"
		/>

		{#if loading}
			<div class="absolute right-3 top-1/2 -translate-y-1/2">
				<LoadingSpinner size="sm" />
			</div>
		{:else}
			<button
				type="submit"
				disabled={!query.trim()}
				class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-teal-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
				title="Submit search (Enter)"
			>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
					/>
				</svg>
			</button>
		{/if}
	</div>
</form>

<style>
	form :global(input:disabled) {
		background-color: #f5f5f5;
	}
</style>
