import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Oracle connection
const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
const mockConn = {
	execute: mockExecute,
	commit: vi.fn().mockResolvedValue(undefined),
	rollback: vi.fn().mockResolvedValue(undefined),
	close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) => fn(mockConn)),
}));

// Mock logger
vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

// Store original env
const originalEnv = { ...process.env };

describe('Multi-tenancy', () => {
	let resolveCompartment: typeof import('$lib/server/auth/tenancy.js').resolveCompartment;
	let getOrgRole: typeof import('$lib/server/auth/tenancy.js').getOrgRole;

	beforeEach(async () => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		process.env.OCI_COMPARTMENT_ID = 'ocid1.compartment.default';

		const tenancy = await import('$lib/server/auth/tenancy.js');
		resolveCompartment = tenancy.resolveCompartment;
		getOrgRole = tenancy.getOrgRole;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	describe('resolveCompartment', () => {
		it('resolves compartment for user with org that has compartment', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [{
					ID: 'org-1',
					NAME: 'Acme Corp',
					OCI_COMPARTMENT_ID: 'ocid1.compartment.acme',
				}],
			});

			const ctx = await resolveCompartment('user-with-org');
			expect(ctx).not.toBeNull();
			expect(ctx!.orgId).toBe('org-1');
			expect(ctx!.orgName).toBe('Acme Corp');
			expect(ctx!.compartmentId).toBe('ocid1.compartment.acme');
		});

		it('returns null for user without org membership', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const ctx = await resolveCompartment('user-no-org');
			expect(ctx).toBeNull();
		});

		it('falls back to env compartment if org has no compartment', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [{
					ID: 'org-2',
					NAME: 'No Compartment Org',
					OCI_COMPARTMENT_ID: null,
				}],
			});

			const ctx = await resolveCompartment('user-org-no-compartment');
			expect(ctx).not.toBeNull();
			expect(ctx!.compartmentId).toBe('ocid1.compartment.default');
		});

		it('scopes lookup to specific org when orgId is provided', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [{
					ID: 'org-specific',
					NAME: 'Specific Org',
					OCI_COMPARTMENT_ID: 'ocid1.compartment.specific',
				}],
			});

			const ctx = await resolveCompartment('user-1', 'org-specific');
			expect(ctx).not.toBeNull();
			expect(ctx!.orgId).toBe('org-specific');

			// Verify the query included orgId bind
			const callArgs = mockExecute.mock.calls[0];
			expect(callArgs[1]).toEqual({ userId: 'user-1', orgId: 'org-specific' });
		});

		it('returns empty compartmentId when no env fallback configured', async () => {
			delete process.env.OCI_COMPARTMENT_ID;

			mockExecute.mockResolvedValueOnce({
				rows: [{
					ID: 'org-3',
					NAME: 'Org Without Compartment',
					OCI_COMPARTMENT_ID: null,
				}],
			});

			const ctx = await resolveCompartment('user-1');
			expect(ctx).not.toBeNull();
			expect(ctx!.compartmentId).toBe('');
		});

		it('returns null on database error', async () => {
			mockExecute.mockRejectedValueOnce(new Error('DB connection failed'));

			const ctx = await resolveCompartment('user-1');
			expect(ctx).toBeNull();
		});
	});

	describe('getOrgRole', () => {
		it('gets org role for user who is a member', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [{ ROLE: 'operator' }],
			});

			const role = await getOrgRole('user-1', 'org-1');
			expect(role).toBe('operator');
		});

		it('returns null role for non-member', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const role = await getOrgRole('user-not-in-org', 'org-1');
			expect(role).toBeNull();
		});

		it('returns admin role for org admin', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [{ ROLE: 'admin' }],
			});

			const role = await getOrgRole('admin-user', 'org-1');
			expect(role).toBe('admin');
		});

		it('returns null when orgId is not provided', async () => {
			const role = await getOrgRole('user-1');
			expect(role).toBeNull();
			// Should not make a DB call when orgId is missing
			expect(mockExecute).not.toHaveBeenCalled();
		});

		it('returns null on database error', async () => {
			mockExecute.mockRejectedValueOnce(new Error('DB connection failed'));

			const role = await getOrgRole('user-1', 'org-1');
			expect(role).toBeNull();
		});
	});
});
