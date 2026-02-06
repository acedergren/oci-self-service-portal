<script lang="ts">
	import type { NodePaletteProps, PaletteItem } from './types.js';

	let { groups, onDragStart }: NodePaletteProps = $props();

	let searchQuery = $state('');

	const filteredGroups = $derived(
		groups
			.map((group) => ({
				...group,
				items: group.items.filter(
					(item) =>
						!searchQuery ||
						item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
						item.description.toLowerCase().includes(searchQuery.toLowerCase())
				)
			}))
			.filter((group) => group.items.length > 0)
	);

	function handleDragStart(item: PaletteItem, event: DragEvent) {
		if (event.dataTransfer) {
			event.dataTransfer.setData('application/workflow-node', JSON.stringify(item));
			event.dataTransfer.effectAllowed = 'move';
		}
		onDragStart(item, event);
	}

	const approvalColors: Record<string, string> = {
		auto: 'var(--semantic-success)',
		confirm: 'var(--semantic-warning)',
		danger: 'var(--semantic-error)'
	};

	const categoryIcons: Record<string, string> = {
		compute: 'M20 7h-9M20 11h-9M20 15h-9M4 7h.01M4 11h.01M4 15h.01',
		networking:
			'M12 2v6M12 16v6M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M16 12h6M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24',
		storage: 'M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
		database:
			'M12 2C6.48 2 2 4.02 2 6.5v11C2 19.98 6.48 22 12 22s10-2.02 10-4.5v-11C22 4.02 17.52 2 12 2',
		identity:
			'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
		observability: 'M22 12h-4l-3 9L9 3l-3 9H2',
		pricing: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
		search: 'M11 17.25a6.25 6.25 0 1 1 0-12.5 6.25 6.25 0 0 1 0 12.5zM16 16l4.5 4.5',
		billing: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
		logging:
			'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5zM14 2v6h6M16 13H8M16 17H8M10 9H8',
		control: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2'
	};
</script>

<aside class="node-palette">
	<div class="palette-header">
		<h3 class="palette-title">Nodes</h3>
	</div>

	<div class="palette-search">
		<input
			type="text"
			class="search-input"
			placeholder="Search nodes..."
			bind:value={searchQuery}
		/>
		{#if searchQuery}
			<button
				class="search-clear"
				onclick={() => {
					searchQuery = '';
				}}
				aria-label="Clear search"
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					width="14"
					height="14"
				>
					<path d="M18 6 6 18M6 6l12 12" />
				</svg>
			</button>
		{/if}
	</div>

	<div class="palette-groups">
		{#each filteredGroups as group (group.category)}
			<div class="palette-group">
				<div class="group-header">
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						width="14"
						height="14"
					>
						<path d={categoryIcons[group.category] ?? categoryIcons.control} />
					</svg>
					<span class="group-label">{group.label}</span>
					<span class="group-count">{group.items.length}</span>
				</div>

				<div class="group-items">
					{#each group.items as item (item.id)}
						<div
							class="palette-item"
							draggable="true"
							ondragstart={(e) => handleDragStart(item, e)}
							role="listitem"
							aria-label="{item.label} - drag to add to canvas"
						>
							<div class="item-header">
								<span class="item-name">{item.label}</span>
								{#if item.approvalLevel}
									<span
										class="approval-dot"
										style="background: {approvalColors[item.approvalLevel]}"
										title="{item.approvalLevel} approval"
									></span>
								{/if}
							</div>
							<p class="item-description">{item.description}</p>
						</div>
					{/each}
				</div>
			</div>
		{/each}

		{#if filteredGroups.length === 0}
			<div class="empty-state">
				<p class="empty-text">No nodes match "{searchQuery}"</p>
			</div>
		{/if}
	</div>
</aside>

<style>
	.node-palette {
		width: 250px;
		background: var(--bg-secondary);
		border-right: 1px solid var(--border-default);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		flex-shrink: 0;
	}

	.palette-header {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border-default);
	}

	.palette-title {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--fg-primary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.palette-search {
		padding: 0.5rem;
		position: relative;
	}

	.search-input {
		width: 100%;
		padding: 0.375rem 0.5rem;
		padding-right: 1.75rem;
		font-size: 0.8125rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--fg-primary);
		outline: none;
		font-family: inherit;
		box-sizing: border-box;
	}

	.search-input::placeholder {
		color: var(--fg-tertiary);
	}

	.search-input:focus {
		border-color: var(--accent-primary);
	}

	.search-clear {
		position: absolute;
		right: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		cursor: pointer;
		color: var(--fg-tertiary);
		display: flex;
		padding: 2px;
	}

	.search-clear:hover {
		color: var(--fg-primary);
	}

	.palette-groups {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem;
	}

	.palette-group {
		margin-bottom: 0.75rem;
	}

	.group-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem;
		color: var(--fg-secondary);
		margin-bottom: 0.25rem;
	}

	.group-label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		flex: 1;
	}

	.group-count {
		font-size: 0.625rem;
		color: var(--fg-tertiary);
		background: var(--bg-tertiary);
		padding: 0 0.375rem;
		border-radius: 8px;
	}

	.group-items {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.palette-item {
		padding: 0.5rem;
		background: var(--bg-elevated);
		border: 1px solid transparent;
		border-radius: 6px;
		cursor: grab;
		transition: all 0.15s;
		user-select: none;
	}

	.palette-item:hover {
		border-color: var(--border-default);
		background: var(--bg-hover);
	}

	.palette-item:active {
		cursor: grabbing;
		border-color: var(--accent-primary);
	}

	.item-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem;
	}

	.item-name {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--fg-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.approval-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.item-description {
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
		margin-top: 0.125rem;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.empty-state {
		padding: 2rem 1rem;
		text-align: center;
	}

	.empty-text {
		font-size: 0.75rem;
		color: var(--fg-tertiary);
	}
</style>
