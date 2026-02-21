<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client.js';
	import NotificationBell from './NotificationBell.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	interface Props {
		user: { name?: string; email: string; image?: string | null };
		role?: string;
	}

	let { user, role = 'viewer' }: Props = $props();

	// Default to collapsed; restore user preference after mount
	let collapsed = $state(true);

	$effect(() => {
		if (browser) {
			const saved = localStorage.getItem('sidebar-collapsed');
			if (saved !== null) {
				collapsed = saved === 'true';
			}
		}
	});

	function toggleCollapsed() {
		collapsed = !collapsed;
		if (browser) {
			localStorage.setItem('sidebar-collapsed', String(collapsed));
		}
	}

	const navItems = [
		{ href: '/', label: 'Home', exact: true },
		{ href: '/chat', label: 'Charlie', exact: false },
		{ href: '/workflows', label: 'Workflows', exact: false },
		{ href: '/admin', label: 'Admin', exact: false }
	];

	function isActive(href: string, exact: boolean): boolean {
		if (exact) return $page.url.pathname === href;
		return $page.url.pathname.startsWith(href);
	}

	function getInitials(name?: string, email?: string): string {
		if (name)
			return name
				.split(' ')
				.map((n) => n[0])
				.join('')
				.toUpperCase()
				.slice(0, 2);
		return (email?.[0] ?? '?').toUpperCase();
	}

	function signOut() {
		authClient.signOut({
			fetchOptions: {
				onSuccess: () => {
					window.location.href = resolve('/login');
				}
			}
		});
	}
</script>

<aside class="sidebar" class:collapsed>
	<!-- Brand -->
	<div class="sidebar-brand">
		<a href={resolve('/')} class="brand-link" title={collapsed ? 'CloudNow' : undefined}>
			<svg
				class="brand-icon"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
			</svg>
			<span class="brand-name">CloudNow</span>
		</a>
		<button
			class="sidebar-toggle"
			onclick={toggleCollapsed}
			aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
		>
			<svg
				class="toggle-icon"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				{#if collapsed}
					<polyline points="9 18 15 12 9 6" />
				{:else}
					<polyline points="15 18 9 12 15 6" />
				{/if}
			</svg>
		</button>
	</div>

	<!-- Navigation -->
	<nav class="sidebar-nav" aria-label="Main navigation">
		{#each navItems as item (item.href)}
			<a
				href={resolve(item.href)}
				class="nav-item"
				class:active={isActive(item.href, item.exact)}
				aria-current={isActive(item.href, item.exact) ? 'page' : undefined}
				title={collapsed ? item.label : undefined}
			>
				{#if item.href === '/'}
					<!-- Home icon -->
					<svg
						class="nav-icon"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
						<polyline points="9 22 9 12 15 12 15 22" />
					</svg>
				{:else if item.href === '/chat'}
					<!-- Chat bubble icon -->
					<svg
						class="nav-icon"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
					</svg>
				{:else if item.href === '/workflows'}
					<!-- Zap icon -->
					<svg
						class="nav-icon"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
					</svg>
				{:else if item.href === '/admin'}
					<!-- Settings gear icon -->
					<svg
						class="nav-icon"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="3" />
						<path
							d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
						/>
					</svg>
				{/if}
				<span class="nav-label">{item.label}</span>
			</a>
		{/each}
	</nav>

	<!-- Bottom: notifications + theme + user + sign out -->
	<div class="sidebar-bottom">
		<div class="notification-row" title={collapsed ? 'Notifications' : undefined}>
			<NotificationBell />
		</div>

		{#if !collapsed}
			<div class="theme-row">
				<ThemeToggle />
			</div>
		{/if}

		<div class="sidebar-divider"></div>

		<div class="user-row" title={collapsed ? `${user.name ?? user.email} (${role})` : undefined}>
			{#if user.image}
				<img src={user.image} alt="" class="user-avatar" />
			{:else}
				<div class="user-avatar user-avatar-initials" aria-hidden="true">
					{getInitials(user.name, user.email)}
				</div>
			{/if}
			<div class="user-info">
				<span class="user-name">{user.name ?? user.email}</span>
				<span class="user-role user-role-{role}">{role}</span>
			</div>
		</div>

		<button class="signout-btn" onclick={signOut} title={collapsed ? 'Sign Out' : undefined}>
			<svg
				class="signout-icon"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
				<polyline points="16 17 21 12 16 7" />
				<line x1="21" y1="12" x2="9" y2="12" />
			</svg>
			<span class="signout-label">Sign Out</span>
		</button>
	</div>
</aside>

<style>
	/* ── Sidebar shell ──────────────────────────────────────────────────── */
	.sidebar {
		display: flex;
		flex-direction: column;
		width: 200px;
		min-width: 200px;
		height: 100dvh;
		position: sticky;
		top: 0;
		background: var(--bg-secondary);
		border-right: 1px solid var(--border-default);
		box-shadow: 2px 0 12px color-mix(in srgb, var(--fg-primary) 5%, transparent);
		overflow-y: auto;
		overflow-x: hidden;
		z-index: var(--z-header, 100);
		padding: var(--space-md) var(--space-sm);
		gap: var(--space-xs);
		transition:
			width 220ms ease,
			min-width 220ms ease;
	}

	.sidebar.collapsed {
		width: 56px;
		min-width: 56px;
		padding: var(--space-md) var(--space-xs);
	}

	/* ── Brand ──────────────────────────────────────────────────────────── */
	.sidebar-brand {
		display: flex;
		align-items: center;
		padding: 0 var(--space-xs) var(--space-md);
		gap: var(--space-xs);
		flex-shrink: 0;
	}

	.brand-link {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		text-decoration: none;
		color: var(--fg-primary);
		flex: 1;
		min-width: 0;
	}

	.brand-icon {
		width: 22px;
		height: 22px;
		color: var(--accent-primary);
		flex-shrink: 0;
	}

	.brand-name {
		font-size: var(--text-sm);
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--fg-primary);
		white-space: nowrap;
		overflow: hidden;
	}

	/* Toggle button */
	.sidebar-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--fg-tertiary);
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
		transition:
			background var(--transition-fast),
			color var(--transition-fast);
	}

	.sidebar-toggle:hover {
		background: var(--bg-hover);
		color: var(--fg-secondary);
	}

	.toggle-icon {
		width: 14px;
		height: 14px;
	}

	/* Collapsed brand: stack icon and toggle vertically */
	.sidebar.collapsed .sidebar-brand {
		flex-direction: column;
		align-items: center;
		padding: 0 0 var(--space-md);
		gap: 4px;
	}

	.sidebar.collapsed .brand-link {
		flex: none;
	}

	.sidebar.collapsed .brand-name {
		display: none;
	}

	/* ── Navigation ─────────────────────────────────────────────────────── */
	.sidebar-nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-sm) var(--space-sm);
		border-radius: var(--radius-md);
		text-decoration: none;
		color: var(--fg-secondary);
		font-size: var(--text-sm);
		font-weight: 500;
		transition:
			background var(--transition-fast),
			color var(--transition-fast);
		-webkit-user-select: none;
		user-select: none;
	}

	.nav-item:hover:not(.active) {
		background: var(--bg-hover);
		color: var(--fg-primary);
	}

	.nav-item.active {
		background: var(--accent-primary);
		color: white;
		font-weight: 600;
	}

	.nav-icon {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.nav-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sidebar.collapsed .nav-item {
		justify-content: center;
		padding: var(--space-sm);
	}

	.sidebar.collapsed .nav-label {
		display: none;
	}

	/* ── Bottom section ─────────────────────────────────────────────────── */
	.sidebar-bottom {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		padding-top: var(--space-sm);
	}

	.notification-row {
		display: flex;
		align-items: center;
		padding: 0 var(--space-xs);
	}

	.sidebar.collapsed .notification-row {
		justify-content: center;
		padding: 0;
	}

	.theme-row {
		padding: 0 var(--space-xs);
	}

	.sidebar-divider {
		height: 1px;
		background: var(--border-muted);
		margin: 0 var(--space-xs);
	}

	/* ── User row ───────────────────────────────────────────────────────── */
	.user-row {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-xs) var(--space-xs);
		border-radius: var(--radius-md);
		background: var(--bg-tertiary);
	}

	.user-avatar {
		width: 30px;
		height: 30px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
		object-fit: cover;
	}

	.user-avatar-initials {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent-muted);
		color: var(--accent-primary);
		font-size: var(--text-xs);
		font-weight: 700;
	}

	.user-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.user-name {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--fg-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 110px;
	}

	.user-role {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.user-role-admin {
		color: var(--accent-primary);
	}

	.user-role-operator {
		color: var(--semantic-info);
	}

	.user-role-viewer {
		color: var(--fg-tertiary);
	}

	.sidebar.collapsed .user-row {
		justify-content: center;
		padding: var(--space-xs);
	}

	.sidebar.collapsed .user-info {
		display: none;
	}

	/* ── Sign out button ────────────────────────────────────────────────── */
	.signout-btn {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		width: 100%;
		padding: var(--space-sm) var(--space-sm);
		border: none;
		border-radius: var(--radius-md);
		background: none;
		color: var(--fg-tertiary);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--transition-fast),
			color var(--transition-fast);
	}

	.signout-btn:hover {
		background: color-mix(in srgb, var(--semantic-error) 10%, transparent);
		color: var(--semantic-error);
	}

	.signout-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.sidebar.collapsed .signout-btn {
		justify-content: center;
		padding: var(--space-sm);
	}

	.sidebar.collapsed .signout-label {
		display: none;
	}
</style>
