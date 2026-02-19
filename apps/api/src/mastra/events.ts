/**
 * Typed event facade over the workflow stream bus.
 *
 * Provides a stable, domain-focused API for emitting and subscribing to
 * workflow lifecycle events without coupling consumers to the raw bus structure.
 *
 * Use this module instead of importing from workflow-stream-bus directly.
 */

import {
	emitWorkflowStream,
	subscribeWorkflowStream,
	getLatestWorkflowStatus,
	type WorkflowStreamEvent
} from '../services/workflow-stream-bus.js';

// Re-export raw event union for consumers that need the full shape
export type { WorkflowStreamEvent };

export type WorkflowStatusEvent = Extract<WorkflowStreamEvent, { type: 'status' }>;
export type WorkflowStepEvent = Extract<WorkflowStreamEvent, { type: 'step' }>;
export type WorkflowStatus = WorkflowStatusEvent['status'];
export type WorkflowStepStage = WorkflowStepEvent['stage'];

/**
 * Emit a workflow lifecycle status change.
 */
export function emitWorkflowStatus(
	runId: string,
	status: WorkflowStatus,
	opts: { output?: Record<string, unknown> | null; error?: string | null } = {}
): void {
	emitWorkflowStream({ type: 'status', runId, status, ...opts });
}

/**
 * Emit a workflow step progress event.
 */
export function emitWorkflowStep(
	runId: string,
	stage: WorkflowStepStage,
	nodeId: string,
	nodeType: string,
	payload?: unknown
): void {
	emitWorkflowStream({ type: 'step', runId, stage, nodeId, nodeType, payload });
}

/**
 * Subscribe to all events for a specific workflow run.
 * Returns an unsubscribe function — call it in cleanup/finally blocks.
 */
export function onWorkflowEvent(
	runId: string,
	listener: (event: WorkflowStreamEvent) => void
): () => void {
	return subscribeWorkflowStream(runId, listener);
}

/**
 * Get the most recent status event for a run (undefined if not started).
 */
export function getWorkflowStatus(runId: string): WorkflowStatusEvent | undefined {
	return getLatestWorkflowStatus(runId);
}
