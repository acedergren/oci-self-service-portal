/**
 * TDD tests for admin route RBAC enforcement in Fastify.
 *
 * Verifies that /api/admin/* routes are protected by the Fastify RBAC plugin
 * (requireAuth('admin:all')) and return 401/403 for unauthenticated or
 * unauthorized requests.
 *
 * This test suite was written as part of W1-2: moving admin RBAC from the
 * SvelteKit +layout.server.ts into the Fastify layer, ensuring the API itself
 * enforces authorization (not just the SSR layer).
 *
 * Security contract:
 * - Returns 401 for unauthenticated requests (no session, no API key)
 * - Returns 403 for authenticated users without admin:all permission
 * - Returns 200 for users with admin:all permission
 * - admin:all grants access regardless of other permission combinations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, simulateSession } from './test-helpers.js';

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

const mockRegistryCollect = vi.fn();
vi.mock('@portal/server/metrics', () => ({
	registry: {
		collect: (...args: unknown[]) => mockRegistryCollect(...args)
	}
}));

// ── Setup ─────────────────────────────────────────────────────────────────

async function buildAdminApp(): Promise<FastifyInstance> {
	const app = await buildTestApp({ withRbac: true });
	const { adminMetricsRoutes } = await import('../../routes/admin/metrics.js');
	await app.register(adminMetricsRoutes);
	return app;
}

let app: FastifyInstance;

beforeEach(async () => {
	mockRegistryCollect.mockReturnValue('');
});

afterEach(async () => {
	if (app) await app.close();
});

// ── Unauthenticated access ────────────────────────────────────────────────

describe('Admin routes — unauthenticated', () => {
	it('GET /api/admin/metrics/summary returns 401 with no session', async () => {
		app = await buildAdminApp();
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/metrics/summary'
		});

		expect(res.statusCode).toBe(401);
		const body = res.json();
		expect(body.error).toBe('Unauthorized');
	});
});

// ── Insufficient permissions ──────────────────────────────────────────────

describe('Admin routes — authenticated but not admin', () => {
	it('GET /api/admin/metrics/summary returns 403 for regular user without admin:all', async () => {
		app = await buildAdminApp();
		simulateSession(app, { id: 'user-1' }, ['tools:read', 'sessions:read']);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/metrics/summary'
		});

		expect(res.statusCode).toBe(403);
		const body = res.json();
		expect(body.error).toBe('Forbidden');
		expect(body.message).toContain('admin:all');
	});

	it('returns 403 with only tools:execute permission', async () => {
		app = await buildAdminApp();
		simulateSession(app, { id: 'user-2' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/metrics/summary'
		});

		expect(res.statusCode).toBe(403);
	});
});

// ── Admin access granted ──────────────────────────────────────────────────

describe('Admin routes — admin user with admin:all', () => {
	it('GET /api/admin/metrics/summary returns 200 for user with admin:all', async () => {
		app = await buildAdminApp();
		simulateSession(app, { id: 'admin-1' }, ['admin:all']);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/metrics/summary'
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.timestamp).toBeDefined();
		expect(body.chat).toBeDefined();
		expect(body.tools).toBeDefined();
	});

	it('admin:all grants access even with other permissions present', async () => {
		app = await buildAdminApp();
		simulateSession(app, { id: 'admin-2' }, ['tools:read', 'admin:all', 'sessions:read']);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/metrics/summary'
		});

		expect(res.statusCode).toBe(200);
	});
});
