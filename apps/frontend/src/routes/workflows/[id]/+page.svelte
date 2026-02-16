<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import WorkflowCanvas from '$lib/components/workflows/WorkflowCanvas.svelte';
	import WorkflowToolbar from '$lib/components/workflows/WorkflowToolbar.svelte';
	import NodePalette from '$lib/components/workflows/NodePalette.svelte';
	import NodeProperties from '$lib/components/workflows/NodeProperties.svelte';
	import ExecutionTimeline from '$lib/components/workflows/ExecutionTimeline.svelte';
	import type { WorkflowDefinition } from '@portal/types/workflows/types';
	import type {
		PaletteGroup,
		PaletteItem,
		WorkflowNodeData,
		WorkflowRunView
	} from '$lib/components/workflows/types.js';
	import type { NodeType } from '@portal/types/workflows/types';
	import type { Node } from '@xyflow/svelte';

	let { data } = $props();

	const workflowId = $derived($page.params.id);
	const isNew = $derived(workflowId === 'new');

	let workflow = $state<WorkflowDefinition | undefined>(undefined);
	let loading = $state(true);
	let isSaving = $state(false);
	let hasUnsavedChanges = $state(false);
	let workflowName = $state('Untitled Workflow');
	let workflowStatus = $state<'draft' | 'published' | 'archived'>('draft');

	// Node selection state
	let selectedNodeId = $state<string | null>(null);
	let selectedNodeType = $state<NodeType | null>(null);
	let selectedNodeData = $state<WorkflowNodeData | null>(null);

	// Execution timeline
	let runs = $state<WorkflowRunView[]>([]);
	let selectedRunId = $state<string | null>(null);
	let timelineOpen = $state(false);

	// Canvas ref
	let canvas = $state<WorkflowCanvas | undefined>(undefined);

	// Build palette from tool registry
	const paletteGroups = $derived.by((): PaletteGroup[] => {
		const toolDefs = data.toolDefs;
		const grouped = new SvelteMap<string, PaletteItem[]>();

		for (const def of toolDefs) {
			const cat = def.category;
			if (!grouped.has(cat)) grouped.set(cat, []);
			grouped.get(cat)!.push({
				id: `tool-${def.name}`,
				label: def.name,
				description: def.description.substring(0, 80),
				category: def.category,
				nodeType: 'tool',
				approvalLevel: def.approvalLevel,
				defaultData: {
					toolName: def.name,
					toolCategory: def.category,
					args: {}
				}
			});
		}

		// Add control flow nodes
		const controlItems: PaletteItem[] = [
			{
				id: 'ctrl-condition',
				label: 'Condition',
				description: 'Branch based on an expression',
				category: 'control',
				nodeType: 'condition',
				defaultData: { expression: '', trueBranch: undefined, falseBranch: undefined }
			},
			{
				id: 'ctrl-approval',
				label: 'Approval Gate',
				description: 'Require human approval to proceed',
				category: 'control',
				nodeType: 'approval',
				defaultData: { message: '', approvers: [], timeoutMinutes: 60 }
			},
			{
				id: 'ctrl-input',
				label: 'Input',
				description: 'Define workflow input parameters',
				category: 'control',
				nodeType: 'input',
				defaultData: { fields: [] }
			},
			{
				id: 'ctrl-output',
				label: 'Output',
				description: 'Map workflow output values',
				category: 'control',
				nodeType: 'output',
				defaultData: { outputMapping: {} }
			}
		];

		const categoryLabels: Record<string, string> = {
			compute: 'Compute',
			networking: 'Networking',
			storage: 'Storage',
			database: 'Database',
			identity: 'Identity',
			observability: 'Observability',
			pricing: 'Pricing',
			search: 'Search',
			billing: 'Billing',
			logging: 'Logging',
			control: 'Control Flow'
		};

		const groups: PaletteGroup[] = [
			{ category: 'control', label: 'Control Flow', items: controlItems }
		];

		for (const [cat, items] of grouped.entries()) {
			groups.push({
				category: cat,
				label: categoryLabels[cat] ?? cat,
				items
			});
		}

		return groups;
	});

	// Load workflow
	async function loadWorkflow() {
		if (isNew) {
			loading = false;
			return;
		}

		loading = true;
		try {
			const res = await fetch(`/api/workflows/${workflowId}`);
			if (!res.ok) {
				if (res.status === 404) {
					toast.error('Workflow not found');
					goto(resolve('/workflows'));
					return;
				}
				throw new Error(`Failed to load: ${res.status}`);
			}
			const data = await res.json();
			workflow = data.workflow;
			workflowName = workflow!.name;
			workflowStatus = workflow!.status as 'draft' | 'published' | 'archived';
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to load workflow');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		loadWorkflow();
	});

	// Cleanup saveTimer on destroy
	$effect(() => {
		return () => {
			if (saveTimer) clearTimeout(saveTimer);
		};
	});

	// Save workflow
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	function debouncedSave() {
		hasUnsavedChanges = true;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(save, 500);
	}

	async function save() {
		if (!canvas) return;
		isSaving = true;

		const { nodes, edges } = canvas.getGraph();
		const body = {
			name: workflowName,
			nodes: nodes.map((n: Node) => ({
				id: n.id,
				type: n.type ?? 'tool',
				position: n.position,
				data: n.data
			})),
			edges: edges.map((e) => ({
				id: e.id,
				source: e.source,
				target: e.target,
				...(e.label ? { label: String(e.label) } : {}),
				...(e.sourceHandle ? { condition: e.sourceHandle } : {})
			}))
		};

		try {
			if (isNew) {
				const res = await fetch('/api/workflows', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				});
				if (!res.ok) throw new Error(`Save failed: ${res.status}`);
				const data = await res.json();
				toast.success('Workflow created');
				goto(resolve(`/workflows/${data.workflow.id}`), { replaceState: true });
			} else {
				const res = await fetch(`/api/workflows/${workflowId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				});
				if (!res.ok) throw new Error(`Save failed: ${res.status}`);
				toast.success('Workflow saved');
			}
			hasUnsavedChanges = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to save');
		} finally {
			isSaving = false;
		}
	}

	async function publish() {
		if (isNew) {
			toast.error('Save the workflow first');
			return;
		}

		try {
			const res = await fetch(`/api/workflows/${workflowId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'published' })
			});
			if (!res.ok) throw new Error(`Publish failed: ${res.status}`);
			workflowStatus = 'published';
			toast.success('Workflow published');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to publish');
		}
	}

	async function run() {
		if (isNew) {
			toast.error('Save the workflow first');
			return;
		}

		try {
			const res = await fetch(`/api/workflows/${workflowId}/run`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			if (!res.ok) throw new Error(`Run failed: ${res.status}`);
			const data = await res.json();
			toast.success('Workflow run started');
			timelineOpen = true;
			// Refresh runs
			runs = [data.run, ...runs];
			selectedRunId = data.run.id;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to run workflow');
		}
	}

	function share() {
		const url = `${window.location.origin}/workflows/${workflowId}`;
		navigator.clipboard.writeText(url);
		toast.success('Link copied to clipboard');
	}

	// Node selection handler
	function handleNodeSelect(nodeId: string | null) {
		selectedNodeId = nodeId;
		if (nodeId && canvas) {
			const { nodes } = canvas.getGraph();
			const node = nodes.find((n: Node) => n.id === nodeId);
			if (node) {
				selectedNodeType = (node.type as NodeType) ?? null;
				selectedNodeData = (node.data as WorkflowNodeData) ?? null;
			}
		} else {
			selectedNodeType = null;
			selectedNodeData = null;
		}
	}

	function handleNodeUpdate(nodeId: string, data: WorkflowNodeData) {
		canvas?.updateNodeData(nodeId, data as Record<string, unknown>);
		selectedNodeData = data;
		debouncedSave();
	}

	function handleNodeDelete(nodeId: string) {
		canvas?.deleteNode(nodeId);
		debouncedSave();
	}

	function handlePaletteDragStart(_item: PaletteItem, _event: DragEvent) {
		// The actual drag data is set in NodePalette; nothing extra needed here
	}
</script>

<svelte:head>
	<title>{isNew ? 'New Workflow' : workflowName} | OCI Self-Service Portal</title>
</svelte:head>

{#if loading}
	<div class="loading-state">
		<p>Loading workflow...</p>
	</div>
{:else}
	<div class="editor-layout">
		<WorkflowToolbar
			{workflowName}
			{workflowStatus}
			{isSaving}
			{hasUnsavedChanges}
			onNameChange={(name) => {
				workflowName = name;
				debouncedSave();
			}}
			onSave={save}
			onPublish={publish}
			onRun={run}
			onShare={share}
		/>

		<div class="editor-body">
			<NodePalette groups={paletteGroups} onDragStart={handlePaletteDragStart} />

			<WorkflowCanvas
				bind:this={canvas}
				{workflow}
				onNodeSelect={handleNodeSelect}
				onSave={() => debouncedSave()}
			/>

			<NodeProperties
				{selectedNodeId}
				nodeType={selectedNodeType}
				nodeData={selectedNodeData}
				onUpdate={handleNodeUpdate}
				onDelete={handleNodeDelete}
			/>
		</div>

		<ExecutionTimeline
			{runs}
			{selectedRunId}
			isOpen={timelineOpen}
			onSelectRun={(id) => {
				selectedRunId = id;
			}}
			onToggle={() => {
				timelineOpen = !timelineOpen;
			}}
		/>
	</div>
{/if}

<style>
	.editor-layout {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 48px);
		overflow: hidden;
	}

	.editor-body {
		display: flex;
		flex: 1;
		overflow: hidden;
	}

	.loading-state {
		display: flex;
		align-items: center;
		justify-content: center;
		height: calc(100vh - 48px);
		color: var(--fg-tertiary);
		font-size: 0.875rem;
	}
</style>
