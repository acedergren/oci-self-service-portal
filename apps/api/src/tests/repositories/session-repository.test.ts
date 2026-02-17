/**
 * Unit tests for the session repository — chat session CRUD with
 * enriched listing (message counts from chat_turns JOIN).
 *
 * Mock strategy: Mock `withConnection` to invoke the callback with a fake
 * connection object, and mock `execute` with counter-based sequencing.
 *
 * Source: packages/server/src/oracle/repositories/session-repository.ts (274 lines, 0 tests)
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

const MOCK_SESSION_ROW = {
	ID: VALID_UUID,
	USER_ID: VALID_UUID_2,
	ORG_ID: VALID_UUID_3,
	TITLE: 'Test Session',
	MODEL: 'cohere.command-r-plus',
	REGION: 'us-ashburn-1',
	STATUS: 'active',
	CONFIG: '{"temperature":0.7}',
	CREATED_AT: MOCK_DATE,
	UPDATED_AT: MOCK_DATE
};

const MOCK_ENRICHED_ROW = {
	...MOCK_SESSION_ROW,
	MESSAGE_COUNT: 5,
	LAST_MESSAGE: 'What instances are running?'
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
	const mod = await import('@portal/server/oracle/repositories/session-repository.js');
	return mod.sessionRepository;
}

async function getStandaloneFns() {
	const mod = await import('@portal/server/oracle/repositories/session-repository.js');
	return {
		listSessionsEnriched: mod.listSessionsEnriched,
		deleteSession: mod.deleteSession
	};
}

// ── Smoke test ──────────────────────────────────────────────────────────

describe('session-repository (smoke)', () => {
	it('list returns empty array when no rows', async () => {
		const repo = await getRepo();
		const result = await repo.list();
		expect(result).toEqual([]);
	});
});

// ── getById ─────────────────────────────────────────────────────────────

describe('getById', () => {
	it('returns session with parsed config', async () => {
		mockExecute.mockResolvedValue({ rows: [MOCK_SESSION_ROW] });

		const repo = await getRepo();
		const result = await repo.getById(VALID_UUID);
		expect(result).toBeTruthy();
		expect(result!.id).toBe(VALID_UUID);
		expect(result!.model).toBe('cohere.command-r-plus');
		expect(result!.region).toBe('us-ashburn-1');
		expect(result!.config).toEqual({ temperature: 0.7 });
		expect(result!.status).toBe('active');
	});

	it('returns null when not found', async () => {
		mockExecute.mockResolvedValue({ rows: [] });
		const repo = await getRepo();
		const result = await repo.getById('nonexistent');
		expect(result).toBeNull();
	});

	it('handles null CONFIG', async () => {
		mockExecute.mockResolvedValue({
			rows: [{ ...MOCK_SESSION_ROW, CONFIG: null }]
		});

		const repo = await getRepo();
		const result = await repo.getById(VALID_UUID);
		expect(result!.config).toBeUndefined();
	});

	it('handles null USER_ID and ORG_ID', async () => {
		mockExecute.mockResolvedValue({
			rows: [{ ...MOCK_SESSION_ROW, USER_ID: null, ORG_ID: null }]
		});

		const repo = await getRepo();
		const result = await repo.getById(VALID_UUID);
		expect(result!.userId).toBeUndefined();
		expect(result!.orgId).toBeUndefined();
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
	it('inserts and returns the created session', async () => {
		// create calls withConnection for INSERT, then getById calls withConnection for SELECT
		let wcCallCount = 0;
		mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) => {
			wcCallCount++;
			if (wcCallCount === 1) {
				return fn({ execute: mockExecute, close: vi.fn(), commit: vi.fn(), rollback: vi.fn() });
			}
			return fn({
				execute: vi.fn().mockResolvedValue({ rows: [MOCK_SESSION_ROW] }),
				close: vi.fn(),
				commit: vi.fn(),
				rollback: vi.fn()
			});
		});

		const repo = await getRepo();
		const result = await repo.create({
			model: 'cohere.command-r-plus',
			region: 'us-ashburn-1',
			title: 'Test Session',
			userId: VALID_UUID_2,
			orgId: VALID_UUID_3,
			config: { temperature: 0.7 }
		});

		expect(result.model).toBe('cohere.command-r-plus');
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO chat_sessions'),
			expect.objectContaining({
				model: 'cohere.command-r-plus',
				region: 'us-ashburn-1',
				title: 'Test Session',
				config: '{"temperature":0.7}'
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
					rows: [{ ...MOCK_SESSION_ROW, USER_ID: null, ORG_ID: null, TITLE: null, CONFIG: null }]
				}),
				close: vi.fn(),
				commit: vi.fn(),
				rollback: vi.fn()
			});
		});

		const repo = await getRepo();
		await repo.create({ model: 'cohere.command-r-plus', region: 'us-ashburn-1' });

		const insertBinds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		expect(insertBinds.userId).toBeNull();
		expect(insertBinds.orgId).toBeNull();
		expect(insertBinds.title).toBeNull();
		expect(insertBinds.config).toBeNull();
		expect(insertBinds.status).toBe('active'); // default
	});

	it('throws when getById returns null after creation', async () => {
		// Both withConnection calls return empty rows
		mockExecute.mockResolvedValue({ rows: [] });

		const repo = await getRepo();
		await expect(
			repo.create({ model: 'cohere.command-r-plus', region: 'us-ashburn-1' })
		).rejects.toThrow('Failed to retrieve session after creation');
	});
});

// ── list ────────────────────────────────────────────────────────────────

describe('list', () => {
	it('maps Oracle UPPERCASE rows', async () => {
		mockExecute.mockResolvedValue({ rows: [MOCK_SESSION_ROW] });

		const repo = await getRepo();
		const result = await repo.list();

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe(VALID_UUID);
		expect(result[0].model).toBe('cohere.command-r-plus');
	});

	it('filters by status', async () => {
		mockExecute.mockResolvedValue({ rows: [] });

		const repo = await getRepo();
		await repo.list({ status: 'active' });

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('status = :status'),
			expect.objectContaining({ status: 'active' })
		);
	});

	it('filters by userId', async () => {
		mockExecute.mockResolvedValue({ rows: [] });

		const repo = await getRepo();
		await repo.list({ userId: VALID_UUID_2 });

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('user_id = :userId'),
			expect.objectContaining({ userId: VALID_UUID_2 })
		);
	});

	it('filters by orgId', async () => {
		mockExecute.mockResolvedValue({ rows: [] });

		const repo = await getRepo();
		await repo.list({ orgId: VALID_UUID_3 });

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('org_id = :orgId'),
			expect.objectContaining({ orgId: VALID_UUID_3 })
		);
	});

	it('applies pagination defaults (limit=50, offset=0)', async () => {
		mockExecute.mockResolvedValue({ rows: [] });

		const repo = await getRepo();
		await repo.list();

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('OFFSET :offset ROWS FETCH FIRST :maxRows ROWS ONLY'),
			expect.objectContaining({ offset: 0, maxRows: 50 })
		);
	});

	it('uses custom pagination', async () => {
		mockExecute.mockResolvedValue({ rows: [] });

		const repo = await getRepo();
		await repo.list({ limit: 10, offset: 20 });

		expect(mockExecute).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ offset: 20, maxRows: 10 })
		);
	});

	it('handles null rows', async () => {
		mockExecute.mockResolvedValue({ rows: null });

		const repo = await getRepo();
		const result = await repo.list();
		expect(result).toEqual([]);
	});
});

// ── update ──────────────────────────────────────────────────────────────

describe('update', () => {
	it('builds dynamic SET clause for title', async () => {
		// update calls execute then getById in the same withConnection
		let execCount = 0;
		mockExecute.mockImplementation(async () => {
			execCount++;
			if (execCount === 1) return { rows: [] }; // UPDATE
			return { rows: [{ ...MOCK_SESSION_ROW, TITLE: 'New Title' }] }; // getById SELECT
		});

		const repo = await getRepo();
		const result = await repo.update(VALID_UUID, { title: 'New Title' });

		expect(result).toBeTruthy();
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('title = :title'),
			expect.objectContaining({ id: VALID_UUID, title: 'New Title' })
		);
	});

	it('serializes config to JSON', async () => {
		let execCount = 0;
		mockExecute.mockImplementation(async () => {
			execCount++;
			if (execCount === 1) return { rows: [] };
			return { rows: [MOCK_SESSION_ROW] };
		});

		const repo = await getRepo();
		await repo.update(VALID_UUID, { config: { maxTokens: 500 } });

		const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		expect(binds.config).toBe('{"maxTokens":500}');
	});

	it('always includes updated_at = SYSTIMESTAMP', async () => {
		let execCount = 0;
		mockExecute.mockImplementation(async () => {
			execCount++;
			if (execCount === 1) return { rows: [] };
			return { rows: [MOCK_SESSION_ROW] };
		});

		const repo = await getRepo();
		await repo.update(VALID_UUID, { status: 'completed' });

		const sql = mockExecute.mock.calls[0][0] as string;
		expect(sql).toContain('updated_at = SYSTIMESTAMP');
	});
});

// ── getMostRecent ───────────────────────────────────────────────────────

describe('getMostRecent', () => {
	it('returns most recent session', async () => {
		mockExecute.mockResolvedValue({ rows: [MOCK_SESSION_ROW] });

		const repo = await getRepo();
		const result = await repo.getMostRecent();

		expect(result).toBeTruthy();
		expect(result!.id).toBe(VALID_UUID);
		const sql = mockExecute.mock.calls[0][0] as string;
		expect(sql).toContain('FETCH FIRST 1 ROWS ONLY');
	});

	it('filters by userId when provided', async () => {
		mockExecute.mockResolvedValue({ rows: [] });

		const repo = await getRepo();
		await repo.getMostRecent(VALID_UUID_2);

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('user_id = :userId'),
			expect.objectContaining({ userId: VALID_UUID_2 })
		);
	});

	it('returns null when no sessions', async () => {
		mockExecute.mockResolvedValue({ rows: [] });
		const repo = await getRepo();
		const result = await repo.getMostRecent();
		expect(result).toBeNull();
	});
});

// ── listSessionsEnriched ────────────────────────────────────────────────

describe('listSessionsEnriched', () => {
	it('returns sessions with message count and total', async () => {
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				// COUNT total
				return { rows: [{ CNT: 1 }] };
			}
			// Enriched SELECT
			return { rows: [MOCK_ENRICHED_ROW] };
		});

		const { listSessionsEnriched } = await getStandaloneFns();
		const result = await listSessionsEnriched();

		expect(result.total).toBe(1);
		expect(result.sessions).toHaveLength(1);
		expect(result.sessions[0].messageCount).toBe(5);
		expect(result.sessions[0].lastMessage).toBe('What instances are running?');
		expect(result.sessions[0].model).toBe('cohere.command-r-plus');
	});

	it('escapes search term for LIKE injection', async () => {
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return { rows: [{ CNT: 0 }] };
			return { rows: [] };
		});

		const { listSessionsEnriched } = await getStandaloneFns();
		await listSessionsEnriched({ search: '100%_done\\' });

		const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		// Should escape %, _, and \
		expect(binds.search).toBe('%100\\%\\_done\\\\%');
	});

	it('filters by status, userId, and orgId', async () => {
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return { rows: [{ CNT: 0 }] };
			return { rows: [] };
		});

		const { listSessionsEnriched } = await getStandaloneFns();
		await listSessionsEnriched({
			status: 'active',
			userId: VALID_UUID_2,
			orgId: VALID_UUID_3
		});

		const sql = mockExecute.mock.calls[0][0] as string;
		expect(sql).toContain('s.status = :status');
		expect(sql).toContain('s.user_id = :userId');
		expect(sql).toContain('s.org_id = :orgId');
	});

	it('handles null rows in both queries', async () => {
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return { rows: null };
			return { rows: null };
		});

		const { listSessionsEnriched } = await getStandaloneFns();
		const result = await listSessionsEnriched();

		expect(result.total).toBe(0);
		expect(result.sessions).toEqual([]);
	});

	it('handles null MESSAGE_COUNT and LAST_MESSAGE', async () => {
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return { rows: [{ CNT: 1 }] };
			return {
				rows: [
					{
						...MOCK_SESSION_ROW,
						MESSAGE_COUNT: null,
						LAST_MESSAGE: null
					}
				]
			};
		});

		const { listSessionsEnriched } = await getStandaloneFns();
		const result = await listSessionsEnriched();

		expect(result.sessions[0].messageCount).toBe(0);
		expect(result.sessions[0].lastMessage).toBeNull();
	});
});

// ── deleteSession ───────────────────────────────────────────────────────

describe('deleteSession', () => {
	it('returns true when row deleted', async () => {
		mockExecute.mockResolvedValue({ rowsAffected: 1 });

		const { deleteSession } = await getStandaloneFns();
		const result = await deleteSession(VALID_UUID, VALID_UUID_2);

		expect(result).toBe(true);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('DELETE FROM chat_sessions'),
			expect.objectContaining({ id: VALID_UUID, userId: VALID_UUID_2 })
		);
	});

	it('returns false when no rows affected', async () => {
		mockExecute.mockResolvedValue({ rowsAffected: 0 });

		const { deleteSession } = await getStandaloneFns();
		const result = await deleteSession(VALID_UUID, VALID_UUID_2);
		expect(result).toBe(false);
	});

	it('scopes deletion by userId (IDOR prevention)', async () => {
		mockExecute.mockResolvedValue({ rowsAffected: 0 });

		const { deleteSession } = await getStandaloneFns();
		await deleteSession(VALID_UUID, VALID_UUID_2);

		const sql = mockExecute.mock.calls[0][0] as string;
		expect(sql).toContain('id = :id AND user_id = :userId');
	});
});
