/**
 * Phase 8: IDCS Provisioning Tests
 *
 * Tests the IDCS auto-provisioning pipeline:
 * - Profile cache (stash IDCS claims during OAuth callback)
 * - Group-to-role mapping
 * - Org resolution (existing membership → tenant mapping → default)
 * - Org membership upsert (MERGE INTO)
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock Oracle connection before importing modules
const mockExecute = vi.fn();
vi.mock('@portal/server/oracle/connection', () => ({
	withConnection: vi.fn(async (fn: (conn: { execute: typeof mockExecute }) => unknown) => {
		return fn({ execute: mockExecute });
	})
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn()
	})
}));

// Stub env vars required by requireEnv() in auth/config.ts (called at module scope)
vi.stubEnv('OCI_IAM_CLIENT_ID', 'test-client-id');
vi.stubEnv('OCI_IAM_CLIENT_SECRET', 'test-client-secret');

// ── Group-to-role mapping ──────────────────────────────────────────────────
describe('mapIdcsGroupsToRole', () => {
	let mapIdcsGroupsToRole: (groups: string[]) => 'admin' | 'operator' | 'viewer';

	beforeEach(async () => {
		const mod = await import('@portal/server/auth/idcs-provisioning');
		mapIdcsGroupsToRole = mod.mapIdcsGroupsToRole;
	});

	test('maps admin group to admin role', () => {
		expect(mapIdcsGroupsToRole(['PortalAdmins'])).toBe('admin');
		expect(mapIdcsGroupsToRole(['OCI_Administrators'])).toBe('admin');
		expect(mapIdcsGroupsToRole(['Administrators'])).toBe('admin');
	});

	test('maps operator group to operator role', () => {
		expect(mapIdcsGroupsToRole(['PortalOperators'])).toBe('operator');
		expect(mapIdcsGroupsToRole(['OCI_Operators'])).toBe('operator');
		expect(mapIdcsGroupsToRole(['CloudOperators'])).toBe('operator');
	});

	test('defaults to viewer when no known groups', () => {
		expect(mapIdcsGroupsToRole([])).toBe('viewer');
		expect(mapIdcsGroupsToRole(['SomeOtherGroup'])).toBe('viewer');
	});

	test('admin takes precedence over operator', () => {
		expect(mapIdcsGroupsToRole(['PortalOperators', 'PortalAdmins'])).toBe('admin');
	});
});

// ── IDCS Profile Cache ─────────────────────────────────────────────────────
describe('idcsProfileCache', () => {
	let stashIdcsProfile: (sub: string, groups: string[], tenantName?: string) => void;
	let consumeIdcsProfile: (sub: string) => { groups: string[]; tenantName?: string } | null;

	beforeEach(async () => {
		const mod = await import('@portal/server/auth/idcs-provisioning');
		stashIdcsProfile = mod.stashIdcsProfile;
		consumeIdcsProfile = mod.consumeIdcsProfile;
	});

	test('stashes and consumes IDCS profile data', () => {
		stashIdcsProfile('user-sub-1', ['PortalAdmins'], 'myTenant');
		const result = consumeIdcsProfile('user-sub-1');
		expect(result).toEqual({ groups: ['PortalAdmins'], tenantName: 'myTenant' });
	});

	test('consume is single-use (removes entry)', () => {
		stashIdcsProfile('user-sub-2', ['OCI_Operators']);
		consumeIdcsProfile('user-sub-2');
		expect(consumeIdcsProfile('user-sub-2')).toBeNull();
	});

	test('returns null for unknown sub', () => {
		expect(consumeIdcsProfile('unknown-sub')).toBeNull();
	});

	test('stash without tenant name', () => {
		stashIdcsProfile('user-sub-3', ['CloudOperators']);
		const result = consumeIdcsProfile('user-sub-3');
		expect(result).toEqual({ groups: ['CloudOperators'], tenantName: undefined });
	});
});

// ── Org resolution ──────────────────────────────────────────────────────────
describe('resolveIdcsOrg', () => {
	let resolveIdcsOrg: (userId: string, tenantName?: string) => Promise<string | null>;

	beforeEach(async () => {
		vi.clearAllMocks();
		delete process.env.OCI_IAM_TENANT_ORG_MAP;
		delete process.env.OCI_IAM_DEFAULT_ORG_ID;
		const mod = await import('@portal/server/auth/idcs-provisioning');
		resolveIdcsOrg = mod.resolveIdcsOrg;
	});

	test('returns existing org membership from DB', async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{ ORG_ID: 'existing-org-123' }]
		});

		const result = await resolveIdcsOrg('user-1');
		expect(result).toBe('existing-org-123');
	});

	test('falls back to tenant mapping when no existing membership', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });
		process.env.OCI_IAM_TENANT_ORG_MAP = 'myTenant:org-from-mapping';

		const result = await resolveIdcsOrg('user-2', 'myTenant');
		expect(result).toBe('org-from-mapping');
	});

	test('falls back to default org when no tenant mapping', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });
		process.env.OCI_IAM_DEFAULT_ORG_ID = 'default-org-456';

		const result = await resolveIdcsOrg('user-3');
		expect(result).toBe('default-org-456');
	});

	test('returns null when no org can be resolved', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const result = await resolveIdcsOrg('user-4');
		expect(result).toBeNull();
	});

	test('handles DB error gracefully and falls through', async () => {
		mockExecute.mockRejectedValueOnce(new Error('DB down'));
		process.env.OCI_IAM_DEFAULT_ORG_ID = 'fallback-org';

		const result = await resolveIdcsOrg('user-5');
		expect(result).toBe('fallback-org');
	});
});

// ── Org membership provisioning ────────────────────────────────────────────
describe('provisionFromIdcsGroups', () => {
	let provisionFromIdcsGroups: (userId: string, orgId: string, groups: string[]) => Promise<string>;

	beforeEach(async () => {
		vi.clearAllMocks();
		const mod = await import('@portal/server/auth/idcs-provisioning');
		provisionFromIdcsGroups = mod.provisionFromIdcsGroups;
	});

	test('provisions admin role for admin group', async () => {
		mockExecute.mockResolvedValueOnce({});

		const role = await provisionFromIdcsGroups('user-1', 'org-1', ['PortalAdmins']);
		expect(role).toBe('admin');
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('MERGE INTO org_members'),
			expect.objectContaining({ userId: 'user-1', orgId: 'org-1', role: 'admin' }),
			expect.objectContaining({ autoCommit: true })
		);
	});

	test('provisions operator role for operator group', async () => {
		mockExecute.mockResolvedValueOnce({});

		const role = await provisionFromIdcsGroups('user-2', 'org-1', ['OCI_Operators']);
		expect(role).toBe('operator');
	});

	test('provisions viewer role when no matching groups', async () => {
		mockExecute.mockResolvedValueOnce({});

		const role = await provisionFromIdcsGroups('user-3', 'org-1', ['SomeGroup']);
		expect(role).toBe('viewer');
	});

	test('returns computed role even when DB write fails', async () => {
		mockExecute.mockRejectedValueOnce(new Error('DB write failed'));

		const role = await provisionFromIdcsGroups('user-4', 'org-1', ['PortalAdmins']);
		expect(role).toBe('admin');
	});

	test('uses MERGE INTO for atomic upsert', async () => {
		mockExecute.mockResolvedValueOnce({});

		await provisionFromIdcsGroups('user-5', 'org-1', ['CloudOperators']);

		const sql = mockExecute.mock.calls[0][0] as string;
		expect(sql).toContain('MERGE INTO org_members');
		expect(sql).toContain('WHEN MATCHED THEN UPDATE');
		expect(sql).toContain('WHEN NOT MATCHED THEN INSERT');
	});
});
