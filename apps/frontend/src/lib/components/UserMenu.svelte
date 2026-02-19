<script lang="ts">
	import { authClient } from '$lib/auth-client.js';

	interface Props {
		user: { name?: string; email: string; image?: string | null };
		role?: string;
		orgName?: string;
	}

	let { user, role = 'viewer', orgName }: Props = $props();
	let menuOpen = $state(false);

	function signOut() {
		authClient.signOut();
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

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.user-menu')) {
			menuOpen = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="user-menu">
	<button class="user-menu-trigger" onclick={() => (menuOpen = !menuOpen)} aria-label="User menu">
		{#if user.image}
			<img src={user.image} alt="" class="user-avatar" />
		{:else}
			<div class="user-avatar-initials">{getInitials(user.name, user.email)}</div>
		{/if}
	</button>

	{#if menuOpen}
		<div class="user-menu-dropdown glass animate-slide-in-up">
			<div class="user-menu-header">
				{#if user.image}
					<img src={user.image} alt="" class="user-avatar-lg" />
				{:else}
					<div class="user-avatar-initials user-avatar-lg">
						{getInitials(user.name, user.email)}
					</div>
				{/if}
				<div class="user-menu-info">
					<span class="user-menu-name">{user.name ?? user.email}</span>
					{#if user.name}
						<span class="user-menu-email">{user.email}</span>
					{/if}
				</div>
			</div>

			<div class="user-menu-meta">
				<span class="badge badge-role badge-{role}">{role}</span>
				{#if orgName}
					<span class="user-menu-org">{orgName}</span>
				{/if}
			</div>

			<div class="user-menu-divider"></div>

			<button class="user-menu-item" onclick={signOut}>Sign Out</button>
		</div>
	{/if}
</div>

<style>
	.user-menu {
		position: relative;
	}

	.user-menu-trigger {
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-full);
		padding: 2px;
		transition: border-color var(--transition-fast);
	}

	.user-menu-trigger:hover {
		border-color: var(--border-focused);
	}

	.user-avatar,
	.user-avatar-initials {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-full);
	}

	.user-avatar {
		object-fit: cover;
	}

	.user-avatar-initials {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-elevated);
		color: var(--accent-primary);
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.user-avatar-lg {
		width: 40px;
		height: 40px;
	}

	.user-menu-dropdown {
		position: absolute;
		top: calc(100% + var(--space-sm));
		right: 0;
		min-width: 240px;
		padding: var(--space-sm);
		z-index: 50;
		border-radius: var(--radius-lg);
	}

	.user-menu-header {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-sm);
	}

	.user-menu-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.user-menu-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.user-menu-email {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.user-menu-meta {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: 0 var(--space-sm);
		margin-top: var(--space-xs);
	}

	.badge-role {
		text-transform: capitalize;
	}

	.badge-admin {
		background-color: var(--accent-primary);
		color: var(--bg-primary);
	}

	.badge-operator {
		background-color: var(--semantic-info);
		color: var(--bg-primary);
	}

	.badge-viewer {
		background-color: var(--bg-elevated);
		color: var(--fg-secondary);
	}

	.user-menu-org {
		font-size: var(--text-xs);
		color: var(--fg-secondary);
	}

	.user-menu-divider {
		height: 1px;
		background: var(--border-muted);
		margin: var(--space-sm) 0;
	}

	.user-menu-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: var(--space-sm);
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--fg-secondary);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.user-menu-item:hover {
		background: var(--bg-hover);
		color: var(--fg-primary);
	}
</style>
