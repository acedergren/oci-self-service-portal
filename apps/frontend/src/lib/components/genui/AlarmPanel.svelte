<script lang="ts">
	export type AlarmSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
	export type AlarmState = 'FIRING' | 'OK' | 'SUPPRESSED';

	export interface AlarmItem {
		id: string;
		displayName: string;
		severity: AlarmSeverity;
		state: AlarmState;
		namespace?: string;
		metricName?: string;
		body?: string;
		lastTriggered?: string;
	}

	interface Props {
		alarms: AlarmItem[];
		title?: string;
	}

	let { alarms, title = 'Monitoring Alarms' }: Props = $props();

	const counts = $derived({
		critical: alarms.filter((a) => a.severity === 'CRITICAL' && a.state === 'FIRING').length,
		warning: alarms.filter((a) => a.severity === 'WARNING' && a.state === 'FIRING').length,
		ok: alarms.filter((a) => a.state === 'OK').length
	});

	function severityClass(severity: AlarmSeverity, state: AlarmState): string {
		if (state === 'OK') return 'alarm-ok';
		if (state === 'SUPPRESSED') return 'alarm-suppressed';
		return severity === 'CRITICAL' ? 'alarm-critical' : 'alarm-warning';
	}

	function formatTime(dateStr?: string): string {
		if (!dateStr) return '';
		const d = new Date(dateStr);
		return d.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div class="alarm-panel">
	<div class="panel-header">
		<h3 class="panel-title">{title}</h3>
		<div class="alarm-counts">
			{#if counts.critical > 0}
				<span class="count-badge alarm-critical">{counts.critical} Critical</span>
			{/if}
			{#if counts.warning > 0}
				<span class="count-badge alarm-warning">{counts.warning} Warning</span>
			{/if}
			<span class="count-badge alarm-ok">{counts.ok} OK</span>
		</div>
	</div>

	{#if alarms.length === 0}
		<p class="empty-message">No alarms configured.</p>
	{:else}
		<ul class="alarm-list">
			{#each alarms as alarm (alarm.id)}
				<li class="alarm-item {severityClass(alarm.severity, alarm.state)}">
					<div class="alarm-top">
						<div class="alarm-indicator"></div>
						<div class="alarm-info">
							<span class="alarm-name">{alarm.displayName}</span>
							<div class="alarm-meta">
								{#if alarm.namespace}
									<span class="alarm-namespace">{alarm.namespace}</span>
								{/if}
								{#if alarm.metricName}
									<span class="alarm-metric">{alarm.metricName}</span>
								{/if}
							</div>
						</div>
						<div class="alarm-state">
							<span class="state-label">{alarm.state}</span>
							{#if alarm.lastTriggered}
								<span class="last-triggered">{formatTime(alarm.lastTriggered)}</span>
							{/if}
						</div>
					</div>
					{#if alarm.body}
						<p class="alarm-body">{alarm.body}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.alarm-panel {
		background: var(--portal-white, #ffffff);
		border: 1px solid var(--portal-border, #e2e8f0);
		border-radius: 8px;
		overflow: hidden;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--portal-border, #e2e8f0);
	}

	.panel-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--portal-navy, #1e293b);
		margin: 0;
	}

	.alarm-counts {
		display: flex;
		gap: 0.375rem;
	}

	.count-badge {
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 500;
	}

	.count-badge.alarm-critical {
		background: var(--portal-error-bg, #fef2f2);
		color: var(--portal-error, #dc2626);
	}

	.count-badge.alarm-warning {
		background: var(--portal-warning-bg, #fffbeb);
		color: var(--portal-warning-dark, #d97706);
	}

	.count-badge.alarm-ok {
		background: var(--portal-success-bg, #ecfdf5);
		color: var(--portal-success, #059669);
	}

	.empty-message {
		padding: 2rem;
		text-align: center;
		color: var(--portal-slate, #64748b);
		font-size: 0.875rem;
	}

	.alarm-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.alarm-item {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--portal-border-light, #f1f5f9);
		border-left: 3px solid transparent;
	}

	.alarm-item:last-child {
		border-bottom: none;
	}

	.alarm-item.alarm-critical {
		border-left-color: var(--portal-error, #ef4444);
	}
	.alarm-item.alarm-warning {
		border-left-color: var(--portal-warning, #f59e0b);
	}
	.alarm-item.alarm-ok {
		border-left-color: var(--portal-success, #10b981);
	}
	.alarm-item.alarm-suppressed {
		border-left-color: var(--portal-gray, #94a3b8);
	}

	.alarm-top {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.alarm-indicator {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin-top: 0.375rem;
		flex-shrink: 0;
	}

	.alarm-critical .alarm-indicator {
		background: var(--portal-error, #ef4444);
		animation: pulse 2s infinite;
	}
	.alarm-warning .alarm-indicator {
		background: var(--portal-warning, #f59e0b);
	}
	.alarm-ok .alarm-indicator {
		background: var(--portal-success, #10b981);
	}
	.alarm-suppressed .alarm-indicator {
		background: var(--portal-gray, #94a3b8);
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	.alarm-info {
		flex: 1;
		min-width: 0;
	}

	.alarm-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--portal-navy, #1e293b);
	}

	.alarm-meta {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.125rem;
	}

	.alarm-namespace,
	.alarm-metric {
		font-size: 0.6875rem;
		color: var(--portal-slate, #64748b);
		font-family: 'JetBrains Mono', monospace;
	}

	.alarm-state {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.125rem;
		flex-shrink: 0;
	}

	.state-label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.alarm-critical .state-label {
		color: var(--portal-error, #ef4444);
	}
	.alarm-warning .state-label {
		color: var(--portal-warning-dark, #d97706);
	}
	.alarm-ok .state-label {
		color: var(--portal-success, #059669);
	}
	.alarm-suppressed .state-label {
		color: var(--portal-gray, #94a3b8);
	}

	.last-triggered {
		font-size: 0.625rem;
		color: var(--portal-slate, #94a3b8);
	}

	.alarm-body {
		font-size: 0.75rem;
		color: var(--portal-slate, #64748b);
		margin: 0.375rem 0 0 1.25rem;
		line-height: 1.4;
	}
</style>
