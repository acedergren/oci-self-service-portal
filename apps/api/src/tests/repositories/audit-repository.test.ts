/**
 * Unit tests for the audit repository — tool execution logging with
 * action/tool aggregation and failure rate calculation.
 *
 * Mock strategy: Mock `withConnection` to invoke the callback with a fake
 * connection object, and mock `execute` with counter-based sequencing.
 *
 * Source: packages/server/src/oracle/repositories/audit-repository.ts (175 lines, 0 tests)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockWithConnection = vi.fn();

vi.mock('@portal/server/oracle/connection', () => ({
	withConnection: (...args: unknown[]) => mockWithConnection(...args)
}));

// ── Test data ─────────────────────────────────────────────────────────────

const MOCK_DATE = new Date('2026-02-17T12:00:00Z');
const VALID_UUID = '12345678-1234-4123-8123-123456789012';
const VALID_UUID_2 = '22345678-1234-4123-8123-223456789012';
const VALID_UUID_3 = '32345678-1234-4123-8123-323456789012';

const MOCK_EXECUTION_ROW = {
	ID: VALID_UUID,
	SESSION_ID: VALID_UUID_2,
	USER_ID: VALID_UUID_3,
	ORG_ID: VALID_UUID,
	TOOL_NAME: 'list-instances',
	TOOL_CATEGORY: 'compute',
	APPROVAL_LEVEL: 'auto',
	ACTION: 'executed',
	ARGS: '{"region":"us-ashburn-1"}',
	REDACTED_ARGS: '{"region":"***"}',
	SUCCESS: 1,
	ERROR: null,
	DURATION_MS: 250,
	IP_ADDRESS: '10.0.0.1',
	USER_AGENT: 'CloudNow/1.0',
	CREATED_AT: MOCK_DATE
};

// ── Setup ─────────────────────────────────────────────────────────────────

let callCount: number;

beforeEach(() => {
	vi.clearAllMocks();
	callCount = 0;

	mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) =>
		fn({ execute: mockExecute, close: vi.fn(), commit: vi.fn(), rollback: vi.fn() })
	);

	mockExecute.mockImplementation(async () => {
		callCount++;
		return { rows: [] };
	});
});

// ── Import after mocks ────────────────────────────────────────────────────

async function getRepo() {
	const mod = await import('@portal/server/oracle/repositories/audit-repository.js');
	return mod.auditRepository;
}

// ── Smoke test ──────────────────────────────────────────────────────────

describe('audit-repository (smoke)', () => {
	it('getBySession returns empty array when no rows', async () => {
		const repo = await getRepo();
		const result = await repo.getBySession('session-1');
		expect(result).toEqual([]);
	});
});

// ── write ───────────────────────────────────────────────────────────────

describe('write', () => {
	it('inserts and returns UUID', async () => {
		const repo = await getRepo();
		const id = await repo.write({
			sessionId: VALID_UUID_2,
			userId: VALID_UUID_3,
			orgId: VALID_UUID,
			toolName: 'list-instances',
			toolCategory: 'compute',
			approvalLevel: 'auto',
			action: 'executed',
			args: { region: 'us-ashburn-1' },
			redactedArgs: { region: '***' },
			success: true,
			durationMs: 250,
			ipAddress: '10.0.0.1',
			userAgent: 'CloudNow/1.0'
		});

		expect(typeof id).toBe('string');
		expect(id.length).toBeGreaterThan(0);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO tool_executions'),
			expect.objectContaining({
				toolName: 'list-instances',
				action: 'executed',
				success: 1, // boolean → number mapping
				args: '{"region":"us-ashburn-1"}',
				redactedArgs: '{"region":"***"}'
			})
		);
	});

	it('maps success=false to 0', async () => {
		const repo = await getRepo();
		await repo.write({
			toolName: 'delete-vcn',
			toolCategory: 'networking',
			approvalLevel: 'danger',
			action: 'failed',
			success: false,
			error: 'VCN not found'
		});

		const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		expect(binds.success).toBe(0);
		expect(binds.error).toBe('VCN not found');
	});

	it('maps success=undefined to null', async () => {
		const repo = await getRepo();
		await repo.write({
			toolName: 'list-instances',
			toolCategory: 'compute',
			approvalLevel: 'auto',
			action: 'requested'
		});

		const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		expect(binds.success).toBeNull();
	});

	it('passes null for all optional fields', async () => {
		const repo = await getRepo();
		await repo.write({
			toolName: 'list-instances',
			toolCategory: 'compute',
			approvalLevel: 'auto',
			action: 'executed'
		});

		const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		expect(binds.sessionId).toBeNull();
		expect(binds.userId).toBeNull();
		expect(binds.orgId).toBeNull();
		expect(binds.args).toBeNull();
		expect(binds.redactedArgs).toBeNull();
		expect(binds.durationMs).toBeNull();
		expect(binds.ipAddress).toBeNull();
		expect(binds.userAgent).toBeNull();
	});
});

// ── getBySession ────────────────────────────────────────────────────────

describe('getBySession', () => {
	it('returns mapped tool executions', async () => {
		mockExecute.mockResolvedValue({ rows: [MOCK_EXECUTION_ROW] });

		const repo = await getRepo();
		const result = await repo.getBySession(VALID_UUID_2);

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe(VALID_UUID);
		expect(result[0].toolName).toBe('list-instances');
		expect(result[0].success).toBe(true); // number 1 → boolean true
		expect(result[0].args).toEqual({ region: 'us-ashburn-1' });
		expect(result[0].durationMs).toBe(250);
	});

	it('maps SUCCESS=0 to false', async () => {
		mockExecute.mockResolvedValue({
			rows: [{ ...MOCK_EXECUTION_ROW, SUCCESS: 0 }]
		});

		const repo = await getRepo();
		const result = await repo.getBySession(VALID_UUID_2);
		expect(result[0].success).toBe(false);
	});

	it('maps SUCCESS=null to undefined', async () => {
		mockExecute.mockResolvedValue({
			rows: [{ ...MOCK_EXECUTION_ROW, SUCCESS: null }]
		});

		const repo = await getRepo();
		const result = await repo.getBySession(VALID_UUID_2);
		expect(result[0].success).toBeUndefined();
	});

	it('handles null rows', async () => {
		mockExecute.mockResolvedValue({ rows: null });
		const repo = await getRepo();
		const result = await repo.getBySession(VALID_UUID_2);
		expect(result).toEqual([]);
	});
});

// ── getByDateRange ──────────────────────────────────────────────────────

describe('getByDateRange', () => {
	it('returns executions within date range', async () => {
		mockExecute.mockResolvedValue({ rows: [MOCK_EXECUTION_ROW] });

		const start = new Date('2026-02-17T00:00:00Z');
		const end = new Date('2026-02-17T23:59:59Z');

		const repo = await getRepo();
		const result = await repo.getByDateRange(start, end);

		expect(result).toHaveLength(1);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('created_at >= :startDate'),
			expect.objectContaining({ startDate: start, endDate: end })
		);
	});

	it('filters by toolName when provided', async () => {
		mockExecute.mockResolvedValue({ rows: [] });
		const start = new Date('2026-02-17T00:00:00Z');
		const end = new Date('2026-02-17T23:59:59Z');

		const repo = await getRepo();
		await repo.getByDateRange(start, end, { toolName: 'list-instances' });

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('tool_name = :toolName'),
			expect.objectContaining({ toolName: 'list-instances' })
		);
	});

	it('filters by action when provided', async () => {
		mockExecute.mockResolvedValue({ rows: [] });
		const start = new Date('2026-02-17T00:00:00Z');
		const end = new Date('2026-02-17T23:59:59Z');

		const repo = await getRepo();
		await repo.getByDateRange(start, end, { action: 'failed' });

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('action = :action'),
			expect.objectContaining({ action: 'failed' })
		);
	});

	it('applies both toolName and action filters', async () => {
		mockExecute.mockResolvedValue({ rows: [] });
		const start = new Date('2026-02-17T00:00:00Z');
		const end = new Date('2026-02-17T23:59:59Z');

		const repo = await getRepo();
		await repo.getByDateRange(start, end, { toolName: 'delete-vcn', action: 'rejected' });

		const sql = mockExecute.mock.calls[0][0] as string;
		expect(sql).toContain('tool_name = :toolName');
		expect(sql).toContain('action = :action');
	});

	it('handles null rows', async () => {
		mockExecute.mockResolvedValue({ rows: null });
		const start = new Date('2026-02-17T00:00:00Z');
		const end = new Date('2026-02-17T23:59:59Z');

		const repo = await getRepo();
		const result = await repo.getByDateRange(start, end);
		expect(result).toEqual([]);
	});
});

// ── getSummary ──────────────────────────────────────────────────────────

describe('getSummary', () => {
	it('aggregates counts, actions, tools, and failure rate', async () => {
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				// COUNT total
				return { rows: [{ CNT: 100 }] };
			}
			if (callCount === 2) {
				// GROUP BY action
				return {
					rows: [
						{ ACTION: 'executed', CNT: 80 },
						{ ACTION: 'failed', CNT: 15 },
						{ ACTION: 'rejected', CNT: 5 }
					]
				};
			}
			// GROUP BY tool_name
			return {
				rows: [
					{ TOOL_NAME: 'list-instances', CNT: 60 },
					{ TOOL_NAME: 'delete-vcn', CNT: 40 }
				]
			};
		});

		const start = new Date('2026-02-17T00:00:00Z');
		const end = new Date('2026-02-17T23:59:59Z');

		const repo = await getRepo();
		const result = await repo.getSummary(start, end);

		expect(result.totalExecutions).toBe(100);
		expect(result.byAction).toEqual({ executed: 80, failed: 15, rejected: 5 });
		expect(result.byTool).toEqual({ 'list-instances': 60, 'delete-vcn': 40 });
		expect(result.failureRate).toBe(0.2); // (15 + 5) / 100
	});

	it('handles zero total executions', async () => {
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return { rows: [{ CNT: 0 }] };
			return { rows: [] };
		});

		const repo = await getRepo();
		const result = await repo.getSummary(new Date(), new Date());

		expect(result.totalExecutions).toBe(0);
		expect(result.byAction).toEqual({});
		expect(result.byTool).toEqual({});
		expect(result.failureRate).toBe(0);
	});

	it('handles null rows in all three queries', async () => {
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return { rows: null };
			return { rows: null };
		});

		const repo = await getRepo();
		const result = await repo.getSummary(new Date(), new Date());

		expect(result.totalExecutions).toBe(0);
		expect(result.byAction).toEqual({});
		expect(result.byTool).toEqual({});
		expect(result.failureRate).toBe(0);
	});

	it('counts only failed+rejected for failure rate', async () => {
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return { rows: [{ CNT: 10 }] };
			if (callCount === 2) {
				return {
					rows: [
						{ ACTION: 'executed', CNT: 8 },
						{ ACTION: 'approved', CNT: 2 }
					]
				};
			}
			return { rows: [] };
		});

		const repo = await getRepo();
		const result = await repo.getSummary(new Date(), new Date());

		// No 'failed' or 'rejected' actions → 0 failure rate
		expect(result.failureRate).toBe(0);
	});
});
