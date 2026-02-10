<script lang="ts">
	import {
		createTable,
		getCoreRowModel,
		getSortedRowModel,
		createColumnHelper,
		type SortingState,
		type TableOptionsResolved,
		type TableState,
		type Updater
	} from '@tanstack/table-core';
	import type { InstanceRow } from './types.js';

	interface Props {
		instances: InstanceRow[];
		title?: string;
	}

	let { instances, title = 'Compute Instances' }: Props = $props();

	let sorting: SortingState = $state([]);

	const columnHelper = createColumnHelper<InstanceRow>();

	const columns = [
		columnHelper.accessor('displayName', { header: 'Name' }),
		columnHelper.accessor('shape', { header: 'Shape' }),
		columnHelper.accessor('lifecycleState', { header: 'State' }),
		columnHelper.accessor('id', { header: 'OCID' }),
		columnHelper.accessor('timeCreated', { header: 'Created' })
	];

	const options = $derived({
		data: instances,
		columns,
		state: { sorting },
		onSortingChange: (updater: Updater<SortingState>) => {
			sorting = typeof updater === 'function' ? updater(sorting) : updater;
		},
		onStateChange: (_updater: Updater<TableState>) => {},
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		renderFallbackValue: null
	} satisfies TableOptionsResolved<InstanceRow>);

	const table = $derived(createTable(options));

	function truncateOcid(ocid: string): string {
		return ocid.length > 30 ? `${ocid.slice(0, 15)}...${ocid.slice(-10)}` : ocid;
	}

	function formatDate(dateStr: unknown): string {
		if (!dateStr || typeof dateStr !== 'string') return '-';
		return new Date(dateStr).toLocaleDateString();
	}

	function stateClass(state: string): string {
		switch (state) {
			case 'RUNNING':
				return 'state-running';
			case 'STOPPED':
				return 'state-stopped';
			case 'TERMINATED':
				return 'state-terminated';
			case 'PROVISIONING':
			case 'STARTING':
			case 'STOPPING':
				return 'state-transitioning';
			default:
				return '';
		}
	}
</script>

<div class="instance-table-wrapper">
	{#if title}
		<h3 class="table-title">{title}</h3>
	{/if}
	{#if instances.length === 0}
		<p class="empty-message">No instances found.</p>
	{:else}
		<div class="table-scroll">
			<table class="instance-table">
				<thead>
					{#each table.getHeaderGroups() as headerGroup}
						<tr>
							{#each headerGroup.headers as header}
								<th
									class:sortable={header.column.getCanSort()}
									onclick={header.column.getToggleSortingHandler()}
								>
									<span class="header-content">
										{header.isPlaceholder ? '' : header.column.columnDef.header}
										{#if header.column.getIsSorted() === 'asc'}
											<span class="sort-indicator"> &#9650;</span>
										{:else if header.column.getIsSorted() === 'desc'}
											<span class="sort-indicator"> &#9660;</span>
										{/if}
									</span>
								</th>
							{/each}
						</tr>
					{/each}
				</thead>
				<tbody>
					{#each table.getRowModel().rows as row}
						<tr>
							{#each row.getVisibleCells() as cell}
								<td
									class:state-cell={cell.column.id === 'lifecycleState'}
									class={cell.column.id === 'lifecycleState'
										? stateClass(String(cell.getValue()))
										: ''}
								>
									{#if cell.column.id === 'lifecycleState'}
										<span class="state-badge {stateClass(String(cell.getValue()))}">
											{cell.getValue()}
										</span>
									{:else if cell.column.id === 'id'}
										<code class="ocid">{truncateOcid(String(cell.getValue()))}</code>
									{:else if cell.column.id === 'timeCreated'}
										{formatDate(cell.getValue())}
									{:else}
										{cell.getValue()}
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="table-footer">
			<span class="row-count">{instances.length} instance{instances.length !== 1 ? 's' : ''}</span>
		</div>
	{/if}
</div>

<style>
	.instance-table-wrapper {
		background: var(--portal-white, #ffffff);
		border: 1px solid var(--portal-border, #e2e8f0);
		border-radius: 8px;
		overflow: hidden;
	}

	.table-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--portal-navy, #1e293b);
		padding: 0.75rem 1rem;
		margin: 0;
		border-bottom: 1px solid var(--portal-border, #e2e8f0);
	}

	.empty-message {
		padding: 2rem;
		text-align: center;
		color: var(--portal-slate, #64748b);
		font-size: 0.875rem;
	}

	.table-scroll {
		overflow-x: auto;
	}

	.instance-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	thead {
		background: var(--portal-light, #f8fafc);
	}

	th {
		text-align: left;
		padding: 0.5rem 1rem;
		color: var(--portal-slate, #64748b);
		font-weight: 500;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
		user-select: none;
		border-bottom: 1px solid var(--portal-border, #e2e8f0);
	}

	th.sortable {
		cursor: pointer;
	}

	th.sortable:hover {
		color: var(--portal-teal, #0d9488);
	}

	.header-content {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.sort-indicator {
		font-size: 0.625rem;
		color: var(--portal-teal, #0d9488);
	}

	td {
		padding: 0.5rem 1rem;
		color: var(--portal-navy, #1e293b);
		border-bottom: 1px solid var(--portal-border-light, #f1f5f9);
		white-space: nowrap;
	}

	tr:hover td {
		background: var(--portal-hover, #f8fafc);
	}

	.state-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.state-badge.state-running {
		background: var(--portal-success-bg, #ecfdf5);
		color: var(--portal-success, #059669);
	}

	.state-badge.state-stopped {
		background: var(--portal-warning-bg, #fffbeb);
		color: var(--portal-warning-dark, #d97706);
	}

	.state-badge.state-terminated {
		background: var(--portal-error-bg, #fef2f2);
		color: var(--portal-error, #dc2626);
	}

	.state-badge.state-transitioning {
		background: var(--portal-info-bg, #eff6ff);
		color: var(--portal-info, #2563eb);
	}

	.ocid {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		color: var(--portal-slate, #64748b);
		background: var(--portal-light, #f8fafc);
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
	}

	.table-footer {
		padding: 0.5rem 1rem;
		border-top: 1px solid var(--portal-border, #e2e8f0);
		background: var(--portal-light, #f8fafc);
	}

	.row-count {
		font-size: 0.75rem;
		color: var(--portal-slate, #64748b);
	}
</style>
