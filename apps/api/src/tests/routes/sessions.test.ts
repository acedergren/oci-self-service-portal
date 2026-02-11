/**
 * TDD tests for Session routes (Phase 9 task 9.8)
 *
 * Tests the routes at apps/api/src/routes/sessions.ts:
 * - GET    /api/sessions     — list enriched sessions (user-scoped)
 * - POST   /api/sessions     — create a new session
 * - DELETE  /api/sessions/:id — delete a session (user-scoped, ownership check)
 *
 * Security contract:
 * - GET/POST require 'sessions:read' / 'sessions:write' permission
 * - DELETE requires 'sessions:write' + verifies ownership
 * - Returns 401 for unauthenticated requests
 * - Returns 403 when user lacks required permission
 * - Returns empty list / 503 when DB is unavailable (fallback mode)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockListSessionsEnriched = vi.fn();
const mockCreate = vi.fn();
const mockDeleteSession = vi.fn();

vi.mock('@portal/shared/server/oracle/repositories/session-repository', () => ({
	sessionRepository: {
		create: (...args: unknown[]) => mockCreate(...args)
	},
	listSessionsEnriched: (...args: unknown[]) => mockListSessionsEnriched(...args),
	deleteSession: (...args: unknown[]) => mockDeleteSession(...args)
}));

const mockValidateApiKey = vi.fn();
vi.mock('@portal/shared/server/auth/api-keys', () => ({
	validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args)
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

vi.mock('@portal/shared/server/auth/config', () => ({
	auth: {
		api: {
			getSession: vi.fn().mockResolvedValue(null)
		}
	}
}));

// ---------------------------------------------------------------------------
// Helper — builds a Fastify app with auth, RBAC, and session routes
// ---------------------------------------------------------------------------

const PERMS_KEY = Symbol('permissions');

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);

	// Register cookie support (required for session cookie handling)
	await app.register(fastifyCookie);

	// Fake auth plugin (decorates request like the real auth plugin)
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
			fastify.decorateRequest('dbAvailable', true);
		},
		{ name: 'auth', fastify: '5.x' }
	);

	await app.register(fakeAuthPlugin);

	const rbacPlugin = (await import('../../plugins/rbac.js')).default;
	await app.register(rbacPlugin);

	const { sessionRoutes } = await import('../../routes/sessions.js');
	await app.register(async (instance) => sessionRoutes(instance));

	return app;
}

function simulateSession(
	app: FastifyInstance,
	user: Record<string, unknown>,
	permissions: string[]
) {
	app.addHook('onRequest', async (request) => {
		(request as FastifyRequest).user = user as any;
		(request as FastifyRequest).permissions = permissions;
	});
}

// ---------------------------------------------------------------------------
// GET /api/sessions
// ---------------------------------------------------------------------------

describe('GET /api/sessions', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		mockListSessionsEnriched.mockReset();
		mockValidateApiKey.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('returns 401 for unauthenticated requests', async () => {
		app = await buildApp();
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/sessions' });
		expect(res.statusCode).toBe(401);
	});

	it('returns 403 when user lacks sessions:read permission', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/sessions' });
		expect(res.statusCode).toBe(403);
	});

	it('returns sessions for authorized user', async () => {
		const now = new Date();
		mockListSessionsEnriched.mockResolvedValue({
			sessions: [
				{
					id: 'sess-1',
					title: 'Test Session',
					model: 'default',
					region: 'eu-frankfurt-1',
					status: 'active',
					messageCount: 5,
					lastMessage: 'Hello',
					createdAt: now,
					updatedAt: now
				}
			],
			total: 1
		});

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/sessions' });
		expect(res.statusCode).toBe(200);

		const body = JSON.parse(res.body);
		expect(body.sessions).toHaveLength(1);
		expect(body.sessions[0].id).toBe('sess-1');
		expect(body.total).toBe(1);
	});

	it('passes query params to repository', async () => {
		mockListSessionsEnriched.mockResolvedValue({ sessions: [], total: 0 });

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		await app.ready();

		await app.inject({
			method: 'GET',
			url: '/api/sessions?limit=10&offset=5&search=test'
		});

		expect(mockListSessionsEnriched).toHaveBeenCalledWith(
			expect.objectContaining({
				limit: 10,
				offset: 5,
				search: 'test',
				userId: 'user-1'
			})
		);
	});

	it('validates query param types (rejects negative offset)', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/sessions?offset=-1'
		});

		expect(res.statusCode).toBe(400);
	});

	it('validates query param types (rejects limit > 100)', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/sessions?limit=200'
		});

		expect(res.statusCode).toBe(400);
	});

	it('returns empty list when DB is unavailable', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		// Override dbAvailable to false
		app.addHook('onRequest', async (request) => {
			(request as any).dbAvailable = false;
		});
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/sessions' });
		expect(res.statusCode).toBe(200);

		const body = JSON.parse(res.body);
		expect(body.sessions).toEqual([]);
		expect(body.message).toContain('Database not available');
	});

	it('returns 503 when repository throws', async () => {
		mockListSessionsEnriched.mockRejectedValue(new Error('DB connection lost'));

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/sessions' });
		// Route catches the error and returns a DatabaseError (503) response
		expect(res.statusCode).toBe(503);
	});
});

// ---------------------------------------------------------------------------
// POST /api/sessions
// ---------------------------------------------------------------------------

describe('POST /api/sessions', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		mockCreate.mockReset();
		mockValidateApiKey.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('returns 401 for unauthenticated requests', async () => {
		app = await buildApp();
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/sessions',
			payload: { model: 'default' }
		});

		expect(res.statusCode).toBe(401);
	});

	it('returns 403 when user lacks sessions:write permission', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/sessions',
			payload: { model: 'default' }
		});

		expect(res.statusCode).toBe(403);
	});

	it('creates session and returns 201', async () => {
		mockCreate.mockResolvedValue({
			id: 'new-sess-1',
			model: 'default',
			region: 'eu-frankfurt-1',
			title: 'My Session'
		});

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:write']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/sessions',
			payload: { model: 'default', region: 'eu-frankfurt-1', title: 'My Session' }
		});

		expect(res.statusCode).toBe(201);
		const body = JSON.parse(res.body);
		expect(body.session.id).toBe('new-sess-1');
	});

	it('passes userId from session to repository', async () => {
		mockCreate.mockResolvedValue({ id: 'new-sess' });

		app = await buildApp();
		simulateSession(app, { id: 'user-42' }, ['sessions:write']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/sessions',
			payload: { model: 'default' }
		});

		expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-42' }));
	});

	it('returns 503 when DB is unavailable', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:write']);
		app.addHook('onRequest', async (request) => {
			(request as any).dbAvailable = false;
		});
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/sessions',
			payload: { model: 'default' }
		});

		expect(res.statusCode).toBe(503);
	});

	it('uses default model and region when not provided', async () => {
		mockCreate.mockResolvedValue({ id: 'new-sess' });

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:write']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/sessions',
			payload: {}
		});

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'default',
				region: 'eu-frankfurt-1'
			})
		);
	});
});

// ---------------------------------------------------------------------------
// DELETE /api/sessions/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/sessions/:id', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		mockDeleteSession.mockReset();
		mockValidateApiKey.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('returns 401 for unauthenticated requests', async () => {
		app = await buildApp();
		await app.ready();

		const res = await app.inject({
			method: 'DELETE',
			url: '/api/sessions/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
		});

		expect(res.statusCode).toBe(401);
	});

	it('returns 403 when user lacks sessions:write permission', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		await app.ready();

		const res = await app.inject({
			method: 'DELETE',
			url: '/api/sessions/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
		});

		expect(res.statusCode).toBe(403);
	});

	it('deletes session and returns success', async () => {
		mockDeleteSession.mockResolvedValue(true);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:write']);
		await app.ready();

		const res = await app.inject({
			method: 'DELETE',
			url: '/api/sessions/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.success).toBe(true);
	});

	it('passes userId for ownership check', async () => {
		mockDeleteSession.mockResolvedValue(true);

		app = await buildApp();
		simulateSession(app, { id: 'user-42' }, ['sessions:write']);
		await app.ready();

		await app.inject({
			method: 'DELETE',
			url: '/api/sessions/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
		});

		expect(mockDeleteSession).toHaveBeenCalledWith(
			'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
			'user-42'
		);
	});

	it('returns 404 when session not found or not owned', async () => {
		mockDeleteSession.mockResolvedValue(false);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:write']);
		await app.ready();

		const res = await app.inject({
			method: 'DELETE',
			url: '/api/sessions/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
		});

		expect(res.statusCode).toBe(404);
	});

	it('validates UUID format in params', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:write']);
		await app.ready();

		const res = await app.inject({
			method: 'DELETE',
			url: '/api/sessions/not-a-uuid'
		});

		expect(res.statusCode).toBe(400);
	});

	it('returns 503 when DB is unavailable', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:write']);
		app.addHook('onRequest', async (request) => {
			(request as any).dbAvailable = false;
		});
		await app.ready();

		const res = await app.inject({
			method: 'DELETE',
			url: '/api/sessions/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
		});

		expect(res.statusCode).toBe(503);
	});
});
