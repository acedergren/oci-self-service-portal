import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { hasPermission, type Permission } from '@portal/shared/server/auth/rbac';
import { validateApiKey } from '@portal/shared/server/auth/api-keys';
import { createLogger } from '@portal/shared/server/logger';

const log = createLogger('fastify-rbac');

/**
 * Create a Fastify preHandler hook that requires a specific permission.
 *
 * Supports dual auth: session (cookie) and API key (Authorization header).
 * Returns 401 if unauthenticated, 403 if unauthorized.
 *
 * Usage in a route:
 * ```ts
 * app.get('/api/v1/tools', {
 *   preHandler: requireAuth('tools:read'),
 *   handler: async (request, reply) => { ... }
 * });
 * ```
 */
export function requireAuth(permission: Permission) {
	return async (request: FastifyRequest, reply: FastifyReply) => {
		// 1. Check session auth (set by auth plugin)
		if (request.user && request.permissions.length > 0) {
			const perms = request.permissions as Permission[];
			if (hasPermission(perms, permission) || hasPermission(perms, 'admin:all')) {
				return; // Authorized via session
			}
			log.warn(
				{ userId: request.user.id, url: request.url, permission },
				'Insufficient session permissions'
			);
			return reply.status(403).send({
				error: 'Forbidden',
				message: `Insufficient permissions: ${permission} required`,
				statusCode: 403
			});
		}

		// 2. Check API key auth (Authorization: Bearer portal_xxx)
		if (request.apiKeyContext) {
			const keyPerms = request.apiKeyContext.permissions as Permission[];
			if (hasPermission(keyPerms, permission)) {
				return; // Authorized via API key
			}
			log.warn(
				{ keyId: request.apiKeyContext.keyId, url: request.url, permission },
				'Insufficient API key permissions'
			);
			return reply.status(403).send({
				error: 'Forbidden',
				message: `Insufficient permissions: ${permission} required`,
				statusCode: 403
			});
		}

		// 3. Try to resolve API key from header if not already resolved
		const authHeader = request.headers.authorization;
		if (authHeader?.startsWith('Bearer portal_')) {
			const apiKey = authHeader.slice(7); // Remove "Bearer "
			try {
				const context = await validateApiKey(apiKey);
				if (context) {
					request.apiKeyContext = context;
					const keyPerms = context.permissions as Permission[];
					if (hasPermission(keyPerms, permission)) {
						return; // Authorized via API key
					}
					return reply.status(403).send({
						error: 'Forbidden',
						message: `Insufficient permissions: ${permission} required`,
						statusCode: 403
					});
				}
			} catch (err) {
				log.debug({ err }, 'API key validation failed');
			}
		}

		// 4. Neither auth method succeeded
		log.warn({ url: request.url, permission }, 'Unauthenticated access attempt');
		return reply.status(401).send({
			error: 'Unauthorized',
			message: 'Authentication required. Provide a session cookie or API key.',
			statusCode: 401
		});
	};
}

/**
 * Resolve the organization ID from the current request context.
 *
 * Works for both auth paths:
 *   - API key auth: reads orgId from apiKeyContext
 *   - Session auth: reads activeOrganizationId from session
 */
export function resolveOrgId(request: FastifyRequest): string | null {
	if (request.apiKeyContext?.orgId) {
		return request.apiKeyContext.orgId;
	}
	if (request.session?.activeOrganizationId) {
		return request.session.activeOrganizationId as string;
	}
	return null;
}

/**
 * Require authentication only (no specific permission check).
 * Useful for endpoints that just need a logged-in user.
 */
export function requireAuthenticated() {
	return async (request: FastifyRequest, reply: FastifyReply) => {
		if (request.user) return;

		// Try API key
		const authHeader = request.headers.authorization;
		if (authHeader?.startsWith('Bearer portal_')) {
			const apiKey = authHeader.slice(7);
			try {
				const context = await validateApiKey(apiKey);
				if (context) {
					request.apiKeyContext = context;
					return;
				}
			} catch {
				// Fall through
			}
		}

		return reply.status(401).send({
			error: 'Unauthorized',
			message: 'Authentication required.',
			statusCode: 401
		});
	};
}

const rbacPlugin: FastifyPluginAsync = async (_fastify) => {
	// The actual guards are standalone functions (requireAuth, resolveOrgId)
	// that can be used as preHandler hooks on individual routes.
	// This plugin just ensures the auth plugin decorators exist.
	log.info('RBAC plugin registered');
};

export default fp(rbacPlugin, {
	name: 'rbac',
	dependencies: ['auth'],
	fastify: '5.x'
});
