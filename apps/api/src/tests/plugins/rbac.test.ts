/**
 * TDD tests for RBAC Fastify plugin and preHandler hooks (Phase 9 task 9.6)
 *
 * Tests the RBAC module at apps/api/src/plugins/rbac.ts which provides:
 * - requireAuth(permission) — preHandler hook for session + API key dual auth
 * - requireAuthenticated() — preHandler hook for auth-only (no permission check)
 * - resolveOrgId(request) — utility to extract org ID from session or API key
 *
 * Security contract:
 * - Returns 401 for unauthenticated requests
 * - Returns 403 when user lacks required permission
 * - Session auth: checks request.user + request.permissions
 * - API key auth: checks Authorization header with portal_ prefix
 * - admin:all permission bypasses specific permission checks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockValidateApiKey = vi.fn();

vi.mock('@portal/server/auth/api-keys', () => ({
	validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args)
}));

vi.mock('@portal/server/auth/rbac', async () => {
	const actual = await vi.importActual<typeof import('@portal/server/auth/rbac')>(
		'@portal/server/auth/rbac'
	);
	return actual;
});

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

// ---------------------------------------------------------------------------
// Helper — builds a Fastify app with minimal auth decorators + RBAC
// ---------------------------------------------------------------------------

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });

	// Simulate the auth plugin's decorators (the rbac plugin depends on these).
	// Fastify 5 requires { getter, setter } for reference-type decorators (arrays).
	const PERMS_KEY = Symbol('permissions');
	const fakeAuthPlugin = fp(
		async (fastify) => {
			fastify.decorateRequest('user', null);
			fastify.decorateRequest('session', null);
			fastify.decorateRequest('permissions', {
				getter(this: FastifyRequest) {
					const self = this as FastifyRequest & { [PERMS_KEY]?: string[] };
					if (!self[PERMS_KEY]) self[PERMS_KEY] = [];
					return self[PERMS_KEY];
				},
				setter(this: FastifyRequest, value: string[]) {
					(this as FastifyRequest & { [PERMS_KEY]?: string[] })[PERMS_KEY] = value;
				}
			});
			fastify.decorateRequest('apiKeyContext', null);
		},
		{ name: 'auth', fastify: '5.x' }
	);

	await app.register(fakeAuthPlugin);

	const rbacPlugin = (await import('../../plugins/rbac.js')).default;
	await app.register(rbacPlugin);

	return app;
}

/**
 * Simulate an authenticated session by setting request decorators in a preHandler.
 */
function simulateSession(
	app: FastifyInstance,
	user: Record<string, unknown>,
	permissions: string[],
	session?: Record<string, unknown>
) {
	app.addHook('onRequest', async (request) => {
		(request as Record<string, unknown>).user = user;
		(request as FastifyRequest).permissions = permissions;
		if (session) {
			(request as Record<string, unknown>).session = session;
		}
	});
}

// ---------------------------------------------------------------------------
// requireAuth tests
// ---------------------------------------------------------------------------

describe('requireAuth – unauthenticated', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		mockValidateApiKey.mockReset();
		app = await buildApp();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('returns 401 when no session and no API key', async () => {
		const { requireAuth } = await import('../../plugins/rbac.js');

		app.get('/protected', {
			preHandler: requireAuth('tools:read'),
			handler: async () => ({ ok: true })
		});
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/protected' });
		expect(res.statusCode).toBe(401);

		const body = JSON.parse(res.body);
		expect(body.error).toBe('Unauthorized');
		expect(body.message).toContain('Authentication required');
	});

	it('returns 401 with descriptive message mentioning both auth methods', async () => {
		const { requireAuth } = await import('../../plugins/rbac.js');

		app.get('/protected', {
			preHandler: requireAuth('tools:read'),
			handler: async () => ({ ok: true })
		});
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/protected' });
		const body = JSON.parse(res.body);

		expect(body.message).toMatch(/session|cookie|API key/i);
	});
});

describe('requireAuth – session auth', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		mockValidateApiKey.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('allows request when user has required permission', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:read', 'sessions:read']);

		const { requireAuth } = await import('../../plugins/rbac.js');
		app.get('/protected', {
			preHandler: requireAuth('tools:read'),
			handler: async () => ({ ok: true })
		});
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/protected' });
		expect(res.statusCode).toBe(200);
	});

	it('returns 403 when user lacks required permission', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:read']);

		const { requireAuth } = await import('../../plugins/rbac.js');
		app.get('/protected', {
			preHandler: requireAuth('tools:execute'),
			handler: async () => ({ ok: true })
		});
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/protected' });
		expect(res.statusCode).toBe(403);

		const body = JSON.parse(res.body);
		expect(body.message).toContain('tools:execute');
	});

	it('allows admin:all to bypass specific permission checks', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'admin-1' }, ['admin:all', 'tools:read']);

		const { requireAuth } = await import('../../plugins/rbac.js');
		app.get('/admin-only', {
			preHandler: requireAuth('admin:users'),
			handler: async () => ({ ok: true })
		});
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/admin-only' });
		expect(res.statusCode).toBe(200);
	});
});

describe('requireAuth – API key auth', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		mockValidateApiKey.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('validates API key from Authorization header', async () => {
		mockValidateApiKey.mockResolvedValue({
			keyId: 'key-1',
			orgId: 'org-1',
			permissions: ['tools:read', 'tools:execute']
		});

		app = await buildApp();

		const { requireAuth } = await import('../../plugins/rbac.js');
		app.get('/api-protected', {
			preHandler: requireAuth('tools:read'),
			handler: async () => ({ ok: true })
		});
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api-protected',
			headers: { authorization: 'Bearer portal_' + 'a'.repeat(64) }
		});

		expect(res.statusCode).toBe(200);
		expect(mockValidateApiKey).toHaveBeenCalled();
	});

	it('returns 403 when API key lacks required permission', async () => {
		mockValidateApiKey.mockResolvedValue({
			keyId: 'key-1',
			orgId: 'org-1',
			permissions: ['tools:read'] // No tools:execute
		});

		app = await buildApp();

		const { requireAuth } = await import('../../plugins/rbac.js');
		app.get('/api-protected', {
			preHandler: requireAuth('tools:execute'),
			handler: async () => ({ ok: true })
		});
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api-protected',
			headers: { authorization: 'Bearer portal_' + 'a'.repeat(64) }
		});

		expect(res.statusCode).toBe(403);
	});

	it('returns 401 when API key validation fails', async () => {
		mockValidateApiKey.mockRejectedValue(new Error('Invalid key'));

		app = await buildApp();

		const { requireAuth } = await import('../../plugins/rbac.js');
		app.get('/api-protected', {
			preHandler: requireAuth('tools:read'),
			handler: async () => ({ ok: true })
		});
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api-protected',
			headers: { authorization: 'Bearer portal_' + 'b'.repeat(64) }
		});

		expect(res.statusCode).toBe(401);
	});

	it('returns 401 when API key returns null (key not found)', async () => {
		mockValidateApiKey.mockResolvedValue(null);

		app = await buildApp();

		const { requireAuth } = await import('../../plugins/rbac.js');
		app.get('/api-protected', {
			preHandler: requireAuth('tools:read'),
			handler: async () => ({ ok: true })
		});
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api-protected',
			headers: { authorization: 'Bearer portal_' + 'c'.repeat(64) }
		});

		expect(res.statusCode).toBe(401);
	});

	it('only tries API key auth for portal_ prefixed tokens', async () => {
		app = await buildApp();

		const { requireAuth } = await import('../../plugins/rbac.js');
		app.get('/api-protected', {
			preHandler: requireAuth('tools:read'),
			handler: async () => ({ ok: true })
		});
		await app.ready();

		// Non-portal token should not trigger validateApiKey
		await app.inject({
			method: 'GET',
			url: '/api-protected',
			headers: { authorization: 'Bearer some-random-jwt-token' }
		});

		expect(mockValidateApiKey).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// resolveOrgId tests
// ---------------------------------------------------------------------------

describe('resolveOrgId', () => {
	it('returns orgId from apiKeyContext', async () => {
		const { resolveOrgId } = await import('../../plugins/rbac.js');

		const request = {
			apiKeyContext: { keyId: 'k1', orgId: 'org-from-key', permissions: [] },
			session: { activeOrganizationId: 'org-from-session' }
		} as unknown as FastifyRequest;

		expect(resolveOrgId(request)).toBe('org-from-key');
	});

	it('falls back to session activeOrganizationId', async () => {
		const { resolveOrgId } = await import('../../plugins/rbac.js');

		const request = {
			apiKeyContext: null,
			session: { activeOrganizationId: 'org-from-session' }
		} as unknown as FastifyRequest;

		expect(resolveOrgId(request)).toBe('org-from-session');
	});

	it('returns null when no org context available', async () => {
		const { resolveOrgId } = await import('../../plugins/rbac.js');

		const request = {
			apiKeyContext: null,
			session: null
		} as unknown as FastifyRequest;

		expect(resolveOrgId(request)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// requireAuthenticated tests
// ---------------------------------------------------------------------------

describe('requireAuthenticated', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		mockValidateApiKey.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('allows request with session user (no permission check)', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, []);

		const { requireAuthenticated } = await import('../../plugins/rbac.js');
		app.get('/auth-only', {
			preHandler: requireAuthenticated(),
			handler: async () => ({ ok: true })
		});
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/auth-only' });
		expect(res.statusCode).toBe(200);
	});

	it('returns 401 when no user and no API key', async () => {
		app = await buildApp();

		const { requireAuthenticated } = await import('../../plugins/rbac.js');
		app.get('/auth-only', {
			preHandler: requireAuthenticated(),
			handler: async () => ({ ok: true })
		});
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/auth-only' });
		expect(res.statusCode).toBe(401);
	});

	it('allows request with valid API key', async () => {
		mockValidateApiKey.mockResolvedValue({
			keyId: 'key-1',
			orgId: 'org-1',
			permissions: ['tools:read']
		});

		app = await buildApp();

		const { requireAuthenticated } = await import('../../plugins/rbac.js');
		app.get('/auth-only', {
			preHandler: requireAuthenticated(),
			handler: async () => ({ ok: true })
		});
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/auth-only',
			headers: { authorization: 'Bearer portal_' + 'd'.repeat(64) }
		});

		expect(res.statusCode).toBe(200);
	});
});
