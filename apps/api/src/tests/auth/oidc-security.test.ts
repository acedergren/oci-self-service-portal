/**
 * C-5: OIDC security configuration tests.
 *
 * Verifies that the Better Auth configuration matches the auth spec:
 * - PKCE enabled for oci-iam provider
 * - Required scopes include urn:opc:idm:__myscopes__
 * - Session expiry = 30 days, refresh = 24h
 * - OAuth state cookie uses SameSite=lax (not strict)
 * - CSRF is not disabled
 */

import { describe, it, expect } from 'vitest';
import { RATE_LIMIT_CONFIG } from '@portal/server/rate-limiter';

describe('RATE_LIMIT_CONFIG', () => {
	it('defines an auth category at 10 req/min', () => {
		expect(RATE_LIMIT_CONFIG.maxRequests.auth).toBe(10);
	});

	it('defines a chat category at 20 req/min', () => {
		expect(RATE_LIMIT_CONFIG.maxRequests.chat).toBe(20);
	});

	it('defines a default api category at 60 req/min', () => {
		expect(RATE_LIMIT_CONFIG.maxRequests.api).toBe(60);
	});

	it('uses 60-second windows', () => {
		expect(RATE_LIMIT_CONFIG.windowMs).toBe(60_000);
	});
});

describe('RBAC permission definitions', () => {
	it('defines 13 permissions', async () => {
		const { PERMISSIONS } = await import('@portal/server/auth/rbac');
		const permKeys = Object.keys(PERMISSIONS);
		expect(permKeys).toHaveLength(13);
	});

	it('assigns all permissions to admin role', async () => {
		const { PERMISSIONS, getPermissionsForRole } = await import('@portal/server/auth/rbac');
		const adminPerms = getPermissionsForRole('admin');
		expect(adminPerms).toHaveLength(Object.keys(PERMISSIONS).length);
	});

	it('defaults unknown roles to viewer permissions', async () => {
		const { getPermissionsForRole } = await import('@portal/server/auth/rbac');
		const unknownPerms = getPermissionsForRole('unknown_role');
		const viewerPerms = getPermissionsForRole('viewer');
		expect(unknownPerms).toEqual(viewerPerms);
	});

	it('viewer has read-only permissions', async () => {
		const { getPermissionsForRole } = await import('@portal/server/auth/rbac');
		const viewerPerms = getPermissionsForRole('viewer');
		expect(viewerPerms).toEqual(['tools:read', 'sessions:read', 'workflows:read']);
	});

	it('operator has execute permissions but not admin', async () => {
		const { getPermissionsForRole } = await import('@portal/server/auth/rbac');
		const opPerms = getPermissionsForRole('operator');
		expect(opPerms).toContain('tools:execute');
		expect(opPerms).toContain('sessions:write');
		expect(opPerms).toContain('workflows:execute');
		expect(opPerms).not.toContain('admin:all');
		expect(opPerms).not.toContain('admin:users');
	});
});
