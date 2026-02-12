/**
 * TDD tests for Metrics route (Phase 9 task 9.7)
 *
 * Tests the route at apps/api/src/routes/metrics.ts:
 * - GET /api/metrics — Prometheus text format metrics
 *
 * Contract:
 * - Returns Prometheus text format (text/plain)
 * - Does NOT require authentication
 * - Calls registry.collect() from shared metrics module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCollect = vi
	.fn()
	.mockReturnValue(
		'# HELP portal_http_requests_total Total HTTP requests\n' +
			'# TYPE portal_http_requests_total counter\n' +
			'portal_http_requests_total{method="GET",status="200"} 42\n'
	);

vi.mock('@portal/server/metrics', () => ({
	registry: {
		collect: (...args: unknown[]) => mockCollect(...args)
	}
}));

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
// Helper
// ---------------------------------------------------------------------------

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });

	const { metricsRoutes } = await import('../../routes/metrics.js');
	await app.register(async (instance) => metricsRoutes(instance));

	return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/metrics', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		// Re-configure mockCollect after mockReset: true clears it
		mockCollect.mockReturnValue(
			'# HELP portal_http_requests_total Total HTTP requests\n' +
				'# TYPE portal_http_requests_total counter\n' +
				'portal_http_requests_total{method="GET",status="200"} 42\n'
		);
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('returns 200 with Prometheus text format', async () => {
		app = await buildApp();
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/metrics' });
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toContain('text/plain');
	});

	it('returns metrics content from registry.collect()', async () => {
		app = await buildApp();
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/metrics' });
		expect(res.body).toContain('portal_http_requests_total');
		expect(res.body).toContain('# TYPE');
		expect(mockCollect).toHaveBeenCalled();
	});

	it('does not require authentication', async () => {
		app = await buildApp();
		await app.ready();

		// No auth headers at all
		const res = await app.inject({ method: 'GET', url: '/api/metrics' });
		expect(res.statusCode).toBe(200);
	});

	it('returns correct Content-Type for Prometheus scraping', async () => {
		app = await buildApp();
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/metrics' });
		expect(res.headers['content-type']).toContain('text/plain');
		expect(res.headers['content-type']).toContain('charset=utf-8');
	});
});
