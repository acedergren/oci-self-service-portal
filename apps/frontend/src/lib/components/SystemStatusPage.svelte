<script lang="ts">
	type SystemStatus = 'database_unavailable' | 'api_unreachable';

	interface Props {
		status: SystemStatus;
	}

	let { status }: Props = $props();

	const statusConfig: Record<SystemStatus, { title: string; message: string; detail: string }> = {
		database_unavailable: {
			title: 'Database Unavailable',
			message: "CloudNow can't reach Oracle Database.",
			detail:
				'The database connection failed. This usually means the Oracle Autonomous Database is down or network configuration has changed.'
		},
		api_unreachable: {
			title: 'API Service Unavailable',
			message: "CloudNow can't reach the backend API.",
			detail:
				'The Fastify API server is not responding. This usually means the backend service needs to be restarted.'
		}
	};

	let config = $derived(statusConfig[status]);
	let retryCountdown = $state(30);
	let retryInterval: ReturnType<typeof setInterval> | undefined;

	function startCountdown() {
		retryCountdown = 30;
		clearInterval(retryInterval);
		retryInterval = setInterval(() => {
			retryCountdown--;
			if (retryCountdown <= 0) {
				clearInterval(retryInterval);
				window.location.reload();
			}
		}, 1000);
	}

	function retry() {
		clearInterval(retryInterval);
		window.location.reload();
	}

	$effect(() => {
		startCountdown();
		return () => clearInterval(retryInterval);
	});
</script>

<div class="status-page">
	<div class="status-card glass animate-slide-in-up">
		<div class="status-brand">
			<span class="brand-logo">CloudNow</span>
		</div>

		<div class="status-icon">
			{#if status === 'database_unavailable'}
				<svg
					width="48"
					height="48"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<ellipse cx="12" cy="5" rx="9" ry="3" />
					<path d="M3 5V19A9 3 0 0 0 21 19V5" />
					<path d="M3 12A9 3 0 0 0 21 12" />
					<line x1="2" y1="2" x2="22" y2="22" stroke="var(--semantic-error)" stroke-width="2" />
				</svg>
			{:else}
				<svg
					width="48"
					height="48"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path
						d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
					/>
					<line x1="2" y1="2" x2="22" y2="22" stroke="var(--semantic-error)" stroke-width="2" />
				</svg>
			{/if}
		</div>

		<h1 class="status-title">{config.title}</h1>
		<p class="status-message">{config.message}</p>
		<p class="status-detail">{config.detail}</p>

		<div class="status-actions">
			<button class="btn-primary" onclick={retry}>Retry Now</button>
		</div>

		<p class="status-countdown">
			Auto-retrying in {retryCountdown}s
		</p>
	</div>
</div>

<style>
	.status-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-lg);
		background: var(--bg-primary);
	}

	.status-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-md);
		padding: var(--space-xl) var(--space-xxl);
		border-radius: var(--radius-xl);
		max-width: 480px;
		width: 100%;
		text-align: center;
	}

	.status-brand {
		margin-bottom: var(--space-sm);
	}

	.brand-logo {
		font-size: var(--text-xl);
		font-weight: 700;
		color: var(--accent-primary);
		letter-spacing: -0.02em;
	}

	.status-icon {
		color: var(--fg-tertiary);
	}

	.status-title {
		font-size: var(--text-xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin: 0;
	}

	.status-message {
		font-size: var(--text-lg);
		color: var(--fg-secondary);
		margin: 0;
	}

	.status-detail {
		font-size: var(--text-sm);
		color: var(--fg-tertiary);
		margin: 0;
		background: var(--bg-tertiary);
		padding: var(--space-sm) var(--space-md);
		border-radius: var(--radius-md);
		border: 1px solid var(--border-muted);
		line-height: 1.5;
	}

	.status-actions {
		margin-top: var(--space-sm);
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		padding: var(--space-sm) var(--space-lg);
		background: var(--accent-primary);
		color: #ffffff;
		border: none;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
		font-family: inherit;
	}

	.btn-primary:hover {
		background: var(--accent-secondary);
		transform: translateY(-1px);
	}

	.status-countdown {
		font-size: var(--text-xs);
		color: var(--fg-disabled);
		margin: 0;
	}

	@media (max-width: 480px) {
		.status-card {
			padding: var(--space-lg);
		}
	}
</style>
