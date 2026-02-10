<script lang="ts">
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import { page } from '$app/stores';
	import type { LayoutData } from './$types';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let { data, children }: { data: LayoutData; children: any } = $props();

	// Create QueryClient with sensible defaults
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 1000 * 60 * 5, // 5 minutes
				gcTime: 1000 * 60 * 30, // 30 minutes (formerly cacheTime)
				retry: 1,
				refetchOnWindowFocus: false
			}
		}
	});

	const navItems = [
		{ href: '/admin/idp', label: 'Identity Providers', icon: '🔐' },
		{ href: '/admin/models', label: 'AI Models', icon: '🤖' },
		{ href: '/admin/integrations', label: 'MCP Integrations', icon: '🔌' },
		{ href: '/admin/settings', label: 'Portal Settings', icon: '⚙️' }
	];

	function isActive(href: string): boolean {
		return $page.url.pathname === href || $page.url.pathname.startsWith(href + '/');
	}
</script>

<QueryClientProvider client={queryClient}>
	<div class="admin-layout">
		<!-- Sidebar -->
		<aside class="admin-sidebar">
			<div class="sidebar-header">
				<div class="logo-diamond">&#9670;</div>
				<h1 class="sidebar-title">Admin Console</h1>
			</div>

			<nav class="sidebar-nav">
				{#each navItems as item (item.href)}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={item.href} class="nav-item" class:active={isActive(item.href)}>
						<span class="nav-icon">{item.icon}</span>
						<span class="nav-label">{item.label}</span>
					</a>
				{/each}
			</nav>

			<div class="sidebar-footer">
				<div class="user-info">
					<div class="user-avatar">{data.user.name?.[0] || 'U'}</div>
					<div class="user-details">
						<div class="user-name">{data.user.name || 'Unknown'}</div>
						<div class="user-email">{data.user.email || ''}</div>
					</div>
				</div>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href="/" class="back-link">← Back to Portal</a>
			</div>
		</aside>

		<!-- Main content -->
		<main class="admin-main">
			{@render children()}
		</main>
	</div>
</QueryClientProvider>

<style>
	.admin-layout {
		display: grid;
		grid-template-columns: 280px 1fr;
		min-height: 100dvh;
		background: var(--bg-primary);
	}

	.admin-sidebar {
		display: flex;
		flex-direction: column;
		background: var(--bg-secondary);
		border-right: 1px solid var(--border-default);
		padding: var(--space-lg);
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		gap: var(--space-md);
		margin-bottom: var(--space-xl);
		padding-bottom: var(--space-lg);
		border-bottom: 1px solid var(--border-muted);
	}

	.logo-diamond {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		font-size: 1.5rem;
		color: var(--accent-primary);
		background: var(--bg-elevated);
		border-radius: var(--radius-md);
		animation: bioluminescent-pulse 3s ease-in-out infinite;
	}

	.sidebar-title {
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--fg-primary);
	}

	.sidebar-nav {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--space-md);
		padding: var(--space-md);
		border-radius: var(--radius-md);
		color: var(--fg-secondary);
		text-decoration: none;
		transition: all var(--transition-fast);
	}

	.nav-item:hover {
		background: var(--bg-elevated);
		color: var(--fg-primary);
	}

	.nav-item.active {
		background: var(--accent-primary);
		color: var(--bg-primary);
		font-weight: 600;
		box-shadow: 0 0 20px -5px var(--accent-primary);
	}

	.nav-icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.nav-label {
		font-size: var(--text-sm);
	}

	.sidebar-footer {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
		padding-top: var(--space-lg);
		border-top: 1px solid var(--border-muted);
	}

	.user-info {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
	}

	.user-avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--accent-muted);
		color: var(--bg-primary);
		font-weight: 600;
		font-size: var(--text-sm);
		flex-shrink: 0;
	}

	.user-details {
		flex: 1;
		min-width: 0;
	}

	.user-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.user-email {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.back-link {
		display: block;
		padding: var(--space-sm);
		text-align: center;
		border-radius: var(--radius-sm);
		background: var(--bg-tertiary);
		color: var(--fg-secondary);
		text-decoration: none;
		font-size: var(--text-xs);
		transition: all var(--transition-fast);
	}

	.back-link:hover {
		background: var(--bg-elevated);
		color: var(--fg-primary);
	}

	.admin-main {
		padding: var(--space-xxl);
		overflow-y: auto;
	}

	@media (max-width: 1024px) {
		.admin-layout {
			grid-template-columns: 1fr;
		}

		.admin-sidebar {
			display: none;
		}

		.admin-main {
			padding: var(--space-lg);
		}
	}
</style>
