import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	WorkflowExecutor,
	type WorkflowExecutorOptions,
	type AIStepHandlerPayload,
	type LoopIterationContext,
	type ParallelBranchContext
} from './executor';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '../../workflows/types';

const TIMESTAMP = new Date('2024-01-01T00:00:00.000Z');

describe('WorkflowExecutor advanced nodes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('runs ai-step nodes via agent adapter and stores result in stepResults', async () => {
		const aiHandler = vi
			.fn<[AIStepHandlerPayload], Promise<{ summary: string; tokens: number }>>()
			.mockResolvedValue({
				summary: 'ok',
				tokens: 12
			});

		const exec = buildExecutor({ aiStepHandler: aiHandler });
		const result = await exec.run(buildDefinitionWithAIStep(), buildInput());

		expect(result).toMatchObject({
			output: { aiSummary: 'ok' },
			stepResults: expect.objectContaining({ aiStep1: expect.any(Object) })
		});
		expect(aiHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				nodeId: 'aiStep1',
				temperature: 0.2,
				prompt: 'Summarize signal a and b'
			})
		);
	});

	it('executes loop nodes with retries and break expressions', async () => {
		const exec = buildExecutor({ loopHandler: flakyLoopHandler({ failTimes: 1 }) });
		await expect(exec.run(buildLoopDefinition(), buildInput())).resolves.toMatchObject({
			output: { items: ['a', 'b'] }
		});
	});

	it('executes parallel branches concurrently and merges outputs', async () => {
		const exec = buildExecutor({ parallelHandler: parallelHandler() });
		await expect(exec.run(buildParallelDefinition(), buildInput())).resolves.toMatchObject({
			output: { branchA: 'done', branchB: 'done' }
		});
	});
});

function buildExecutor(overrides: Partial<WorkflowExecutorOptions> = {}): WorkflowExecutor {
	return new WorkflowExecutor({
		maxSteps: 100,
		maxDurationMs: 30_000,
		now: () => 0,
		wait: async () => {},
		...overrides
	});
}

function buildDefinitionWithAIStep(): WorkflowDefinition {
	const nodes: WorkflowNode[] = [
		createNode('input1', 'input', { fields: [] }),
		createNode('aiStep1', 'ai-step', {
			prompt: 'Summarize signal {{input1.payload.signal}}',
			temperature: 0.2
		}),
		createNode('output1', 'output', {
			outputMapping: {
				aiSummary: 'aiStep1.summary'
			}
		})
	];

	const edges = createLinearEdges(['input1', 'aiStep1', 'output1']);

	return buildDefinition(nodes, edges);
}

function buildLoopDefinition(): WorkflowDefinition {
	const nodes: WorkflowNode[] = [
		createNode('input1', 'input', { fields: [] }),
		createNode('loop1', 'loop', {
			iteratorExpression: 'input1.payload.items',
			iterationVariable: 'item',
			indexVariable: 'idx',
			breakCondition: 'item === "stop"'
		}),
		createNode('output1', 'output', {
			outputMapping: {
				items: 'loop1.items'
			}
		})
	];

	return buildDefinition(nodes, createLinearEdges(['input1', 'loop1', 'output1']));
}

function buildParallelDefinition(): WorkflowDefinition {
	const nodes: WorkflowNode[] = [
		createNode('input1', 'input', { fields: [] }),
		createNode('parallel1', 'parallel', {
			branchNodeIds: [['branchA'], ['branchB']],
			mergeStrategy: 'all'
		}),
		createNode('output1', 'output', {
			outputMapping: {
				branchA: 'parallel1.branches.branchA',
				branchB: 'parallel1.branches.branchB'
			}
		})
	];

	return buildDefinition(nodes, createLinearEdges(['input1', 'parallel1', 'output1']));
}

function buildDefinition(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDefinition {
	return {
		id: 'wf-' + nodes[1]?.id,
		name: 'test-workflow',
		status: 'draft',
		version: 1,
		nodes,
		edges,
		createdAt: TIMESTAMP,
		updatedAt: TIMESTAMP
	};
}

function createNode(
	id: string,
	type: WorkflowNode['type'],
	data: Record<string, unknown>
): WorkflowNode {
	return {
		id,
		type,
		label: id,
		position: { x: 0, y: 0 },
		data
	};
}

function createLinearEdges(order: string[]): WorkflowEdge[] {
	const edges: WorkflowEdge[] = [];
	for (let i = 0; i < order.length - 1; i++) {
		edges.push({
			id: `edge-${order[i]}-${order[i + 1]}`,
			source: order[i],
			target: order[i + 1]
		});
	}
	return edges;
}

function buildInput(): Record<string, unknown> {
	return {
		payload: {
			signal: 'a and b',
			items: ['a', 'b', 'stop']
		}
	};
}

function flakyLoopHandler({ failTimes }: { failTimes: number }) {
	let attempts = 0;

	return vi.fn(async ({ item }: LoopIterationContext) => {
		if (attempts < failTimes) {
			attempts += 1;
			throw new Error('temporary failure');
		}
		return item;
	});
}

function parallelHandler() {
	return vi.fn(async ({ branchKey: _branchKey }: ParallelBranchContext) => `done`);
}
