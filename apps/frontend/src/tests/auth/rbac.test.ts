import { describe, it, expect } from 'vitest';
import {
	getPermissionsForRole,
	hasPermission,
	requirePermission,
	PERMISSIONS,
	type Permission
} from '@portal/shared/server/auth/rbac.js';

describe('RBAC Permission System', () => {
	describe('getPermissionsForRole', () => {
		it('viewer role gets read-only permissions', () => {
			const perms = getPermissionsForRole('viewer');
			expect(perms).toContain('tools:read');
			expect(perms).toContain('sessions:read');
			expect(perms).not.toContain('tools:execute');
			expect(perms).not.toContain('admin:all');
		});

		it('operator role gets execute + approve permissions', () => {
			const perms = getPermissionsForRole('operator');
			expect(perms).toContain('tools:read');
			expect(perms).toContain('tools:execute');
			expect(perms).toContain('tools:approve');
			expect(perms).toContain('sessions:write');
			expect(perms).not.toContain('tools:danger');
			expect(perms).not.toContain('admin:all');
		});

		it('admin role gets all permissions', () => {
			const perms = getPermissionsForRole('admin');
			// Admin gets every permission key
			const allPermissions = Object.keys(PERMISSIONS) as Permission[];
			for (const p of allPermissions) {
				expect(perms).toContain(p);
			}
		});

		it('unknown role falls back to viewer permissions', () => {
			const perms = getPermissionsForRole('unknown');
			const viewerPerms = getPermissionsForRole('viewer');
			expect(perms).toEqual(viewerPerms);
		});
	});

	describe('hasPermission', () => {
		it('returns true when permission exists', () => {
			expect(hasPermission(['tools:read', 'tools:execute'], 'tools:read')).toBe(true);
		});

		it('returns false when permission is missing', () => {
			expect(hasPermission(['tools:read'], 'tools:execute')).toBe(false);
		});

		it('is a simple includes check (no wildcard expansion)', () => {
			// hasPermission itself does NOT expand admin:all as a wildcard.
			// The wildcard logic lives in requirePermission.
			expect(hasPermission(['admin:all'], 'tools:danger')).toBe(false);
			expect(hasPermission(['admin:all'], 'admin:all')).toBe(true);
		});

		it('empty permissions array returns false', () => {
			expect(hasPermission([], 'tools:read')).toBe(false);
		});

		it('handles empty string as permission', () => {
			expect(hasPermission(['tools:read'], '' as Permission)).toBe(false);
		});
	});

	describe('requirePermission', () => {
		function makeEvent(
			user: { id: string } | undefined,
			permissions: Permission[]
		): { locals: { user: typeof user; permissions: Permission[] }; url: { pathname: string } } {
			return {
				locals: { user, permissions },
				url: { pathname: '/api/test' }
			};
		}

		it('throws 401 when user is not set', () => {
			const event = makeEvent(undefined, []);
			expect(() => requirePermission(event as never, 'tools:read')).toThrow();
		});

		it('throws 403 when permission is missing', () => {
			const event = makeEvent({ id: 'u1' }, ['tools:read']);
			expect(() => requirePermission(event as never, 'tools:execute')).toThrow();
		});

		it('does not throw when permission is present', () => {
			const event = makeEvent({ id: 'u1' }, ['tools:read', 'tools:execute']);
			expect(() => requirePermission(event as never, 'tools:execute')).not.toThrow();
		});

		it('admin:all grants any permission via requirePermission', () => {
			const event = makeEvent({ id: 'u1' }, ['admin:all']);
			// requirePermission checks admin:all as a fallback wildcard
			expect(() => requirePermission(event as never, 'tools:danger')).not.toThrow();
			expect(() => requirePermission(event as never, 'sessions:write')).not.toThrow();
		});

		it('throws 403 even with some permissions when required is missing', () => {
			const event = makeEvent({ id: 'u1' }, ['tools:read', 'sessions:read']);
			expect(() => requirePermission(event as never, 'admin:users')).toThrow();
		});
	});
});
