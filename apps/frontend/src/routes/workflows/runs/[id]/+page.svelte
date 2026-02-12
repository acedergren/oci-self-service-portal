<script lang="ts">
	import { page } from '$app/stores';
	import { Badge } from '$lib/components/ui/index.js';
	import { toast } from 'svelte-sonner';

	const runId = $derived($page.params.id);

	interface RunStep {
		id: string;
		nodeId: string;
		nodeType: string;
		stepNumber: number;
		status: string;
		input?: Record<string, unknown>;
		output?: Record<string, unknown>;
		error?: string;
		startedAt?: string;
		completedAt?: string;
		durationMs?: number;
	}

	interface RunDetail {
		id: string;
		definitionId: string;
		status: string;
		input?: Record<string, unknown>;
		output?: Record<string, unknown>;
		startedAt?: string;
		completedAt?: string;
		steps: RunStep[];
	}

	let run = $state<RunDetail | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let selectedStepId = $state<string | null>(null);

	const selectedStep = $derived(run?.steps.find((s) => s.id === selectedStepId));

	async function loadRun() {
		loading = true;
		error = null;
		try {
			const res = await fetch(`/api/workflows/runs/${runId}`);
			if (!res.ok) throw new Error(`Failed to load run: ${res.status}`);
			const data = await res.json();
			run = data.run;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load run';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void runId; // Establish dependency on runId
		loadRun();
	});

	async function approveStep(stepId: string) {
		try {
			const res = await fetch(`/api/workflows/runs/${runId}/approve`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ stepId })
			});
			if (!res.ok) throw new Error(`Approve failed: ${res.status}`);
			toast.success('Step approved');
			loadRun(); // Refresh
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to approve step');
		}
	}

	const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
		pending: 'default',
		running: 'info',
		completed: 'success',
		failed: 'error',
		suspended: 'warning',
		skipped: 'default'
	};

	const stepIcons: Record<string, string> = {
		pending: '\u25CB',
		running: '\u25CF',
		completed: '\u2713',
		failed: '\u2717',
		skipped: '\u2298',
		suspended: '\u23F8'
	};

	function formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	function formatTime(iso?: string): string {
		if (!iso) return '-';
		return new Date(iso).toLocaleString();
	}
</script>

<svelte:head>
	<title>Run {runId} | OCI Self-Service Portal</title>
</svelte:head>

<div class="run-page">
	<div class="page-header">
		<a href="/workflows" class="back-link">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				width="18"
				height="18"
			>
				<path d="M19 12H5M12 19l-7-7 7-7" />
			</svg>
			Back to Workflows
		</a>
		<h1 class="page-title">Workflow Run</h1>
	</div>

	{#if loading}
		<div class="loading-state">Loading run details...</div>
	{:else if error}
		<div class="error-state">
			<p>{error}</p>
			<button onclick={loadRun} class="retry-btn">Retry</button>
		</div>
	{:else if run}
		<div class="run-overview">
			<div class="overview-item">
				<span class="overview-label">Status</span>
				<Badge variant={statusVariant[run.status] ?? 'default'}>{run.status}</Badge>
			</div>
			<div class="overview-item">
				<span class="overview-label">Started</span>
				<span class="overview-value">{formatTime(run.startedAt)}</span>
			</div>
			<div class="overview-item">
				<span class="overview-label">Completed</span>
				<span class="overview-value">{formatTime(run.completedAt)}</span>
			</div>
			<div class="overview-item">
				<span class="overview-label">Steps</span>
				<span class="overview-value"
					>{run.steps.filter((s) => s.status === 'completed').length}/{run.steps.length}</span
				>
			</div>
			{#if run.definitionId}
				<div class="overview-item">
					<a href="/workflows/{run.definitionId}" class="overview-link">View Workflow</a>
				</div>
			{/if}
		</div>

		<div class="run-detail-layout">
			<div class="steps-panel">
				<h2 class="panel-title">Steps</h2>
				{#each run.steps as step (step.id)}
					<div
						class="step-row"
						class:selected={step.id === selectedStepId}
						class:running={step.status === 'running'}
						role="button"
						tabindex="0"
						onclick={() => {
							selectedStepId = step.id;
						}}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								selectedStepId = step.id;
							}
						}}
					>
						<span
							class="step-icon"
							class:completed={step.status === 'completed'}
							class:failed={step.status === 'failed'}
							class:suspended={step.status === 'suspended'}
						>
							{stepIcons[step.status] ?? stepIcons.pending}
						</span>
						<div class="step-info">
							<span class="step-number">Step {step.stepNumber}</span>
							<span class="step-type">{step.nodeType}</span>
						</div>
						{#if step.durationMs}
							<span class="step-duration">{formatDuration(step.durationMs)}</span>
						{/if}
						{#if step.status === 'suspended'}
							<button
								class="approve-btn"
								onclick={(e) => {
									e.stopPropagation();
									approveStep(step.id);
								}}
							>
								Approve
							</button>
						{/if}
					</div>
				{/each}
			</div>

			<div class="detail-panel">
				{#if selectedStep}
					<h2 class="panel-title">Step {selectedStep.stepNumber} - {selectedStep.nodeType}</h2>
					<div class="detail-meta">
						<Badge variant={statusVariant[selectedStep.status] ?? 'default'}
							>{selectedStep.status}</Badge
						>
						{#if selectedStep.durationMs}
							<span class="detail-duration">{formatDuration(selectedStep.durationMs)}</span>
						{/if}
					</div>

					{#if selectedStep.error}
						<div class="detail-error">
							<h3 class="detail-section-title">Error</h3>
							<pre class="detail-json error">{selectedStep.error}</pre>
						</div>
					{/if}

					{#if selectedStep.input}
						<div class="detail-section">
							<h3 class="detail-section-title">Input</h3>
							<pre class="detail-json">{JSON.stringify(selectedStep.input, null, 2)}</pre>
						</div>
					{/if}

					{#if selectedStep.output}
						<div class="detail-section">
							<h3 class="detail-section-title">Output</h3>
							<pre class="detail-json">{JSON.stringify(selectedStep.output, null, 2)}</pre>
						</div>
					{/if}
				{:else}
					<div class="empty-detail">
						<p>Select a step to view details</p>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.run-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--fg-secondary);
		text-decoration: none;
		font-size: 0.8125rem;
		margin-bottom: 0.5rem;
		transition: color 0.15s;
	}

	.back-link:hover {
		color: var(--fg-primary);
	}

	.page-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--fg-primary);
	}

	.run-overview {
		display: flex;
		gap: 2rem;
		padding: 1rem 1.25rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.overview-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.overview-label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-tertiary);
	}

	.overview-value {
		font-size: 0.875rem;
		color: var(--fg-primary);
	}

	.overview-link {
		font-size: 0.8125rem;
		color: var(--accent-primary);
		text-decoration: none;
	}

	.overview-link:hover {
		text-decoration: underline;
	}

	.run-detail-layout {
		display: grid;
		grid-template-columns: 280px 1fr;
		gap: 1rem;
		min-height: 400px;
	}

	.steps-panel {
		background: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		padding: 1rem;
		overflow-y: auto;
	}

	.panel-title {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--fg-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.75rem;
	}

	.step-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem;
		background: none;
		border: 1px solid transparent;
		border-radius: 6px;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		margin-bottom: 2px;
		transition: all 0.15s;
	}

	.step-row:hover {
		background: var(--bg-hover);
	}

	.step-row.selected {
		background: var(--bg-tertiary);
		border-color: var(--border-default);
	}

	.step-row.running {
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.6;
		}
	}

	.step-icon {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		background: var(--bg-tertiary);
		color: var(--fg-tertiary);
		flex-shrink: 0;
	}

	.step-icon.completed {
		background: rgba(0, 200, 0, 0.15);
		color: var(--semantic-success);
	}

	.step-icon.failed {
		background: rgba(255, 0, 0, 0.15);
		color: var(--semantic-error);
	}

	.step-icon.suspended {
		background: rgba(255, 180, 0, 0.15);
		color: var(--semantic-warning);
	}

	.step-info {
		flex: 1;
		min-width: 0;
	}

	.step-number {
		display: block;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--fg-primary);
	}

	.step-type {
		display: block;
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
	}

	.step-duration {
		font-size: 0.625rem;
		color: var(--fg-tertiary);
		flex-shrink: 0;
	}

	.approve-btn {
		padding: 0.25rem 0.5rem;
		background: var(--semantic-warning);
		color: var(--bg-primary);
		border: none;
		border-radius: 4px;
		font-size: 0.6875rem;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
		flex-shrink: 0;
	}

	.detail-panel {
		background: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		padding: 1rem;
		overflow-y: auto;
	}

	.detail-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.detail-duration {
		font-size: 0.75rem;
		color: var(--fg-tertiary);
	}

	.detail-error {
		margin-bottom: 1rem;
	}

	.detail-section {
		margin-bottom: 1rem;
	}

	.detail-section-title {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-secondary);
		margin-bottom: 0.375rem;
	}

	.detail-json {
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		font-size: 0.75rem;
		font-family: monospace;
		color: var(--fg-primary);
		white-space: pre-wrap;
		word-break: break-all;
		max-height: 300px;
		overflow-y: auto;
		margin: 0;
	}

	.detail-json.error {
		border-color: var(--semantic-error);
		color: var(--semantic-error);
	}

	.empty-detail {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 200px;
		color: var(--fg-tertiary);
		font-size: 0.875rem;
	}

	.loading-state,
	.error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem;
		color: var(--fg-tertiary);
	}

	.retry-btn {
		margin-top: 1rem;
		padding: 0.5rem 1rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--fg-secondary);
		cursor: pointer;
		font-family: inherit;
	}

	@media (max-width: 768px) {
		.run-page {
			padding: 1rem;
		}

		.run-detail-layout {
			grid-template-columns: 1fr;
		}
	}
</style>
