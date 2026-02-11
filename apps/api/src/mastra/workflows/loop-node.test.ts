/**
 * Loop node tests - to be integrated into executor.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '@portal/shared/workflows';

// Mock executeTool before importing executor
vi.mock('../tools/registry.js', () => ({
	executeTool: vi.fn(async (toolName: string, args: Record<string, unknown>) => ({
		toolName,
		args,
		result: `result-of-${toolName}`
	}))
}));

import { WorkflowExecutor } from './executor.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeNode(
	id: string,
	type: WorkflowNode['type'] = 'tool',
	data: Record<string, unknown> = {}
): WorkflowNode {
	return { id, type, position: { x: 0, y: 0 }, data };
}

function makeEdge(source: string, target: string): WorkflowEdge {
	return { id: `${source}-${target}`, source, target };
}

function makeDefinition(
	nodes: WorkflowNode[],
	edges: WorkflowEdge[],
	overrides: Partial<WorkflowDefinition> = {}
): WorkflowDefinition {
	return {
		id: 'wf-1',
		name: 'Test Workflow',
		status: 'published',
		version: 1,
		nodes,
		edges,
		userId: 'user-1',
		orgId: 'org-1',
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides
	};
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('WorkflowExecutor - Loop Node', () => {
	let executor: WorkflowExecutor;

	beforeEach(() => {
		vi.clearAllMocks();
		executor = new WorkflowExecutor();
	});

	it('iterates over array in sequential mode', async () => {
		const nodes = [
			makeNode('n1', 'input'),
			makeNode('loop1', 'loop', {
				iteratorExpression: 'n1.items',
				executionMode: 'sequential'
			})
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);
		const input = { items: ['a', 'b', 'c'] };

		const result = await executor.execute(def, input);

		expect(result.status).toBe('completed');
		const loopResult = result.stepResults!['loop1'] as {
			iterations: unknown[];
			totalIterations: number;
			executionMode: string;
		};
		expect(loopResult.totalIterations).toBe(3);
		expect(loopResult.executionMode).toBe('sequential');
		expect(loopResult.iterations).toHaveLength(3);
	});

	it('supports parallel execution mode', async () => {
		const nodes = [
			makeNode('n1', 'input'),
			makeNode('loop1', 'loop', {
				iteratorExpression: 'n1.numbers',
				executionMode: 'parallel'
			})
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);
		const input = { numbers: [1, 2, 3, 4, 5] };

		const result = await executor.execute(def, input);

		expect(result.status).toBe('completed');
		const loopResult = result.stepResults!['loop1'] as {
			totalIterations: number;
			executionMode: string;
		};
		expect(loopResult.totalIterations).toBe(5);
		expect(loopResult.executionMode).toBe('parallel');
	});

	it('respects maxIterations limit', async () => {
		const nodes = [
			makeNode('n1', 'input'),
			makeNode('loop1', 'loop', {
				iteratorExpression: 'n1.items',
				maxIterations: 2
			})
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);
		const input = { items: ['a', 'b', 'c', 'd', 'e'] };

		const result = await executor.execute(def, input);

		expect(result.status).toBe('completed');
		const loopResult = result.stepResults!['loop1'] as {
			totalIterations: number;
		};
		// Should only process first 2 items despite array having 5
		expect(loopResult.totalIterations).toBe(2);
	});

	it('supports break condition for early exit', async () => {
		const nodes = [
			makeNode('n1', 'input'),
			makeNode('loop1', 'loop', {
				iteratorExpression: 'n1.numbers',
				iterationVariable: 'num',
				breakCondition: 'num > 5'
			})
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);
		const input = { numbers: [1, 3, 6, 8, 10] };

		const result = await executor.execute(def, input);

		expect(result.status).toBe('completed');
		const loopResult = result.stepResults!['loop1'] as {
			totalIterations: number;
			breakTriggered: boolean;
		};
		// Should process 1, 3, then break when encountering 6
		expect(loopResult.totalIterations).toBe(2);
		expect(loopResult.breakTriggered).toBe(true);
	});

	it('binds iteration variable and index', async () => {
		const nodes = [
			makeNode('n1', 'input'),
			makeNode('loop1', 'loop', {
				iteratorExpression: 'n1.items',
				iterationVariable: 'currentItem',
				indexVariable: 'idx'
			})
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);
		const input = { items: ['x', 'y'] };

		const result = await executor.execute(def, input);

		expect(result.status).toBe('completed');
		const loopResult = result.stepResults!['loop1'] as {
			iterations: Array<{ currentItem: string; idx: number }>;
		};
		expect(loopResult.iterations[0]).toMatchObject({
			currentItem: 'x',
			idx: 0
		});
		expect(loopResult.iterations[1]).toMatchObject({
			currentItem: 'y',
			idx: 1
		});
	});

	it('throws ValidationError when iteratorExpression is missing', async () => {
		const nodes = [makeNode('loop1', 'loop', {})];
		const def = makeDefinition(nodes, []);

		const result = await executor.execute(def, {});

		expect(result.status).toBe('failed');
		expect(result.error).toContain('iteratorExpression');
	});

	it('throws ValidationError when iteratorExpression does not resolve to array', async () => {
		const nodes = [
			makeNode('n1', 'input'),
			makeNode('loop1', 'loop', {
				iteratorExpression: 'n1.notAnArray'
			})
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);
		const input = { notAnArray: 'string value' };

		const result = await executor.execute(def, input);

		expect(result.status).toBe('failed');
		expect(result.error).toContain('array');
	});

	it('handles empty array gracefully', async () => {
		const nodes = [
			makeNode('n1', 'input'),
			makeNode('loop1', 'loop', {
				iteratorExpression: 'n1.items'
			})
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);
		const input = { items: [] };

		const result = await executor.execute(def, input);

		expect(result.status).toBe('completed');
		const loopResult = result.stepResults!['loop1'] as {
			totalIterations: number;
		};
		expect(loopResult.totalIterations).toBe(0);
	});

	it('uses default variable names (item, index) when not specified', async () => {
		const nodes = [
			makeNode('n1', 'input'),
			makeNode('loop1', 'loop', {
				iteratorExpression: 'n1.values'
			})
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);
		const input = { values: ['first'] };

		const result = await executor.execute(def, input);

		expect(result.status).toBe('completed');
		const loopResult = result.stepResults!['loop1'] as {
			iterations: Array<{ item: string; index: number }>;
		};
		// Should use default variable names
		expect(loopResult.iterations[0]).toMatchObject({
			item: 'first',
			index: 0
		});
	});
});
