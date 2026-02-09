/**
 * TDD tests for Better Auth Fastify plugin (Phase 9 task 9.5)
 *
 * Tests the auth plugin at apps/api/src/plugins/auth.ts which wraps
 * Better Auth session resolution as a Fastify onRequest hook.
 *
 * Plugin contract:
 * - Decorates request with { user, session, permissions, apiKeyContext }
 * - Resolves session from cookies via Better Auth on each request
 * - Skips session resolution for excluded paths (health, metrics)
 * - Maps session role to permissions via RBAC module
 * - Defaults to empty permissions on auth failure (fail-open for resolution)
 * - Does not block requests — individual routes guard via preHandler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn();

vi.mock('@portal/shared/server/auth/config', () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => mockGetSession(...args)
		}
	}
}));

vi.mock('@portal/shared/server/auth/rbac', async () => {
	const actual = await vi.importActual<typeof import('@portal/shared/server/auth/rbac')>(
		'@portal/shared/server/auth/rbac'
	);
	return actual;
});

vi.mock('@portal/shared/server/logger', () => ({
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
// Helper
// ---------------------------------------------------------------------------

async function buildApp(
	pluginOpts: Record<string, unknown> = {},
	registerRoutes?: (app: FastifyInstance) => void
): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });

	const authPlugin = (await import('../../plugins/auth.js')).default;
	await app.register(authPlugin, pluginOpts);

	// Inspection endpoint — returns request decorators as JSON
	app.get('/test-auth', async (request) => {
		return {
			hasUser: !!request.user,
			userId: request.user?.id ?? null,
			hasSession: !!request.session,
			permissions: request.permissions,
			hasApiKeyContext: !!request.apiKeyContext
		};
	});

	// Register additional routes before ready() (Fastify blocks route adds after ready)
	if (registerRoutes) registerRoutes(app);

	await app.ready();
	return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Auth Fastify plugin – decoration', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		mockGetSession.mockResolvedValue(null);
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('decorates request.user as null by default', async () => {
		app = await buildApp();
		const res = await app.inject({ method: 'GET', url: '/test-auth' });
		const body = JSON.parse(res.body);
		expect(body.hasUser).toBe(false);
		expect(body.userId).toBeNull();
	});

	it('decorates request.session as null by default', async () => {
		app = await buildApp();
		const res = await app.inject({ method: 'GET', url: '/test-auth' });
		const body = JSON.parse(res.body);
		expect(body.hasSession).toBe(false);
	});

	it('decorates request.permissions as empty array by default', async () => {
		app = await buildApp();
		const res = await app.inject({ method: 'GET', url: '/test-auth' });
		const body = JSON.parse(res.body);
		expect(body.permissions).toEqual([]);
	});

	it('decorates request.apiKeyContext as null by default', async () => {
		app = await buildApp();
		const res = await app.inject({ method: 'GET', url: '/test-auth' });
		const body = JSON.parse(res.body);
		expect(body.hasApiKeyContext).toBe(false);
	});
});

describe('Auth Fastify plugin – session resolution', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		mockGetSession.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('resolves user and session from Better Auth', async () => {
		mockGetSession.mockResolvedValue({
			user: { id: 'user-123', name: 'Alice', email: 'alice@example.com' },
			session: { id: 'sess-456', role: 'operator', activeOrganizationId: 'org-789' }
		});

		app = await buildApp();
		const res = await app.inject({
			method: 'GET',
			url: '/test-auth',
			headers: { cookie: 'better-auth.session_token=mock-token' }
		});

		const body = JSON.parse(res.body);
		expect(body.hasUser).toBe(true);
		expect(body.userId).toBe('user-123');
		expect(body.hasSession).toBe(true);
	});

	it('maps session role to RBAC permissions', async () => {
		mockGetSession.mockResolvedValue({
			user: { id: 'user-123', name: 'Alice' },
			session: { id: 'sess-456', role: 'operator' }
		});

		app = await buildApp();
		const res = await app.inject({
			method: 'GET',
			url: '/test-auth',
			headers: { cookie: 'better-auth.session_token=mock-token' }
		});

		const body = JSON.parse(res.body);
		expect(body.permissions).toContain('tools:read');
		expect(body.permissions).toContain('tools:execute');
		expect(body.permissions).toContain('tools:approve');
		expect(body.permissions).not.toContain('admin:all');
	});

	it('defaults to viewer permissions when role is missing', async () => {
		mockGetSession.mockResolvedValue({
			user: { id: 'user-123', name: 'Bob' },
			session: { id: 'sess-456' } // No role property
		});

		app = await buildApp();
		const res = await app.inject({
			method: 'GET',
			url: '/test-auth',
			headers: { cookie: 'better-auth.session_token=mock-token' }
		});

		const body = JSON.parse(res.body);
		expect(body.permissions).toContain('tools:read');
		expect(body.permissions).toContain('sessions:read');
		expect(body.permissions).not.toContain('tools:execute');
	});

	it('leaves permissions empty when no session returned', async () => {
		mockGetSession.mockResolvedValue(null);

		app = await buildApp();
		const res = await app.inject({ method: 'GET', url: '/test-auth' });

		const body = JSON.parse(res.body);
		expect(body.permissions).toEqual([]);
		expect(body.hasUser).toBe(false);
	});

	it('handles getSession() throwing gracefully (fail-open)', async () => {
		mockGetSession.mockRejectedValue(new Error('Better Auth internal error'));

		app = await buildApp();
		const res = await app.inject({
			method: 'GET',
			url: '/test-auth',
			headers: { cookie: 'better-auth.session_token=bad-token' }
		});

		// Should NOT return 500 — the hook catches the error
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.hasUser).toBe(false);
		expect(body.permissions).toEqual([]);
	});
});

describe('Auth Fastify plugin – excluded paths', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		mockGetSession.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('skips session resolution for excluded paths', async () => {
		app = await buildApp({ excludePaths: ['/healthz', '/health', '/skip-me'] }, (a) => {
			a.get('/skip-me', async (request) => {
				return { permissions: request.permissions };
			});
		});

		const res = await app.inject({ method: 'GET', url: '/skip-me' });

		// getSession should NOT have been called for this path
		expect(mockGetSession).not.toHaveBeenCalled();
		expect(res.statusCode).toBe(200);
	});

	it('still resolves sessions for non-excluded paths', async () => {
		mockGetSession.mockResolvedValue({
			user: { id: 'user-1' },
			session: { id: 'sess-1', role: 'admin' }
		});

		app = await buildApp({ excludePaths: ['/health'] });
		await app.inject({
			method: 'GET',
			url: '/test-auth',
			headers: { cookie: 'better-auth.session_token=valid' }
		});

		expect(mockGetSession).toHaveBeenCalledTimes(1);
	});

	it('strips query params before matching excluded paths', async () => {
		app = await buildApp({ excludePaths: ['/health'] }, (a) => {
			a.get('/health', async () => ({ status: 'ok' }));
		});

		await app.inject({ method: 'GET', url: '/health?verbose=true' });

		// Should be excluded even with query params
		expect(mockGetSession).not.toHaveBeenCalled();
	});
});

describe('Auth Fastify plugin – admin role', () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) await app.close();
	});

	it('grants all permissions to admin role', async () => {
		mockGetSession.mockResolvedValue({
			user: { id: 'admin-1', name: 'Admin' },
			session: { id: 'sess-1', role: 'admin' }
		});

		app = await buildApp();
		const res = await app.inject({
			method: 'GET',
			url: '/test-auth',
			headers: { cookie: 'better-auth.session_token=admin-token' }
		});

		const body = JSON.parse(res.body);
		expect(body.permissions).toContain('admin:all');
		expect(body.permissions).toContain('tools:execute');
		expect(body.permissions).toContain('tools:danger');
		expect(body.permissions).toContain('workflows:write');
		expect(body.permissions.length).toBe(13); // All 13 permissions
	});
});
