<script lang="ts">
	import { resolve } from '$app/paths';

	interface Finding {
		id: string;
		title: string;
		severity: 'critical' | 'high' | 'medium' | 'low';
		summary: string;
		impact?: string;
		domain?: string;
		charlieAction?: { prompt: string; label?: string };
	}

	interface Props {
		finding: Finding;
		onDismiss?: (id: string) => void;
		/** When provided, renders an in-context button instead of navigating to /chat */
		onCharlieAction?: (prompt: string) => void;
	}

	let { finding, onDismiss, onCharlieAction }: Props = $props();

	const severityConfig = {
		critical: { color: 'var(--semantic-error)', label: 'Critical' },
		high: { color: 'var(--semantic-warning)', label: 'High' },
		medium: { color: 'var(--semantic-info)', label: 'Medium' },
		low: { color: 'var(--fg-tertiary)', label: 'Low' }
	} as const;

	let config = $derived(severityConfig[finding.severity]);

	let charliePrompt = $derived(
		finding.charlieAction?.prompt ?? `Help me fix this issue: ${finding.title}`
	);

	let charlieHref = $derived(`${resolve('/chat')}?prompt=${encodeURIComponent(charliePrompt)}`);
</script>

<article
	class="finding-card glass-advisor"
	style="border-left-color: {config.color};"
	aria-label="Finding: {finding.title}"
>
	<div class="card-header">
		<div class="severity-row">
			<span class="severity-dot" style="background: {config.color};" aria-hidden="true"></span>
			<span class="severity-label" style="color: {config.color};">{config.label}</span>
			{#if finding.domain}
				<span class="domain-tag">{finding.domain}</span>
			{/if}
		</div>

		{#if onDismiss}
			<button
				class="dismiss-btn"
				onclick={() => onDismiss?.(finding.id)}
				aria-label="Dismiss finding: {finding.title}"
			>
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
					<line x1="18" y1="6" x2="6" y2="18" />
					<line x1="6" y1="6" x2="18" y2="18" />
				</svg>
			</button>
		{/if}
	</div>

	<h3 class="card-title">{finding.title}</h3>

	<p class="card-summary">{finding.summary}</p>

	{#if finding.impact}
		<div class="impact-row">
			<span class="impact-label">Impact</span>
			<span class="impact-text">{finding.impact}</span>
		</div>
	{/if}

	<div class="card-actions">
		{#if onCharlieAction}
			<button
				class="charlie-btn"
				onclick={() => onCharlieAction?.(charliePrompt)}
				aria-label="Ask Charlie to fix this finding"
			>
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
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
				</svg>
				{finding.charlieAction?.label ?? 'Ask Charlie to fix this'}
			</button>
		{:else}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() used in charlieHref derivation -->
			<a href={charlieHref} class="charlie-btn" aria-label="Ask Charlie to fix this finding">
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
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
				</svg>
				{finding.charlieAction?.label ?? 'Ask Charlie to fix this'}
			</a>
		{/if}

		{#if onDismiss}
			<button
				class="dismiss-text-btn"
				onclick={() => onDismiss?.(finding.id)}
				aria-label="Dismiss this finding"
			>
				Dismiss
			</button>
		{/if}
	</div>
</article>

<style>
	.finding-card {
		border-radius: var(--radius-lg);
		padding: var(--space-md);
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		/* Override glass-advisor's border-left with per-severity color via inline style */
		border-left-width: 3px;
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
	}

	.severity-row {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		flex-wrap: wrap;
	}

	.severity-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.severity-label {
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.domain-tag {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		background: var(--bg-tertiary);
		border: 1px solid var(--border-muted);
		border-radius: var(--radius-full);
		padding: 1px var(--space-xs);
		text-transform: capitalize;
	}

	.dismiss-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		color: var(--fg-disabled);
		cursor: pointer;
		padding: 4px;
		border-radius: var(--radius-sm);
		transition: color var(--transition-fast);
		flex-shrink: 0;
	}

	.dismiss-btn:hover {
		color: var(--fg-primary);
		background: var(--bg-hover);
	}

	.card-title {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--fg-primary);
		margin: 0;
		line-height: 1.3;
	}

	.card-summary {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
		margin: 0;
		line-height: 1.5;
	}

	.impact-row {
		display: flex;
		gap: var(--space-sm);
		align-items: baseline;
		padding: var(--space-xs) var(--space-sm);
		background: color-mix(in srgb, var(--semantic-warning) 8%, var(--bg-tertiary));
		border-radius: var(--radius-sm);
		border: 1px solid color-mix(in srgb, var(--semantic-warning) 20%, transparent);
	}

	.impact-label {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--semantic-warning);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	.impact-text {
		font-size: var(--text-xs);
		color: var(--fg-secondary);
		line-height: 1.4;
	}

	.card-actions {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		flex-wrap: wrap;
		padding-top: var(--space-xs);
		border-top: 1px solid var(--border-muted);
		margin-top: var(--space-xs);
	}

	.charlie-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-xs);
		padding: var(--space-xs) var(--space-sm);
		background: var(--accent-primary);
		color: #ffffff;
		border: none;
		border-radius: var(--radius-md);
		font-size: var(--text-xs);
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.charlie-btn:hover {
		background: var(--accent-secondary);
		transform: translateY(-1px);
	}

	.dismiss-text-btn {
		background: none;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-tertiary);
		font-size: var(--text-xs);
		padding: var(--space-xs) var(--space-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.dismiss-text-btn:hover {
		background: var(--bg-hover);
		color: var(--fg-primary);
		border-color: var(--border-focused);
	}
</style>
