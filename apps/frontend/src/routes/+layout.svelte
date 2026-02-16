<script lang="ts">
	import '../app.css';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import { Toaster } from 'svelte-sonner';
	import { resolve } from '$app/paths';
	import UserMenu from '$lib/components/UserMenu.svelte';

	// Create query client with OCI AI Chat defaults
	// Using QueryClient directly from svelte-query to avoid version mismatches
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 1000 * 60 * 5, // 5 minutes
				gcTime: 1000 * 60 * 60, // 1 hour (v5: renamed from cacheTime)
				retry: 1,
				refetchOnWindowFocus: false
			}
		}
	});

	let { data, children } = $props();
</script>

<QueryClientProvider client={queryClient}>
	{#if data.user}
		<header class="app-header">
			<div class="header-left">
				<a href={resolve('/')} class="app-title">CloudNow</a>
				<nav class="header-nav">
					<a href={resolve('/workflows')} class="nav-link">Workflows</a>
				</nav>
			</div>
			<div class="header-right">
				<UserMenu user={data.user} />
			</div>
		</header>
	{/if}
	{@render children()}
</QueryClientProvider>
<Toaster
	position="bottom-right"
	richColors
	toastOptions={{
		style:
			'font-family: inherit; background: var(--bg-elevated); color: var(--fg-primary); border: 1px solid var(--border-default);'
	}}
/>

<style>
	.app-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-sm) var(--space-md);
		border-bottom: 1px solid var(--border-muted);
		background: var(--bg-secondary);
		height: 48px;
		flex-shrink: 0;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 1.5rem;
	}

	.header-nav {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.nav-link {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
		text-decoration: none;
		transition: color var(--transition-fast);
	}

	.nav-link:hover {
		color: var(--accent-primary);
	}

	.app-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-primary);
		text-decoration: none;
		transition: color var(--transition-fast);
	}

	.app-title:hover {
		color: var(--accent-primary);
	}

	.header-right {
		display: flex;
		align-items: center;
	}
</style>
