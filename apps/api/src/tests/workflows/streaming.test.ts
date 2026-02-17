import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { WorkflowNode } from '@portal/shared/workflows';
import {
	createStreamingWriter,
	createStreamingStepExecutor
} from '../../mastra/workflows/streaming.js';
import {
	subscribeWorkflowStream,
	clearWorkflowStreamState
} from '../../services/workflow-stream-bus.js';
import type { WorkflowStreamEvent } from '../../services/workflow-stream-bus.js';

describe('Workflow Streaming', () => {
	beforeEach(() => {
		clearWorkflowStreamState();
	});

	afterEach(() => {
		clearWorkflowStreamState();
	});

	describe('createStreamingWriter', () => {
		const runId = '13345678-1234-4123-8123-123456789012';
		const node: WorkflowNode = {
			id: 'aiStep1',
			type: 'ai-step',
			tool: 'cohere',
			position: { x: 0, y: 0 },
			connections: []
		};

		it('creates a writer function that accepts StreamingWriterEvent', async () => {
			const writer = createStreamingWriter(runId, node);
			expect(typeof writer).toBe('function');

			// Should not throw when called with valid event
			await writer({ type: 'token', text: 'hello' });
		});

		it('emits token events to the stream bus', async () => {
			const writer = createStreamingWriter(runId, node);
			const emittedEvents: WorkflowStreamEvent[] = [];

			const unsubscribe = subscribeWorkflowStream(runId, (event) => {
				emittedEvents.push(event);
			});

			await writer({ type: 'token', text: 'hello' });
			await writer({ type: 'token', text: ' world' });

			expect(emittedEvents).toHaveLength(2);
			expect(emittedEvents[0]).toMatchObject({
				type: 'step',
				runId,
				stage: 'start',
				nodeId: 'aiStep1',
				nodeType: 'ai-step'
			});
			expect(emittedEvents[0].payload).toMatchObject({
				partialOutput: 'hello',
				tokenCount: 5
			});
			expect(emittedEvents[1].payload).toMatchObject({
				partialOutput: 'hello world',
				tokenCount: 11
			});

			unsubscribe();
		});

		it('accumulates tokens in the buffer', async () => {
			const writer = createStreamingWriter(runId, node);
			const emittedEvents: WorkflowStreamEvent[] = [];

			const unsubscribe = subscribeWorkflowStream(runId, (event) => {
				emittedEvents.push(event);
			});

			await writer({ type: 'token', text: 'chunk1' });
			await writer({ type: 'token', text: 'chunk2' });
			await writer({ type: 'token', text: 'chunk3' });

			// Each event should have accumulated text
			expect(emittedEvents[0].payload).toMatchObject({ partialOutput: 'chunk1' });
			expect(emittedEvents[1].payload).toMatchObject({ partialOutput: 'chunk1chunk2' });
			expect(emittedEvents[2].payload).toMatchObject({ partialOutput: 'chunk1chunk2chunk3' });

			unsubscribe();
		});

		it('emits metadata events to the stream bus', async () => {
			const writer = createStreamingWriter(runId, node);
			const emittedEvents: WorkflowStreamEvent[] = [];

			const unsubscribe = subscribeWorkflowStream(runId, (event) => {
				emittedEvents.push(event);
			});

			const metadata = { usage: { tokens: 42 }, model: 'cohere.command-r-plus' };
			await writer({ type: 'metadata', metadata });

			expect(emittedEvents).toHaveLength(1);
			expect(emittedEvents[0]).toMatchObject({
				type: 'step',
				runId,
				stage: 'start',
				nodeId: 'aiStep1',
				nodeType: 'ai-step'
			});
			expect(emittedEvents[0].payload).toMatchObject({
				metadata
			});

			unsubscribe();
		});

		it('emits complete events with final output and resets buffer', async () => {
			const writer = createStreamingWriter(runId, node);
			const emittedEvents: WorkflowStreamEvent[] = [];

			const unsubscribe = subscribeWorkflowStream(runId, (event) => {
				emittedEvents.push(event);
			});

			await writer({ type: 'token', text: 'part1' });
			await writer({ type: 'token', text: 'part2' });
			await writer({ type: 'complete', result: { success: true } });

			// Should have 3 events: token, token, complete
			expect(emittedEvents).toHaveLength(3);

			const completeEvent = emittedEvents[2];
			expect(completeEvent).toMatchObject({
				type: 'step',
				runId,
				stage: 'complete',
				nodeId: 'aiStep1',
				nodeType: 'ai-step'
			});
			expect(completeEvent.payload).toMatchObject({
				result: { success: true },
				finalOutput: 'part1part2'
			});

			unsubscribe();
		});

		it('resets buffer after complete event', async () => {
			const writer = createStreamingWriter(runId, node);
			const emittedEvents: WorkflowStreamEvent[] = [];

			const unsubscribe = subscribeWorkflowStream(runId, (event) => {
				emittedEvents.push(event);
			});

			// First sequence
			await writer({ type: 'token', text: 'first' });
			await writer({ type: 'complete', result: null });

			// Second sequence should start with empty buffer
			await writer({ type: 'token', text: 'second' });

			// Events: [token 'first', complete, token 'second']
			expect(emittedEvents[1].payload).toMatchObject({ result: null, finalOutput: 'first' });
			expect(emittedEvents[2].payload).toMatchObject({ partialOutput: 'second' });

			unsubscribe();
		});

		it('emits error events', async () => {
			const writer = createStreamingWriter(runId, node);
			const emittedEvents: WorkflowStreamEvent[] = [];

			const unsubscribe = subscribeWorkflowStream(runId, (event) => {
				emittedEvents.push(event);
			});

			await writer({ type: 'token', text: 'partial' });
			await writer({ type: 'error', error: 'Model rate limited' });

			expect(emittedEvents).toHaveLength(2);
			expect(emittedEvents[1]).toMatchObject({
				type: 'step',
				runId,
				stage: 'error',
				nodeId: 'aiStep1',
				nodeType: 'ai-step'
			});
			expect(emittedEvents[1].payload).toMatchObject({
				error: 'Model rate limited'
			});

			unsubscribe();
		});

		it('resets buffer after error event', async () => {
			const writer = createStreamingWriter(runId, node);
			const emittedEvents: WorkflowStreamEvent[] = [];

			const unsubscribe = subscribeWorkflowStream(runId, (event) => {
				emittedEvents.push(event);
			});

			// First sequence with error
			await writer({ type: 'token', text: 'failed' });
			await writer({ type: 'error', error: 'timeout' });

			// Second sequence should have clean buffer
			await writer({ type: 'token', text: 'retry' });

			expect(emittedEvents[2].payload).toMatchObject({ partialOutput: 'retry' });

			unsubscribe();
		});

		it('handles multiple writers for different nodes', async () => {
			const node2: WorkflowNode = {
				id: 'toolStep2',
				type: 'tool-step',
				tool: 'search',
				position: { x: 100, y: 0 },
				connections: []
			};

			const writer1 = createStreamingWriter(runId, node);
			const writer2 = createStreamingWriter(runId, node2);
			const emittedEvents: WorkflowStreamEvent[] = [];

			const unsubscribe = subscribeWorkflowStream(runId, (event) => {
				emittedEvents.push(event);
			});

			await writer1({ type: 'token', text: 'ai response' });
			await writer2({ type: 'token', text: 'search results' });

			expect(emittedEvents).toHaveLength(2);
			expect(emittedEvents[0].nodeId).toBe('aiStep1');
			expect(emittedEvents[0].payload).toMatchObject({ partialOutput: 'ai response' });
			expect(emittedEvents[1].nodeId).toBe('toolStep2');
			expect(emittedEvents[1].payload).toMatchObject({ partialOutput: 'search results' });

			unsubscribe();
		});

		it('handles empty token events', async () => {
			const writer = createStreamingWriter(runId, node);
			const emittedEvents: WorkflowStreamEvent[] = [];

			const unsubscribe = subscribeWorkflowStream(runId, (event) => {
				emittedEvents.push(event);
			});

			await writer({ type: 'token', text: '' });
			await writer({ type: 'token', text: 'text' });

			expect(emittedEvents).toHaveLength(2);
			expect(emittedEvents[0].payload).toMatchObject({ partialOutput: '' });
			expect(emittedEvents[1].payload).toMatchObject({ partialOutput: 'text' });

			unsubscribe();
		});

		it('emits all event types in sequence', async () => {
			const writer = createStreamingWriter(runId, node);
			const emittedEvents: WorkflowStreamEvent[] = [];

			const unsubscribe = subscribeWorkflowStream(runId, (event) => {
				emittedEvents.push(event);
			});

			// Simulate a complete AI step lifecycle
			await writer({ type: 'token', text: 'start' });
			await writer({ type: 'token', text: ' middle' });
			await writer({
				type: 'metadata',
				metadata: { usage: { inputTokens: 10, outputTokens: 5 } }
			});
			await writer({ type: 'complete', result: { text: 'start middle' } });

			expect(emittedEvents).toHaveLength(4);
			expect(emittedEvents[0].payload).toMatchObject({ partialOutput: 'start' });
			expect(emittedEvents[1].payload).toMatchObject({ partialOutput: 'start middle' });
			expect(emittedEvents[2].payload).toMatchObject({
				metadata: { usage: { inputTokens: 10, outputTokens: 5 } }
			});
			expect(emittedEvents[3].stage).toBe('complete');
			expect(emittedEvents[3].payload).toMatchObject({ finalOutput: 'start middle' });

			unsubscribe();
		});
	});

	describe('createStreamingStepExecutor', () => {
		const runId = '13345678-1234-4123-8123-123456789012';
		const node: WorkflowNode = {
			id: 'aiStep1',
			type: 'ai-step',
			tool: 'cohere',
			position: { x: 0, y: 0 },
			connections: []
		};

		it('creates an executor with a writer', () => {
			const executor = createStreamingStepExecutor({
				runId,
				node,
				prompt: 'What is AI?',
				model: 'oci:cohere.command-r-plus'
			});

			expect(executor).toHaveProperty('writer');
			expect(executor).toHaveProperty('config');
			expect(typeof executor.writer).toBe('function');
		});

		it('returns config with correct values', () => {
			const config = {
				runId,
				node,
				prompt: 'What is AI?',
				model: 'oci:cohere.command-r-plus'
			};

			const executor = createStreamingStepExecutor(config);

			expect(executor.config).toEqual(config);
		});

		it('writer in executor emits to stream bus', async () => {
			const executor = createStreamingStepExecutor({
				runId,
				node,
				prompt: 'What is AI?',
				model: 'oci:cohere.command-r-plus'
			});

			const emittedEvents: WorkflowStreamEvent[] = [];
			const unsubscribe = subscribeWorkflowStream(runId, (event) => {
				emittedEvents.push(event);
			});

			await executor.writer({ type: 'token', text: 'response' });

			expect(emittedEvents).toHaveLength(1);
			expect(emittedEvents[0].nodeId).toBe('aiStep1');
			expect(emittedEvents[0].payload).toMatchObject({ partialOutput: 'response' });

			unsubscribe();
		});

		it('supports multiple sequential executors', async () => {
			const node2: WorkflowNode = {
				id: 'aiStep2',
				type: 'ai-step',
				tool: 'cohere',
				position: { x: 100, y: 0 },
				connections: []
			};

			const executor1 = createStreamingStepExecutor({
				runId,
				node,
				prompt: 'First prompt',
				model: 'oci:cohere.command-r-plus'
			});

			const executor2 = createStreamingStepExecutor({
				runId,
				node: node2,
				prompt: 'Second prompt',
				model: 'oci:cohere.command-r-plus'
			});

			const emittedEvents: WorkflowStreamEvent[] = [];
			const unsubscribe = subscribeWorkflowStream(runId, (event) => {
				emittedEvents.push(event);
			});

			await executor1.writer({ type: 'token', text: 'first' });
			await executor1.writer({ type: 'complete', result: null });
			await executor2.writer({ type: 'token', text: 'second' });
			await executor2.writer({ type: 'complete', result: null });

			expect(emittedEvents).toHaveLength(4);
			expect(emittedEvents[0].nodeId).toBe('aiStep1');
			expect(emittedEvents[1].nodeId).toBe('aiStep1');
			expect(emittedEvents[2].nodeId).toBe('aiStep2');
			expect(emittedEvents[3].nodeId).toBe('aiStep2');

			unsubscribe();
		});
	});
});
