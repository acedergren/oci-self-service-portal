/**
 * Phase 4 Security: DB-backed approval tokens (M-2)
 *
 * Problem: approvedToolCalls Map is in-memory only, breaks multi-instance deployment.
 * Fix: Add recordApprovalDB/consumeApprovalDB with Oracle persistence + in-memory fallback.
 *
 * Expected: recordApproval and consumeApproval try Oracle first, fall back to Map.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
const mockConn = {
	execute: mockExecute
};

vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) => fn(mockConn))
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

// Mock the approval repository (pending approvals, not the tool call approvals)
vi.mock('$lib/server/oracle/repositories/approval-repository.js', () => ({
	approvalRepository: {
		create: vi.fn().mockResolvedValue({ id: 'mock-id', status: 'pending' }),
		getById: vi.fn().mockResolvedValue(null),
		resolve: vi.fn().mockResolvedValue(null),
		getPending: vi.fn().mockResolvedValue([]),
		expireOld: vi.fn().mockResolvedValue(0)
	}
}));

let approvalsModule: Record<string, unknown> | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		approvalsModule = await import('$lib/server/approvals.js');
	} catch {
		// Module may not be available yet
	}
});

describe('M-2: DB-backed approval tokens', () => {
	describe('module exports', () => {
		it('should export recordApproval function', () => {
			expect(approvalsModule).not.toBeNull();
			expect(typeof approvalsModule!.recordApproval).toBe('function');
		});

		it('should export consumeApproval function', () => {
			expect(approvalsModule).not.toBeNull();
			expect(typeof approvalsModule!.consumeApproval).toBe('function');
		});
	});

	describe('recordApproval', () => {
		it('attempts Oracle INSERT for approval token', async () => {
			const recordApproval = approvalsModule!.recordApproval as (
				toolCallId: string,
				toolName: string
			) => Promise<void>;

			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 }); // INSERT

			await recordApproval('tc-001', 'listInstances');

			// Should have attempted an INSERT into approved_tool_calls
			expect(mockExecute).toHaveBeenCalled();
			const sql = mockExecute.mock.calls[0]?.[0] as string;
			expect(sql).toMatch(/INSERT\s+INTO\s+approved_tool_calls/i);
		});

		it('falls back to in-memory Map on DB error', async () => {
			const recordApproval = approvalsModule!.recordApproval as (
				toolCallId: string,
				toolName: string
			) => Promise<void>;
			const consumeApproval = approvalsModule!.consumeApproval as (
				toolCallId: string,
				toolName: string
			) => Promise<boolean>;

			// DB fails
			mockExecute.mockRejectedValueOnce(new Error('DB down'));

			await recordApproval('tc-fallback', 'listBuckets');

			// Should still be consumable via in-memory fallback
			// consumeApproval also falls back to in-memory when DB fails
			mockExecute.mockRejectedValueOnce(new Error('DB down'));
			const result = await consumeApproval('tc-fallback', 'listBuckets');
			expect(result).toBe(true);
		});
	});

	describe('consumeApproval', () => {
		it('consumes approval from Oracle (single-use)', async () => {
			const recordApproval = approvalsModule!.recordApproval as (
				toolCallId: string,
				toolName: string
			) => Promise<void>;
			const consumeApproval = approvalsModule!.consumeApproval as (
				toolCallId: string,
				toolName: string
			) => Promise<boolean>;

			// Record: INSERT succeeds
			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });
			await recordApproval('tc-002', 'listInstances');

			// Consume: atomic DELETE affects 1 row (valid approval consumed)
			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });

			const result = await consumeApproval('tc-002', 'listInstances');
			expect(result).toBe(true);
		});

		it('returns false for unknown toolCallId', async () => {
			const consumeApproval = approvalsModule!.consumeApproval as (
				toolCallId: string,
				toolName: string
			) => Promise<boolean>;

			// Atomic DELETE affects 0 rows (no matching approval)
			mockExecute.mockResolvedValueOnce({ rowsAffected: 0 });

			const result = await consumeApproval('tc-unknown', 'listInstances');
			expect(result).toBe(false);
		});

		it('returns false when toolName does not match', async () => {
			const recordApproval = approvalsModule!.recordApproval as (
				toolCallId: string,
				toolName: string
			) => Promise<void>;
			const consumeApproval = approvalsModule!.consumeApproval as (
				toolCallId: string,
				toolName: string
			) => Promise<boolean>;

			// Record approval for listInstances
			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });
			await recordApproval('tc-003', 'listInstances');

			// Atomic DELETE with wrong tool name — WHERE clause rejects, 0 rows affected
			mockExecute.mockResolvedValueOnce({ rowsAffected: 0 });

			const result = await consumeApproval('tc-003', 'deleteBucket');
			expect(result).toBe(false);
		});

		it('returns false for expired approval', async () => {
			const consumeApproval = approvalsModule!.consumeApproval as (
				toolCallId: string,
				toolName: string
			) => Promise<boolean>;

			// SELECT returns expired row (approved_at is 10 minutes ago)
			const expiredDate = new Date(Date.now() - 10 * 60 * 1000);
			mockExecute.mockResolvedValueOnce({
				rows: [{ TOOL_CALL_ID: 'tc-expired', TOOL_NAME: 'listInstances', APPROVED_AT: expiredDate }]
			});

			const result = await consumeApproval('tc-expired', 'listInstances');
			expect(result).toBe(false);
		});

		it('consumes single-use: second consume returns false', async () => {
			const recordApproval = approvalsModule!.recordApproval as (
				toolCallId: string,
				toolName: string
			) => Promise<void>;
			const consumeApproval = approvalsModule!.consumeApproval as (
				toolCallId: string,
				toolName: string
			) => Promise<boolean>;

			// Record
			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });
			await recordApproval('tc-single', 'listInstances');

			// First consume: atomic DELETE affects 1 row
			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });
			const first = await consumeApproval('tc-single', 'listInstances');
			expect(first).toBe(true);

			// Second consume: atomic DELETE affects 0 rows (already consumed)
			mockExecute.mockResolvedValueOnce({ rowsAffected: 0 });
			const second = await consumeApproval('tc-single', 'listInstances');
			expect(second).toBe(false);
		});
	});
});
