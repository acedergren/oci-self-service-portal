/**
 * Unit tests for the tool progress TransformStream — intercepts UI
 * message stream chunks and injects tool progress data parts.
 *
 * Mock strategy: Mock `getToolProgressMessage` to return deterministic
 * strings. Test the TransformStream transform behavior (pass-through,
 * injection, timing, cleanup).
 *
 * Source: apps/frontend/src/lib/utils/tool-progress-stream.ts (132 lines, 0 tests)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockGetToolProgressMessage = vi.fn();

vi.mock('@portal/shared/tools/types', () => ({
	getToolProgressMessage: (...args: unknown[]) => mockGetToolProgressMessage(...args)
}));

import { createToolProgressTransform } from '$lib/utils/tool-progress-stream';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Pipe chunks through the transform and collect output. */
async function pipeChunks(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	chunks: Record<string, any>[]
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>[]> {
	const transform = createToolProgressTransform();
	const writer = transform.writable.getWriter();
	const reader = transform.readable.getReader();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const output: Record<string, any>[] = [];

	const readAll = (async () => {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			output.push(value);
		}
	})();

	for (const chunk of chunks) {
		await writer.write(chunk);
	}
	await writer.close();
	await readAll;

	return output;
}

// ── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	mockGetToolProgressMessage.mockImplementation(
		(toolName: string, stage: string) => `${toolName}:${stage}`
	);
});

// ── Pass-through behavior ────────────────────────────────────────────────

describe('pass-through', () => {
	it('passes through unknown chunk types unchanged', async () => {
		const chunks = [{ type: 'text', text: 'Hello' }];
		const output = await pipeChunks(chunks);

		expect(output).toHaveLength(1);
		expect(output[0]).toEqual({ type: 'text', text: 'Hello' });
	});

	it('passes through original chunk before injecting progress', async () => {
		const input = {
			type: 'tool-input-available',
			toolCallId: 'tc-1',
			toolName: 'list-instances',
			input: {}
		};
		const output = await pipeChunks([input]);

		// First chunk = original, second = injected progress
		expect(output).toHaveLength(2);
		expect(output[0]).toEqual(input);
		expect(output[1].type).toBe('data-tool-progress');
	});
});

// ── tool-input-available ─────────────────────────────────────────────────

describe('tool-input-available', () => {
	it('injects executing progress on tool start', async () => {
		const output = await pipeChunks([
			{ type: 'tool-input-available', toolCallId: 'tc-1', toolName: 'list-instances', input: {} }
		]);

		const progress = output.find((c) => c.type === 'data-tool-progress');
		expect(progress).toBeTruthy();
		expect(progress!.data.toolCallId).toBe('tc-1');
		expect(progress!.data.toolName).toBe('list-instances');
		expect(progress!.data.stage).toBe('executing');
		expect(progress!.transient).toBe(true);
		expect(typeof progress!.data.startedAt).toBe('number');
	});

	it('uses getToolProgressMessage for executing message', async () => {
		await pipeChunks([
			{ type: 'tool-input-available', toolCallId: 'tc-1', toolName: 'list-vcns', input: {} }
		]);

		expect(mockGetToolProgressMessage).toHaveBeenCalledWith('list-vcns', 'executing');
	});
});

// ── tool-output-available ────────────────────────────────────────────────

describe('tool-output-available', () => {
	it('injects completed progress on tool success', async () => {
		const output = await pipeChunks([
			{ type: 'tool-input-available', toolCallId: 'tc-1', toolName: 'list-instances', input: {} },
			{ type: 'tool-output-available', toolCallId: 'tc-1', output: { instances: [] } }
		]);

		const completedChunks = output.filter(
			(c) => c.type === 'data-tool-progress' && c.data.stage === 'completed'
		);
		expect(completedChunks).toHaveLength(1);
		expect(completedChunks[0].data.toolName).toBe('list-instances');
		expect(typeof completedChunks[0].data.completedAt).toBe('number');
	});

	it('includes startedAt from the original tool-input-available', async () => {
		const output = await pipeChunks([
			{ type: 'tool-input-available', toolCallId: 'tc-1', toolName: 'list-instances', input: {} },
			{ type: 'tool-output-available', toolCallId: 'tc-1', output: {} }
		]);

		const executing = output.find(
			(c) => c.type === 'data-tool-progress' && c.data.stage === 'executing'
		);
		const completed = output.find(
			(c) => c.type === 'data-tool-progress' && c.data.stage === 'completed'
		);

		expect(completed!.data.startedAt).toBe(executing!.data.startedAt);
	});

	it('handles output without prior input (unknown tool)', async () => {
		const output = await pipeChunks([
			{ type: 'tool-output-available', toolCallId: 'tc-unknown', output: {} }
		]);

		const completed = output.find((c) => c.type === 'data-tool-progress');
		expect(completed).toBeTruthy();
		expect(completed!.data.toolName).toBe('');
		expect(completed!.data.startedAt).toBeUndefined();
	});
});

// ── tool-output-error ────────────────────────────────────────────────────

describe('tool-output-error', () => {
	it('injects error progress on tool failure', async () => {
		const output = await pipeChunks([
			{ type: 'tool-input-available', toolCallId: 'tc-1', toolName: 'delete-vcn', input: {} },
			{ type: 'tool-output-error', toolCallId: 'tc-1', errorText: 'VCN not found' }
		]);

		const errorChunks = output.filter(
			(c) => c.type === 'data-tool-progress' && c.data.stage === 'error'
		);
		expect(errorChunks).toHaveLength(1);
		expect(errorChunks[0].data.message).toBe('VCN not found');
		expect(errorChunks[0].data.toolName).toBe('delete-vcn');
	});

	it('falls back to generic message when errorText is empty', async () => {
		const output = await pipeChunks([
			{ type: 'tool-input-available', toolCallId: 'tc-1', toolName: 'delete-vcn', input: {} },
			{ type: 'tool-output-error', toolCallId: 'tc-1', errorText: '' }
		]);

		const errorChunk = output.find(
			(c) => c.type === 'data-tool-progress' && c.data.stage === 'error'
		);
		expect(errorChunk!.data.message).toBe('Tool execution failed');
	});
});
