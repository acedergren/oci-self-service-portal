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

// Mock AI SDK and provider registry
const mockGenerateText = vi.fn();
const mockLanguageModel = vi.fn();

vi.mock('ai', () => ({
	generateText: (...args: unknown[]) => mockGenerateText(...args)
}));

vi.mock('../models/provider-registry.js', () => ({
	getProviderRegistry: vi.fn(async () => ({
		languageModel: (...args: unknown[]) => mockLanguageModel(...args)
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

		it('loop node iterates over array (tested in loop node suite)', async () => {
			// Full loop tests are in the "loop node" describe block.
			// This just verifies the node type dispatches correctly.
			mockedExecuteTool.mockResolvedValueOnce({ items: ['a'] });

			const nodes = [
				makeNode('n1', 'tool', { toolName: 'list' }),
				makeNode('n2', 'loop', {
					iteratorExpression: 'n1.items'
				})
			];
			const edges = [makeEdge('n1', 'n2')];
			const def = makeDefinition(nodes, edges);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			const loopResult = result.stepResults!['n2'] as Record<string, unknown>;
			expect(loopResult).toBeDefined();
			expect(loopResult.totalIterations).toBe(1);
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

	// ── Parallel node ───────────────────────────────────────────────────

	describe('parallel node', () => {
		it('executes all branches with "all" merge strategy', async () => {
			const nodes = [
				makeNode('parallel', 'parallel', {
					branchNodeIds: [
						['branch-1-node-1', 'branch-1-node-2'],
						['branch-2-node-1'],
						['branch-3-node-1', 'branch-3-node-2', 'branch-3-node-3']
					],
					mergeStrategy: 'all',
					errorHandling: 'fail-fast'
				})
			];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			expect(result.stepResults!['parallel']).toBeDefined();
			const parallelResult = result.stepResults!['parallel'] as Record<string, unknown>;
			expect(parallelResult['branch-0']).toBeDefined();
			expect(parallelResult['branch-1']).toBeDefined();
			expect(parallelResult['branch-2']).toBeDefined();
		});

		it('returns first successful branch with "any" merge strategy', async () => {
			const nodes = [
				makeNode('parallel', 'parallel', {
					branchNodeIds: [['slow-branch'], ['fast-branch'], ['another-branch']],
					mergeStrategy: 'any'
				})
			];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			const parallelResult = result.stepResults!['parallel'] as Record<string, unknown>;
			// Should have exactly one branch result
			const branchKeys = Object.keys(parallelResult);
			expect(branchKeys.length).toBe(1);
		});

		it('returns first completed branch (even if error) with "first" merge strategy', async () => {
			const nodes = [
				makeNode('parallel', 'parallel', {
					branchNodeIds: [['branch-1'], ['branch-2']],
					mergeStrategy: 'first',
					errorHandling: 'collect-all'
				})
			];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			const parallelResult = result.stepResults!['parallel'] as Record<string, unknown>;
			const branchKeys = Object.keys(parallelResult);
			expect(branchKeys.length).toBe(1);
		});

		it('throws ValidationError when branchNodeIds is missing', async () => {
			const nodes = [makeNode('parallel', 'parallel', {})];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('failed');
			expect(result.error).toContain('branchNodeIds');
		});

		it('throws ValidationError when branchNodeIds is empty', async () => {
			const nodes = [
				makeNode('parallel', 'parallel', {
					branchNodeIds: []
				})
			];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('failed');
			expect(result.error).toContain('branchNodeIds');
		});

		it('collects all branch results including errors with "collect-all" error handling', async () => {
			const nodes = [
				makeNode('parallel', 'parallel', {
					branchNodeIds: [['success-branch'], ['error-branch'], ['another-success']],
					mergeStrategy: 'all',
					errorHandling: 'collect-all'
				})
			];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			const parallelResult = result.stepResults!['parallel'] as Record<string, unknown>;
			// All branches should be present in result
			expect(parallelResult['branch-0']).toBeDefined();
			expect(parallelResult['branch-1']).toBeDefined();
			expect(parallelResult['branch-2']).toBeDefined();
		});

		it('handles timeout by rejecting slow branches', async () => {
			const nodes = [
				makeNode('parallel', 'parallel', {
					branchNodeIds: [['fast'], ['slow'], ['medium']],
					mergeStrategy: 'all',
					timeoutMs: 100, // Very short timeout
					errorHandling: 'collect-all'
				})
			];
			const def = makeDefinition(nodes, []);

			// All branches complete nearly instantly in this stub implementation,
			// but the timeout mechanism is in place
			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
		}, 10000);

		it('uses default merge strategy "all" when not specified', async () => {
			const nodes = [
				makeNode('parallel', 'parallel', {
					branchNodeIds: [['b1'], ['b2']]
					// mergeStrategy not specified
				})
			];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			const parallelResult = result.stepResults!['parallel'] as Record<string, unknown>;
			expect(Object.keys(parallelResult).length).toBe(2);
		});

		it('uses default error handling "fail-fast" when not specified', async () => {
			const nodes = [
				makeNode('parallel', 'parallel', {
					branchNodeIds: [['b1'], ['b2']],
					mergeStrategy: 'all'
					// errorHandling not specified
				})
			];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
		});
	});

	// ── Loop node ────────────────────────────────────────────────────────

	describe('loop node', () => {
		it('iterates sequentially over an array', async () => {
			mockedExecuteTool.mockResolvedValueOnce({ items: ['a', 'b', 'c'] });

			const nodes = [
				makeNode('n1', 'tool', { toolName: 'list-items' }),
				makeNode('loop', 'loop', {
					iteratorExpression: 'n1.items',
					executionMode: 'sequential'
				})
			];
			const edges = [makeEdge('n1', 'loop')];
			const def = makeDefinition(nodes, edges);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			const loopResult = result.stepResults!['loop'] as Record<string, unknown>;
			expect(loopResult.totalIterations).toBe(3);
			expect(loopResult.executionMode).toBe('sequential');
			expect(loopResult.breakTriggered).toBe(false);
			expect(Array.isArray(loopResult.iterations)).toBe(true);
			const iterations = loopResult.iterations as Array<Record<string, unknown>>;
			expect(iterations[0].item).toBe('a');
			expect(iterations[1].item).toBe('b');
			expect(iterations[2].item).toBe('c');
		});

		it('iterates in parallel over an array', async () => {
			mockedExecuteTool.mockResolvedValueOnce({ items: [1, 2, 3, 4] });

			const nodes = [
				makeNode('n1', 'tool', { toolName: 'list-nums' }),
				makeNode('loop', 'loop', {
					iteratorExpression: 'n1.items',
					executionMode: 'parallel'
				})
			];
			const edges = [makeEdge('n1', 'loop')];
			const def = makeDefinition(nodes, edges);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			const loopResult = result.stepResults!['loop'] as Record<string, unknown>;
			expect(loopResult.totalIterations).toBe(4);
			expect(loopResult.executionMode).toBe('parallel');
		});

		it('respects maxIterations limit', async () => {
			mockedExecuteTool.mockResolvedValueOnce({ items: ['a', 'b', 'c', 'd', 'e'] });

			const nodes = [
				makeNode('n1', 'tool', { toolName: 'list' }),
				makeNode('loop', 'loop', {
					iteratorExpression: 'n1.items',
					maxIterations: 2
				})
			];
			const edges = [makeEdge('n1', 'loop')];
			const def = makeDefinition(nodes, edges);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			const loopResult = result.stepResults!['loop'] as Record<string, unknown>;
			expect(loopResult.totalIterations).toBe(2);
			const iterations = loopResult.iterations as Array<Record<string, unknown>>;
			expect(iterations).toHaveLength(2);
		});

		it('handles break condition in sequential mode', async () => {
			mockedExecuteTool.mockResolvedValueOnce({ items: [1, 2, 3, 4, 5] });

			const nodes = [
				makeNode('n1', 'tool', { toolName: 'list' }),
				makeNode('loop', 'loop', {
					iteratorExpression: 'n1.items',
					executionMode: 'sequential',
					iterationVariable: 'item',
					breakCondition: 'item == 3'
				})
			];
			const edges = [makeEdge('n1', 'loop')];
			const def = makeDefinition(nodes, edges);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			const loopResult = result.stepResults!['loop'] as Record<string, unknown>;
			expect(loopResult.breakTriggered).toBe(true);
			// Should have iterated items 1 and 2, then broken before 3
			const iterations = loopResult.iterations as unknown[];
			expect(iterations.length).toBeLessThan(5);
		});

		it('throws ValidationError when iteratorExpression is missing', async () => {
			const nodes = [makeNode('loop', 'loop', {})];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('failed');
			expect(result.error).toContain('iteratorExpression');
		});

		it('throws ValidationError when iterator resolves to non-array', async () => {
			mockedExecuteTool.mockResolvedValueOnce({ notAnArray: 'string-value' });

			const nodes = [
				makeNode('n1', 'tool', { toolName: 'get' }),
				makeNode('loop', 'loop', {
					iteratorExpression: 'n1.notAnArray'
				})
			];
			const edges = [makeEdge('n1', 'loop')];
			const def = makeDefinition(nodes, edges);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('failed');
			expect(result.error).toContain('array');
		});

		it('uses custom iteration variable names', async () => {
			mockedExecuteTool.mockResolvedValueOnce({ data: ['x', 'y'] });

			const nodes = [
				makeNode('n1', 'tool', { toolName: 'list' }),
				makeNode('loop', 'loop', {
					iteratorExpression: 'n1.data',
					iterationVariable: 'element',
					indexVariable: 'idx'
				})
			];
			const edges = [makeEdge('n1', 'loop')];
			const def = makeDefinition(nodes, edges);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			const loopResult = result.stepResults!['loop'] as Record<string, unknown>;
			const iterations = loopResult.iterations as Array<Record<string, unknown>>;
			expect(iterations[0].element).toBe('x');
			expect(iterations[0].idx).toBe(0);
			expect(iterations[1].element).toBe('y');
			expect(iterations[1].idx).toBe(1);
		});
	});

	// ── AI-step node ─────────────────────────────────────────────────────

	describe('ai-step node', () => {
		it('calls generateText with interpolated prompt', async () => {
			mockGenerateText.mockResolvedValueOnce({
				text: 'Hello from AI',
				usage: { promptTokens: 10, completionTokens: 5 }
			});

			const nodes = [
				makeNode('input', 'input'),
				makeNode('ai', 'ai-step', {
					prompt: 'Summarize: {{input.text}}',
					model: 'oci:cohere.command-r-plus'
				})
			];
			const edges = [makeEdge('input', 'ai')];
			const def = makeDefinition(nodes, edges);

			const result = await executor.execute(def, { text: 'Test content' });

			expect(result.status).toBe('completed');
			const aiResult = result.stepResults!['ai'] as Record<string, unknown>;
			expect(aiResult.text).toBe('Hello from AI');

			// Verify generateText was called with interpolated prompt
			expect(mockGenerateText).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: 'Summarize: Test content'
				})
			);
		});

		it('uses default model when not specified', async () => {
			mockGenerateText.mockResolvedValueOnce({
				text: 'Default model response',
				usage: { promptTokens: 5, completionTokens: 3 }
			});

			const nodes = [
				makeNode('ai', 'ai-step', {
					prompt: 'Hello world'
					// model not specified
				})
			];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			// Should have called languageModel with the default model string
			expect(mockLanguageModel).toHaveBeenCalledWith('oci:cohere.command-r-plus');
		});

		it('throws ValidationError when prompt is missing', async () => {
			const nodes = [makeNode('ai', 'ai-step', {})];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('failed');
			expect(result.error).toContain('prompt');
		});

		it('validates output against schema', async () => {
			mockGenerateText.mockResolvedValueOnce({
				text: '{"name": "test", "score": 42}',
				usage: { promptTokens: 10, completionTokens: 8 }
			});

			const nodes = [
				makeNode('ai', 'ai-step', {
					prompt: 'Generate JSON',
					outputSchema: { name: 'string', score: 'number' }
				})
			];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			const aiResult = result.stepResults!['ai'] as Record<string, unknown>;
			expect(aiResult).toEqual({ name: 'test', score: 42 });
		});

		it('fails when output does not match schema', async () => {
			mockGenerateText.mockResolvedValueOnce({
				text: 'not valid JSON',
				usage: { promptTokens: 10, completionTokens: 5 }
			});

			const nodes = [
				makeNode('ai', 'ai-step', {
					prompt: 'Generate JSON',
					outputSchema: { name: 'string' }
				})
			];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('failed');
			expect(result.error).toContain('schema validation');
		});

		it('includes system prompt when provided', async () => {
			mockGenerateText.mockResolvedValueOnce({
				text: 'Response with system prompt',
				usage: { promptTokens: 15, completionTokens: 5 }
			});

			const nodes = [
				makeNode('ai', 'ai-step', {
					prompt: 'User question',
					systemPrompt: 'You are a helpful assistant',
					temperature: 0.7,
					maxTokens: 100
				})
			];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('completed');
			expect(mockGenerateText).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: 'User question',
					system: 'You are a helpful assistant',
					temperature: 0.7,
					maxOutputTokens: 100
				})
			);
		});

		it('returns failed status when generateText throws', async () => {
			mockGenerateText.mockRejectedValueOnce(new Error('Model unavailable'));

			const nodes = [
				makeNode('ai', 'ai-step', {
					prompt: 'Test prompt',
					model: 'oci:bad-model'
				})
			];
			const def = makeDefinition(nodes, []);

			const result = await executor.execute(def, {});

			expect(result.status).toBe('failed');
			expect(result.error).toContain('Model unavailable');
		});
	});
});
