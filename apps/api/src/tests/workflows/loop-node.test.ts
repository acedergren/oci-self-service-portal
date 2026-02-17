/**
 * Loop Node Tests
 *
 * Tests the loop workflow node factory helpers and integration
 * with the WorkflowExecutor. Verifies:
 * - createLoopNode factory builds valid WorkflowNode structs
 * - extractIterationItems helper
 * - isLoopNodeResult type guard
 * - Sequential iteration with correct variable binding
 * - Parallel iteration mode
 * - maxIterations cap
 * - breakCondition early exit
 * - Missing iteratorExpression error handling
 * - Non-array iteratorExpression error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '@portal/shared/workflows';
import {
	createLoopNode,
	extractIterationItems,
	isLoopNodeResult,
	type LoopNodeResult
} from '../../mastra/workflows/nodes/loop.js';

// Mock executeTool (needed by WorkflowExecutor)
vi.mock('../../mastra/tools/registry.js', () => ({
	executeTool: vi.fn(async (toolName: string, args: Record<string, unknown>) => ({
		toolName,
		args,
		result: `result-of-${toolName}`
	}))
}));

import { WorkflowExecutor } from '../../mastra/workflows/executor.js';

// ── Helpers ─────────────────────────────────────────────────────────────

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

// ── Unit tests for factory helpers ───────────────────────────────────────

describe('createLoopNode', () => {
	it('creates a node with type loop and required data', () => {
		const node = createLoopNode('loop-1', {
			iteratorExpression: 'listInstances.data'
		});

		expect(node.id).toBe('loop-1');
		expect(node.type).toBe('loop');
		expect(node.data.iteratorExpression).toBe('listInstances.data');
	});

	it('applies default values for optional fields', () => {
		const node = createLoopNode('loop-1', {
			iteratorExpression: 'input.items'
		});

		expect(node.data.iterationVariable).toBe('item');
		expect(node.data.indexVariable).toBe('index');
		expect(node.data.executionMode).toBe('sequential');
		expect(node.data.bodyNodeIds).toEqual([]);
	});

	it('accepts custom iteration variable names', () => {
		const node = createLoopNode('loop-1', {
			iteratorExpression: 'input.instances',
			iterationVariable: 'instance',
			indexVariable: 'idx'
		});

		expect(node.data.iterationVariable).toBe('instance');
		expect(node.data.indexVariable).toBe('idx');
	});

	it('stores breakCondition in node data', () => {
		const node = createLoopNode('loop-1', {
			iteratorExpression: 'input.items',
			breakCondition: 'item.done === true'
		});

		expect(node.data.breakCondition).toBe('item.done === true');
	});

	it('stores maxIterations in node data', () => {
		const node = createLoopNode('loop-1', {
			iteratorExpression: 'input.items',
			maxIterations: 10
		});

		expect(node.data.maxIterations).toBe(10);
	});

	it('sets parallel execution mode when specified', () => {
		const node = createLoopNode('loop-1', {
			iteratorExpression: 'input.items',
			executionMode: 'parallel'
		});

		expect(node.data.executionMode).toBe('parallel');
	});

	it('defaults position to (0,0) when not specified', () => {
		const node = createLoopNode('loop-1', {
			iteratorExpression: 'input.items'
		});

		expect(node.position).toEqual({ x: 0, y: 0 });
	});

	it('accepts custom position', () => {
		const node = createLoopNode('loop-1', { iteratorExpression: 'input.items' }, { x: 50, y: 75 });

		expect(node.position).toEqual({ x: 50, y: 75 });
	});
});

describe('isLoopNodeResult', () => {
	it('returns true for a valid LoopNodeResult shape', () => {
		const result: LoopNodeResult = {
			iterations: [{ item: 'a', index: 0, bodyNodeIds: [] }],
			totalIterations: 1,
			breakTriggered: false,
			executionMode: 'sequential'
		};

		expect(isLoopNodeResult(result)).toBe(true);
	});

	it('returns false when iterations is not an array', () => {
		expect(isLoopNodeResult({ iterations: 'not-array', totalIterations: 0 })).toBe(false);
	});

	it('returns false when totalIterations is missing', () => {
		expect(isLoopNodeResult({ iterations: [] })).toBe(false);
	});

	it('returns false for null', () => {
		expect(isLoopNodeResult(null)).toBe(false);
	});

	it('returns false for primitives', () => {
		expect(isLoopNodeResult(42)).toBe(false);
		expect(isLoopNodeResult('string')).toBe(false);
	});
});

describe('extractIterationItems', () => {
	it('extracts the iteration variable from each iteration', () => {
		const result: LoopNodeResult = {
			iterations: [
				{ item: 'apple', index: 0, bodyNodeIds: [] },
				{ item: 'banana', index: 1, bodyNodeIds: [] }
			],
			totalIterations: 2,
			breakTriggered: false,
			executionMode: 'sequential'
		};

		const items = extractIterationItems(result, 'item');

		expect(items).toEqual(['apple', 'banana']);
	});

	it('defaults to "item" variable name when not specified', () => {
		const result: LoopNodeResult = {
			iterations: [{ item: 'x', index: 0, bodyNodeIds: [] }],
			totalIterations: 1,
			breakTriggered: false,
			executionMode: 'sequential'
		};

		const items = extractIterationItems(result);

		expect(items).toEqual(['x']);
	});

	it('returns empty array for empty iterations', () => {
		const result: LoopNodeResult = {
			iterations: [],
			totalIterations: 0,
			breakTriggered: false,
			executionMode: 'sequential'
		};

		expect(extractIterationItems(result)).toEqual([]);
	});
});

// ── Executor integration tests ────────────────────────────────────────────

describe('WorkflowExecutor — loop node integration', () => {
	let executor: WorkflowExecutor;

	beforeEach(() => {
		vi.clearAllMocks();
		executor = new WorkflowExecutor();
	});

	it('iterates over array in sequential mode with default variable names', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createLoopNode('loop1', {
				iteratorExpression: 'n1.items',
				executionMode: 'sequential'
			})
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);
		const input = { items: ['a', 'b', 'c'] };

		const result = await executor.execute(def, input);

		expect(result.status).toBe('completed');
		const loopResult = result.stepResults!['loop1'] as LoopNodeResult;
		expect(loopResult.totalIterations).toBe(3);
		expect(loopResult.executionMode).toBe('sequential');
		expect(loopResult.iterations).toHaveLength(3);
	});

	it('binds iteration variable and index variable', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createLoopNode('loop1', {
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
		const loopResult = result.stepResults!['loop1'] as LoopNodeResult;
		expect(loopResult.iterations[0]).toMatchObject({
			currentItem: 'x',
			idx: 0
		});
		expect(loopResult.iterations[1]).toMatchObject({
			currentItem: 'y',
			idx: 1
		});
	});

	it('respects maxIterations cap', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createLoopNode('loop1', {
				iteratorExpression: 'n1.items',
				maxIterations: 2
			})
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);
		const input = { items: ['a', 'b', 'c', 'd', 'e'] };

		const result = await executor.execute(def, input);

		expect(result.status).toBe('completed');
		const loopResult = result.stepResults!['loop1'] as LoopNodeResult;
		expect(loopResult.totalIterations).toBe(2);
	});

	it('supports breakCondition for early exit', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createLoopNode('loop1', {
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
		const loopResult = result.stepResults!['loop1'] as LoopNodeResult;
		// 1 and 3 pass the condition (<=5), 6 triggers break
		expect(loopResult.totalIterations).toBe(2);
		expect(loopResult.breakTriggered).toBe(true);
	});

	it('supports parallel execution mode', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createLoopNode('loop1', {
				iteratorExpression: 'n1.numbers',
				executionMode: 'parallel'
			})
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);
		const input = { numbers: [1, 2, 3] };

		const result = await executor.execute(def, input);

		expect(result.status).toBe('completed');
		const loopResult = result.stepResults!['loop1'] as LoopNodeResult;
		expect(loopResult.totalIterations).toBe(3);
		expect(loopResult.executionMode).toBe('parallel');
	});

	it('handles empty array gracefully', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createLoopNode('loop1', { iteratorExpression: 'n1.items' })
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);

		const result = await executor.execute(def, { items: [] });

		expect(result.status).toBe('completed');
		const loopResult = result.stepResults!['loop1'] as LoopNodeResult;
		expect(loopResult.totalIterations).toBe(0);
		expect(loopResult.breakTriggered).toBe(false);
	});

	it('fails when iteratorExpression is missing', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'loop1', type: 'loop', position: { x: 0, y: 0 }, data: {} }
		];
		const def = makeDefinition(nodes, []);

		const result = await executor.execute(def, {});

		expect(result.status).toBe('failed');
		expect(result.error).toContain('iteratorExpression');
	});

	it('fails when iteratorExpression does not resolve to an array', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createLoopNode('loop1', { iteratorExpression: 'n1.notAnArray' })
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);

		const result = await executor.execute(def, { notAnArray: 'string value' });

		expect(result.status).toBe('failed');
		expect(result.error).toContain('array');
	});

	it('extractIterationItems works with loop executor output', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createLoopNode('loop1', {
				iteratorExpression: 'n1.values',
				iterationVariable: 'val'
			})
		];
		const edges = [makeEdge('n1', 'loop1')];
		const def = makeDefinition(nodes, edges);
		const input = { values: ['first', 'second'] };

		const result = await executor.execute(def, input);
		const loopResult = result.stepResults!['loop1'] as LoopNodeResult;

		const items = extractIterationItems(loopResult, 'val');
		expect(items).toEqual(['first', 'second']);
	});
});
