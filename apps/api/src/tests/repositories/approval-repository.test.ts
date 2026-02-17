/**
 * Unit tests for the approval repository — pending tool approvals with
 * 5-minute TTL, stored in Oracle via pending_approvals table.
 *
 * Mock strategy: Mock `withConnection` to invoke the callback with a fake
 * connection object, and mock `execute` with counter-based sequencing.
 *
 * Source: packages/server/src/oracle/repositories/approval-repository.ts (142 lines, 0 tests)
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

const MOCK_APPROVAL_ROW = {
	ID: VALID_UUID,
	SESSION_ID: VALID_UUID_2,
	USER_ID: VALID_UUID_3,
	TOOL_NAME: 'list-instances',
	TOOL_CATEGORY: 'compute',
	APPROVAL_LEVEL: 'confirm',
	ARGS: '{"region":"us-ashburn-1"}',
	STATUS: 'pending',
	EXPIRES_AT: new Date('2026-02-17T12:05:00Z'),
	RESOLVED_BY: null,
	RESOLVED_AT: null,
	CREATED_AT: MOCK_DATE
};

// ── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();

	// Default: withConnection invokes the callback with our mock connection
	mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) =>
		fn({ execute: mockExecute, close: vi.fn(), commit: vi.fn(), rollback: vi.fn() })
	);

	// Default: execute returns empty result
	mockExecute.mockImplementation(async () => {
		return { rows: [] };
	});
});

// ── Import after mocks ────────────────────────────────────────────────────

async function getRepo() {
	const mod = await import('@portal/server/oracle/repositories/approval-repository.js');
	return mod.approvalRepository;
}

// ── Smoke test ──────────────────────────────────────────────────────────

describe('approval-repository (smoke)', () => {
	it('getPending returns empty array when no rows', async () => {
		const repo = await getRepo();
		const result = await repo.getPending();
		expect(result).toEqual([]);
	});
});

// ── getById ─────────────────────────────────────────────────────────────

describe('getById', () => {
	it('returns approval with parsed args', async () => {
		mockExecute.mockResolvedValue({ rows: [MOCK_APPROVAL_ROW] });

		const repo = await getRepo();
		const result = await repo.getById(VALID_UUID);
		expect(result).toBeTruthy();
		expect(result!.id).toBe(VALID_UUID);
		expect(result!.toolName).toBe('list-instances');
		expect(result!.toolCategory).toBe('compute');
		expect(result!.args).toEqual({ region: 'us-ashburn-1' });
		expect(result!.status).toBe('pending');
		expect(result!.sessionId).toBe(VALID_UUID_2);
		expect(result!.userId).toBe(VALID_UUID_3);
	});

	it('returns null when not found', async () => {
		mockExecute.mockResolvedValue({ rows: [] });
		const repo = await getRepo();
		const result = await repo.getById('nonexistent');
		expect(result).toBeNull();
	});

	it('handles null ARGS', async () => {
		mockExecute.mockResolvedValue({
			rows: [{ ...MOCK_APPROVAL_ROW, ARGS: null }]
		});

		const repo = await getRepo();
		const result = await repo.getById(VALID_UUID);
		expect(result!.args).toBeUndefined();
	});

	it('handles null SESSION_ID and USER_ID', async () => {
		mockExecute.mockResolvedValue({
			rows: [{ ...MOCK_APPROVAL_ROW, SESSION_ID: null, USER_ID: null }]
		});

		const repo = await getRepo();
		const result = await repo.getById(VALID_UUID);
		expect(result!.sessionId).toBeUndefined();
		expect(result!.userId).toBeUndefined();
	});

	it('handles null rows', async () => {
		mockExecute.mockResolvedValue({ rows: null });
		const repo = await getRepo();
		const result = await repo.getById(VALID_UUID);
		expect(result).toBeNull();
	});
});

// ── create ──────────────────────────────────────────────────────────────

describe('create', () => {
	it('inserts and returns the created approval', async () => {
		// create calls withConnection for INSERT, then getById calls withConnection for SELECT
		let wcCallCount = 0;
		mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) => {
			wcCallCount++;
			if (wcCallCount === 1) {
				// INSERT — just run the callback (returns undefined from execute)
				return fn({ execute: mockExecute, close: vi.fn(), commit: vi.fn(), rollback: vi.fn() });
			}
			// SELECT (getById)
			return fn({
				execute: vi.fn().mockResolvedValue({ rows: [MOCK_APPROVAL_ROW] }),
				close: vi.fn(),
				commit: vi.fn(),
				rollback: vi.fn()
			});
		});

		const repo = await getRepo();
		const result = await repo.create({
			sessionId: VALID_UUID_2,
			userId: VALID_UUID_3,
			toolName: 'list-instances',
			toolCategory: 'compute',
			approvalLevel: 'confirm',
			args: { region: 'us-ashburn-1' },
			status: 'pending',
			expiresAt: new Date('2026-02-17T12:05:00Z')
		});

		expect(result.toolName).toBe('list-instances');
		expect(result.status).toBe('pending');
		// INSERT should have been called
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO pending_approvals'),
			expect.objectContaining({
				toolName: 'list-instances',
				toolCategory: 'compute',
				approvalLevel: 'confirm',
				args: '{"region":"us-ashburn-1"}'
			})
		);
	});

	it('passes null for optional fields', async () => {
		let wcCallCount = 0;
		mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) => {
			wcCallCount++;
			if (wcCallCount === 1) {
				return fn({ execute: mockExecute, close: vi.fn(), commit: vi.fn(), rollback: vi.fn() });
			}
			return fn({
				execute: vi.fn().mockResolvedValue({
					rows: [{ ...MOCK_APPROVAL_ROW, SESSION_ID: null, USER_ID: null, ARGS: null }]
				}),
				close: vi.fn(),
				commit: vi.fn(),
				rollback: vi.fn()
			});
		});

		const repo = await getRepo();
		await repo.create({
			toolName: 'list-vcns',
			toolCategory: 'networking',
			approvalLevel: 'auto',
			status: 'pending',
			expiresAt: MOCK_DATE
		});

		const insertBinds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		expect(insertBinds.sessionId).toBeNull();
		expect(insertBinds.userId).toBeNull();
		expect(insertBinds.args).toBeNull();
	});

	it('uses default expiry when not provided', async () => {
		let wcCallCount = 0;
		mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) => {
			wcCallCount++;
			if (wcCallCount === 1) {
				return fn({ execute: mockExecute, close: vi.fn(), commit: vi.fn(), rollback: vi.fn() });
			}
			return fn({
				execute: vi.fn().mockResolvedValue({ rows: [MOCK_APPROVAL_ROW] }),
				close: vi.fn(),
				commit: vi.fn(),
				rollback: vi.fn()
			});
		});

		const repo = await getRepo();
		await repo.create({
			toolName: 'list-vcns',
			toolCategory: 'networking',
			approvalLevel: 'auto',
			status: 'pending'
		});

		const insertBinds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		// expiresAt should be a Date roughly 5 minutes in the future
		expect(insertBinds.expiresAt).toBeInstanceOf(Date);
	});
});

// ── resolve ─────────────────────────────────────────────────────────────

describe('resolve', () => {
	it('updates status and returns the resolved approval', async () => {
		let wcCallCount = 0;
		mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) => {
			wcCallCount++;
			if (wcCallCount === 1) {
				// UPDATE
				return fn({ execute: mockExecute, close: vi.fn(), commit: vi.fn(), rollback: vi.fn() });
			}
			// getById SELECT
			return fn({
				execute: vi.fn().mockResolvedValue({
					rows: [
						{
							...MOCK_APPROVAL_ROW,
							STATUS: 'approved',
							RESOLVED_BY: VALID_UUID_3,
							RESOLVED_AT: MOCK_DATE
						}
					]
				}),
				close: vi.fn(),
				commit: vi.fn(),
				rollback: vi.fn()
			});
		});

		const repo = await getRepo();
		const result = await repo.resolve(VALID_UUID, 'approved', VALID_UUID_3);

		expect(result).toBeTruthy();
		expect(result!.status).toBe('approved');
		expect(result!.resolvedBy).toBe(VALID_UUID_3);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining("status = 'pending'"),
			expect.objectContaining({
				id: VALID_UUID,
				status: 'approved',
				resolvedBy: VALID_UUID_3
			})
		);
	});

	it('passes null resolvedBy when not provided', async () => {
		let wcCallCount = 0;
		mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) => {
			wcCallCount++;
			if (wcCallCount === 1) {
				return fn({ execute: mockExecute, close: vi.fn(), commit: vi.fn(), rollback: vi.fn() });
			}
			return fn({
				execute: vi.fn().mockResolvedValue({
					rows: [{ ...MOCK_APPROVAL_ROW, STATUS: 'rejected' }]
				}),
				close: vi.fn(),
				commit: vi.fn(),
				rollback: vi.fn()
			});
		});

		const repo = await getRepo();
		await repo.resolve(VALID_UUID, 'rejected');

		const updateBinds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		expect(updateBinds.resolvedBy).toBeNull();
	});
});

// ── getPending ──────────────────────────────────────────────────────────

describe('getPending', () => {
	it('returns mapped pending approvals', async () => {
		mockExecute.mockResolvedValue({ rows: [MOCK_APPROVAL_ROW] });

		const repo = await getRepo();
		const result = await repo.getPending();

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe(VALID_UUID);
		expect(result[0].status).toBe('pending');
	});

	it('filters by sessionId when provided', async () => {
		mockExecute.mockResolvedValue({ rows: [] });

		const repo = await getRepo();
		await repo.getPending(VALID_UUID_2);

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('session_id = :sessionId'),
			expect.objectContaining({ sessionId: VALID_UUID_2 })
		);
	});

	it('omits sessionId filter when not provided', async () => {
		mockExecute.mockResolvedValue({ rows: [] });

		const repo = await getRepo();
		await repo.getPending();

		const sql = mockExecute.mock.calls[0][0] as string;
		expect(sql).not.toContain('session_id = :sessionId');
	});

	it('handles null rows', async () => {
		mockExecute.mockResolvedValue({ rows: null });

		const repo = await getRepo();
		const result = await repo.getPending();
		expect(result).toEqual([]);
	});
});

// ── expireOld ───────────────────────────────────────────────────────────

describe('expireOld', () => {
	it('returns rowsAffected count', async () => {
		mockExecute.mockResolvedValue({ rowsAffected: 3 });

		const repo = await getRepo();
		const result = await repo.expireOld();
		expect(result).toBe(3);
	});

	it('returns 0 when no rows affected', async () => {
		mockExecute.mockResolvedValue({ rowsAffected: 0 });

		const repo = await getRepo();
		const result = await repo.expireOld();
		expect(result).toBe(0);
	});

	it('handles missing rowsAffected', async () => {
		mockExecute.mockResolvedValue({});

		const repo = await getRepo();
		const result = await repo.expireOld();
		expect(result).toBe(0);
	});

	it('passes cutoff date based on maxAgeMs', async () => {
		mockExecute.mockResolvedValue({ rowsAffected: 0 });

		const repo = await getRepo();
		await repo.expireOld(10_000); // 10 seconds

		const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		expect(binds.cutoff).toBeInstanceOf(Date);
	});

	it('updates only pending approvals', async () => {
		mockExecute.mockResolvedValue({ rowsAffected: 0 });

		const repo = await getRepo();
		await repo.expireOld();

		const sql = mockExecute.mock.calls[0][0] as string;
		expect(sql).toContain("SET status = 'expired'");
		expect(sql).toContain("status = 'pending'");
	});
});
