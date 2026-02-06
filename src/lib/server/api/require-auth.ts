/**
 * Auth guard for REST API v1 endpoints.
 *
 * Supports dual authentication:
 *   1. Session auth (cookie-based, via Better Auth) — permissions from event.locals.permissions
 *   2. API key auth (header-based) — permissions from event.locals.apiKeyContext
 *
 * Usage:
 *   requireApiAuth(event, 'tools:read');  // throws 401/403 SvelteKit error
 */
import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { Permission } from '$lib/server/auth/rbac.js';
import { hasPermission } from '$lib/server/auth/rbac.js';
import { createLogger } from '$lib/server/logger.js';

const log = createLogger('api-v1-auth');

/**
 * Require authentication and authorization for an API v1 request.
 *
 * Checks session auth first, then API key auth.
 * Throws SvelteKit 401 if unauthenticated, 403 if unauthorized.
 */
export function requireApiAuth(event: RequestEvent, permission: Permission): void {
	const { user, permissions, apiKeyContext } = event.locals;

	// Check session auth
	if (user && permissions.length > 0) {
		if (!hasPermission(permissions, permission) && !hasPermission(permissions, 'admin:all')) {
			log.warn(
				{ userId: user.id, path: event.url.pathname, permission },
				'v1 insufficient session permissions'
			);
			throw error(403, `Insufficient permissions: ${permission} required`);
		}
		return; // Authorized via session
	}

	// Check API key auth
	if (apiKeyContext) {
		const keyPerms = apiKeyContext.permissions as Permission[];
		if (!hasPermission(keyPerms, permission)) {
			log.warn(
				{ keyId: apiKeyContext.keyId, path: event.url.pathname, permission },
				'v1 insufficient API key permissions'
			);
			throw error(403, `Insufficient permissions: ${permission} required`);
		}
		return; // Authorized via API key
	}

	// Neither auth method succeeded
	log.warn({ path: event.url.pathname, permission }, 'v1 unauthenticated access attempt');
	throw error(401, 'Authentication required. Provide a session cookie or API key.');
}

/**
 * Resolve the organization ID from the current request context.
 *
 * Works for both auth paths:
 *   - API key auth: reads orgId from apiKeyContext
 *   - Session auth: reads activeOrganizationId from session
 *
 * Returns null if no org context is available (caller should return 400).
 */
export function resolveOrgId(event: RequestEvent): string | null {
	// API key auth — orgId is always set
	if (event.locals.apiKeyContext?.orgId) {
		return event.locals.apiKeyContext.orgId;
	}
	// Session auth — activeOrganizationId from Better Auth session
	const session = event.locals.session as Record<string, unknown> | undefined;
	if (session?.activeOrganizationId && typeof session.activeOrganizationId === 'string') {
		return session.activeOrganizationId;
	}
	return null;
}
