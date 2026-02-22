<svelte:head>
	<title>Audit Log - Admin Console</title>
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
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
				<polyline points="14 2 14 8 20 8" />
				<line x1="16" y1="13" x2="8" y2="13" />
				<line x1="16" y1="17" x2="8" y2="17" />
				<polyline points="10 9 9 9 8 9" />
			</svg>
		</div>
		<h1 class="placeholder-title">Audit Log</h1>
		<p class="placeholder-description">
			Track all administrative actions, tool executions, and configuration changes across your
			CloudNow environment with immutable audit records.
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
