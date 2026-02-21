<svelte:head>
	<title>API Keys - Admin Console</title>
</svelte:head>

<div class="placeholder-page">
	<div class="placeholder-card glass">
		<div class="placeholder-icon">
			<svg
				width="48"
				height="48"
				viewBox="0 0 24 24"
				fill="none"
				stroke="var(--accent-primary)"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path
					d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"
				/>
			</svg>
		</div>
		<h1 class="placeholder-title">API Keys</h1>
		<p class="placeholder-description">
			Manage API keys for programmatic access to CloudNow services. Create, rotate, and revoke keys
			with fine-grained permissions.
		</p>
		<span class="placeholder-badge">Coming Soon</span>
	</div>
</div>

<style>
	.placeholder-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 60vh;
		padding: var(--space-xl);
	}

	.placeholder-card {
		max-width: 480px;
		text-align: center;
		padding: var(--space-xxl);
		border-radius: var(--radius-xl);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-md);
	}

	.placeholder-icon {
		width: 80px;
		height: 80px;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.placeholder-title {
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin: 0;
	}

	.placeholder-description {
		color: var(--fg-tertiary);
		font-size: var(--text-sm);
		line-height: 1.6;
		margin: 0;
	}

	.placeholder-badge {
		display: inline-block;
		padding: var(--space-xs) var(--space-md);
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
		color: var(--accent-primary);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
</style>
