/**
 * AI Step Node Tests
 *
 * Tests the ai-step workflow node factory helpers and integration
 * with the WorkflowExecutor. Verifies:
 * - createAIStepNode factory builds valid WorkflowNode structs
 * - buildPromptTemplate variable injection
 * - isAIStepTextResult type guard
 * - Executor calls generateText with the correct parameters
 * - Output schema validation path
 * - Variable interpolation from stepResults
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '@portal/shared/workflows';
import {
	createAIStepNode,
	buildPromptTemplate,
	isAIStepTextResult,
	type AIStepTextResult
} from '../../mastra/workflows/nodes/ai-step.js';

// Mock executeTool (needed by WorkflowExecutor even for ai-step tests)
vi.mock('../../mastra/tools/registry.js', () => ({
	executeTool: vi.fn(async (toolName: string, args: Record<string, unknown>) => ({
		toolName,
		args,
		result: `result-of-${toolName}`
	}))
}));

// Mock the provider registry
const mockLanguageModel = vi.fn();
vi.mock('../../mastra/models/provider-registry.js', () => ({
	getProviderRegistry: vi.fn((...args: unknown[]) => mockGetProviderRegistry(...args))
}));
const mockGetProviderRegistry = vi.fn();

// Mock generateText from the 'ai' package
const mockGenerateText = vi.fn();
vi.mock('ai', () => ({
	generateText: (...args: unknown[]) => mockGenerateText(...args)
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

// ── Tests ────────────────────────────────────────────────────────────────

describe('createAIStepNode', () => {
	it('creates a node with type ai-step and correct data', () => {
		const node = createAIStepNode('summarize-1', {
			prompt: 'Summarize these instances: {{listInstances.data}}',
			systemPrompt: 'You are a cloud advisor.',
			model: 'oci:cohere.command-r-plus',
			temperature: 0.2,
			maxTokens: 500
		});

		expect(node.id).toBe('summarize-1');
		expect(node.type).toBe('ai-step');
		expect(node.data.prompt).toBe('Summarize these instances: {{listInstances.data}}');
		expect(node.data.systemPrompt).toBe('You are a cloud advisor.');
		expect(node.data.model).toBe('oci:cohere.command-r-plus');
		expect(node.data.temperature).toBe(0.2);
		expect(node.data.maxTokens).toBe(500);
	});

	it('defaults position to (0,0) when not specified', () => {
		const node = createAIStepNode('n1', { prompt: 'Hello' });

		expect(node.position).toEqual({ x: 0, y: 0 });
	});

	it('accepts custom position', () => {
		const node = createAIStepNode('n1', { prompt: 'Hello' }, { x: 100, y: 200 });

		expect(node.position).toEqual({ x: 100, y: 200 });
	});

	it('stores outputSchema in node data', () => {
		const schema = { summary: 'string', count: 'number' };
		const node = createAIStepNode('n1', { prompt: 'Test', outputSchema: schema });

		expect(node.data.outputSchema).toEqual(schema);
	});

	it('omits optional fields when not provided', () => {
		const node = createAIStepNode('n1', { prompt: 'Hello world' });

		expect(node.data.systemPrompt).toBeUndefined();
		expect(node.data.model).toBeUndefined();
		expect(node.data.temperature).toBeUndefined();
		expect(node.data.maxTokens).toBeUndefined();
		expect(node.data.outputSchema).toBeUndefined();
	});
});

describe('buildPromptTemplate', () => {
	it('returns base prompt unchanged when no variables given', () => {
		const result = buildPromptTemplate('Analyze OCI costs', {});

		expect(result).toBe('Analyze OCI costs');
	});

	it('appends variable placeholders to the base prompt', () => {
		const result = buildPromptTemplate('Analyze the following:', {
			instances: 'listInstances.data',
			region: 'input.region'
		});

		expect(result).toContain('{{listInstances.data}}');
		expect(result).toContain('{{input.region}}');
		expect(result).toContain('instances:');
		expect(result).toContain('region:');
	});

	it('separates base prompt and variables with newline', () => {
		const result = buildPromptTemplate('Base', { key: 'path.to.value' });

		expect(result.startsWith('Base\n')).toBe(true);
	});
});

describe('isAIStepTextResult', () => {
	it('returns true for objects with a text property', () => {
		const result: AIStepTextResult = { text: 'Hello world', usage: {} };

		expect(isAIStepTextResult(result)).toBe(true);
	});

	it('returns false for objects without a text property', () => {
		expect(isAIStepTextResult({ summary: 'text' })).toBe(false);
	});

	it('returns false for non-objects', () => {
		expect(isAIStepTextResult('string')).toBe(false);
		expect(isAIStepTextResult(null)).toBe(false);
		expect(isAIStepTextResult(42)).toBe(false);
	});

	it('returns false when text is not a string', () => {
		expect(isAIStepTextResult({ text: 42 })).toBe(false);
	});
});

describe('WorkflowExecutor — ai-step node integration', () => {
	let executor: WorkflowExecutor;

	beforeEach(() => {
		vi.clearAllMocks();
		executor = new WorkflowExecutor();

		// Set up provider registry mock to return a model function
		mockGetProviderRegistry.mockResolvedValue({
			languageModel: mockLanguageModel.mockReturnValue('fake-model')
		});

		// Default: generateText returns a text response
		mockGenerateText.mockResolvedValue({
			text: 'This is the AI response.',
			usage: { promptTokens: 10, completionTokens: 20 }
		});
	});

	it('executes ai-step node and returns text result', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createAIStepNode('ai1', { prompt: 'Analyze the input data' })
		];
		const edges = [makeEdge('n1', 'ai1')];
		const def = makeDefinition(nodes, edges);

		const result = await executor.execute(def, { value: 42 });

		expect(result.status).toBe('completed');
		const aiResult = result.stepResults!['ai1'] as AIStepTextResult;
		expect(isAIStepTextResult(aiResult)).toBe(true);
		expect(aiResult.text).toBe('This is the AI response.');
	});

	it('calls generateText with the configured prompt', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createAIStepNode('ai1', { prompt: 'List compute instances' })
		];
		const def = makeDefinition(nodes, [makeEdge('n1', 'ai1')]);

		await executor.execute(def, {});

		expect(mockGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({ prompt: 'List compute instances' })
		);
	});

	it('interpolates {{nodeId.path}} variables from stepResults', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createAIStepNode('ai1', { prompt: 'The region is {{n1.region}}' })
		];
		const def = makeDefinition(nodes, [makeEdge('n1', 'ai1')]);

		await executor.execute(def, { region: 'us-phoenix-1' });

		expect(mockGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({ prompt: 'The region is us-phoenix-1' })
		);
	});

	it('passes systemPrompt when configured', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createAIStepNode('ai1', {
				prompt: 'Analyze',
				systemPrompt: 'You are an expert.'
			})
		];
		const def = makeDefinition(nodes, [makeEdge('n1', 'ai1')]);

		await executor.execute(def, {});

		expect(mockGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({ system: 'You are an expert.' })
		);
	});

	it('fails workflow when ai-step is missing prompt', async () => {
		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			{ id: 'ai1', type: 'ai-step', position: { x: 0, y: 0 }, data: {} }
		];
		const def = makeDefinition(nodes, [makeEdge('n1', 'ai1')]);

		const result = await executor.execute(def, {});

		expect(result.status).toBe('failed');
		expect(result.error).toContain('prompt');
	});

	it('validates outputSchema and returns structured JSON', async () => {
		mockGenerateText.mockResolvedValue({
			text: JSON.stringify({ summary: 'All good', count: 5 }),
			usage: {}
		});

		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createAIStepNode('ai1', {
				prompt: 'Summarize',
				outputSchema: { summary: 'string', count: 'number' }
			})
		];
		const def = makeDefinition(nodes, [makeEdge('n1', 'ai1')]);

		const result = await executor.execute(def, {});

		expect(result.status).toBe('completed');
		const aiResult = result.stepResults!['ai1'] as { summary: string; count: number };
		expect(aiResult.summary).toBe('All good');
		expect(aiResult.count).toBe(5);
	});

	it('fails workflow when outputSchema validation fails', async () => {
		// AI returns text that fails JSON.parse
		mockGenerateText.mockResolvedValue({ text: 'not valid json', usage: {} });

		const nodes: WorkflowNode[] = [
			{ id: 'n1', type: 'input', position: { x: 0, y: 0 }, data: {} },
			createAIStepNode('ai1', {
				prompt: 'Summarize',
				outputSchema: { summary: 'string' }
			})
		];
		const def = makeDefinition(nodes, [makeEdge('n1', 'ai1')]);

		const result = await executor.execute(def, {});

		expect(result.status).toBe('failed');
		expect(result.error).toContain('schema');
	});
});
