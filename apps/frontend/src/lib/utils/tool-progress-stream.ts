/**
 * TransformStream that intercepts UI message stream chunks and injects
 * `data-tool-progress` parts when tool execution events are detected.
 *
 * This gives the client real-time progress descriptions for long-running
 * OCI operations (e.g., "Querying compute instances..." → "Completed").
 *
 * Uses AI SDK v6's DataUIMessageChunk convention:
 *   { type: 'data-tool-progress', data: ToolProgressEvent, transient: true }
 *
 * `transient: true` means the data part updates the UI in real-time
 * but doesn't persist in message history.
 */
import { getToolProgressMessage } from '@portal/shared/tools/types';
import type { ToolProgressEvent } from '@portal/types/tools/types';

/** Chunk types we observe from the UI message stream */
interface ToolInputAvailableChunk {
	type: 'tool-input-available';
	toolCallId: string;
	toolName: string;
	input: unknown;
	[key: string]: unknown;
}

interface ToolOutputAvailableChunk {
	type: 'tool-output-available';
	toolCallId: string;
	output: unknown;
	[key: string]: unknown;
}

interface ToolOutputErrorChunk {
	type: 'tool-output-error';
	toolCallId: string;
	errorText: string;
	[key: string]: unknown;
}

/** The progress data part chunk we inject into the stream */
interface ToolProgressChunk {
	type: 'data-tool-progress';
	data: ToolProgressEvent;
	transient: true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UIChunk = Record<string, any>;

/**
 * Creates a TransformStream that enriches a UI message stream with
 * tool progress data parts. Pass-through for all original chunks.
 */
export function createToolProgressTransform(): TransformStream<UIChunk, UIChunk> {
	// Track start times so we can include duration in completed events
	const toolStartTimes = new Map<string, number>();
	// Track tool names so we can include them in completed/error events
	const toolNames = new Map<string, string>();

	return new TransformStream<UIChunk, UIChunk>({
		transform(chunk: UIChunk, controller) {
			// Always pass through the original chunk
			controller.enqueue(chunk);

			if (chunk.type === 'tool-input-available') {
				const c = chunk as ToolInputAvailableChunk;
				const now = Date.now();
				toolStartTimes.set(c.toolCallId, now);
				toolNames.set(c.toolCallId, c.toolName);

				const progress: ToolProgressChunk = {
					type: 'data-tool-progress',
					data: {
						toolCallId: c.toolCallId,
						toolName: c.toolName,
						stage: 'executing',
						message: getToolProgressMessage(c.toolName, 'executing'),
						startedAt: now
					},
					transient: true
				};
				controller.enqueue(progress as unknown as UIChunk);
			}

			if (chunk.type === 'tool-output-available') {
				const c = chunk as ToolOutputAvailableChunk;
				const startedAt = toolStartTimes.get(c.toolCallId);
				const toolName = toolNames.get(c.toolCallId) ?? '';
				const now = Date.now();

				const progress: ToolProgressChunk = {
					type: 'data-tool-progress',
					data: {
						toolCallId: c.toolCallId,
						toolName,
						stage: 'completed',
						message: getToolProgressMessage(toolName, 'completed'),
						startedAt,
						completedAt: now
					},
					transient: true
				};
				controller.enqueue(progress as unknown as UIChunk);
				toolStartTimes.delete(c.toolCallId);
				toolNames.delete(c.toolCallId);
			}

			if (chunk.type === 'tool-output-error') {
				const c = chunk as ToolOutputErrorChunk;
				const startedAt = toolStartTimes.get(c.toolCallId);
				const toolName = toolNames.get(c.toolCallId) ?? '';
				const now = Date.now();

				const progress: ToolProgressChunk = {
					type: 'data-tool-progress',
					data: {
						toolCallId: c.toolCallId,
						toolName,
						stage: 'error',
						message: c.errorText || 'Tool execution failed',
						startedAt,
						completedAt: now
					},
					transient: true
				};
				controller.enqueue(progress as unknown as UIChunk);
				toolStartTimes.delete(c.toolCallId);
				toolNames.delete(c.toolCallId);
			}
		}
	});
}
