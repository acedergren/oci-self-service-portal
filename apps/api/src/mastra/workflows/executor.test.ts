import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '@portal/shared/workflows';
import { ValidationError } from '@portal/shared/workflows';

// Mock executeTool before importing executor
vi.mock('../tools/registry.js', () => ({
	executeTool: vi.fn(async (toolName: string, args: Record<string, unknown>) => ({
		toolName,
		args,
		result: `result-of-${toolName}`
	}))
}));

import { WorkflowExecutor } from './executor.js';
import { executeTool } from '../tools/registry.js';

const mockedExecuteTool = vi.mocked(executeTool);

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

describe('WorkflowExecutor', () => {
	let executor: WorkflowExecutor;

	beforeEach(() => {
		vi.clearAllMocks();
		executor = new WorkflowExecutor();
	});

	// ── execute() ───────────────────────────────────────────────────────

	describe('execute', () => {
		it('executes a linear input → tool → output workflow', async () => {
			const nodes = [
				makeNode('n1', 'input'),
				makeNode('n2', 'tool', {
					toolName: 'list-instances',
					args: { limit: 10 }
				}),
				makeNode('n3', 'output', { outputMapping: { result: 'n2.result' } })
			];
			const edges = [makeEdge('n1', 'n2'), makeEdge('n2', 'n3')];
			const def = makeDefinition(nodes, edges);

			const result = await executor.execute(def, { compartmentId: 'comp-1' });

			expect(result.status).toBe('completed');
			expect(result.stepResults).toBeDefined();
			expect(result.stepResults!['n1']).toEqual({ compartmentId: 'comp-1' });
			expect(mockedExecuteTool).toHaveBeenCalledWith('list-instances', {
				limit: 10
			});
		});

		it('throws ValidationError on cyclic graph', async () => {
			const nodes = [
				makeNode('a', 'tool', { toolName: 't1' }),
				makeNode('b', 'tool', { toolName: 't2' })
			];
			const edges = [makeEdge('a', 'b'), makeEdge('b', 'a')];
			const def = makeDefinition(nodes, edges);

			await expect(executor.execute(def, {})).rejects.toThrow(ValidationError);
			await expect(executor.execute(def, {})).rejects.toThrow('cycle');
		});

		it('handles empty workflow (no nodes)', async () => {
			const def = makeDefinition([], []);
			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			expect(result.stepResults).toEqual({});
		});
	});

	// ── Node types ──────────────────────────────────────────────────────

	describe('node types', () => {
		it('input node passes through input data', async () => {
			const nodes = [makeNode('n1', 'input')];
			const def = makeDefinition(nodes, []);
			const input = { key: 'value' };

			const result = await executor.execute(def, input);

			expect(result.status).toBe('completed');
			expect(result.stepResults!['n1']).toEqual(input);
		});

		it('tool node calls executeTool with args', async () => {
			const nodes = [
				makeNode('n1', 'tool', {
					toolName: 'create-vcn',
					args: { cidrBlock: '10.0.0.0/16' }
				})
			];
			const def = makeDefinition(nodes, []);

			await executor.execute(def, {});

			expect(mockedExecuteTool).toHaveBeenCalledWith('create-vcn', {
				cidrBlock: '10.0.0.0/16'
			});
		});

		it('tool node throws ValidationError when toolName is missing', async () => {
			const nodes = [makeNode('n1', 'tool', {})];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('failed');
			expect(result.error).toContain('toolName');
		});

		it('approval node suspends execution', async () => {
			const nodes = [
				makeNode('n1', 'input'),
				makeNode('n2', 'approval'),
				makeNode('n3', 'tool', { toolName: 'delete-vcn' })
			];
			const edges = [makeEdge('n1', 'n2'), makeEdge('n2', 'n3')];
			const def = makeDefinition(nodes, edges);

			const result = await executor.execute(def, { vcnId: 'id-1' });

			expect(result.status).toBe('suspended');
			expect(result.engineState).toBeDefined();
			expect(result.engineState!.suspendedAtNodeId).toBe('n2');
			// Tool after approval should NOT have been called
			expect(mockedExecuteTool).not.toHaveBeenCalled();
		});

		it('output node with outputMapping resolves paths', async () => {
			mockedExecuteTool.mockResolvedValueOnce({ data: { id: 'abc' } });

			const nodes = [
				makeNode('n1', 'tool', { toolName: 'get-instance' }),
				makeNode('n2', 'output', {
					outputMapping: { instanceId: 'n1.data.id' }
				})
			];
			const edges = [makeEdge('n1', 'n2')];
			const def = makeDefinition(nodes, edges);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			expect(result.output).toEqual({ instanceId: 'abc' });
		});

		it('output node without outputMapping returns all stepResults', async () => {
			const nodes = [makeNode('n1', 'input'), makeNode('n2', 'output')];
			const edges = [makeEdge('n1', 'n2')];
			const def = makeDefinition(nodes, edges);

			const result = await executor.execute(def, { x: 1 });

			expect(result.status).toBe('completed');
			// Output captures all stepResults when no mapping is defined
			expect(result.output).toBeDefined();
		});

		it('condition node skips false branch', async () => {
			mockedExecuteTool.mockResolvedValueOnce({ status: 'ok' });

			const nodes = [
				makeNode('n1', 'tool', { toolName: 'check' }),
				makeNode('cond', 'condition', {
					expression: 'result.status == "ok"',
					trueBranch: 'n-true',
					falseBranch: 'n-false'
				}),
				makeNode('n-true', 'tool', { toolName: 'true-tool' }),
				makeNode('n-false', 'tool', { toolName: 'false-tool' })
			];
			const edges = [
				makeEdge('n1', 'cond'),
				makeEdge('cond', 'n-true'),
				makeEdge('cond', 'n-false')
			];
			const def = makeDefinition(nodes, edges);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			// true-tool should have been called, false-tool should NOT
			const callArgs = mockedExecuteTool.mock.calls.map((c) => c[0]);
			expect(callArgs).toContain('check');
			expect(callArgs).toContain('true-tool');
			expect(callArgs).not.toContain('false-tool');
		});

		it('condition node throws when expression is missing', async () => {
			const nodes = [makeNode('cond', 'condition', {})];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('failed');
			expect(result.error).toContain('expression');
		});

		it('unimplemented node types (ai-step, loop, parallel) return null', async () => {
			const nodes = [makeNode('n1', 'ai-step'), makeNode('n2', 'loop'), makeNode('n3', 'parallel')];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			expect(result.stepResults!['n1']).toBeNull();
			expect(result.stepResults!['n2']).toBeNull();
			expect(result.stepResults!['n3']).toBeNull();
		});
	});

	// ── resume() ────────────────────────────────────────────────────────

	describe('resume', () => {
		it('resumes after approval node and completes remaining nodes', async () => {
			const nodes = [
				makeNode('n1', 'input'),
				makeNode('n2', 'approval'),
				makeNode('n3', 'tool', { toolName: 'delete-vcn', args: {} }),
				makeNode('n4', 'output')
			];
			const edges = [makeEdge('n1', 'n2'), makeEdge('n2', 'n3'), makeEdge('n3', 'n4')];
			const def = makeDefinition(nodes, edges);

			// First execute — suspends at n2
			const suspended = await executor.execute(def, { vcnId: 'id-1' });
			expect(suspended.status).toBe('suspended');
			expect(suspended.engineState).toBeDefined();

			// Resume — should skip n1 and n2, execute n3 and n4
			const resumed = await executor.resume(def, suspended.engineState!, {
				vcnId: 'id-1'
			});

			expect(resumed.status).toBe('completed');
			expect(mockedExecuteTool).toHaveBeenCalledWith('delete-vcn', {});
		});
	});

	// ── DoS prevention ─────────────────────────────────────────────────

	describe('DoS prevention', () => {
		it('fails when exceeding MAX_STEPS (50)', async () => {
			// Create 51 tool nodes (exceeds limit of 50)
			const nodes: WorkflowNode[] = [];
			const edges: WorkflowEdge[] = [];

			for (let i = 0; i < 51; i++) {
				nodes.push(makeNode(`n${i}`, 'tool', { toolName: `tool-${i}` }));
				if (i > 0) {
					edges.push(makeEdge(`n${i - 1}`, `n${i}`));
				}
			}

			const def = makeDefinition(nodes, edges);
			const result = await executor.execute(def, {});

			expect(result.status).toBe('failed');
			expect(result.error).toContain('maximum step limit');
		});
	});

	// ── Error handling ─────────────────────────────────────────────────

	describe('error handling', () => {
		it('returns failed status when executeTool throws', async () => {
			mockedExecuteTool.mockRejectedValueOnce(new Error('OCI CLI error: 404'));

			const nodes = [makeNode('n1', 'tool', { toolName: 'get-missing' })];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('failed');
			expect(result.error).toContain('OCI CLI error: 404');
		});
	});
});
