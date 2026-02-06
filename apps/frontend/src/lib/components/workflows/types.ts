/**
 * Workflow Designer Component Types
 *
 * TypeScript interfaces for the Phase 7 visual workflow designer.
 * Components live under src/lib/components/workflows/.
 *
 * Node data types re-exported from $lib/workflows/types.ts (backend Zod schemas).
 * Component-specific props defined here.
 *
 * Architecture:
 *   WorkflowCanvas (center -- Svelte Flow)
 *   +-- nodes/ToolNode
 *   +-- nodes/ConditionNode
 *   +-- nodes/ApprovalNode
 *   +-- nodes/InputNode
 *   +-- nodes/OutputNode
 *   NodePalette (left sidebar)
 *   NodeProperties (right sidebar)
 *   WorkflowToolbar (top bar)
 *   ExecutionTimeline (bottom drawer)
 */

import type { ToolCategory, ApprovalLevel } from '@portal/shared/tools/types.js';
import type { NodeType } from '@portal/shared/workflows/types.js';

// Re-export the canonical node data types from backend
export type {
	ToolNodeData,
	ConditionNodeData,
	ApprovalNodeData,
	InputNodeData,
	OutputNodeData,
	InputField
} from '@portal/shared/workflows/types.js';

import type {
	ToolNodeData,
	ConditionNodeData,
	ApprovalNodeData,
	InputNodeData,
	OutputNodeData
} from '@portal/shared/workflows/types.js';

/** Union of all node data types for property editing */
export type WorkflowNodeData =
	| ToolNodeData
	| ConditionNodeData
	| ApprovalNodeData
	| InputNodeData
	| OutputNodeData
	| Record<string, unknown>;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/** A draggable item in the node palette */
export interface PaletteItem {
	id: string;
	label: string;
	description: string;
	category: ToolCategory | 'control';
	nodeType: NodeType;
	approvalLevel?: ApprovalLevel;
	/** Default data to attach when dropped onto canvas */
	defaultData: Record<string, unknown>;
}

/** Grouped palette items for display */
export interface PaletteGroup {
	category: string;
	label: string;
	items: PaletteItem[];
}

// ---------------------------------------------------------------------------
// Execution (UI-facing, derived from backend WorkflowStep/WorkflowRun)
// ---------------------------------------------------------------------------

/** Status of a single workflow execution step */
export type StepExecutionStatus =
	| 'pending'
	| 'running'
	| 'completed'
	| 'failed'
	| 'skipped'
	| 'suspended';

/** A single step in a workflow execution run (UI view) */
export interface StepExecution {
	stepId: string;
	nodeId: string;
	nodeName: string;
	status: StepExecutionStatus;
	input?: Record<string, unknown>;
	output?: Record<string, unknown>;
	error?: string;
	startedAt?: string;
	completedAt?: string;
	duration?: number;
}

/** A complete workflow execution run (UI view) */
export interface WorkflowRunView {
	id: string;
	workflowId: string;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'suspended';
	steps: StepExecution[];
	startedAt: string;
	completedAt?: string;
	triggeredBy: string;
}

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

/** WorkflowToolbar props */
export interface WorkflowToolbarProps {
	workflowName: string;
	workflowStatus: 'draft' | 'published' | 'archived';
	isSaving: boolean;
	hasUnsavedChanges: boolean;
	onNameChange: (name: string) => void;
	onSave: () => void;
	onPublish: () => void;
	onRun: () => void;
	onShare: () => void;
}

/** NodePalette props */
export interface NodePaletteProps {
	groups: PaletteGroup[];
	onDragStart: (item: PaletteItem, event: DragEvent) => void;
}

/** NodeProperties props */
export interface NodePropertiesProps {
	selectedNodeId: string | null;
	nodeType: NodeType | null;
	nodeData: WorkflowNodeData | null;
	onUpdate: (nodeId: string, data: WorkflowNodeData) => void;
	onDelete: (nodeId: string) => void;
}

/** ExecutionTimeline props */
export interface ExecutionTimelineProps {
	runs: WorkflowRunView[];
	selectedRunId: string | null;
	isOpen: boolean;
	onSelectRun: (runId: string) => void;
	onToggle: () => void;
	onApproveStep?: (runId: string, stepId: string) => void;
}
