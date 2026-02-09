/**
 * Phase 7 TDD: Workflow Types & Zod Schemas
 *
 * Tests for the workflow type system including node types,
 * workflow/run/step status enums, node data interfaces,
 * and full workflow definition/run/step schemas.
 *
 * TDD: These tests are written FIRST, before implementation.
 */
import { describe, it, expect } from 'vitest';
import {
	NodeTypeSchema,
	WorkflowStatusSchema,
	WorkflowRunStatusSchema,
	WorkflowStepStatusSchema,
	ToolNodeDataSchema,
	ConditionNodeDataSchema,
	LoopNodeDataSchema,
	ApprovalNodeDataSchema,
	AIStepNodeDataSchema,
	InputNodeDataSchema,
	OutputNodeDataSchema,
	ParallelNodeDataSchema,
	WorkflowNodeSchema,
	WorkflowEdgeSchema,
	WorkflowDefinitionSchema,
	WorkflowRunSchema,
	WorkflowStepSchema
} from '@portal/shared/workflows/types';

// ============================================================================
// Enum schemas
// ============================================================================

describe('NodeType enum', () => {
	it('accepts all 8 valid node types', () => {
		const valid = [
			'tool',
			'condition',
			'loop',
			'approval',
			'ai-step',
			'input',
			'output',
			'parallel'
		];
		for (const t of valid) {
			expect(() => NodeTypeSchema.parse(t)).not.toThrow();
		}
	});

	it('rejects invalid node types', () => {
		expect(() => NodeTypeSchema.parse('unknown')).toThrow();
		expect(() => NodeTypeSchema.parse('')).toThrow();
	});
});

describe('WorkflowStatus enum', () => {
	it('accepts draft, published, archived', () => {
		for (const s of ['draft', 'published', 'archived']) {
			expect(() => WorkflowStatusSchema.parse(s)).not.toThrow();
		}
	});

	it('rejects invalid statuses', () => {
		expect(() => WorkflowStatusSchema.parse('active')).toThrow();
	});
});

describe('WorkflowRunStatus enum', () => {
	it('accepts all valid run statuses', () => {
		const valid = ['pending', 'running', 'suspended', 'completed', 'failed', 'cancelled'];
		for (const s of valid) {
			expect(() => WorkflowRunStatusSchema.parse(s)).not.toThrow();
		}
	});

	it('rejects invalid statuses', () => {
		expect(() => WorkflowRunStatusSchema.parse('paused')).toThrow();
	});
});

describe('WorkflowStepStatus enum', () => {
	it('accepts all valid step statuses', () => {
		const valid = ['pending', 'running', 'suspended', 'completed', 'failed', 'skipped'];
		for (const s of valid) {
			expect(() => WorkflowStepStatusSchema.parse(s)).not.toThrow();
		}
	});

	it('rejects invalid statuses', () => {
		expect(() => WorkflowStepStatusSchema.parse('paused')).toThrow();
	});
});

// ============================================================================
// Node data schemas
// ============================================================================

describe('ToolNodeData', () => {
	it('validates tool node data with required fields', () => {
		const data = {
			toolName: 'listInstances',
			toolCategory: 'compute',
			args: { compartmentId: 'ocid1...' }
		};
		expect(() => ToolNodeDataSchema.parse(data)).not.toThrow();
	});

	it('requires toolName', () => {
		expect(() => ToolNodeDataSchema.parse({ args: {} })).toThrow();
	});

	it('accepts without optional args', () => {
		const data = { toolName: 'listInstances' };
		expect(() => ToolNodeDataSchema.parse(data)).not.toThrow();
	});
});

describe('ConditionNodeData', () => {
	it('validates condition node data', () => {
		const data = {
			expression: 'result.data.length > 0',
			trueBranch: 'node-2',
			falseBranch: 'node-3'
		};
		expect(() => ConditionNodeDataSchema.parse(data)).not.toThrow();
	});

	it('requires expression', () => {
		expect(() => ConditionNodeDataSchema.parse({ trueBranch: 'n1' })).toThrow();
	});
});

describe('LoopNodeData', () => {
	it('validates loop node data', () => {
		const data = {
			iteratorExpression: 'result.data',
			maxIterations: 10,
			bodyNodeIds: ['n1', 'n2']
		};
		expect(() => LoopNodeDataSchema.parse(data)).not.toThrow();
	});

	it('requires iteratorExpression', () => {
		expect(() => LoopNodeDataSchema.parse({ maxIterations: 5 })).toThrow();
	});
});

describe('ApprovalNodeData', () => {
	it('validates approval node data', () => {
		const data = {
			message: 'Approve instance launch?',
			approvers: ['admin@example.com'],
			timeoutMinutes: 30
		};
		expect(() => ApprovalNodeDataSchema.parse(data)).not.toThrow();
	});

	it('requires message', () => {
		expect(() => ApprovalNodeDataSchema.parse({ approvers: [] })).toThrow();
	});
});

describe('AIStepNodeData', () => {
	it('validates AI step data', () => {
		const data = { prompt: 'Summarize the results', model: 'cohere.command-r-plus' };
		expect(() => AIStepNodeDataSchema.parse(data)).not.toThrow();
	});

	it('requires prompt', () => {
		expect(() => AIStepNodeDataSchema.parse({ model: 'cohere.command-r-plus' })).toThrow();
	});
});

describe('InputNodeData', () => {
	it('validates input node data', () => {
		const data = { fields: [{ name: 'compartmentId', type: 'string', required: true }] };
		expect(() => InputNodeDataSchema.parse(data)).not.toThrow();
	});

	it('requires fields array', () => {
		expect(() => InputNodeDataSchema.parse({})).toThrow();
	});
});

describe('OutputNodeData', () => {
	it('validates output node data', () => {
		const data = { outputMapping: { instanceId: '{{result.data.id}}' } };
		expect(() => OutputNodeDataSchema.parse(data)).not.toThrow();
	});

	it('requires outputMapping', () => {
		expect(() => OutputNodeDataSchema.parse({})).toThrow();
	});
});

describe('ParallelNodeData', () => {
	it('validates parallel node data', () => {
		const data = {
			branchNodeIds: [
				['n1', 'n2'],
				['n3', 'n4']
			],
			waitForAll: true
		};
		expect(() => ParallelNodeDataSchema.parse(data)).not.toThrow();
	});

	it('requires branchNodeIds', () => {
		expect(() => ParallelNodeDataSchema.parse({ waitForAll: true })).toThrow();
	});
});

// ============================================================================
// Workflow Node and Edge schemas
// ============================================================================

describe('WorkflowNode', () => {
	it('validates a tool node', () => {
		const node = {
			id: 'n1',
			type: 'tool',
			position: { x: 0, y: 0 },
			data: { toolName: 'listInstances' }
		};
		expect(() => WorkflowNodeSchema.parse(node)).not.toThrow();
	});

	it('validates an input node', () => {
		const node = {
			id: 'n2',
			type: 'input',
			position: { x: 100, y: 100 },
			data: { fields: [{ name: 'region', type: 'string', required: true }] }
		};
		expect(() => WorkflowNodeSchema.parse(node)).not.toThrow();
	});

	it('requires id, type, position, and data', () => {
		expect(() => WorkflowNodeSchema.parse({ type: 'tool' })).toThrow();
	});
});

describe('WorkflowEdge', () => {
	it('validates an edge', () => {
		const edge = { id: 'e1', source: 'n1', target: 'n2' };
		expect(() => WorkflowEdgeSchema.parse(edge)).not.toThrow();
	});

	it('accepts optional label and condition', () => {
		const edge = { id: 'e1', source: 'n1', target: 'n2', label: 'on success', condition: 'true' };
		expect(() => WorkflowEdgeSchema.parse(edge)).not.toThrow();
	});

	it('requires id, source, target', () => {
		expect(() => WorkflowEdgeSchema.parse({ source: 'n1' })).toThrow();
	});
});

// ============================================================================
// WorkflowDefinition schema
// ============================================================================

describe('WorkflowDefinition', () => {
	const validDef = {
		id: 'wf-123',
		name: 'Provision Web Server',
		description: 'Deploy a compute instance with web server',
		status: 'draft',
		version: 1,
		nodes: [
			{
				id: 'n1',
				type: 'input',
				position: { x: 0, y: 0 },
				data: { fields: [{ name: 'compartmentId', type: 'string', required: true }] }
			},
			{ id: 'n2', type: 'tool', position: { x: 200, y: 0 }, data: { toolName: 'launchInstance' } },
			{
				id: 'n3',
				type: 'output',
				position: { x: 400, y: 0 },
				data: { outputMapping: { instanceId: '{{result.id}}' } }
			}
		],
		edges: [
			{ id: 'e1', source: 'n1', target: 'n2' },
			{ id: 'e2', source: 'n2', target: 'n3' }
		],
		userId: 'user-1',
		orgId: 'org-1',
		tags: ['compute', 'provisioning'],
		createdAt: new Date(),
		updatedAt: new Date()
	};

	it('validates a complete workflow definition', () => {
		expect(() => WorkflowDefinitionSchema.parse(validDef)).not.toThrow();
	});

	it('requires name', () => {
		const { name: _, ...noName } = validDef;
		expect(() => WorkflowDefinitionSchema.parse(noName)).toThrow();
	});

	it('requires nodes array', () => {
		const { nodes: _, ...noNodes } = validDef;
		expect(() => WorkflowDefinitionSchema.parse(noNodes)).toThrow();
	});

	it('requires edges array', () => {
		const { edges: _, ...noEdges } = validDef;
		expect(() => WorkflowDefinitionSchema.parse(noEdges)).toThrow();
	});

	it('defaults status to draft', () => {
		const { status: _, ...noStatus } = validDef;
		const parsed = WorkflowDefinitionSchema.parse(noStatus);
		expect(parsed.status).toBe('draft');
	});

	it('defaults version to 1', () => {
		const { version: _, ...noVersion } = validDef;
		const parsed = WorkflowDefinitionSchema.parse(noVersion);
		expect(parsed.version).toBe(1);
	});

	it('accepts empty tags', () => {
		const def = { ...validDef, tags: [] };
		expect(() => WorkflowDefinitionSchema.parse(def)).not.toThrow();
	});

	it('userId and orgId are optional', () => {
		const { userId: _, orgId: __, ...noOwners } = validDef;
		expect(() => WorkflowDefinitionSchema.parse(noOwners)).not.toThrow();
	});

	it('accepts inputSchema as optional JSON schema object', () => {
		const def = {
			...validDef,
			inputSchema: {
				type: 'object',
				properties: { compartmentId: { type: 'string' } },
				required: ['compartmentId']
			}
		};
		expect(() => WorkflowDefinitionSchema.parse(def)).not.toThrow();
	});
});

// ============================================================================
// WorkflowRun schema
// ============================================================================

describe('WorkflowRun', () => {
	it('validates a running workflow', () => {
		const run = {
			id: 'run-456',
			definitionId: 'wf-123',
			workflowVersion: 1,
			status: 'running',
			userId: 'user-1',
			orgId: 'org-1',
			input: { compartmentId: 'ocid1...' },
			startedAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date()
		};
		expect(() => WorkflowRunSchema.parse(run)).not.toThrow();
	});

	it('validates a completed workflow with output', () => {
		const run = {
			id: 'run-789',
			definitionId: 'wf-123',
			workflowVersion: 1,
			status: 'completed',
			userId: 'user-1',
			input: { compartmentId: 'ocid1...' },
			output: { instanceId: 'i-123' },
			startedAt: new Date(),
			completedAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date()
		};
		expect(() => WorkflowRunSchema.parse(run)).not.toThrow();
	});

	it('validates a failed workflow with error', () => {
		const run = {
			id: 'run-err',
			definitionId: 'wf-123',
			workflowVersion: 1,
			status: 'failed',
			userId: 'user-1',
			error: { message: 'OCI CLI exited with code 1', code: 'OCI_ERROR' },
			startedAt: new Date(),
			completedAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date()
		};
		expect(() => WorkflowRunSchema.parse(run)).not.toThrow();
	});

	it('validates a suspended workflow with engine state', () => {
		const run = {
			id: 'run-susp',
			definitionId: 'wf-123',
			workflowVersion: 1,
			status: 'suspended',
			userId: 'user-1',
			engineState: { currentNodeId: 'n3', awaitingApproval: true },
			startedAt: new Date(),
			suspendedAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date()
		};
		expect(() => WorkflowRunSchema.parse(run)).not.toThrow();
	});

	it('rejects invalid status', () => {
		expect(() =>
			WorkflowRunSchema.parse({
				id: 'run-1',
				definitionId: 'wf-1',
				workflowVersion: 1,
				status: 'invalid_status',
				startedAt: new Date(),
				createdAt: new Date(),
				updatedAt: new Date()
			})
		).toThrow();
	});

	it('requires definitionId', () => {
		expect(() =>
			WorkflowRunSchema.parse({
				id: 'run-1',
				status: 'pending',
				createdAt: new Date(),
				updatedAt: new Date()
			})
		).toThrow();
	});
});

// ============================================================================
// WorkflowStep schema
// ============================================================================

describe('WorkflowStep', () => {
	it('validates a completed step', () => {
		const step = {
			id: 'step-1',
			runId: 'run-456',
			nodeId: 'n1',
			nodeType: 'tool',
			stepNumber: 1,
			status: 'completed',
			input: { compartmentId: 'ocid1...' },
			output: { data: [{ id: 'instance-1' }] },
			startedAt: new Date(),
			completedAt: new Date(),
			durationMs: 1234,
			createdAt: new Date(),
			updatedAt: new Date()
		};
		expect(() => WorkflowStepSchema.parse(step)).not.toThrow();
	});

	it('validates a pending step with minimal fields', () => {
		const step = {
			id: 'step-2',
			runId: 'run-456',
			nodeId: 'n2',
			nodeType: 'approval',
			stepNumber: 2,
			status: 'pending',
			createdAt: new Date(),
			updatedAt: new Date()
		};
		expect(() => WorkflowStepSchema.parse(step)).not.toThrow();
	});

	it('validates a failed step with error', () => {
		const step = {
			id: 'step-3',
			runId: 'run-456',
			nodeId: 'n3',
			nodeType: 'tool',
			stepNumber: 3,
			status: 'failed',
			error: 'OCI CLI timeout',
			startedAt: new Date(),
			completedAt: new Date(),
			durationMs: 30000,
			createdAt: new Date(),
			updatedAt: new Date()
		};
		expect(() => WorkflowStepSchema.parse(step)).not.toThrow();
	});

	it('accepts optional toolExecutionId for audit linkage', () => {
		const step = {
			id: 'step-4',
			runId: 'run-456',
			nodeId: 'n4',
			nodeType: 'tool',
			stepNumber: 4,
			status: 'completed',
			toolExecutionId: 'exec-789',
			createdAt: new Date(),
			updatedAt: new Date()
		};
		expect(() => WorkflowStepSchema.parse(step)).not.toThrow();
	});

	it('rejects invalid nodeType', () => {
		expect(() =>
			WorkflowStepSchema.parse({
				id: 'step-x',
				runId: 'run-1',
				nodeId: 'n1',
				nodeType: 'invalid',
				stepNumber: 1,
				status: 'pending',
				createdAt: new Date(),
				updatedAt: new Date()
			})
		).toThrow();
	});

	it('rejects invalid status', () => {
		expect(() =>
			WorkflowStepSchema.parse({
				id: 'step-y',
				runId: 'run-1',
				nodeId: 'n1',
				nodeType: 'tool',
				stepNumber: 1,
				status: 'invalid',
				createdAt: new Date(),
				updatedAt: new Date()
			})
		).toThrow();
	});
});
