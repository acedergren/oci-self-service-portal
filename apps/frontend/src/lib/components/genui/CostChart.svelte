<script lang="ts">
	import { Chart, Svg, Area, Axis, Grid } from 'layerchart';

	export interface CostDataPoint {
		date: string;
		amount: number;
		service?: string;
	}

	interface Props {
		data: CostDataPoint[];
		title?: string;
		currency?: string;
	}

	let { data, title = 'Cost Overview', currency = 'USD' }: Props = $props();

	const chartData = $derived(
		data.map((d) => ({
			...d,
			dateObj: new Date(d.date)
		}))
	);

	const totalCost = $derived(data.reduce((sum, d) => sum + d.amount, 0));

	function currencySymbol(c: string): string {
		return c === 'USD' ? '$' : c;
	}
</script>

<div class="cost-chart-wrapper">
	<div class="chart-header">
		<h3 class="chart-title">{title}</h3>
		<span class="chart-total">
			Total: {currencySymbol(currency)}{totalCost.toFixed(2)}
		</span>
	</div>

	{#if data.length === 0}
		<p class="empty-message">No cost data available.</p>
	{:else if data.length === 1}
		<div class="single-value">
			<span class="single-date">{data[0].date}</span>
			<span class="single-amount">
				{currencySymbol(currency)}{data[0].amount.toFixed(2)}
			</span>
			{#if data[0].service}
				<span class="single-service">{data[0].service}</span>
			{/if}
		</div>
	{:else}
		<div class="chart-container">
			<Chart
				data={chartData}
				x="dateObj"
				y="amount"
				yDomain={[0, null]}
				padding={{ top: 16, right: 16, bottom: 32, left: 48 }}
			>
				<Svg>
					<Grid class="stroke-gray-200" />
					<Axis placement="bottom" />
					<Axis placement="left" />
					<Area class="fill-teal-500/20" line={{ class: 'stroke-teal-500 stroke-2' }} />
				</Svg>
			</Chart>
		</div>
	{/if}
</div>

<style>
	.cost-chart-wrapper {
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

	.chart-total {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--portal-teal, #0d9488);
	}

	.empty-message {
		padding: 2rem;
		text-align: center;
		color: var(--portal-slate, #64748b);
		font-size: 0.875rem;
	}

	.single-value {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 2rem;
	}

	.single-date {
		font-size: 0.75rem;
		color: var(--portal-slate, #64748b);
	}

	.single-amount {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--portal-teal, #0d9488);
	}

	.single-service {
		font-size: 0.75rem;
		color: var(--portal-slate, #64748b);
		font-family: 'JetBrains Mono', monospace;
	}

	.chart-container {
		padding: 1rem;
		height: 250px;
	}
</style>
