import { EventEmitter } from 'node:events';

export type WorkflowStreamEvent =
	| {
			type: 'status';
			runId: string;
			status: 'pending' | 'running' | 'completed' | 'failed' | 'suspended' | 'cancelled';
			output?: Record<string, unknown> | null;
			error?: string | null;
	  }
	| {
			type: 'step';
			runId: string;
			stage: 'start' | 'complete' | 'error';
			nodeId: string;
			nodeType: string;
			payload?: unknown;
	  };

type WorkflowStreamListener = (event: WorkflowStreamEvent) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const latestStatusByRun = new Map<string, Extract<WorkflowStreamEvent, { type: 'status' }>>();

export function emitWorkflowStream(event: WorkflowStreamEvent): void {
	if (event.type === 'status') {
		latestStatusByRun.set(event.runId, event);
	}

	emitter.emit('workflow-event', event);
}

export function subscribeWorkflowStream(
	runId: string,
	listener: WorkflowStreamListener
): () => void {
	const handler = (event: WorkflowStreamEvent): void => {
		if (event.runId === runId) {
			listener(event);
		}
	};

	emitter.on('workflow-event', handler);

	return () => {
		emitter.off('workflow-event', handler);
	};
}

export function getLatestWorkflowStatus(
	runId: string
): Extract<WorkflowStreamEvent, { type: 'status' }> | undefined {
	return latestStatusByRun.get(runId);
}

export function clearWorkflowStreamState(): void {
	latestStatusByRun.clear();
	emitter.removeAllListeners('workflow-event');
}
