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
// 1000 concurrent SSE subscribers is a safe upper bound; keeps leak detection active
emitter.setMaxListeners(1000);

const TTL_MS = 60 * 60 * 1000; // 1 hour

interface TimestampedStatus {
	event: Extract<WorkflowStreamEvent, { type: 'status' }>;
	timestamp: number;
}

const latestStatusByRun = new Map<string, TimestampedStatus>();

export function emitWorkflowStream(event: WorkflowStreamEvent): void {
	if (event.type === 'status') {
		latestStatusByRun.set(event.runId, { event, timestamp: Date.now() });
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
	return latestStatusByRun.get(runId)?.event;
}

/** Remove Map entries older than TTL_MS to prevent unbounded growth. */
export function cleanupStaleRuns(): void {
	const cutoff = Date.now() - TTL_MS;
	for (const [runId, { timestamp }] of latestStatusByRun) {
		if (timestamp < cutoff) {
			latestStatusByRun.delete(runId);
		}
	}
}

export function clearWorkflowStreamState(): void {
	latestStatusByRun.clear();
	emitter.removeAllListeners('workflow-event');
}

// Evict stale run entries every 10 minutes; .unref() so the timer doesn't prevent process exit
const _cleanupInterval = setInterval(cleanupStaleRuns, 10 * 60 * 1000).unref();
// Silence unused-variable lint warning — interval is intentionally kept as a side effect
void _cleanupInterval;
