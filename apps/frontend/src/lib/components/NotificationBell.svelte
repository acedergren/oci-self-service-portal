<script lang="ts">
	import { resolve } from '$app/paths';

	interface Finding {
		id: string;
		title: string;
		severity: 'critical' | 'high' | 'medium' | 'low';
		summary?: string;
	}

	let open = $state(false);
	let findings: Finding[] = $state([]);
	let loading = $state(true);
	let error = $state(false);

	$effect(() => {
		fetchFindings();
	});

	async function fetchFindings() {
		loading = true;
		error = false;
		try {
			const res = await fetch(
				'/api/cloud-advisor/findings?limit=5&status=active&severity=critical,high'
			);
			if (!res.ok) throw new Error('Failed to load');
			const data = await res.json();
			findings = data.findings ?? data ?? [];
		} catch {
			error = true;
			findings = [];
		} finally {
			loading = false;
		}
	}

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.notification-bell')) {
			open = false;
		}
	}

	function buildChatPrompt(finding: Finding): string {
		return `${resolve('/chat')}?prompt=${encodeURIComponent(`Help me fix this CloudAdvisor finding: ${finding.title}`)}`;
	}

	const badgeCount = $derived(findings.length);

	const severityColors: Record<Finding['severity'], string> = {
		critical: 'var(--semantic-error)',
		high: 'var(--advisor-accent)',
		medium: 'var(--semantic-info)',
		low: 'var(--fg-tertiary)'
	};
</script>

<svelte:window onclick={handleClickOutside} />

<div class="notification-bell">
	<button
		class="bell-btn"
		onclick={() => (open = !open)}
		aria-label="Notifications"
		aria-expanded={open}
	>
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
			<path d="M13.73 21a2 2 0 0 1-3.46 0" />
		</svg>

		{#if !error && !loading && badgeCount > 0}
			<span
				class="badge-dot"
				style="background: {badgeCount > 0 && findings.some((f) => f.severity === 'critical')
					? 'var(--semantic-error)'
					: 'var(--advisor-accent)'};"
				aria-label="{badgeCount} notifications"
			>
				{badgeCount > 9 ? '9+' : badgeCount}
			</span>
		{/if}
	</button>

	{#if open}
		<div class="dropdown glass animate-slide-in-up" role="dialog" aria-label="Notifications panel">
			<div class="dropdown-header">
				<span class="dropdown-title">Notifications</span>
				{#if !loading && !error}
					<button class="refresh-btn" onclick={fetchFindings} aria-label="Refresh notifications">
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M23 4v6h-6" />
							<path d="M1 20v-6h6" />
							<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
						</svg>
					</button>
				{/if}
			</div>

			{#if loading}
				<div class="dropdown-state">
					<div class="spinner" aria-label="Loading..."></div>
				</div>
			{:else if error}
				<div class="dropdown-state">
					<p class="state-text error-text">Unable to load notifications.</p>
					<button class="retry-btn" onclick={fetchFindings}>Try again</button>
				</div>
			{:else if findings.length === 0}
				<div class="dropdown-state">
					<svg
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--semantic-success)"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
						<polyline points="22 4 12 14.01 9 11.01" />
					</svg>
					<p class="state-text">All clear — no findings need attention.</p>
				</div>
			{:else}
				<ul class="findings-list" role="list">
					{#each findings as finding (finding.id)}
						<li class="finding-item">
							<span
								class="severity-dot"
								style="background: {severityColors[finding.severity]};"
								aria-label="Severity: {finding.severity}"
							></span>
							<div class="finding-info">
								<span class="finding-title">{finding.title}</span>
								<span class="finding-severity">{finding.severity}</span>
							</div>
							<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve() used inside buildChatPrompt -->
							<a
								href={buildChatPrompt(finding)}
								class="ask-charlie-link"
								onclick={() => (open = false)}
								aria-label="Ask Charlie to fix: {finding.title}"
							>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
								Fix
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	.notification-bell {
		position: relative;
	}

	.bell-btn {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-secondary);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.bell-btn:hover {
		background: var(--bg-hover);
		color: var(--fg-primary);
		border-color: var(--border-focused);
	}

	.badge-dot {
		position: absolute;
		top: -4px;
		right: -4px;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		border-radius: var(--radius-full);
		font-size: 10px;
		font-weight: 700;
		color: #ffffff;
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	.dropdown {
		position: absolute;
		top: calc(100% + var(--space-sm));
		right: 0;
		width: 320px;
		border-radius: var(--radius-lg);
		z-index: 50;
		overflow: hidden;
	}

	.dropdown-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-sm) var(--space-md);
		border-bottom: 1px solid var(--border-muted);
	}

	.dropdown-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-primary);
	}

	.refresh-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		color: var(--fg-tertiary);
		cursor: pointer;
		padding: 4px;
		border-radius: var(--radius-sm);
		transition: color var(--transition-fast);
	}

	.refresh-btn:hover {
		color: var(--fg-primary);
	}

	.dropdown-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-sm);
		padding: var(--space-xl) var(--space-md);
	}

	.state-text {
		font-size: var(--text-sm);
		color: var(--fg-tertiary);
		text-align: center;
		margin: 0;
	}

	.error-text {
		color: var(--semantic-error);
	}

	.retry-btn {
		background: none;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--fg-secondary);
		font-size: var(--text-xs);
		padding: var(--space-xs) var(--space-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.retry-btn:hover {
		background: var(--bg-hover);
		color: var(--fg-primary);
	}

	.spinner {
		width: 20px;
		height: 20px;
		border: 2px solid var(--border-default);
		border-top-color: var(--accent-primary);
		border-radius: var(--radius-full);
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.findings-list {
		list-style: none;
		margin: 0;
		padding: var(--space-xs) 0;
	}

	.finding-item {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-sm) var(--space-md);
		transition: background var(--transition-fast);
	}

	.finding-item:hover {
		background: var(--bg-hover);
	}

	.severity-dot {
		flex-shrink: 0;
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
	}

	.finding-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.finding-title {
		font-size: var(--text-sm);
		color: var(--fg-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.finding-severity {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		text-transform: capitalize;
	}

	.ask-charlie-link {
		flex-shrink: 0;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--accent-primary);
		text-decoration: none;
		padding: 2px var(--space-sm);
		border: 1px solid var(--border-muted);
		border-radius: var(--radius-sm);
		transition: all var(--transition-fast);
		white-space: nowrap;
	}

	.ask-charlie-link:hover {
		background: var(--accent-muted);
		border-color: var(--accent-primary);
	}

	@media (max-width: 400px) {
		.dropdown {
			width: calc(100vw - var(--space-lg) * 2);
			right: -12px;
		}
	}
</style>
