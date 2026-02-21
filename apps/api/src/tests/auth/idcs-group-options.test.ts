/**
 * Tests for GroupMappingOptions — DB-driven group-to-role overrides.
 *
 * The new `options` parameter on mapIdcsGroupsToRole() allows per-IDP
 * admin/operator group lists from the admin panel to override env-var defaults.
 *
 * Also tests provisionFromIdcsGroups() fetching IDP records for group config.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock setup ───────────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockIdpGetByProviderId = vi.fn();

vi.mock('@portal/server/oracle/connection', () => ({
	withConnection: vi.fn(async (fn: (conn: { execute: typeof mockExecute }) => unknown) => {
		return fn({ execute: mockExecute });
	})
}));

vi.mock('@portal/server/admin/idp-repository.js', () => ({
	idpRepository: {
		getByProviderId: (...args: unknown[]) => mockIdpGetByProviderId(...args)
	}
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

// Stub env vars so auth/config.ts module loads without error
vi.stubEnv('OCI_IAM_CLIENT_ID', 'test-client-id');
vi.stubEnv('OCI_IAM_CLIENT_SECRET', 'test-client-secret');

// ── Tests: mapIdcsGroupsToRole with GroupMappingOptions ──────────────────

describe('mapIdcsGroupsToRole with GroupMappingOptions', () => {
	let mapIdcsGroupsToRole: typeof import('@portal/server/auth/idcs-provisioning').mapIdcsGroupsToRole;

	beforeEach(async () => {
		const mod = await import('@portal/server/auth/idcs-provisioning');
		mapIdcsGroupsToRole = mod.mapIdcsGroupsToRole;
	});

	it('uses custom adminGroups when provided', () => {
		const role = mapIdcsGroupsToRole(['MyCustomAdmins'], {
			adminGroups: ['MyCustomAdmins']
		});
		expect(role).toBe('admin');
	});

	it('uses custom operatorGroups when provided', () => {
		const role = mapIdcsGroupsToRole(['DevOpsTeam'], {
			operatorGroups: ['DevOpsTeam']
		});
		expect(role).toBe('operator');
	});

	it('custom groups override env-var defaults', () => {
		// 'PortalAdmins' is in the env-var default admin list,
		// but custom options don't include it — should NOT match
		const role = mapIdcsGroupsToRole(['PortalAdmins'], {
			adminGroups: ['DifferentAdminGroup'],
			operatorGroups: ['DifferentOperatorGroup']
		});
		expect(role).toBe('viewer');
	});

	it('falls back to env-var defaults when options is undefined', () => {
		// Without options, env-var defaults should work
		const role = mapIdcsGroupsToRole(['PortalAdmins']);
		expect(role).toBe('admin');
	});

	it('falls back to env-var defaults when options fields are undefined', () => {
		// Options with undefined fields should use env-var defaults
		const role = mapIdcsGroupsToRole(['PortalAdmins'], {
			adminGroups: undefined,
			operatorGroups: undefined
		});
		expect(role).toBe('admin');
	});

	it('is case-insensitive for custom groups', () => {
		const role = mapIdcsGroupsToRole(['mycustomadmins'], {
			adminGroups: ['MyCustomAdmins']
		});
		expect(role).toBe('admin');
	});

	it('admin custom groups take precedence over operator custom groups', () => {
		const role = mapIdcsGroupsToRole(['TeamLead'], {
			adminGroups: ['TeamLead'],
			operatorGroups: ['TeamLead']
		});
		expect(role).toBe('admin');
	});

	it('returns viewer when user groups match neither custom admin nor operator', () => {
		const role = mapIdcsGroupsToRole(['RandomGroup', 'AnotherGroup'], {
			adminGroups: ['Admins'],
			operatorGroups: ['Operators']
		});
		expect(role).toBe('viewer');
	});

	it('handles empty custom groups arrays', () => {
		const role = mapIdcsGroupsToRole(['PortalAdmins'], {
			adminGroups: [],
			operatorGroups: []
		});
		// Empty arrays mean no groups match — should be viewer
		expect(role).toBe('viewer');
	});
});

// ── Tests: provisionFromIdcsGroups with DB-driven group config ───────────

describe('provisionFromIdcsGroups with IDP record overrides', () => {
	let provisionFromIdcsGroups: typeof import('@portal/server/auth/idcs-provisioning').provisionFromIdcsGroups;
	let callCount: number;

	beforeEach(async () => {
		callCount = 0;
		mockExecute.mockReset();
		mockIdpGetByProviderId.mockReset();

		// Default: IDP lookup returns null (no record)
		mockIdpGetByProviderId.mockResolvedValue(null);

		const mod = await import('@portal/server/auth/idcs-provisioning');
		provisionFromIdcsGroups = mod.provisionFromIdcsGroups;
	});

	it('uses IDP record adminGroups when available', async () => {
		mockIdpGetByProviderId.mockResolvedValue({
			adminGroups: 'CustomAdmins,SuperUsers',
			operatorGroups: null
		});

		// Counter-based mock: 1st call = admin count, 2nd call = MERGE
		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				// Admin count check — no admins yet
				return { rows: [{ CNT: 1 }] };
			}
			// MERGE INTO
			return {};
		});

		const role = await provisionFromIdcsGroups('user-1', 'org-1', ['CustomAdmins']);
		expect(role).toBe('admin');
		expect(mockIdpGetByProviderId).toHaveBeenCalledWith('oci-iam');
	});

	it('uses IDP record operatorGroups when available', async () => {
		mockIdpGetByProviderId.mockResolvedValue({
			adminGroups: null,
			operatorGroups: 'DevOps,SRE'
		});

		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return { rows: [{ CNT: 1 }] };
			return {};
		});

		const role = await provisionFromIdcsGroups('user-2', 'org-1', ['DevOps']);
		expect(role).toBe('operator');
	});

	it('falls back to env-var defaults when IDP record has no group config', async () => {
		mockIdpGetByProviderId.mockResolvedValue({
			adminGroups: null,
			operatorGroups: null
		});

		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return { rows: [{ CNT: 1 }] };
			return {};
		});

		// 'PortalAdmins' is in env-var defaults
		const role = await provisionFromIdcsGroups('user-3', 'org-1', ['PortalAdmins']);
		expect(role).toBe('admin');
	});

	it('falls back gracefully when IDP repository throws', async () => {
		mockIdpGetByProviderId.mockRejectedValue(new Error('DB not ready'));

		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return { rows: [{ CNT: 1 }] };
			return {};
		});

		// Should still resolve a role using env-var defaults
		const role = await provisionFromIdcsGroups('user-4', 'org-1', ['PortalOperators']);
		expect(role).toBe('operator');
	});

	it('promotes first user to admin when no admins exist in org', async () => {
		mockIdpGetByProviderId.mockResolvedValue(null);

		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				// Admin count check — zero admins
				return { rows: [{ CNT: 0 }] };
			}
			// MERGE INTO
			return {};
		});

		// User has no admin groups, but should be promoted as first-user bootstrap
		const role = await provisionFromIdcsGroups('user-5', 'org-1', ['SomeRandomGroup']);
		expect(role).toBe('admin');
	});

	it('does NOT promote when admins already exist', async () => {
		mockIdpGetByProviderId.mockResolvedValue(null);

		callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				// Admin count check — admins exist
				return { rows: [{ CNT: 2 }] };
			}
			return {};
		});

		const role = await provisionFromIdcsGroups('user-6', 'org-1', ['SomeRandomGroup']);
		expect(role).toBe('viewer');
	});

	it('skips admin-bootstrap check for users already mapped to admin', async () => {
		mockIdpGetByProviderId.mockResolvedValue(null);

		mockExecute.mockResolvedValue({});

		// User is in PortalAdmins (env default) — no need for bootstrap check
		const role = await provisionFromIdcsGroups('user-7', 'org-1', ['PortalAdmins']);
		expect(role).toBe('admin');

		// MERGE should be the only DB call (no admin-count query needed)
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});
});
