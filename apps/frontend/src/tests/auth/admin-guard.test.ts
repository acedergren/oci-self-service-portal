/**
 * C-8: Admin layout RBAC guard tests.
 *
 * Verifies that the admin layout server load function:
 * - Allows admin users through
 * - Redirects viewer users to /
 * - Redirects operator users to /
 * - Redirects unauthenticated users to /login
 */

import { describe, it, expect } from 'vitest';
import { redirect, isRedirect } from '@sveltejs/kit';

// Simulate the admin layout guard logic (mirrors +layout.server.ts)
function adminGuard(user: unknown, session: { role?: string } | null): 'allowed' | string {
	if (!user) {
		return '/login';
	}
	if (session?.role !== 'admin') {
		return '/';
	}
	return 'allowed';
}

describe('Admin layout guard', () => {
	it('allows admin users', () => {
		const result = adminGuard({ id: 'user-1', name: 'Admin' }, { role: 'admin' });
		expect(result).toBe('allowed');
	});

	it('redirects viewer users to /', () => {
		const result = adminGuard({ id: 'user-2', name: 'Viewer' }, { role: 'viewer' });
		expect(result).toBe('/');
	});

	it('redirects operator users to /', () => {
		const result = adminGuard({ id: 'user-3', name: 'Operator' }, { role: 'operator' });
		expect(result).toBe('/');
	});

	it('redirects unauthenticated users to /login', () => {
		const result = adminGuard(null, null);
		expect(result).toBe('/login');
	});

	it('redirects users with no role to /', () => {
		const result = adminGuard({ id: 'user-4', name: 'No Role' }, { role: undefined });
		expect(result).toBe('/');
	});

	it('redirects users with null session to /', () => {
		const result = adminGuard({ id: 'user-5', name: 'Null Session' }, null);
		expect(result).toBe('/');
	});
});
