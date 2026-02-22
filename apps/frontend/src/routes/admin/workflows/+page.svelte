<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Workflow Management - Admin Console</title>
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
				<polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
			</svg>
		</div>
		<h1 class="placeholder-title">Workflow Management</h1>
		<p class="placeholder-description">
			Centrally manage workflow templates, execution policies, and approval chains. Monitor workflow
			health across your organisation.
		</p>
		<div class="placeholder-actions">
			<span class="placeholder-badge">Coming Soon</span>
			<a href={resolve('/workflows')} class="btn btn-secondary">Go to Workflow Designer</a>
			<a href={resolve('/admin/workflows/runs')} class="btn btn-secondary">View Run History</a>
		</div>
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

	.placeholder-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-sm);
		align-items: center;
		justify-content: center;
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
