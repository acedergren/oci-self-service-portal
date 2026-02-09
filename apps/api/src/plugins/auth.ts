import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { auth, type Session, type User } from '@portal/shared/server/auth/config';
import { getPermissionsForRole } from '@portal/shared/server/auth/rbac';
import { createLogger } from '@portal/shared/server/logger';
import type { ApiKeyContext } from '@portal/shared/server/api/types';

const log = createLogger('fastify-auth');
const PERMISSIONS_KEY = Symbol('fastify.request.permissions');

export interface AuthPluginOptions {
	/** Paths excluded from session resolution (e.g., /healthz). */
	excludePaths?: string[];
}

declare module 'fastify' {
	interface FastifyRequest {
		/** Authenticated user, or null if anonymous. */
		user: User | null;
		/** Active session, or null. */
		session: (Session & Record<string, unknown>) | null;
		/** Resolved permissions from role. */
		permissions: string[];
		/** API key context (set by API key validation middleware). */
		apiKeyContext: ApiKeyContext | null;
	}
}

/**
 * Convert a Fastify request to a Web API Request for Better Auth.
 *
 * Better Auth's `auth.api.getSession()` needs a `Request`-like object
 * with headers (specifically the cookie header for session lookup).
 */
function toWebRequest(request: FastifyRequest): Request {
	const url = `${request.protocol}://${request.hostname}${request.url}`;
	const headers = new Headers();

	for (const [key, value] of Object.entries(request.headers)) {
		if (value) {
			headers.set(key, Array.isArray(value) ? value.join(', ') : value);
		}
	}

	return new Request(url, {
		method: request.method,
		headers
	}) as Request;
}

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
	const { excludePaths = ['/healthz', '/health', '/api/auth'] } = opts;
	const excludeSet = new Set(excludePaths);

	// Decorate requests with auth fields
	fastify.decorateRequest('user', null);
	fastify.decorateRequest('session', null);
	fastify.decorateRequest('permissions', {
		getter(this: FastifyRequest): string[] {
			const requestState = this as FastifyRequest & {
				[PERMISSIONS_KEY]?: string[];
			};

			if (!requestState[PERMISSIONS_KEY]) {
				requestState[PERMISSIONS_KEY] = [];
			}

			return requestState[PERMISSIONS_KEY];
		},
		setter(this: FastifyRequest, value: string[]) {
			const requestState = this as FastifyRequest & {
				[PERMISSIONS_KEY]?: string[];
			};

			requestState[PERMISSIONS_KEY] = value;
		}
	});
	fastify.decorateRequest('apiKeyContext', null);

	// Resolve session on every request (except excluded paths)
	fastify.addHook('onRequest', async (request) => {
		request.permissions = [];

		const path = request.url.split('?')[0].replace(/\/+$/, '') || '/';
		const isExcluded =
			excludeSet.has(path) ||
			Array.from(excludeSet).some((prefix) => path.startsWith(`${prefix}/`));
		if (isExcluded) {
			return;
		}

		try {
			const webRequest = toWebRequest(request);
			const sessionResult = await auth.api.getSession({ headers: webRequest.headers });

			if (sessionResult?.user && sessionResult?.session) {
				request.user = sessionResult.user;
				request.session = sessionResult.session as Session & Record<string, unknown>;

				// Resolve role-based permissions.
				// The org role comes from the session's activeOrganizationId membership.
				// For simplicity, default to the session role or 'viewer'.
				const role = (sessionResult.session as Record<string, unknown>).role as string | undefined;
				request.permissions = getPermissionsForRole(role ?? 'viewer');
			}
		} catch (err) {
			// Auth failure should not block the request — endpoints guard individually.
			log.warn({ err, url: request.url }, 'Session resolution failed');
		}
	});
};

export default fp(authPlugin, {
	name: 'auth',
	fastify: '5.x'
});
