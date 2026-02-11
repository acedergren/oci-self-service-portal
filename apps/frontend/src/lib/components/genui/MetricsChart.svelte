<script lang="ts">
	import { Chart, Svg, Spline, Axis, Grid } from 'layerchart';

	export interface MetricDataPoint {
		timestamp: string;
		value: number;
	}

	export interface MetricSeries {
		name: string;
		unit: string;
		data: MetricDataPoint[];
		color?: string;
	}

	interface Props {
		series: MetricSeries[];
		title?: string;
	}

	let { series, title = 'Metrics' }: Props = $props();

	let selectedIndex = $state(0);

	const activeSeries = $derived(
		series.length > 0 ? (series[selectedIndex] ?? series[0]) : undefined
	);

	const chartData = $derived(
		activeSeries
			? activeSeries.data.map((d) => ({
					...d,
					dateObj: new Date(d.timestamp)
				}))
			: []
	);

	const stats = $derived.by(() => {
		if (chartData.length === 0) return { latest: 0, min: 0, max: 0, avg: 0 };
		const values = chartData.map((d) => d.value);
		return {
			latest: values[values.length - 1],
			min: Math.min(...values),
			max: Math.max(...values),
			avg: values.reduce((sum, v) => sum + v, 0) / values.length
		};
	});
</script>

<div class="metrics-chart-wrapper">
	<div class="chart-header">
		<h3 class="chart-title">{title}</h3>
		{#if series.length > 1}
			<div class="series-tabs">
				{#each series as s, i (s.name)}
					<button
						class="series-tab"
						class:active={i === selectedIndex}
						onclick={() => (selectedIndex = i)}
					>
						{s.name}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if series.length === 0 || chartData.length === 0}
		<p class="empty-message">No metrics data available.</p>
	{:else}
		{@const s = stats}
		<div class="metrics-summary">
			<div class="metric-stat">
				<span class="stat-label">Latest</span>
				<span class="stat-value">
					{s.latest.toFixed(1)}
					<span class="stat-unit">{activeSeries!.unit}</span>
				</span>
			</div>
			<div class="metric-stat">
				<span class="stat-label">Min</span>
				<span class="stat-value">
					{s.min.toFixed(1)}
					<span class="stat-unit">{activeSeries!.unit}</span>
				</span>
			</div>
			<div class="metric-stat">
				<span class="stat-label">Max</span>
				<span class="stat-value">
					{s.max.toFixed(1)}
					<span class="stat-unit">{activeSeries!.unit}</span>
				</span>
			</div>
			<div class="metric-stat">
				<span class="stat-label">Avg</span>
				<span class="stat-value">
					{s.avg.toFixed(1)}
					<span class="stat-unit">{activeSeries!.unit}</span>
				</span>
			</div>
		</div>
		<div class="chart-container">
			<Chart
				data={chartData}
				x="dateObj"
				y="value"
				yDomain={[0, null]}
				padding={{ top: 16, right: 16, bottom: 32, left: 48 }}
			>
				<Svg>
					<Grid class="stroke-gray-200" />
					<Axis placement="bottom" />
					<Axis placement="left" />
					<Spline class="stroke-blue-500 stroke-2 fill-none" />
				</Svg>
			</Chart>
		</div>
	{/if}
</div>

<style>
	.metrics-chart-wrapper {
		background: var(--portal-white, #ffffff);
		border: 1px solid var(--portal-border, #e2e8f0);
		border-radius: 8px;
		overflow: hidden;
	}

	.chart-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--portal-border, #e2e8f0);
	}

	.chart-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--portal-navy, #1e293b);
		margin: 0;
	}

	.series-tabs {
		display: flex;
		gap: 0.25rem;
	}

	.series-tab {
		padding: 0.25rem 0.625rem;
		border: 1px solid var(--portal-border, #e2e8f0);
		border-radius: 6px;
		background: transparent;
		font-size: 0.6875rem;
		color: var(--portal-slate, #64748b);
		cursor: pointer;
	}

	.series-tab:hover {
		background: var(--portal-light, #f8fafc);
	}

	.series-tab.active {
		background: var(--portal-teal, #0d9488);
		color: white;
		border-color: var(--portal-teal, #0d9488);
	}

	.empty-message {
		padding: 2rem;
		text-align: center;
		color: var(--portal-slate, #64748b);
		font-size: 0.875rem;
	}

	.metrics-summary {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--portal-border-light, #f1f5f9);
	}

	.metric-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.125rem;
	}

	.stat-label {
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--portal-slate, #64748b);
	}

	.stat-value {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--portal-navy, #1e293b);
	}

	.stat-unit {
		font-size: 0.6875rem;
		font-weight: 400;
		color: var(--portal-slate, #64748b);
	}

	.chart-container {
		padding: 1rem;
		height: 250px;
	}
</style>
