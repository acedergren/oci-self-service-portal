/**
 * Workflow Lifecycle Callbacks Tests
 *
 * Tests the onWorkflowFinish and onWorkflowError lifecycle callbacks.
 * Verifies:
 * - onWorkflowFinish writes audit records to Oracle with correct structure
 * - onWorkflowError captures errors to Sentry with context
 * - Both functions handle errors gracefully without throwing
 * - JSON serialization of complex results
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

// Mock Sentry
vi.mock('@portal/server/sentry', () => ({
	captureError: vi.fn()
}));

// Mock Oracle withConnection
const mocks = {
	executeQuery: vi.fn()
};

vi.mock('@portal/server/oracle', () => ({
	withConnection: async (fn: (conn: Record<string, unknown>) => Promise<void>) => {
		const mockConn = {
			execute: (...args: unknown[]) => mocks.executeQuery(...args)
		};
		return fn(mockConn);
	}
}));

// Import after mocks are set up
import { onWorkflowFinish, onWorkflowError } from '../../mastra/workflows/lifecycle.js';
import { captureError } from '@portal/server/sentry';

describe('onWorkflowFinish', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.executeQuery.mockResolvedValue(undefined);
	});

	it('inserts audit record with correct structure', async () => {
		const runId = '12345678-1234-4123-8123-123456789012';
		const orgId = 'org-123';
		const result = { status: 'completed', itemsProcessed: 42 };

		await onWorkflowFinish(runId, result, orgId);

		expect(mocks.executeQuery).toHaveBeenCalledOnce();
		const [sql, binds] = mocks.executeQuery.mock.calls[0];

		expect(sql).toContain('INSERT INTO workflow_audit_log');
		expect(sql).toContain('(id, run_id, org_id, event_type, result, created_at)');

		// Verify bind parameters
		expect(binds).toMatchObject({
			runId,
			orgId,
			eventType: 'finish'
		});
		expect(binds.id).toBeDefined();
		expect(binds.result).toBe(JSON.stringify(result));
		expect(binds.createdAt).toBeInstanceOf(Date);
	});

	it('serializes complex result objects to JSON', async () => {
		const runId = '12345678-1234-4123-8123-123456789012';
		const orgId = 'org-456';
		const result = {
			nodes: [{ id: 'n1', status: 'success' }],
			metrics: { duration: 1234, retries: 2 }
		};

		await onWorkflowFinish(runId, result, orgId);

		const [, binds] = mocks.executeQuery.mock.calls[0];
		const parsedResult = JSON.parse(binds.result);

		expect(parsedResult).toEqual(result);
	});

	it('handles null and undefined values gracefully', async () => {
		const runId = '12345678-1234-4123-8123-123456789012';
		const orgId = 'org-789';

		await onWorkflowFinish(runId, null, orgId);

		expect(mocks.executeQuery).toHaveBeenCalledOnce();
		const [, binds] = mocks.executeQuery.mock.calls[0];
		expect(binds.result).toBe('null');
	});

	it('does not throw when withConnection fails', async () => {
		const runId = '12345678-1234-4123-8123-123456789012';
		const orgId = 'org-fail';

		mocks.executeQuery.mockRejectedValue(new Error('Database error'));

		// Should not throw
		await expect(onWorkflowFinish(runId, { status: 'completed' }, orgId)).resolves.toBeUndefined();

		expect(mocks.executeQuery).toHaveBeenCalled();
	});

	it('generates unique ID for each audit record', async () => {
		const runId = '12345678-1234-4123-8123-123456789012';
		const orgId = 'org-unique';

		await onWorkflowFinish(runId, { test: 1 }, orgId);
		const call1Id = mocks.executeQuery.mock.calls[0][1].id;

		mocks.executeQuery.mockClear();

		await onWorkflowFinish(runId, { test: 2 }, orgId);
		const call2Id = mocks.executeQuery.mock.calls[0][1].id;

		expect(call1Id).not.toBe(call2Id);
		// Verify UUIDs are valid format
		expect(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(call1Id)
		).toBe(true);
	});
});

describe('onWorkflowError', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('captures error to Sentry with runId and context', () => {
		const runId = '12345678-1234-4123-8123-123456789012';
		const error = new Error('Workflow failed');
		const context = {
			orgId: 'org-123',
			userId: 'user-456',
			toolName: 'compute.instance.list'
		};

		onWorkflowError(runId, error, context);

		expect(captureError).toHaveBeenCalledWith(error, {
			runId,
			...context
		});
	});

	it('handles empty context object', () => {
		const runId = '12345678-1234-4123-8123-123456789012';
		const error = new Error('Something went wrong');

		onWorkflowError(runId, error);

		expect(captureError).toHaveBeenCalledWith(error, {
			runId
		});
	});

	it('does not throw when Sentry capture fails', () => {
		const runId = '12345678-1234-4123-8123-123456789012';
		const error = new Error('Workflow failed');

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(captureError as any).mockImplementation(() => {
			throw new Error('Sentry error');
		});

		// Should not throw
		expect(() => {
			onWorkflowError(runId, error, { orgId: 'org-fail' });
		}).not.toThrow();
	});

	it('includes complex context in Sentry capture', () => {
		const runId = '12345678-1234-4123-8123-123456789012';
		const error = new Error('Nested error');
		const context = {
			orgId: 'org-789',
			nodeId: 'node-123',
			iteration: 5,
			metadata: { retryCount: 3, timeout: 30000 }
		};

		onWorkflowError(runId, error, context);

		expect(captureError).toHaveBeenCalledWith(error, {
			runId,
			...context
		});
	});

	it('handles different error types', () => {
		const runId = '12345678-1234-4123-8123-123456789012';

		// TypeError
		const typeError = new TypeError('Expected string');
		onWorkflowError(runId, typeError, { type: 'type-error' });
		expect(captureError).toHaveBeenLastCalledWith(typeError, { runId, type: 'type-error' });

		vi.clearAllMocks();

		// RangeError
		const rangeError = new RangeError('Value out of range');
		onWorkflowError(runId, rangeError, { type: 'range-error' });
		expect(captureError).toHaveBeenLastCalledWith(rangeError, { runId, type: 'range-error' });
	});
});

describe('Lifecycle integration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.executeQuery.mockResolvedValue(undefined);
	});

	it('can call both callbacks in sequence for a workflow run', async () => {
		const runId = '12345678-1234-4123-8123-123456789012';
		const orgId = 'org-integration';

		// Simulate workflow error first
		const error = new Error('Initial failure');
		onWorkflowError(runId, error, { attempt: 1 });

		// Then retry succeeds
		await onWorkflowFinish(runId, { status: 'completed', attempt: 2 }, orgId);

		expect(captureError).toHaveBeenCalledOnce();
		expect(mocks.executeQuery).toHaveBeenCalledOnce();
	});

	it('calls both callbacks independently without affecting each other', async () => {
		const runId1 = '12345678-1234-4123-8123-123456789012';
		const runId2 = '87654321-4321-4321-8321-210987654321';

		// First run finishes
		await onWorkflowFinish(runId1, { status: 'ok' }, 'org-1');
		expect(mocks.executeQuery).toHaveBeenCalledTimes(1);

		// Second run errors
		onWorkflowError(runId2, new Error('Failed'), { orgId: 'org-2' });
		expect(captureError).toHaveBeenCalledTimes(1);

		// Both should have been tracked independently
		expect(mocks.executeQuery).toHaveBeenCalledTimes(1);
		expect(captureError).toHaveBeenCalledTimes(1);
	});
});
