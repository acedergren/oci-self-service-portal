<script lang="ts">
	import type { PortalHeaderProps } from './types.js';

	let {
		selectedModel: _selectedModel,
		availableModels: _availableModels,
		notificationCount = 3,
		onModelChange: _onModelChange
	}: PortalHeaderProps = $props();
</script>

<header class="header">
	<div class="header-content">
		<div class="logo">
			<div class="logo-mark">
				<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
					<rect width="32" height="32" rx="8" fill="url(#logo-gradient)" />
					<path d="M8 16L14 10L20 16L14 22L8 16Z" fill="white" fill-opacity="0.9" />
					<path d="M14 16L20 10L26 16L20 22L14 16Z" fill="white" fill-opacity="0.6" />
					<defs>
						<linearGradient id="logo-gradient" x1="0" y1="0" x2="32" y2="32">
							<stop stop-color="#0D9488" />
							<stop offset="1" stop-color="#0F766E" />
						</linearGradient>
					</defs>
				</svg>
			</div>
			<span class="logo-text">Cloud Portal</span>
		</div>

		<nav class="nav">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href="/self-service" class="nav-link active">
				<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.5"
						d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
					/>
				</svg>
				Home
			</a>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href="/self-service" class="nav-link">
				<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.5"
						d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
					/>
				</svg>
				Services
			</a>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href="/" class="nav-link">
				<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.5"
						d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
					/>
				</svg>
				AI Chat
			</a>
		</nav>

		<div class="header-actions">
			<button class="icon-btn" title="Notifications">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.5"
						d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
					/>
				</svg>
				{#if notificationCount && notificationCount > 0}
					<span class="notification-badge">{notificationCount}</span>
				{/if}
			</button>
			<div class="user-menu">
				<div class="avatar">AC</div>
				<span class="user-name">Alex C.</span>
			</div>
		</div>
	</div>
</header>

<style>
	.header {
		background: var(--portal-white, #ffffff);
		border-bottom: 1px solid #e2e8f0;
		position: sticky;
		top: 0;
		z-index: 100;
	}

	.header-content {
		max-width: 1400px;
		margin: 0 auto;
		padding: 0 2rem;
		height: 64px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2rem;
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.logo-mark {
		width: 36px;
		height: 36px;
	}

	.logo-mark svg {
		width: 100%;
		height: 100%;
	}

	.logo-text {
		font-weight: 700;
		font-size: 1.125rem;
		color: var(--portal-navy, #1e293b);
		letter-spacing: -0.02em;
	}

	.nav {
		display: flex;
		gap: 0.5rem;
	}

	.nav-link {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		color: var(--portal-slate, #64748b);
		text-decoration: none;
		font-size: 0.875rem;
		font-weight: 500;
		border-radius: 6px;
		transition: all 0.15s ease;
	}

	.nav-link:hover {
		color: var(--portal-navy, #1e293b);
		background: var(--portal-light, #f1f5f9);
	}

	.nav-link.active {
		color: var(--portal-teal, #0d9488);
		background: rgba(13, 148, 136, 0.08);
	}

	.nav-icon {
		width: 18px;
		height: 18px;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.icon-btn {
		position: relative;
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		color: var(--portal-slate, #64748b);
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.icon-btn:hover {
		background: var(--portal-light, #f1f5f9);
		color: var(--portal-navy, #1e293b);
	}

	.icon-btn svg {
		width: 22px;
		height: 22px;
	}

	.notification-badge {
		position: absolute;
		top: 6px;
		right: 6px;
		width: 18px;
		height: 18px;
		background: var(--portal-teal, #0d9488);
		color: white;
		font-size: 0.65rem;
		font-weight: 600;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.user-menu {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.375rem 0.75rem 0.375rem 0.375rem;
		background: var(--portal-light, #f1f5f9);
		border-radius: 100px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.user-menu:hover {
		background: #e2e8f0;
	}

	.avatar {
		width: 32px;
		height: 32px;
		background: linear-gradient(
			135deg,
			var(--portal-teal, #0d9488),
			var(--portal-teal-dark, #0f766e)
		);
		color: white;
		font-size: 0.75rem;
		font-weight: 600;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.user-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--portal-navy, #1e293b);
	}

	@media (max-width: 768px) {
		.header-content {
			padding: 0 1rem;
		}
		.nav {
			display: none;
		}
		.user-name {
			display: none;
		}
	}
</style>
