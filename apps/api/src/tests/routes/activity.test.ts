/**
 * TDD tests for Activity routes (Phase 9 task 9.9)
 *
 * Tests the routes at apps/api/src/routes/activity.ts:
 * - GET /api/activity — list recent tool executions for current user
 *
 * Security contract:
 * - Requires 'tools:read' permission
 * - Returns 401 for unauthenticated requests
 * - Returns 403 when user lacks permission
 * - User-scoped: only shows current user's activity
 * - Returns empty list when DB unavailable (fallback mode)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecute = vi.fn();
const mockWithConnection = vi.fn();

vi.mock('@portal/shared/server/oracle/connection', () => ({
	initPool: vi.fn().mockResolvedValue(undefined),
	closePool: vi.fn().mockResolvedValue(undefined),
	withConnection: (...args: unknown[]) => mockWithConnection(...args),
	getPoolStats: vi.fn().mockResolvedValue(null),
	isPoolInitialized: vi.fn(() => true)
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
// Helper
// ---------------------------------------------------------------------------

const PERMS_KEY = Symbol('permissions');

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);

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

	const { activityRoutes } = await import('../../routes/activity.js');
	await app.register(async (instance) => activityRoutes(instance));

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
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/activity', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		mockWithConnection.mockReset();
		mockExecute.mockReset();
		mockValidateApiKey.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('returns 401 for unauthenticated requests', async () => {
		app = await buildApp();
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/activity' });
		expect(res.statusCode).toBe(401);
	});

	it('returns 403 when user lacks tools:read permission', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/activity' });
		expect(res.statusCode).toBe(403);
	});

	it('returns activity items for authorized user', async () => {
		const now = new Date();
		mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) =>
			fn({
				execute: vi
					.fn()
					.mockResolvedValueOnce({ rows: [{ CNT: 2 }] })
					.mockResolvedValueOnce({
						rows: [
							{
								ID: 'act-1',
								TOOL_CATEGORY: 'compute',
								TOOL_NAME: 'list-instances',
								ACTION: 'executed',
								SUCCESS: 1,
								CREATED_AT: now
							},
							{
								ID: 'act-2',
								TOOL_CATEGORY: 'storage',
								TOOL_NAME: 'list-buckets',
								ACTION: 'failed',
								SUCCESS: 0,
								CREATED_AT: now
							}
						]
					})
			})
		);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/activity' });
		expect(res.statusCode).toBe(200);

		const body = JSON.parse(res.body);
		expect(body.items).toHaveLength(2);
		expect(body.total).toBe(2);
		expect(body.items[0].id).toBe('act-1');
		expect(body.items[0].type).toBe('compute');
		expect(body.items[0].status).toBe('completed');
		expect(body.items[1].status).toBe('failed');
	});

	it('returns empty list when DB is unavailable', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		app.addHook('onRequest', async (request) => {
			(request as any).dbAvailable = false;
		});
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/activity' });
		expect(res.statusCode).toBe(200);

		const body = JSON.parse(res.body);
		expect(body.items).toEqual([]);
		expect(body.total).toBe(0);
	});

	it('returns empty list for authenticated user without id', async () => {
		app = await buildApp();
		// User object without id
		simulateSession(app, {}, ['tools:read']);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/activity' });
		expect(res.statusCode).toBe(200);

		const body = JSON.parse(res.body);
		expect(body.items).toEqual([]);
		expect(body.total).toBe(0);
	});

	it('passes limit and offset query params', async () => {
		let capturedBinds: unknown;
		mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) =>
			fn({
				execute: vi.fn().mockImplementation(async (_sql: string, binds: unknown) => {
					capturedBinds = binds;
					return { rows: [] };
				})
			})
		);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		await app.ready();

		await app.inject({
			method: 'GET',
			url: '/api/activity?limit=10&offset=5'
		});

		// The second execute call should have offset and maxRows
		expect(capturedBinds).toEqual(expect.objectContaining({ offset: 5, maxRows: 10 }));
	});

	it('validates limit range (max 100)', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/activity?limit=200'
		});

		expect(res.statusCode).toBe(400);
	});

	it('handles DB errors gracefully', async () => {
		mockWithConnection.mockRejectedValue(new Error('Connection failed'));

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/activity' });
		expect(res.statusCode).toBe(500);

		const body = JSON.parse(res.body);
		expect(body.items).toEqual([]);
	});

	it('maps activity status correctly for pending actions', async () => {
		const now = new Date();
		mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) =>
			fn({
				execute: vi
					.fn()
					.mockResolvedValueOnce({ rows: [{ CNT: 1 }] })
					.mockResolvedValueOnce({
						rows: [
							{
								ID: 'act-3',
								TOOL_CATEGORY: 'database',
								TOOL_NAME: 'terminate-db',
								ACTION: 'requested',
								SUCCESS: null,
								CREATED_AT: now
							}
						]
					})
			})
		);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/activity' });
		const body = JSON.parse(res.body);

		expect(body.items[0].status).toBe('pending');
	});
});
