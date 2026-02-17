/**
 * Unit tests for the organization repository.
 *
 * Mock strategy: Mock `withConnection` to invoke the callback with a fake
 * connection object, and mock `execute` with counter-based sequencing.
 *
 * Source: packages/server/src/oracle/repositories/org-repository.ts (150 lines, 0 tests)
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

const MOCK_ORG_ROW = {
	ID: VALID_UUID,
	NAME: 'Test Org',
	OCI_COMPARTMENT_ID: 'ocid1.compartment.oc1..abc',
	SETTINGS: '{"theme":"dark"}',
	STATUS: 'active',
	CREATED_AT: MOCK_DATE,
	UPDATED_AT: MOCK_DATE
};

const MOCK_MEMBER_ROW = {
	USER_ID: VALID_UUID_2,
	ORG_ID: VALID_UUID,
	ROLE: 'admin',
	CREATED_AT: MOCK_DATE
};

// ── Setup ─────────────────────────────────────────────────────────────────

let callCount: number;

beforeEach(() => {
	vi.clearAllMocks();
	callCount = 0;

	// Default: withConnection invokes the callback with our mock connection
	mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) =>
		fn({ execute: mockExecute, close: vi.fn(), commit: vi.fn(), rollback: vi.fn() })
	);

	// Default: execute returns empty result
	mockExecute.mockImplementation(async () => {
		callCount++;
		return { rows: [] };
	});
});

// ── Import after mocks ────────────────────────────────────────────────────

async function getRepo() {
	const mod = await import('@portal/server/oracle/repositories/org-repository.js');
	return mod.orgRepository;
}

// ── Smoke test ──────────────────────────────────────────────────────────

describe('org-repository (smoke)', () => {
	it('list returns empty array when no rows', async () => {
		const repo = await getRepo();
		const result = await repo.list();
		expect(result).toEqual([]);
	});
});

// ── getById ─────────────────────────────────────────────────────────────

describe('getById', () => {
	it('returns organization with parsed settings', async () => {
		mockExecute.mockResolvedValue({ rows: [MOCK_ORG_ROW] });

		const repo = await getRepo();
		const result = await repo.getById(VALID_UUID);
		expect(result).toBeTruthy();
		expect(result!.id).toBe(VALID_UUID);
		expect(result!.name).toBe('Test Org');
		expect(result!.ociCompartmentId).toBe('ocid1.compartment.oc1..abc');
		expect(result!.settings).toEqual({ theme: 'dark' });
		expect(result!.status).toBe('active');
	});

	it('returns null when not found', async () => {
		mockExecute.mockResolvedValue({ rows: [] });
		const repo = await getRepo();
		const result = await repo.getById('nonexistent');
		expect(result).toBeNull();
	});

	it('handles null SETTINGS', async () => {
		mockExecute.mockResolvedValue({
			rows: [{ ...MOCK_ORG_ROW, SETTINGS: null }]
		});

		const repo = await getRepo();
		const result = await repo.getById(VALID_UUID);
		expect(result!.settings).toBeUndefined();
	});

	it('handles corrupt SETTINGS JSON gracefully', async () => {
		mockExecute.mockResolvedValue({
			rows: [{ ...MOCK_ORG_ROW, SETTINGS: 'not-valid-json' }]
		});

		const repo = await getRepo();
		const result = await repo.getById(VALID_UUID);
		// Should fallback to empty object on parse failure
		expect(result!.settings).toEqual({});
	});

	it('handles null OCI_COMPARTMENT_ID', async () => {
		mockExecute.mockResolvedValue({
			rows: [{ ...MOCK_ORG_ROW, OCI_COMPARTMENT_ID: null }]
		});

		const repo = await getRepo();
		const result = await repo.getById(VALID_UUID);
		expect(result!.ociCompartmentId).toBeUndefined();
	});
});

// ── list ────────────────────────────────────────────────────────────────

describe('list', () => {
	it('maps Oracle UPPERCASE rows to typed Organization objects', async () => {
		mockExecute.mockResolvedValue({ rows: [MOCK_ORG_ROW] });

		const repo = await getRepo();
		const result = await repo.list();

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe(VALID_UUID);
		expect(result[0].name).toBe('Test Org');
		expect(result[0].status).toBe('active');
	});

	it('filters by active status', async () => {
		mockExecute.mockResolvedValue({ rows: [] });

		const repo = await getRepo();
		await repo.list();

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('status = :status'),
			expect.objectContaining({ status: 'active' })
		);
	});

	it('handles null rows', async () => {
		mockExecute.mockResolvedValue({ rows: null });

		const repo = await getRepo();
		const result = await repo.list();
		expect(result).toEqual([]);
	});
});

// ── create ──────────────────────────────────────────────────────────────

describe('create', () => {
	it('inserts and returns the created organization', async () => {
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				// INSERT
				return { rows: [] };
			}
			// SELECT (getById after creation)
			return { rows: [MOCK_ORG_ROW] };
		});

		const repo = await getRepo();
		const result = await repo.create({
			name: 'Test Org',
			ociCompartmentId: 'ocid1.compartment.oc1..abc'
		});

		expect(result.name).toBe('Test Org');
		expect(callCount).toBe(2); // INSERT + SELECT
	});

	it('passes null for optional ociCompartmentId', async () => {
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return { rows: [] };
			return { rows: [{ ...MOCK_ORG_ROW, OCI_COMPARTMENT_ID: null }] };
		});

		const repo = await getRepo();
		await repo.create({ name: 'No Compartment' });

		// First call should be the INSERT
		const insertBinds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		expect(insertBinds.ociCompartmentId).toBeNull();
	});

	it('throws when getById returns null after creation', async () => {
		// Both calls return empty rows — simulates missing row after insert
		mockExecute.mockResolvedValue({ rows: [] });

		const repo = await getRepo();
		await expect(repo.create({ name: 'Ghost' })).rejects.toThrow(
			'Failed to retrieve organization after creation'
		);
	});
});

// ── addMember ──────────────────────────────────────────────────────────

describe('addMember', () => {
	it('inserts a member with correct binds', async () => {
		const repo = await getRepo();
		await repo.addMember(VALID_UUID, VALID_UUID_2, 'admin');

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO org_members'),
			expect.objectContaining({
				orgId: VALID_UUID,
				userId: VALID_UUID_2,
				role: 'admin'
			})
		);
	});
});

// ── removeMember ───────────────────────────────────────────────────────

describe('removeMember', () => {
	it('deletes member by userId and orgId', async () => {
		const repo = await getRepo();
		await repo.removeMember(VALID_UUID, VALID_UUID_2);

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('DELETE FROM org_members'),
			expect.objectContaining({
				orgId: VALID_UUID,
				userId: VALID_UUID_2
			})
		);
	});
});

// ── updateMemberRole ───────────────────────────────────────────────────

describe('updateMemberRole', () => {
	it('updates role for specific member', async () => {
		const repo = await getRepo();
		await repo.updateMemberRole(VALID_UUID, VALID_UUID_2, 'viewer');

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('UPDATE org_members SET role = :role'),
			expect.objectContaining({
				role: 'viewer',
				userId: VALID_UUID_2,
				orgId: VALID_UUID
			})
		);
	});
});

// ── getMembers ─────────────────────────────────────────────────────────

describe('getMembers', () => {
	it('returns mapped member list', async () => {
		mockExecute.mockResolvedValue({ rows: [MOCK_MEMBER_ROW] });

		const repo = await getRepo();
		const result = await repo.getMembers(VALID_UUID);

		expect(result).toHaveLength(1);
		expect(result[0].userId).toBe(VALID_UUID_2);
		expect(result[0].orgId).toBe(VALID_UUID);
		expect(result[0].role).toBe('admin');
		expect(result[0].createdAt).toEqual(MOCK_DATE);
	});

	it('returns empty array when no members', async () => {
		mockExecute.mockResolvedValue({ rows: [] });

		const repo = await getRepo();
		const result = await repo.getMembers(VALID_UUID);
		expect(result).toEqual([]);
	});

	it('handles null rows', async () => {
		mockExecute.mockResolvedValue({ rows: null });

		const repo = await getRepo();
		const result = await repo.getMembers(VALID_UUID);
		expect(result).toEqual([]);
	});
});
