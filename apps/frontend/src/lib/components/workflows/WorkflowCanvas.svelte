<script lang="ts">
	import { SvelteFlow, Controls, MiniMap, Background } from '@xyflow/svelte';
	import type { Node, Edge, NodeTypes, Connection } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';

	import ToolNode from './nodes/ToolNode.svelte';
	import ConditionNode from './nodes/ConditionNode.svelte';
	import ApprovalNode from './nodes/ApprovalNode.svelte';
	import InputNode from './nodes/InputNode.svelte';
	import OutputNode from './nodes/OutputNode.svelte';

	import type { WorkflowDefinition } from '@portal/shared/workflows/types';
	import type { PaletteItem } from './types.js';

	interface Props {
		workflow?: WorkflowDefinition;
		readonly?: boolean;
		onSave?: (nodes: Node[], edges: Edge[]) => void;
		onNodeSelect?: (nodeId: string | null) => void;
	}

	let { workflow, readonly = false, onSave, onNodeSelect }: Props = $props();

	const nodeTypes: NodeTypes = {
		tool: ToolNode,
		condition: ConditionNode,
		approval: ApprovalNode,
		input: InputNode,
		output: OutputNode
	} as unknown as NodeTypes;

	// Convert WorkflowDefinition nodes/edges to xyflow format
	function toFlowNodes(wf?: WorkflowDefinition): Node[] {
		if (!wf) return [];
		return wf.nodes.map((n) => ({
			id: n.id,
			type: n.type,
			position: n.position,
			data: n.label ? { ...n.data, label: n.label } : n.data
		}));
	}

	function toFlowEdges(wf?: WorkflowDefinition): Edge[] {
		if (!wf) return [];
		return wf.edges.map((e) => ({
			id: e.id,
			source: e.source,
			target: e.target,
			...(e.label ? { label: e.label } : {}),
			...(e.condition ? { sourceHandle: e.condition } : {})
		}));
	}

	// Use $state.raw for xyflow — it mutates arrays in-place
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);

	// Populate/reset when workflow prop changes
	$effect(() => {
		nodes = toFlowNodes(workflow);
		edges = toFlowEdges(workflow);
	});

	function onconnect(connection: Connection) {
		const newEdge: Edge = {
			id: `e-${connection.source}-${connection.target}-${Date.now()}`,
			source: connection.source!,
			target: connection.target!,
			...(connection.sourceHandle ? { sourceHandle: connection.sourceHandle } : {}),
			...(connection.targetHandle ? { targetHandle: connection.targetHandle } : {})
		};
		edges = [...edges, newEdge];
	}

	function onnodeclick({ node }: { node: Node }) {
		onNodeSelect?.(node.id);
	}

	function onpaneclick() {
		onNodeSelect?.(null);
	}

	// Drag-and-drop from palette
	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		if (!event.dataTransfer) return;

		const itemJson = event.dataTransfer.getData('application/workflow-node');
		if (!itemJson) return;

		const item: PaletteItem = JSON.parse(itemJson);

		// Get the canvas bounding rect to calculate position
		const canvasEl = event.currentTarget as HTMLElement;
		const rect = canvasEl.getBoundingClientRect();
		const position = {
			x: event.clientX - rect.left - 90,
			y: event.clientY - rect.top - 25
		};

		const newNode: Node = {
			id: `${item.nodeType}-${Date.now()}`,
			type: item.nodeType,
			position,
			data: item.defaultData
		};

		nodes = [...nodes, newNode];
	}

	/** Called by parent to update a node's data */
	export function updateNodeData(nodeId: string, data: Record<string, unknown>) {
		nodes = nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n));
	}

	/** Called by parent to remove a node */
	export function deleteNode(nodeId: string) {
		nodes = nodes.filter((n) => n.id !== nodeId);
		edges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
		onNodeSelect?.(null);
	}

	/** Return current nodes and edges for save */
	export function getGraph() {
		return { nodes, edges };
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="workflow-canvas" ondragover={handleDragOver} ondrop={handleDrop}>
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		{onconnect}
		{onnodeclick}
		{onpaneclick}
		fitView
		deleteKey={readonly ? '' : 'Delete'}
		nodesDraggable={!readonly}
		nodesConnectable={!readonly}
		elementsSelectable={!readonly}
	>
		<Controls />
		<MiniMap />
		<Background />
	</SvelteFlow>
</div>

<style>
	.workflow-canvas {
		flex: 1;
		height: 100%;
		position: relative;
	}

	/* Override xyflow styles to match portal theme */
	.workflow-canvas :global(.svelte-flow) {
		background: var(--bg-primary);
	}

	.workflow-canvas :global(.svelte-flow__minimap) {
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: 6px;
	}

	.workflow-canvas :global(.svelte-flow__controls) {
		border: 1px solid var(--border-default);
		border-radius: 6px;
		overflow: hidden;
	}

	.workflow-canvas :global(.svelte-flow__controls button) {
		background: var(--bg-elevated);
		color: var(--fg-secondary);
		border: none;
		border-bottom: 1px solid var(--border-default);
	}

	.workflow-canvas :global(.svelte-flow__controls button:hover) {
		background: var(--bg-hover);
		color: var(--fg-primary);
	}

	.workflow-canvas :global(.svelte-flow__edge-path) {
		stroke: var(--fg-tertiary);
		stroke-width: 2;
	}

	.workflow-canvas :global(.svelte-flow__edge.selected .svelte-flow__edge-path) {
		stroke: var(--accent-primary);
		stroke-width: 2.5;
	}

	.workflow-canvas :global(.svelte-flow__handle) {
		width: 10px;
		height: 10px;
		background: var(--bg-elevated);
		border: 2px solid var(--fg-tertiary);
	}

	.workflow-canvas :global(.svelte-flow__handle:hover) {
		border-color: var(--accent-primary);
	}

	.workflow-canvas :global(.svelte-flow__background pattern) {
		stroke: var(--border-default);
	}
</style>
