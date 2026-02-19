<script lang="ts">
	import '../app.css';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import { Toaster } from 'svelte-sonner';
	import { resolve } from '$app/paths';
	import UserMenu from '$lib/components/UserMenu.svelte';
	import NotificationBell from '$lib/components/NotificationBell.svelte';

	// Create query client with CloudNow defaults
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

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<QueryClientProvider client={queryClient}>
	{#if data.user}
		<header class="app-header">
			<div class="header-left">
				<a href={resolve('/')} class="app-title">CloudNow</a>
				<nav class="header-nav">
					<a href={resolve('/chat')} class="nav-link">Chat with Charlie</a>
					<a href={resolve('/workflows')} class="nav-link">Workflows</a>
					<a href={resolve('/admin')} class="nav-link">Admin</a>
				</nav>
			</div>
			<div class="header-right">
				<NotificationBell />
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
		height: 48px;
		flex-shrink: 0;
		position: sticky;
		top: 0;
		z-index: var(--z-header, 100);
		background: var(--bg-secondary); /* fallback for browsers without color-mix() */
		background: color-mix(in srgb, var(--bg-secondary) 78%, transparent);
		backdrop-filter: blur(32px) saturate(160%);
		-webkit-backdrop-filter: blur(32px) saturate(160%);
		border-bottom: 1px solid var(--glass-border);
		box-shadow:
			0 1px 0 var(--glass-highlight) inset,
			0 4px 24px color-mix(in srgb, var(--fg-primary) 7%, transparent);
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
		gap: var(--space-sm);
	}
</style>
