<script lang="ts">
	import { createQuery, createMutation } from '@tanstack/svelte-query';
	import { browser } from '$app/environment';
	import { fuzzySearch } from '$lib/utils/fuzzy-search.js';

	interface ToolDef {
		name: string;
		description: string;
		category?: string;
		inputSchema?: {
			properties?: Record<string, { type: string; description?: string; default?: unknown }>;
			required?: string[];
		};
	}

	interface ToolsResponse {
		tools: ToolDef[];
	}

	// State
	let searchQuery = $state('');
	let categoryFilter = $state('all');
	let selectedTool = $state<ToolDef | null>(null);
	let paramValues = $state<Record<string, string>>({});

	const toolsQuery = createQuery<ToolsResponse>(() => ({
		queryKey: ['admin', 'tools'],
		queryFn: async () => {
			const res = await fetch('/api/v1/tools');
			if (!res.ok) throw new Error('Failed to fetch tools');
			return res.json();
		},
		enabled: browser
	}));

	const executeMutation = createMutation<
		unknown,
		Error,
		{ name: string; args: Record<string, unknown> }
	>(() => ({
		mutationFn: async ({ name, args }) => {
			const res = await fetch(`/api/v1/tools/${encodeURIComponent(name)}/execute`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(args)
			});
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.message || 'Tool execution failed');
			}
			return res.json();
		}
	}));

	const tools = $derived($toolsQuery.data?.tools ?? []);
	const categories = $derived([
		'all',
		...new Set(tools.map((t: ToolDef) => t.category ?? 'uncategorized'))
	]);

	const filteredTools = $derived.by(() => {
		const catFiltered =
			categoryFilter === 'all'
				? tools
				: tools.filter((t: ToolDef) => (t.category ?? 'uncategorized') === categoryFilter);
		if (!searchQuery) return catFiltered;
		return fuzzySearch(catFiltered, searchQuery, [
			{ name: 'name', weight: 2 },
			{ name: 'description', weight: 1 }
		]);
	});

	function selectTool(tool: ToolDef) {
		selectedTool = tool;
		paramValues = {};
		// Prefill defaults
		const props = tool.inputSchema?.properties ?? {};
		for (const [key, schema] of Object.entries(props)) {
			if (schema.default !== undefined) {
				paramValues[key] = String(schema.default);
			}
		}
		$executeMutation.reset();
	}

	function executeSelected() {
		if (!selectedTool) return;
		const args: Record<string, unknown> = {};
		const props = selectedTool.inputSchema?.properties ?? {};
		for (const [key, value] of Object.entries(paramValues)) {
			if (value === '') continue;
			const propType = props[key]?.type;
			if (propType === 'number' || propType === 'integer') args[key] = Number(value);
			else if (propType === 'boolean') args[key] = value === 'true';
			else args[key] = value;
		}
		$executeMutation.mutate({ name: selectedTool.name, args });
	}
</script>

<svelte:head>
	<title>Tool Tester - Admin Console</title>
</svelte:head>

<div class="admin-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Tool Tester</h1>
			<p class="page-description">Browse, test, and debug OCI tool executions</p>
		</div>
		<span class="tool-count">{tools.length} tools available</span>
	</div>

	<div class="tester-layout">
		<!-- Left: Tool Catalog -->
		<div class="catalog-panel">
			<div class="catalog-toolbar">
				<input
					type="text"
					class="search-input"
					placeholder="Search tools..."
					bind:value={searchQuery}
				/>
				<select class="filter-select" bind:value={categoryFilter}>
					{#each categories as cat}
						<option value={cat}>{cat === 'all' ? 'All Categories' : cat}</option>
					{/each}
				</select>
			</div>

			{#if $toolsQuery.isLoading}
				<div class="loading-state">
					<div class="spinner"></div>
				</div>
			{:else}
				<div class="tool-list">
					{#each filteredTools as tool (tool.name)}
						<button
							type="button"
							class="tool-item"
							class:active={selectedTool?.name === tool.name}
							onclick={() => selectTool(tool)}
						>
							<span class="tool-item-name">{tool.name}</span>
							{#if tool.category}
								<span class="tool-item-cat">{tool.category}</span>
							{/if}
						</button>
					{/each}
					{#if filteredTools.length === 0}
						<p class="no-results">No tools match your search</p>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Right: Tool Detail + Execution -->
		<div class="detail-panel">
			{#if !selectedTool}
				<div class="empty-state">
					<div class="empty-icon">🛠️</div>
					<h2>Select a tool</h2>
					<p>Choose a tool from the catalog to view its parameters and test it</p>
				</div>
			{:else}
				<div class="tool-detail">
					<h2 class="tool-name">{selectedTool.name}</h2>
					<p class="tool-desc">{selectedTool.description}</p>

					<!-- Parameters Form -->
					{#if selectedTool.inputSchema?.properties}
						<div class="params-section">
							<h3 class="section-label">Parameters</h3>
							{#each Object.entries(selectedTool.inputSchema.properties) as [key, schema]}
								<div class="param-field">
									<label class="param-label" for="param-{key}">
										{key}
										{#if selectedTool.inputSchema?.required?.includes(key)}
											<span class="required">*</span>
										{/if}
										<span class="param-type">{schema.type}</span>
									</label>
									{#if schema.description}
										<p class="param-desc">{schema.description}</p>
									{/if}
									{#if schema.type === 'boolean'}
										<select id="param-{key}" class="param-input" bind:value={paramValues[key]}>
											<option value="">-- not set --</option>
											<option value="true">true</option>
											<option value="false">false</option>
										</select>
									{:else}
										<input
											id="param-{key}"
											type="text"
											class="param-input"
											placeholder={schema.default !== undefined ? String(schema.default) : ''}
											bind:value={paramValues[key]}
										/>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					<button
						type="button"
						class="btn-execute"
						disabled={$executeMutation.isPending}
						onclick={executeSelected}
					>
						{$executeMutation.isPending ? 'Executing...' : 'Execute Tool'}
					</button>

					<!-- Result -->
					{#if $executeMutation.data}
						<div class="result-section success">
							<h3 class="section-label">Result</h3>
							<pre class="result-code">{JSON.stringify($executeMutation.data, null, 2)}</pre>
						</div>
					{/if}

					{#if $executeMutation.error}
						<div class="result-section error">
							<h3 class="section-label">Error</h3>
							<pre class="result-code error-text">{$executeMutation.error.message}</pre>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.admin-page {
		max-width: 1400px;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: start;
		margin-bottom: var(--space-xl);
	}

	.page-title {
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
	}

	.page-description {
		font-size: var(--text-base);
		color: var(--fg-secondary);
	}

	.tool-count {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
		background: var(--bg-secondary);
		padding: var(--space-sm) var(--space-md);
		border-radius: var(--radius-md);
	}

	/* Split Layout */
	.tester-layout {
		display: grid;
		grid-template-columns: 340px 1fr;
		gap: var(--space-lg);
		min-height: 600px;
	}

	/* Catalog Panel */
	.catalog-panel {
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.catalog-toolbar {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		padding: var(--space-md);
		border-bottom: 1px solid var(--border-default);
	}

	.search-input,
	.filter-select {
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
	}

	.search-input:focus,
	.filter-select:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	.tool-list {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-sm);
	}

	.tool-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: var(--space-sm) var(--space-md);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--fg-secondary);
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.tool-item:hover {
		background: var(--bg-elevated);
		color: var(--fg-primary);
	}

	.tool-item.active {
		background: var(--accent-primary);
		color: var(--bg-primary);
	}

	.tool-item-name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tool-item-cat {
		font-size: var(--text-xs);
		opacity: 0.7;
		flex-shrink: 0;
	}

	.no-results {
		text-align: center;
		padding: var(--space-lg);
		color: var(--fg-tertiary);
		font-size: var(--text-sm);
	}

	/* Detail Panel */
	.detail-panel {
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: var(--space-xl);
		overflow-y: auto;
	}

	.tool-detail {
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
	}

	.tool-name {
		font-size: var(--text-xl);
		font-weight: 700;
		color: var(--fg-primary);
		font-family: var(--font-mono, monospace);
	}

	.tool-desc {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
		line-height: 1.5;
	}

	.section-label {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--fg-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: var(--space-md);
	}

	/* Param Form */
	.params-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.param-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}

	.param-label {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-primary);
	}

	.required {
		color: oklch(0.7 0.2 30);
	}

	.param-type {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		background: var(--bg-elevated);
		padding: 1px var(--space-sm);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono, monospace);
	}

	.param-desc {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		margin: 0;
	}

	.param-input {
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
		font-family: var(--font-mono, monospace);
	}

	.param-input:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	/* Execute Button */
	.btn-execute {
		padding: var(--space-md) var(--space-xl);
		background: var(--accent-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
		align-self: flex-start;
	}

	.btn-execute:hover:not(:disabled) {
		background: var(--accent-secondary);
		box-shadow: 0 0 20px -5px var(--accent-primary);
	}

	.btn-execute:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Result */
	.result-section {
		border-radius: var(--radius-md);
		padding: var(--space-lg);
	}

	.result-section.success {
		background: oklch(0.2 0.03 155);
		border: 1px solid oklch(0.4 0.08 155);
	}

	.result-section.error {
		background: oklch(0.2 0.03 30);
		border: 1px solid oklch(0.4 0.08 30);
	}

	.result-code {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs);
		color: var(--fg-primary);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 400px;
		overflow-y: auto;
		margin: 0;
	}

	.error-text {
		color: oklch(0.8 0.15 30);
	}

	/* Empty & Loading */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		text-align: center;
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: var(--space-md);
	}

	.empty-state h2 {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: var(--space-sm);
	}

	.empty-state p {
		color: var(--fg-secondary);
	}

	.loading-state {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-xxl);
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--border-muted);
		border-top-color: var(--accent-primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 1024px) {
		.tester-layout {
			grid-template-columns: 1fr;
		}

		.catalog-panel {
			max-height: 300px;
		}
	}
</style>
