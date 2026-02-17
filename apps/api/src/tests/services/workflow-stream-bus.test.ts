/**
 * Unit tests for workflow-stream-bus — the in-process event bus for
 * streaming workflow execution status and step events to SSE clients.
 *
 * Pure utility module — no mocks needed, test inputs/outputs directly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	emitWorkflowStream,
	subscribeWorkflowStream,
	getLatestWorkflowStatus,
	clearWorkflowStreamState,
	type WorkflowStreamEvent
} from '../../services/workflow-stream-bus.js';

// Clean up between tests to avoid listener leaks
beforeEach(() => {
	clearWorkflowStreamState();
});

describe('emitWorkflowStream + subscribeWorkflowStream', () => {
	it('delivers events matching the subscribed runId', () => {
		const received: WorkflowStreamEvent[] = [];
		subscribeWorkflowStream('run-1', (e) => received.push(e));

		emitWorkflowStream({ type: 'status', runId: 'run-1', status: 'running' });

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({ type: 'status', runId: 'run-1', status: 'running' });
	});

	it('filters out events for a different runId', () => {
		const received: WorkflowStreamEvent[] = [];
		subscribeWorkflowStream('run-1', (e) => received.push(e));

		emitWorkflowStream({ type: 'status', runId: 'run-2', status: 'running' });

		expect(received).toHaveLength(0);
	});

	it('delivers step events to the correct subscriber', () => {
		const received: WorkflowStreamEvent[] = [];
		subscribeWorkflowStream('run-1', (e) => received.push(e));

		emitWorkflowStream({
			type: 'step',
			runId: 'run-1',
			stage: 'start',
			nodeId: 'node-A',
			nodeType: 'action'
		});

		expect(received).toHaveLength(1);
		expect(received[0].type).toBe('step');
	});

	it('supports multiple concurrent subscribers for different runs', () => {
		const run1Events: WorkflowStreamEvent[] = [];
		const run2Events: WorkflowStreamEvent[] = [];
		subscribeWorkflowStream('run-1', (e) => run1Events.push(e));
		subscribeWorkflowStream('run-2', (e) => run2Events.push(e));

		emitWorkflowStream({ type: 'status', runId: 'run-1', status: 'running' });
		emitWorkflowStream({ type: 'status', runId: 'run-2', status: 'completed' });

		expect(run1Events).toHaveLength(1);
		expect(run2Events).toHaveLength(1);
		expect(run1Events[0].status).toBe('running');
		expect(run2Events[0].status).toBe('completed');
	});
});

describe('unsubscribe', () => {
	it('stops delivering events after unsubscribe is called', () => {
		const received: WorkflowStreamEvent[] = [];
		const unsubscribe = subscribeWorkflowStream('run-1', (e) => received.push(e));

		emitWorkflowStream({ type: 'status', runId: 'run-1', status: 'running' });
		expect(received).toHaveLength(1);

		unsubscribe();

		emitWorkflowStream({ type: 'status', runId: 'run-1', status: 'completed' });
		expect(received).toHaveLength(1); // No new event delivered
	});
});

describe('getLatestWorkflowStatus', () => {
	it('returns the latest status event for a run', () => {
		emitWorkflowStream({ type: 'status', runId: 'run-1', status: 'pending' });
		emitWorkflowStream({ type: 'status', runId: 'run-1', status: 'running' });

		const latest = getLatestWorkflowStatus('run-1');
		expect(latest?.status).toBe('running');
	});

	it('returns undefined for unknown runId', () => {
		expect(getLatestWorkflowStatus('nonexistent')).toBeUndefined();
	});

	it('does not cache step events (only status events)', () => {
		emitWorkflowStream({
			type: 'step',
			runId: 'run-1',
			stage: 'start',
			nodeId: 'n-1',
			nodeType: 'action'
		});

		expect(getLatestWorkflowStatus('run-1')).toBeUndefined();
	});

	it('tracks status per run independently', () => {
		emitWorkflowStream({ type: 'status', runId: 'run-1', status: 'completed' });
		emitWorkflowStream({ type: 'status', runId: 'run-2', status: 'failed', error: 'timeout' });

		expect(getLatestWorkflowStatus('run-1')?.status).toBe('completed');
		expect(getLatestWorkflowStatus('run-2')?.status).toBe('failed');
	});
});

describe('clearWorkflowStreamState', () => {
	it('clears cached status and removes all listeners', () => {
		const received: WorkflowStreamEvent[] = [];
		subscribeWorkflowStream('run-1', (e) => received.push(e));
		emitWorkflowStream({ type: 'status', runId: 'run-1', status: 'running' });

		clearWorkflowStreamState();

		// Cached status cleared
		expect(getLatestWorkflowStatus('run-1')).toBeUndefined();

		// Listener removed — no new events delivered
		emitWorkflowStream({ type: 'status', runId: 'run-1', status: 'completed' });
		expect(received).toHaveLength(1); // Only the pre-clear event
	});
});
