import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { withConnection } from '@portal/server/oracle/connection';
import type { OracleConnection } from '@portal/server/oracle/connection';
import { createLogger } from '@portal/server/logger';
import { resolveOrgId } from './rbac.js';

const log = createLogger('vpd');

/**
 * Determine whether this request carries admin:all permissions.
 * Admin users bypass tenant row filtering and can see all org data.
 */
function isAdminRequest(request: FastifyRequest): boolean {
	const perms = request.permissions as string[];
	return Array.isArray(perms) && perms.includes('admin:all');
}

/**
 * `withVPD` — wrap a DB callback with Oracle VPD tenant context.
 *
 * For authenticated requests with an org context:
 *   1. Borrow a connection from the pool
 *   2. Call portal_ctx_pkg.set_org_id(:orgId) (or set_admin_bypass for admin:all)
 *   3. Execute the caller's callback
 *   4. Always call portal_ctx_pkg.clear_context() in a finally block
 *
 * For unauthenticated requests (no org):
 *   - Executes the callback without setting VPD context
 *   - The VPD policy will return '1=0' (deny all) for these connections
 *   - This is intentional — callers that reach here without an org should
 *     either not touch VPD-protected tables or expect empty results
 *
 * @param request  - The current Fastify request (provides org/user context)
 * @param fn       - Database callback receiving a borrowed OracleConnection
 */
async function withVPD<T>(
	request: FastifyRequest,
	fn: (conn: OracleConnection) => Promise<T>
): Promise<T> {
	const orgId = resolveOrgId(request);

	// No org context — skip VPD setup, execute without tenant filter
	if (!orgId) {
		return withConnection(fn);
	}

	const admin = isAdminRequest(request);

	return withConnection(async (conn) => {
		// Set tenant context before any query
		if (admin) {
			await conn.execute('BEGIN portal_ctx_pkg.set_admin_bypass; END;', []);
		} else {
			await conn.execute('BEGIN portal_ctx_pkg.set_org_id(:orgId); END;', { orgId });
		}

		try {
			return await fn(conn);
		} finally {
			// Always clear — prevents context leaking to the next request that
			// borrows this connection from the pool
			try {
				await conn.execute('BEGIN portal_ctx_pkg.clear_context; END;', []);
			} catch (err) {
				// Log but do not re-throw — connection cleanup must not mask the original error
				log.warn({ err, orgId }, 'VPD clear_context failed — context may persist on connection');
			}
		}
	});
}

declare module 'fastify' {
	interface FastifyRequest {
		/**
		 * Execute a DB callback within the Oracle VPD tenant context for this request.
		 * Automatically sets portal_ctx_pkg context before and clears it after.
		 *
		 * Usage:
		 * ```ts
		 * const rows = await request.withVPD(async (conn) => {
		 *   const result = await conn.execute('SELECT * FROM workflow_definitions', []);
		 *   return result.rows ?? [];
		 * });
		 * ```
		 */
		withVPD: <T>(fn: (conn: OracleConnection) => Promise<T>) => Promise<T>;
	}
}

const VPD_KEY = Symbol('fastify.request.withVPD');

/**
 * Fastify VPD plugin — wires Oracle Virtual Private Database tenant isolation
 * into the request lifecycle.
 *
 * Must be registered AFTER the auth plugin so that request.user,
 * request.session, and request.apiKeyContext are populated.
 *
 * Provides `request.withVPD(fn)` for route handlers to use instead of
 * the raw `fastify.oracle.withConnection(fn)` when querying VPD-protected tables.
 */
const vpdPlugin: FastifyPluginAsync = async (fastify) => {
	// Decorate each request with a bound withVPD helper using symbol-keyed getter/setter
	// to avoid the reference-type array restriction.
	fastify.decorateRequest('withVPD', {
		getter(this: FastifyRequest) {
			const self = this as FastifyRequest & { [VPD_KEY]?: FastifyRequest['withVPD'] };
			if (!self[VPD_KEY]) {
				self[VPD_KEY] = <T>(fn: (conn: OracleConnection) => Promise<T>) => withVPD(this, fn);
			}
			return self[VPD_KEY]!;
		},
		setter(this: FastifyRequest, value: unknown) {
			const self = this as FastifyRequest & { [VPD_KEY]?: FastifyRequest['withVPD'] };
			self[VPD_KEY] = value as FastifyRequest['withVPD'];
		}
	});

	log.info('VPD plugin registered — portal_ctx_pkg tenant isolation active');
};

export default fp(vpdPlugin, {
	name: 'vpd',
	dependencies: ['oracle', 'auth'],
	fastify: '5.x'
});
