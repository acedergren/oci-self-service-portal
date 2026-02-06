import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { createLogger } from '$lib/server/logger.js';

const log = createLogger('rbac');

// ============================================================================
// Permissions
// ============================================================================

export const PERMISSIONS = {
	'tools:read': 'View tool definitions and results',
	'tools:execute': 'Execute auto-approved tools',
	'tools:approve': 'Approve/reject tool executions',
	'tools:danger': 'Execute danger-level tools',
	'sessions:read': 'View chat sessions',
	'sessions:write': 'Create/modify chat sessions',
	'workflows:read': 'View workflow definitions and runs',
	'workflows:write': 'Create/modify workflow definitions',
	'workflows:execute': 'Execute workflows',
	'admin:users': 'Manage users',
	'admin:orgs': 'Manage organizations',
	'admin:audit': 'View audit logs',
	'admin:all': 'Full admin access'
} as const;

export type Permission = keyof typeof PERMISSIONS;

// ============================================================================
// Role -> Permission mapping
// ============================================================================

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
	viewer: ['tools:read', 'sessions:read', 'workflows:read'],
	operator: [
		'tools:read',
		'tools:execute',
		'tools:approve',
		'sessions:read',
		'sessions:write',
		'workflows:read',
		'workflows:execute'
	],
	admin: Object.keys(PERMISSIONS) as Permission[]
};

/**
 * Get the list of permissions for a given org role.
 * Falls back to viewer permissions for unknown roles.
 */
export function getPermissionsForRole(role: string): Permission[] {
	return ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS['viewer'];
}

/**
 * Check whether a set of user permissions includes the required one.
 */
export function hasPermission(userPermissions: Permission[], required: Permission): boolean {
	return userPermissions.includes(required);
}

// ============================================================================
// Route-level permission guard
// ============================================================================

/**
 * Throw a SvelteKit error if the current user lacks `permission`.
 *
 * Usage in a +server.ts handler:
 * ```ts
 * requirePermission(event, 'tools:execute');
 * ```
 */
export function requirePermission(event: RequestEvent, permission: Permission): void {
	const user = event.locals.user;

	if (!user) {
		log.warn({ path: event.url.pathname, permission }, 'unauthenticated access attempt');
		throw error(401, 'Authentication required');
	}

	const userPerms = event.locals.permissions ?? [];

	if (!hasPermission(userPerms, permission) && !hasPermission(userPerms, 'admin:all')) {
		log.warn({ userId: user.id, path: event.url.pathname, permission }, 'insufficient permissions');
		throw error(403, `Insufficient permissions: ${permission} required`);
	}
}
