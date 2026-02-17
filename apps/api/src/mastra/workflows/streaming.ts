import type { WorkflowNode } from '@portal/shared/workflows';
import {
	emitWorkflowStream,
	type WorkflowStreamEvent
} from '../../services/workflow-stream-bus.js';

/**
 * Streaming step result that wraps text output and metadata.
 */
export interface StreamingStepResult {
	stepId: string;
	nodeId: string;
	nodeType: string;
	text: string;
	tokens?: { prompt: number; completion: number };
	error?: string;
}

/**
 * Writer callback for streaming step output.
 * Called by Mastra when content is available during AI/tool execution.
 * Emits structured events to the workflow-stream-bus.
 */
export interface StreamingWriter {
	(event: StreamingWriterEvent): void | Promise<void>;
}

export type StreamingWriterEvent =
	| {
			type: 'token';
			text: string; // Single token or chunk of text
	  }
	| {
			type: 'metadata';
			metadata: Record<string, unknown>; // Usage, model info, etc.
	  }
	| {
			type: 'complete';
			result: unknown; // Final result of the step
	  }
	| {
			type: 'error';
			error: string;
	  };

/**
 * Create a writer callback for a workflow step.
 * Emits events to the stream bus for SSE consumption.
 */
export function createStreamingWriter(runId: string, node: WorkflowNode): StreamingWriter {
	let buffer = '';

	return async (event: StreamingWriterEvent) => {
		switch (event.type) {
			case 'token': {
				// Accumulate tokens
				buffer += event.text;

				// Emit step progress event
				const streamEvent: WorkflowStreamEvent = {
					type: 'step',
					runId,
					stage: 'start',
					nodeId: node.id,
					nodeType: node.type,
					payload: {
						partialOutput: buffer,
						tokenCount: buffer.length // Rough estimate
					}
				};
				emitWorkflowStream(streamEvent);
				break;
			}

			case 'metadata': {
				// Emit metadata event (usage, model, etc.)
				const streamEvent: WorkflowStreamEvent = {
					type: 'step',
					runId,
					stage: 'start',
					nodeId: node.id,
					nodeType: node.type,
					payload: {
						metadata: event.metadata
					}
				};
				emitWorkflowStream(streamEvent);
				break;
			}

			case 'complete': {
				// Emit completion event
				const streamEvent: WorkflowStreamEvent = {
					type: 'step',
					runId,
					stage: 'complete',
					nodeId: node.id,
					nodeType: node.type,
					payload: {
						result: event.result,
						finalOutput: buffer
					}
				};
				emitWorkflowStream(streamEvent);
				buffer = ''; // Reset buffer for next step
				break;
			}

			case 'error': {
				// Emit error event
				const streamEvent: WorkflowStreamEvent = {
					type: 'step',
					runId,
					stage: 'error',
					nodeId: node.id,
					nodeType: node.type,
					payload: {
						error: event.error
					}
				};
				emitWorkflowStream(streamEvent);
				buffer = '';
				break;
			}
		}
	};
}

/**
 * Create a streaming wrapper for AI step execution.
 * This is the integration point where Mastra's writer is consumed.
 */
export interface StreamingStepConfig {
	runId: string;
	node: WorkflowNode;
	prompt: string;
	model: string;
}

/**
 * Execute an AI step with streaming.
 * Returns the streaming writer for use in Mastra's generateText() call.
 *
 * Usage:
 * ```typescript
 * const { writer } = createStreamingStepExecutor({
 *   runId,
 *   node: aiStepNode,
 *   prompt: interpolatedPrompt,
 *   model: 'oci:cohere.command-r-plus'
 * });
 *
 * const result = await generateText({
 *   model: registry.languageModel(modelString),
 *   prompt,
 *   onStream: writer  // Pass writer to generateText
 * });
 * ```
 */
export function createStreamingStepExecutor(config: StreamingStepConfig) {
	const writer = createStreamingWriter(config.runId, config.node);

	return {
		writer,
		config
	};
}
