<script lang="ts">
	import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import { browser } from '$app/environment';
	import type { PageData } from './$types';
	import IntegrationCatalogCard from '$lib/components/admin/IntegrationCatalogCard.svelte';
	import IntegrationServerCard from '$lib/components/admin/IntegrationServerCard.svelte';
	import MCPServerModal from '$lib/components/admin/MCPServerModal.svelte';
	import ToolPlaygroundCard from '$lib/components/admin/ToolPlaygroundCard.svelte';
	import { fuzzySearch } from '$lib/utils/fuzzy-search.js';
	import { ConfirmDialog } from '$lib/components/ui/index.js';
	import type { McpCatalogItem, McpServer } from '@portal/server/admin/mcp-types';

	let { data }: { data: PageData } = $props();

	let confirmDeleteId = $state<string | null>(null);

	const queryClient = useQueryClient();

	// State
	type Tab = 'catalog' | 'servers' | 'tools';
	let activeTab = $state<Tab>('catalog');
	let searchQuery = $state('');
	let categoryFilter = $state('all');
	let showModal = $state(false);
	let modalMode = $state<'install' | 'custom' | 'edit'>('install');
	let selectedCatalogItem = $state<McpCatalogItem | null>(null);
	let editingServer = $state<McpServer | null>(null);
	let selectedServerId = $state<string | null>(null);

	// Queries
	const catalogQuery = createQuery<{ items: McpCatalogItem[] }>(() => ({
		queryKey: ['admin', 'mcp', 'catalog'],
		queryFn: async () => {
			const res = await fetch('/api/admin/mcp/catalog');
			if (!res.ok) throw new Error('Failed to fetch catalog');
			return res.json();
		},
		initialData: data.initialCatalog,
		enabled: browser
	}));

	const serversQuery = createQuery(() => ({
		queryKey: ['admin', 'mcp', 'servers'],
		queryFn: async () => {
			const res = await fetch('/api/admin/mcp/servers');
			if (!res.ok) throw new Error('Failed to fetch servers');
			return res.json();
		},
		initialData: data.initialServers,
		enabled: browser,
		refetchInterval: activeTab === 'servers' ? 5000 : false
	}));

	const toolsQuery = createQuery(() => ({
		queryKey: ['admin', 'mcp', 'tools', selectedServerId],
		queryFn: async () => {
			if (!selectedServerId) return { tools: [] };
			const res = await fetch(`/api/admin/mcp/servers/${selectedServerId}/tools`);
			if (!res.ok) throw new Error('Failed to fetch tools');
			return res.json();
		},
		enabled: browser && activeTab === 'tools' && !!selectedServerId
	}));

	// Mutations
	const installMutation = createMutation(() => ({
		mutationFn: async (data: Record<string, unknown>) => {
			const res = await fetch('/api/admin/mcp/servers/install', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data)
			});
			if (!res.ok) {
				const error = await res.json();
				throw new Error(error.message || 'Failed to install server');
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'mcp', 'servers'] });
			toast.success('MCP server installed successfully');
			closeModal();
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	const createServerMutation = createMutation(() => ({
		mutationFn: async (data: Record<string, unknown>) => {
			const res = await fetch('/api/admin/mcp/servers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data)
			});
			if (!res.ok) {
				const error = await res.json();
				throw new Error(error.message || 'Failed to create server');
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'mcp', 'servers'] });
			toast.success('MCP server created successfully');
			closeModal();
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	const updateMutation = createMutation(() => ({
		mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
			const res = await fetch(`/api/admin/mcp/servers/${id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data)
			});
			if (!res.ok) {
				const error = await res.json();
				throw new Error(error.message || 'Failed to update server');
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'mcp', 'servers'] });
			toast.success('MCP server updated successfully');
			closeModal();
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	const deleteMutation = createMutation(() => ({
		mutationFn: async (id: string) => {
			const res = await fetch(`/api/admin/mcp/servers/${id}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				const error = await res.json();
				throw new Error(error.message || 'Failed to delete server');
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'mcp', 'servers'] });
			toast.success('MCP server deleted successfully');
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	const connectMutation = createMutation(() => ({
		mutationFn: async (id: string) => {
			const res = await fetch(`/api/admin/mcp/servers/${id}/connect`, {
				method: 'POST'
			});
			if (!res.ok) {
				const error = await res.json();
				throw new Error(error.message || 'Failed to connect server');
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'mcp', 'servers'] });
			toast.success('Server connected successfully');
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	const disconnectMutation = createMutation(() => ({
		mutationFn: async (id: string) => {
			const res = await fetch(`/api/admin/mcp/servers/${id}/disconnect`, {
				method: 'POST'
			});
			if (!res.ok) {
				const error = await res.json();
				throw new Error(error.message || 'Failed to disconnect server');
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'mcp', 'servers'] });
			toast.success('Server disconnected successfully');
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	const restartMutation = createMutation(() => ({
		mutationFn: async (id: string) => {
			const res = await fetch(`/api/admin/mcp/servers/${id}/restart`, {
				method: 'POST'
			});
			if (!res.ok) {
				const error = await res.json();
				throw new Error(error.message || 'Failed to restart server');
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin', 'mcp', 'servers'] });
			toast.success('Server restarted successfully');
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	const testToolMutation = createMutation(() => ({
		mutationFn: async ({
			serverId,
			toolName,
			args
		}: {
			serverId: string;
			toolName: string;
			args: Record<string, unknown>;
		}) => {
			const res = await fetch(`/api/admin/mcp/servers/${serverId}/tools/${toolName}/test`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ args })
			});
			if (!res.ok) {
				const error = await res.json();
				throw new Error(error.message || 'Tool execution failed');
			}
			return res.json();
		},
		onError: (error: Error) => {
			toast.error(error.message);
		}
	}));

	// Derived state
	const catalogItems = $derived(catalogQuery.data?.items || []);
	const servers = $derived(serversQuery.data?.servers || []);
	const tools = $derived(toolsQuery.data?.tools || []);

	const filteredCatalogItems = $derived.by(() => {
		const categoryFiltered =
			categoryFilter === 'all'
				? catalogItems
				: catalogItems.filter((item: McpCatalogItem) => item.category === categoryFilter);
		return fuzzySearch(categoryFiltered, searchQuery, [
			{ name: 'displayName', weight: 2 },
			{ name: 'description', weight: 1 },
			{ name: 'tags', weight: 1.5 }
		]);
	});

	const categories = $derived([
		'all',
		...new Set(catalogItems.map((item: McpCatalogItem) => item.category))
	]);

	// Actions
	function openInstallModal(item: McpCatalogItem) {
		selectedCatalogItem = item;
		editingServer = null;
		modalMode = 'install';
		showModal = true;
	}

	function openCustomModal() {
		selectedCatalogItem = null;
		editingServer = null;
		modalMode = 'custom';
		showModal = true;
	}

	function openEditModal(server: McpServer) {
		selectedCatalogItem = null;
		editingServer = server;
		modalMode = 'edit';
		showModal = true;
	}

	function closeModal() {
		showModal = false;
		selectedCatalogItem = null;
		editingServer = null;
	}

	function handleModalSubmit(data: Record<string, unknown>) {
		if (modalMode === 'install') {
			installMutation.mutate(data);
		} else if (modalMode === 'custom') {
			createServerMutation.mutate(data);
		} else if (modalMode === 'edit' && editingServer) {
			updateMutation.mutate({ id: editingServer.id, data });
		}
	}

	function handleConnect(id: string) {
		connectMutation.mutate(id);
	}

	function handleDisconnect(id: string) {
		disconnectMutation.mutate(id);
	}

	function handleRestart(id: string) {
		restartMutation.mutate(id);
	}

	function handleDelete(id: string) {
		confirmDeleteId = id;
	}

	function confirmDelete() {
		if (confirmDeleteId) {
			deleteMutation.mutate(confirmDeleteId);
			confirmDeleteId = null;
		}
	}

	function handleTestTool(serverId: string, toolName: string, args: Record<string, unknown>) {
		testToolMutation.mutate({ serverId, toolName, args });
	}
</script>

<svelte:head>
	<title>MCP Integrations - Admin Console</title>
</svelte:head>

<div class="admin-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">MCP Integrations</h1>
			<p class="page-description">Manage Model Context Protocol servers and tool discovery</p>
		</div>
		<button type="button" class="btn-primary" onclick={openCustomModal}>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
			>
				<line x1="12" y1="5" x2="12" y2="19" />
				<line x1="5" y1="12" x2="19" y2="12" />
			</svg>
			Add Custom Server
		</button>
	</div>

	<!-- Tabs -->
	<div class="tabs">
		<button
			type="button"
			class="tab"
			class:active={activeTab === 'catalog'}
			onclick={() => (activeTab = 'catalog')}
		>
			<span class="tab-icon">📦</span>
			Catalog
		</button>
		<button
			type="button"
			class="tab"
			class:active={activeTab === 'servers'}
			onclick={() => (activeTab = 'servers')}
		>
			<span class="tab-icon">🔌</span>
			Connected Servers
			{#if servers.length > 0}
				<span class="tab-badge">{servers.length}</span>
			{/if}
		</button>
		<button
			type="button"
			class="tab"
			class:active={activeTab === 'tools'}
			onclick={() => (activeTab = 'tools')}
		>
			<span class="tab-icon">🛠️</span>
			Tool Playground
		</button>
	</div>

	<!-- Tab Content -->
	{#if activeTab === 'catalog'}
		<div class="tab-content">
			<!-- Search & Filter -->
			<div class="toolbar">
				<input
					type="text"
					class="search-input"
					placeholder="Search catalog..."
					bind:value={searchQuery}
				/>
				<select class="filter-select" bind:value={categoryFilter}>
					{#each categories as category (category)}
						<option value={category}>
							{category === 'all' ? 'All Categories' : category}
						</option>
					{/each}
				</select>
			</div>

			{#if catalogQuery.isLoading}
				<div class="loading-state">
					<div class="spinner"></div>
					<p>Loading catalog...</p>
				</div>
			{:else if filteredCatalogItems.length === 0}
				<div class="empty-state">
					<div class="empty-icon">📦</div>
					<h2>No catalog items found</h2>
					<p>Try adjusting your search or filters</p>
				</div>
			{:else}
				<div class="catalog-grid">
					{#each filteredCatalogItems as item (item.id)}
						<IntegrationCatalogCard {item} onInstall={() => openInstallModal(item)} />
					{/each}
				</div>
			{/if}
		</div>
	{:else if activeTab === 'servers'}
		<div class="tab-content">
			{#if serversQuery.isLoading}
				<div class="loading-state">
					<div class="spinner"></div>
					<p>Loading servers...</p>
				</div>
			{:else if servers.length === 0}
				<div class="empty-state">
					<div class="empty-icon">🔌</div>
					<h2>No servers connected</h2>
					<p>Install from the catalog or add a custom server</p>
					<button type="button" class="btn-primary" onclick={() => (activeTab = 'catalog')}>
						Browse Catalog
					</button>
				</div>
			{:else}
				<div class="servers-grid">
					{#each servers as server (server.id)}
						<IntegrationServerCard
							{server}
							onConnect={() => handleConnect(server.id)}
							onDisconnect={() => handleDisconnect(server.id)}
							onRestart={() => handleRestart(server.id)}
							onEdit={() => openEditModal(server)}
							onDelete={() => handleDelete(server.id)}
						/>
					{/each}
				</div>
			{/if}
		</div>
	{:else if activeTab === 'tools'}
		<div class="tab-content">
			<!-- Server Selector -->
			<div class="toolbar">
				<select class="filter-select" bind:value={selectedServerId}>
					<option value={null}>Select a server...</option>
					{#each servers.filter((s: McpServer) => s.status === 'connected') as server (server.id)}
						<option value={server.id}>{server.displayName}</option>
					{/each}
				</select>
			</div>

			{#if !selectedServerId}
				<div class="empty-state">
					<div class="empty-icon">🛠️</div>
					<h2>Select a server</h2>
					<p>Choose a connected server to explore its tools</p>
				</div>
			{:else if toolsQuery.isLoading}
				<div class="loading-state">
					<div class="spinner"></div>
					<p>Loading tools...</p>
				</div>
			{:else if tools.length === 0}
				<div class="empty-state">
					<div class="empty-icon">🛠️</div>
					<h2>No tools found</h2>
					<p>This server doesn't expose any tools yet</p>
				</div>
			{:else}
				<div class="tools-grid">
					{#each tools as tool (tool.id)}
						<ToolPlaygroundCard
							{tool}
							onExecute={(args) => handleTestTool(selectedServerId!, tool.toolName, args)}
							isPending={testToolMutation.isPending}
						/>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- Modal -->
{#if showModal}
	<MCPServerModal
		open={showModal}
		mode={modalMode}
		catalogItem={selectedCatalogItem}
		server={editingServer}
		onClose={closeModal}
		onSubmit={handleModalSubmit}
		isPending={installMutation.isPending ||
			createServerMutation.isPending ||
			updateMutation.isPending}
	/>
{/if}

<ConfirmDialog
	open={confirmDeleteId !== null}
	title="Delete MCP Server"
	message="Are you sure you want to delete this MCP server? This action cannot be undone."
	confirmLabel="Delete"
	variant="danger"
	onConfirm={confirmDelete}
	onCancel={() => (confirmDeleteId = null)}
/>

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

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-sm) var(--space-lg);
		background: var(--accent-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--accent-secondary);
		box-shadow: 0 0 20px -5px var(--accent-primary);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Tabs */
	.tabs {
		display: flex;
		gap: var(--space-sm);
		margin-bottom: var(--space-lg);
		border-bottom: 2px solid var(--border-muted);
	}

	.tab {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-md) var(--space-lg);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -2px;
		color: var(--fg-secondary);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.tab:hover {
		color: var(--fg-primary);
		background: var(--bg-elevated);
	}

	.tab.active {
		color: var(--accent-primary);
		border-bottom-color: var(--accent-primary);
	}

	.tab-icon {
		font-size: 1.25rem;
	}

	.tab-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		background: var(--accent-primary);
		color: var(--bg-primary);
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		font-weight: 700;
	}

	/* Toolbar */
	.toolbar {
		display: flex;
		gap: var(--space-md);
		margin-bottom: var(--space-lg);
	}

	.search-input {
		flex: 1;
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
		transition: all var(--transition-fast);
	}

	.search-input:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 30%, transparent);
	}

	.filter-select {
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.filter-select:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 30%, transparent);
	}

	/* Grids */
	.catalog-grid,
	.servers-grid,
	.tools-grid {
		display: grid;
		gap: var(--space-lg);
	}

	.catalog-grid {
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
	}

	.servers-grid {
		grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
	}

	.tools-grid {
		grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
	}

	/* Loading & Empty states */
	.loading-state,
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-xxl);
		text-align: center;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 4px solid var(--border-muted);
		border-top-color: var(--accent-primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-bottom: var(--space-md);
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
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
		font-size: var(--text-base);
		color: var(--fg-secondary);
		margin-bottom: var(--space-lg);
	}

	@media (max-width: 1024px) {
		.catalog-grid {
			grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		}

		.servers-grid {
			grid-template-columns: 1fr;
		}

		.tools-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 768px) {
		.catalog-grid {
			grid-template-columns: 1fr;
		}

		.toolbar {
			flex-direction: column;
		}
	}
</style>
