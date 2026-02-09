<script lang="ts">
	import { Badge } from '$lib/components/ui/index.js';
	import type { ExecutionTimelineProps, WorkflowRunView, StepExecution } from './types.js';

	let {
		runs,
		selectedRunId,
		isOpen,
		onSelectRun,
		onToggle,
		onApproveStep
	}: ExecutionTimelineProps = $props();

	const selectedRun = $derived(runs.find((r) => r.id === selectedRunId));

	let selectedStepId = $state<string | null>(null);
	const selectedStep = $derived(selectedRun?.steps.find((s) => s.stepId === selectedStepId));

	const runStatusVariant: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
		pending: 'default',
		running: 'info',
		completed: 'success',
		failed: 'error',
		suspended: 'warning'
	};

	const stepStatusIcons: Record<string, string> = {
		pending: '\u25CB', // open circle
		running: '\u25CF', // filled circle
		completed: '\u2713', // checkmark
		failed: '\u2717', // X
		skipped: '\u2298', // circle with slash
		suspended: '\u23F8' // pause
	};

	function formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}
</script>

<div class="execution-timeline" class:open={isOpen}>
	<button class="timeline-toggle" onclick={onToggle}>
		<div class="toggle-content">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				width="16"
				height="16"
				class="toggle-chevron"
				class:open={isOpen}
			>
				<path d="m18 15-6-6-6 6" />
			</svg>
			<span class="toggle-label">Execution History</span>
			{#if runs.length > 0}
				<Badge variant="default">{runs.length}</Badge>
			{/if}
		</div>
	</button>

	{#if isOpen}
		<div class="timeline-content">
			<div class="runs-list">
				{#each runs as run (run.id)}
					<button
						class="run-item"
						class:selected={run.id === selectedRunId}
						onclick={() => {
							onSelectRun(run.id);
							selectedStepId = null;
						}}
					>
						<div class="run-header">
							<Badge variant={runStatusVariant[run.status] ?? 'default'}>{run.status}</Badge>
							<span class="run-time">{formatTime(run.startedAt)}</span>
						</div>
						<div class="run-meta">
							<span class="run-steps-count">
								{run.steps.filter((s) => s.status === 'completed').length}/{run.steps.length} steps
							</span>
							<span class="run-trigger">by {run.triggeredBy}</span>
						</div>
					</button>
				{:else}
					<div class="empty-runs">
						<p>No runs yet</p>
					</div>
				{/each}
			</div>

			{#if selectedRun}
				<div class="run-detail">
					<div class="steps-timeline">
						{#each selectedRun.steps as step, index (step.stepId)}
							{@const isLast = index === selectedRun.steps.length - 1}
							<div
								class="step-item"
								class:selected={step.stepId === selectedStepId}
								class:running={step.status === 'running'}
								role="button"
								tabindex="0"
								onclick={() => {
									selectedStepId = step.stepId;
								}}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										selectedStepId = step.stepId;
									}
								}}
							>
								{#if !isLast}
									<div class="step-connector" class:completed={step.status === 'completed'}></div>
								{/if}

								<div
									class="step-icon"
									class:completed={step.status === 'completed'}
									class:failed={step.status === 'failed'}
									class:running={step.status === 'running'}
									class:suspended={step.status === 'suspended'}
								>
									{stepStatusIcons[step.status] ?? stepStatusIcons.pending}
								</div>

								<div class="step-content">
									<span class="step-name">{step.nodeName}</span>
									{#if step.duration}
										<span class="step-duration">{formatDuration(step.duration)}</span>
									{/if}
								</div>

								{#if step.status === 'suspended' && onApproveStep}
									<button
										class="approve-btn"
										onclick={(e) => {
											e.stopPropagation();
											onApproveStep!(selectedRun!.id, step.stepId);
										}}
									>
										Approve
									</button>
								{/if}
							</div>
						{/each}
					</div>

					{#if selectedStep}
						<div class="step-detail">
							<h4 class="detail-title">{selectedStep.nodeName}</h4>
							{#if selectedStep.error}
								<div class="detail-error">
									<span class="error-label">Error:</span>
									{selectedStep.error}
								</div>
							{/if}
							{#if selectedStep.input}
								<div class="detail-section">
									<span class="detail-label">Input</span>
									<pre class="detail-json">{JSON.stringify(selectedStep.input, null, 2)}</pre>
								</div>
							{/if}
							{#if selectedStep.output}
								<div class="detail-section">
									<span class="detail-label">Output</span>
									<pre class="detail-json">{JSON.stringify(selectedStep.output, null, 2)}</pre>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.execution-timeline {
		background: var(--bg-secondary);
		border-top: 1px solid var(--border-default);
		flex-shrink: 0;
	}

	.timeline-toggle {
		width: 100%;
		padding: 0.5rem 1rem;
		background: none;
		border: none;
		cursor: pointer;
		font-family: inherit;
	}

	.toggle-content {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.toggle-chevron {
		color: var(--fg-secondary);
		transition: transform 0.2s;
		transform: rotate(180deg);
	}

	.toggle-chevron.open {
		transform: rotate(0deg);
	}

	.toggle-label {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--fg-secondary);
	}

	.timeline-content {
		display: flex;
		height: 200px;
		border-top: 1px solid var(--border-default);
	}

	.runs-list {
		width: 200px;
		border-right: 1px solid var(--border-default);
		overflow-y: auto;
		padding: 0.5rem;
	}

	.run-item {
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

	.run-item:hover {
		background: var(--bg-hover);
	}

	.run-item.selected {
		background: var(--bg-elevated);
		border-color: var(--accent-primary);
	}

	.run-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.25rem;
	}

	.run-time {
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
	}

	.run-meta {
		display: flex;
		gap: 0.5rem;
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
	}

	.run-steps-count {
		color: var(--fg-secondary);
	}

	.empty-runs {
		padding: 1.5rem;
		text-align: center;
		font-size: 0.75rem;
		color: var(--fg-tertiary);
	}

	.run-detail {
		flex: 1;
		display: flex;
		overflow: hidden;
	}

	.steps-timeline {
		width: 220px;
		border-right: 1px solid var(--border-default);
		overflow-y: auto;
		padding: 0.5rem;
	}

	.step-item {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		background: none;
		border: 1px solid transparent;
		border-radius: 4px;
		cursor: pointer;
		width: 100%;
		text-align: left;
		font-family: inherit;
		transition: all 0.15s;
		margin-bottom: 2px;
	}

	.step-item:hover {
		background: var(--bg-hover);
	}

	.step-item.selected {
		background: var(--bg-elevated);
		border-color: var(--border-default);
	}

	.step-item.running {
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

	.step-connector {
		position: absolute;
		left: 17px;
		top: 28px;
		bottom: -6px;
		width: 2px;
		background: var(--border-default);
	}

	.step-connector.completed {
		background: var(--semantic-success);
	}

	.step-icon {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 10px;
		background: var(--bg-tertiary);
		color: var(--fg-tertiary);
		flex-shrink: 0;
		z-index: 1;
	}

	.step-icon.completed {
		background: rgba(0, 200, 0, 0.15);
		color: var(--semantic-success);
	}

	.step-icon.failed {
		background: rgba(255, 0, 0, 0.15);
		color: var(--semantic-error);
	}

	.step-icon.running {
		background: rgba(0, 100, 255, 0.15);
		color: var(--semantic-info);
	}

	.step-icon.suspended {
		background: rgba(255, 180, 0, 0.15);
		color: var(--semantic-warning);
	}

	.step-content {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.step-name {
		font-size: 0.75rem;
		color: var(--fg-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.step-duration {
		font-size: 0.625rem;
		color: var(--fg-tertiary);
		flex-shrink: 0;
	}

	.approve-btn {
		padding: 0.125rem 0.375rem;
		background: var(--semantic-warning);
		color: var(--bg-primary);
		border: none;
		border-radius: 4px;
		font-size: 0.625rem;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
		flex-shrink: 0;
	}

	.approve-btn:hover {
		filter: brightness(1.1);
	}

	.step-detail {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem;
	}

	.detail-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: 0.5rem;
	}

	.detail-error {
		padding: 0.5rem;
		background: rgba(255, 0, 0, 0.1);
		border-radius: 4px;
		font-size: 0.75rem;
		color: var(--semantic-error);
		margin-bottom: 0.5rem;
	}

	.error-label {
		font-weight: 600;
	}

	.detail-section {
		margin-bottom: 0.5rem;
	}

	.detail-label {
		display: block;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-secondary);
		margin-bottom: 0.25rem;
	}

	.detail-json {
		padding: 0.5rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		font-size: 0.6875rem;
		color: var(--fg-primary);
		font-family: monospace;
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-all;
		margin: 0;
		max-height: 120px;
		overflow-y: auto;
	}
</style>
