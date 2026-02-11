/**
 * Zod schemas and TypeScript types for the visual workflow designer.
 *
 * Naming convention (matches oracle/types.ts pattern):
 * - FooSchema  : Zod schema object  (runtime validation)
 * - Foo        : Inferred TS type   (compile-time checking)
 */
import { z } from 'zod';

// ============================================================================
// Enum Schemas
// ============================================================================

export const NodeTypeSchema = z.enum([
	'tool',
	'condition',
	'loop',
	'approval',
	'ai-step',
	'input',
	'output',
	'parallel'
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const WorkflowStatusSchema = z.enum(['draft', 'published', 'archived']);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const WorkflowRunStatusSchema = z.enum([
	'pending',
	'running',
	'suspended',
	'completed',
	'failed',
	'cancelled'
]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

export const WorkflowStepStatusSchema = z.enum([
	'pending',
	'running',
	'suspended',
	'completed',
	'failed',
	'skipped'
]);
export type WorkflowStepStatus = z.infer<typeof WorkflowStepStatusSchema>;

// ============================================================================
// Node Data Schemas
// ============================================================================

export const ToolNodeDataSchema = z.object({
	toolName: z.string(),
	toolCategory: z.string().optional(),
	args: z.record(z.string(), z.unknown()).optional()
});
export type ToolNodeData = z.infer<typeof ToolNodeDataSchema>;

export const ConditionNodeDataSchema = z.object({
	expression: z.string(),
	trueBranch: z.string().optional(),
	falseBranch: z.string().optional()
});
export type ConditionNodeData = z.infer<typeof ConditionNodeDataSchema>;

export const LoopNodeDataSchema = z.object({
	iteratorExpression: z.string(),
	iterationVariable: z.string().default('item'),
	indexVariable: z.string().default('index'),
	executionMode: z.enum(['sequential', 'parallel']).default('sequential'),
	maxIterations: z.number().int().positive().optional(),
	breakCondition: z.string().optional(),
	bodyNodeIds: z.array(z.string()).optional()
});
export type LoopNodeData = z.infer<typeof LoopNodeDataSchema>;

export const ApprovalNodeDataSchema = z.object({
	message: z.string(),
	approvers: z.array(z.string()).optional(),
	timeoutMinutes: z.number().int().positive().optional()
});
export type ApprovalNodeData = z.infer<typeof ApprovalNodeDataSchema>;

export const AIStepNodeDataSchema = z.object({
	prompt: z.string(),
	model: z.string().optional(),
	systemPrompt: z.string().optional(),
	temperature: z.number().min(0).max(2).optional(),
	maxTokens: z.number().int().positive().optional(),
	outputSchema: z.record(z.string(), z.unknown()).optional()
});
export type AIStepNodeData = z.infer<typeof AIStepNodeDataSchema>;

export const InputFieldSchema = z.object({
	name: z.string(),
	type: z.string(),
	required: z.boolean().optional(),
	defaultValue: z.unknown().optional(),
	description: z.string().optional()
});
export type InputField = z.infer<typeof InputFieldSchema>;

export const InputNodeDataSchema = z.object({
	fields: z.array(InputFieldSchema)
});
export type InputNodeData = z.infer<typeof InputNodeDataSchema>;

export const OutputNodeDataSchema = z.object({
	outputMapping: z.record(z.string(), z.string())
});
export type OutputNodeData = z.infer<typeof OutputNodeDataSchema>;

export const ParallelNodeDataSchema = z.object({
	branchNodeIds: z.array(z.array(z.string())),
	waitForAll: z.boolean().optional(), // Deprecated: use mergeStrategy instead
	mergeStrategy: z.enum(['all', 'any', 'first']).default('all'),
	timeoutMs: z.number().int().positive().optional(),
	errorHandling: z.enum(['fail-fast', 'collect-all']).default('fail-fast')
});
export type ParallelNodeData = z.infer<typeof ParallelNodeDataSchema>;

// ============================================================================
// Workflow Node & Edge Schemas
// ============================================================================

export const WorkflowNodeSchema = z.object({
	id: z.string(),
	type: NodeTypeSchema,
	position: z.object({ x: z.number(), y: z.number() }),
	data: z.record(z.string(), z.unknown()),
	label: z.string().optional()
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
	id: z.string(),
	source: z.string(),
	target: z.string(),
	label: z.string().optional(),
	condition: z.string().optional()
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

// ============================================================================
// WorkflowDefinition Schema
// ============================================================================

export const WorkflowDefinitionSchema = z.object({
	id: z.string(),
	name: z.string().min(1).max(255),
	description: z.string().max(2000).optional(),
	status: WorkflowStatusSchema.default('draft'),
	version: z.number().int().positive().default(1),
	tags: z.array(z.string()).optional(),
	nodes: z.array(WorkflowNodeSchema),
	edges: z.array(WorkflowEdgeSchema),
	inputSchema: z.record(z.string(), z.unknown()).optional(),
	userId: z.string().optional(),
	orgId: z.string().optional(),
	createdAt: z.date(),
	updatedAt: z.date()
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// ============================================================================
// WorkflowRun Schema
// ============================================================================

export const WorkflowRunSchema = z.object({
	id: z.string(),
	definitionId: z.string(),
	workflowVersion: z.number().int().positive().optional(),
	status: WorkflowRunStatusSchema,
	userId: z.string().optional(),
	orgId: z.string().optional(),
	input: z.record(z.string(), z.unknown()).optional(),
	output: z.record(z.string(), z.unknown()).optional(),
	error: z.record(z.string(), z.unknown()).optional(),
	engineState: z.record(z.string(), z.unknown()).optional(),
	startedAt: z.date().optional(),
	completedAt: z.date().optional(),
	suspendedAt: z.date().optional(),
	resumedAt: z.date().optional(),
	createdAt: z.date().optional(),
	updatedAt: z.date().optional()
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

// ============================================================================
// WorkflowStep Schema
// ============================================================================

export const WorkflowStepSchema = z.object({
	id: z.string(),
	runId: z.string(),
	nodeId: z.string(),
	nodeType: NodeTypeSchema.optional(),
	stepNumber: z.number().int().positive().optional(),
	status: WorkflowStepStatusSchema,
	input: z.record(z.string(), z.unknown()).optional(),
	output: z.record(z.string(), z.unknown()).optional(),
	error: z.string().optional(),
	startedAt: z.date().optional(),
	completedAt: z.date().optional(),
	durationMs: z.number().nonnegative().optional(),
	toolExecutionId: z.string().optional(),
	createdAt: z.date().optional(),
	updatedAt: z.date().optional()
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

// ============================================================================
// Insert Schemas (omit server-generated fields)
// ============================================================================

export const InsertWorkflowDefinitionSchema = WorkflowDefinitionSchema.omit({
	id: true,
	createdAt: true,
	updatedAt: true
});
export type InsertWorkflowDefinition = z.infer<typeof InsertWorkflowDefinitionSchema>;

export const InsertWorkflowRunSchema = WorkflowRunSchema.omit({
	id: true,
	createdAt: true,
	updatedAt: true
});
export type InsertWorkflowRun = z.infer<typeof InsertWorkflowRunSchema>;

export const InsertWorkflowStepSchema = WorkflowStepSchema.omit({
	id: true,
	createdAt: true,
	updatedAt: true
});
export type InsertWorkflowStep = z.infer<typeof InsertWorkflowStepSchema>;
