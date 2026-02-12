/**
 * Phase 7 TDD: Workflow Executor
 *
 * Tests for workflow execution engine including:
 * - Topological sort of workflow DAG
 * - Cycle detection
 * - Tool node execution via executeTool()
 * - Approval node suspend/resume
 * - Condition node safe expression evaluation
 * - Error handling with PortalError hierarchy
 *
 * TDD: Written FIRST, before implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Oracle connection
const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
const mockConn = {
	execute: mockExecute,
	commit: vi.fn().mockResolvedValue(undefined),
	rollback: vi.fn().mockResolvedValue(undefined),
	close: vi.fn().mockResolvedValue(undefined)
};

vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) => fn(mockConn))
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

vi.mock('$lib/server/sentry.js', () => ({
	wrapWithSpan: vi.fn((_name: string, _op: string, fn: () => unknown) => fn()),
	captureError: vi.fn()
}));

// Mock executeTool from registry
const mockExecuteTool = vi.fn();
vi.mock('$lib/tools/registry.js', () => ({
	executeTool: (...args: unknown[]) => mockExecuteTool(...args)
}));

import {
	topologicalSort,
	detectCycles,
	WorkflowExecutor
} from '@portal/shared/server/workflows/executor';
import type { WorkflowNode, WorkflowEdge } from '@portal/types/workflows/types';

beforeEach(() => {
	vi.clearAllMocks();
});

// ============================================================================
// Topological Sort
// ============================================================================

describe('topologicalSort', () => {
	it('sorts a linear chain correctly', () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			{ id: 'n2', type: 'tool', position: { x: 100, y: 0 }, data: {} },
			{ id: 'n3', type: 'output', position: { x: 200, y: 0 }, data: {} }
		];
		const edges: WorkflowEdge[] = [
			{ id: 'e1', source: 'n1', target: 'n2' },
			{ id: 'e2', source: 'n2', target: 'n3' }
		];

		const sorted = topologicalSort(nodes, edges);
		expect(sorted).toHaveLength(3);

		const ids = sorted.map((n) => n.id);
		expect(ids.indexOf('n1')).toBeLessThan(ids.indexOf('n2'));
		expect(ids.indexOf('n2')).toBeLessThan(ids.indexOf('n3'));
	});

	it('sorts a diamond DAG correctly', () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			{ id: 'n2', type: 'tool', position: { x: 0, y: 100 }, data: {} },
			{ id: 'n3', type: 'tool', position: { x: 200, y: 100 }, data: {} },
			{ id: 'n4', type: 'output', position: { x: 100, y: 200 }, data: {} }
		];
		const edges: WorkflowEdge[] = [
			{ id: 'e1', source: 'n1', target: 'n2' },
			{ id: 'e2', source: 'n1', target: 'n3' },
			{ id: 'e3', source: 'n2', target: 'n4' },
			{ id: 'e4', source: 'n3', target: 'n4' }
		];

		const sorted = topologicalSort(nodes, edges);
		expect(sorted).toHaveLength(4);

		const ids = sorted.map((n) => n.id);
		expect(ids.indexOf('n1')).toBeLessThan(ids.indexOf('n2'));
		expect(ids.indexOf('n1')).toBeLessThan(ids.indexOf('n3'));
		expect(ids.indexOf('n2')).toBeLessThan(ids.indexOf('n4'));
		expect(ids.indexOf('n3')).toBeLessThan(ids.indexOf('n4'));
	});

	it('handles a single node with no edges', () => {
		const nodes: WorkflowNode[] = [{ id: 'n1', type: 'tool', position: { x: 0, y: 0 }, data: {} }];

		const sorted = topologicalSort(nodes, []);
		expect(sorted).toHaveLength(1);
		expect(sorted[0].id).toBe('n1');
	});

	it('handles disconnected nodes', () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'tool', position: { x: 0, y: 0 }, data: {} },
			{ id: 'n2', type: 'tool', position: { x: 100, y: 0 }, data: {} }
		];

		const sorted = topologicalSort(nodes, []);
		expect(sorted).toHaveLength(2);
	});
});

// ============================================================================
// Cycle Detection
// ============================================================================

describe('detectCycles', () => {
	it('returns false for acyclic graph', () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			{ id: 'n2', type: 'tool', position: { x: 100, y: 0 }, data: {} }
		];
		const edges: WorkflowEdge[] = [{ id: 'e1', source: 'n1', target: 'n2' }];

		expect(detectCycles(nodes, edges)).toBe(false);
	});

	it('returns true for a simple cycle', () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'tool', position: { x: 0, y: 0 }, data: {} },
			{ id: 'n2', type: 'tool', position: { x: 100, y: 0 }, data: {} }
		];
		const edges: WorkflowEdge[] = [
			{ id: 'e1', source: 'n1', target: 'n2' },
			{ id: 'e2', source: 'n2', target: 'n1' }
		];

		expect(detectCycles(nodes, edges)).toBe(true);
	});

	it('returns true for a self-loop', () => {
		const nodes: WorkflowNode[] = [{ id: 'n1', type: 'tool', position: { x: 0, y: 0 }, data: {} }];
		const edges: WorkflowEdge[] = [{ id: 'e1', source: 'n1', target: 'n1' }];

		expect(detectCycles(nodes, edges)).toBe(true);
	});

	it('returns true for an indirect cycle', () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'tool', position: { x: 0, y: 0 }, data: {} },
			{ id: 'n2', type: 'tool', position: { x: 100, y: 0 }, data: {} },
			{ id: 'n3', type: 'tool', position: { x: 200, y: 0 }, data: {} }
		];
		const edges: WorkflowEdge[] = [
			{ id: 'e1', source: 'n1', target: 'n2' },
			{ id: 'e2', source: 'n2', target: 'n3' },
			{ id: 'e3', source: 'n3', target: 'n1' }
		];

		expect(detectCycles(nodes, edges)).toBe(true);
	});

	it('returns false for empty graph', () => {
		expect(detectCycles([], [])).toBe(false);
	});
});

// ============================================================================
// WorkflowExecutor
// ============================================================================

describe('WorkflowExecutor', () => {
	it('rejects workflows with cycles', async () => {
		const executor = new WorkflowExecutor();

		const definition = {
			id: 'wf-cycle',
			name: 'Cyclic Workflow',
			nodes: [
				{ id: 'n1', type: 'tool' as const, position: { x: 0, y: 0 }, data: { toolName: 'list' } },
				{ id: 'n2', type: 'tool' as const, position: { x: 100, y: 0 }, data: { toolName: 'get' } }
			],
			edges: [
				{ id: 'e1', source: 'n1', target: 'n2' },
				{ id: 'e2', source: 'n2', target: 'n1' }
			],
			status: 'published' as const,
			version: 1,
			createdAt: new Date(),
			updatedAt: new Date()
		};

		await expect(executor.execute(definition, {})).rejects.toThrow(/cycle/i);
	});

	it('executes a single tool node', async () => {
		const executor = new WorkflowExecutor();
		mockExecuteTool.mockResolvedValue({ data: [{ id: 'i-1' }] });

		const definition = {
			id: 'wf-single',
			name: 'Single Tool',
			nodes: [
				{
					id: 'n1',
					type: 'tool' as const,
					position: { x: 0, y: 0 },
					data: { toolName: 'listInstances', args: { compartmentId: 'ocid1...' } }
				}
			],
			edges: [] as { id: string; source: string; target: string }[],
			status: 'published' as const,
			version: 1,
			createdAt: new Date(),
			updatedAt: new Date()
		};

		const result = await executor.execute(definition, {});

		expect(mockExecuteTool).toHaveBeenCalledWith(
			'listInstances',
			expect.objectContaining({ compartmentId: 'ocid1...' })
		);
		expect(result.status).toBe('completed');
		expect(result.stepResults).toBeDefined();
	});

	it('passes output from one node as context to the next', async () => {
		const executor = new WorkflowExecutor();
		mockExecuteTool
			.mockResolvedValueOnce({ data: [{ id: 'img-1', displayName: 'Oracle-Linux' }] })
			.mockResolvedValueOnce({ data: { id: 'i-new' } });

		const definition = {
			id: 'wf-chain',
			name: 'Chained Tools',
			nodes: [
				{
					id: 'n1',
					type: 'tool' as const,
					position: { x: 0, y: 0 },
					data: { toolName: 'listImages' }
				},
				{
					id: 'n2',
					type: 'tool' as const,
					position: { x: 200, y: 0 },
					data: { toolName: 'launchInstance' }
				}
			],
			edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
			status: 'published' as const,
			version: 1,
			createdAt: new Date(),
			updatedAt: new Date()
		};

		const result = await executor.execute(definition, {});

		expect(mockExecuteTool).toHaveBeenCalledTimes(2);
		expect(result.status).toBe('completed');
	});

	it('suspends on approval node and records engine state', async () => {
		const executor = new WorkflowExecutor();
		mockExecuteTool.mockResolvedValue({ data: [{ id: 'i-1' }] });

		const definition = {
			id: 'wf-approval',
			name: 'With Approval',
			nodes: [
				{
					id: 'n1',
					type: 'tool' as const,
					position: { x: 0, y: 0 },
					data: { toolName: 'listInstances' }
				},
				{
					id: 'n2',
					type: 'approval' as const,
					position: { x: 200, y: 0 },
					data: { message: 'Continue?', approvers: [] }
				},
				{
					id: 'n3',
					type: 'tool' as const,
					position: { x: 400, y: 0 },
					data: { toolName: 'terminateInstance' }
				}
			],
			edges: [
				{ id: 'e1', source: 'n1', target: 'n2' },
				{ id: 'e2', source: 'n2', target: 'n3' }
			],
			status: 'published' as const,
			version: 1,
			createdAt: new Date(),
			updatedAt: new Date()
		};

		const result = await executor.execute(definition, {});

		expect(result.status).toBe('suspended');
		expect(result.engineState).toBeDefined();
		expect(result.engineState!.suspendedAtNodeId).toBe('n2');
		// Tool after approval should NOT have been called
		expect(mockExecuteTool).toHaveBeenCalledTimes(1);
	});

	it('resumes from suspended state and completes remaining nodes', async () => {
		const executor = new WorkflowExecutor();
		mockExecuteTool.mockResolvedValue({ data: { id: 'terminated' } });

		const engineState = {
			suspendedAtNodeId: 'n2',
			completedNodeIds: ['n1'],
			stepResults: { n1: { data: [{ id: 'i-1' }] } }
		};

		const definition = {
			id: 'wf-approval',
			name: 'With Approval',
			nodes: [
				{
					id: 'n1',
					type: 'tool' as const,
					position: { x: 0, y: 0 },
					data: { toolName: 'listInstances' }
				},
				{
					id: 'n2',
					type: 'approval' as const,
					position: { x: 200, y: 0 },
					data: { message: 'Continue?' }
				},
				{
					id: 'n3',
					type: 'tool' as const,
					position: { x: 400, y: 0 },
					data: { toolName: 'terminateInstance' }
				}
			],
			edges: [
				{ id: 'e1', source: 'n1', target: 'n2' },
				{ id: 'e2', source: 'n2', target: 'n3' }
			],
			status: 'published' as const,
			version: 1,
			createdAt: new Date(),
			updatedAt: new Date()
		};

		const result = await executor.resume(definition, engineState, {});

		expect(result.status).toBe('completed');
		expect(mockExecuteTool).toHaveBeenCalledTimes(1); // Only n3
	});

	it('evaluates condition nodes safely', async () => {
		const executor = new WorkflowExecutor();
		mockExecuteTool
			.mockResolvedValueOnce({ data: [{ id: 'i-1' }, { id: 'i-2' }] })
			.mockResolvedValueOnce({ data: 'success' });

		const definition = {
			id: 'wf-cond',
			name: 'With Condition',
			nodes: [
				{
					id: 'n1',
					type: 'tool' as const,
					position: { x: 0, y: 0 },
					data: { toolName: 'listInstances' }
				},
				{
					id: 'n2',
					type: 'condition' as const,
					position: { x: 200, y: 0 },
					data: { expression: 'result.data.length > 0', trueBranch: 'n3', falseBranch: 'n4' }
				},
				{
					id: 'n3',
					type: 'tool' as const,
					position: { x: 400, y: 0 },
					data: { toolName: 'scaleUp' }
				},
				{
					id: 'n4',
					type: 'tool' as const,
					position: { x: 400, y: 100 },
					data: { toolName: 'scaleDown' }
				}
			],
			edges: [
				{ id: 'e1', source: 'n1', target: 'n2' },
				{ id: 'e2', source: 'n2', target: 'n3' },
				{ id: 'e3', source: 'n2', target: 'n4' }
			],
			status: 'published' as const,
			version: 1,
			createdAt: new Date(),
			updatedAt: new Date()
		};

		const result = await executor.execute(definition, {});

		// Should have taken trueBranch since data.length > 0
		expect(result.status).toBe('completed');
		expect(mockExecuteTool).toHaveBeenCalledTimes(2); // n1 + n3 (not n4)
	});

	it('handles tool execution failure', async () => {
		const executor = new WorkflowExecutor();
		mockExecuteTool.mockRejectedValue(new Error('OCI CLI exited with code 1'));

		const definition = {
			id: 'wf-fail',
			name: 'Failing Workflow',
			nodes: [
				{ id: 'n1', type: 'tool' as const, position: { x: 0, y: 0 }, data: { toolName: 'badTool' } }
			],
			edges: [] as { id: string; source: string; target: string }[],
			status: 'published' as const,
			version: 1,
			createdAt: new Date(),
			updatedAt: new Date()
		};

		const result = await executor.execute(definition, {});

		expect(result.status).toBe('failed');
		expect(result.error).toBeDefined();
	});

	it('handles input nodes by passing workflow input', async () => {
		const executor = new WorkflowExecutor();
		mockExecuteTool.mockResolvedValue({ data: { id: 'i-1' } });

		const definition = {
			id: 'wf-input',
			name: 'With Input',
			nodes: [
				{
					id: 'n1',
					type: 'input' as const,
					position: { x: 0, y: 0 },
					data: { fields: [{ name: 'region', type: 'string', required: true }] }
				},
				{
					id: 'n2',
					type: 'tool' as const,
					position: { x: 200, y: 0 },
					data: { toolName: 'listInstances' }
				}
			],
			edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
			status: 'published' as const,
			version: 1,
			createdAt: new Date(),
			updatedAt: new Date()
		};

		const result = await executor.execute(definition, { region: 'eu-frankfurt-1' });

		expect(result.status).toBe('completed');
		expect(result.stepResults?.n1).toEqual({ region: 'eu-frankfurt-1' });
	});

	it('handles output nodes by collecting final output', async () => {
		const executor = new WorkflowExecutor();
		mockExecuteTool.mockResolvedValue({ data: { id: 'i-new' } });

		const definition = {
			id: 'wf-output',
			name: 'With Output',
			nodes: [
				{
					id: 'n1',
					type: 'tool' as const,
					position: { x: 0, y: 0 },
					data: { toolName: 'launchInstance' }
				},
				{
					id: 'n2',
					type: 'output' as const,
					position: { x: 200, y: 0 },
					data: { outputMapping: { instanceId: 'n1.data.id' } }
				}
			],
			edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
			status: 'published' as const,
			version: 1,
			createdAt: new Date(),
			updatedAt: new Date()
		};

		const result = await executor.execute(definition, {});

		expect(result.status).toBe('completed');
		expect(result.output).toBeDefined();
	});
});
