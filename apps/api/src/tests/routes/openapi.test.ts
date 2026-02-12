/**
 * Tests for OpenAPI spec endpoint (Phase 9 task 9.18)
 *
 * Validates that /api/v1/openapi.json:
 * - Returns 200 with valid OpenAPI 3.0 JSON
 * - Includes Cache-Control header for caching
 * - Is accessible without authentication
 * - Contains the expected OpenAPI structure
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';

// Mock dependencies
vi.mock('@portal/server/oracle/connection', () => ({
	initPool: vi.fn().mockResolvedValue(undefined),
	closePool: vi.fn().mockResolvedValue(undefined),
	withConnection: vi.fn(async (fn: (conn: unknown) => unknown) =>
		fn({
			execute: vi.fn().mockResolvedValue({ rows: [{ RESULT: 1 }] }),
			close: vi.fn().mockResolvedValue(undefined),
			commit: vi.fn(),
			rollback: vi.fn()
		})
	),
	getPoolStats: vi.fn().mockResolvedValue({
		connectionsOpen: 5,
		connectionsInUse: 2,
		poolMin: 2,
		poolMax: 10
	}),
	isPoolInitialized: vi.fn(() => true),
	getPool: vi.fn()
}));

vi.mock('@portal/server/sentry', () => ({
	wrapWithSpan: vi.fn((_name: string, _op: string, fn: () => unknown) => fn()),
	captureError: vi.fn(),
	isSentryEnabled: vi.fn(() => false),
	initSentry: vi.fn(),
	closeSentry: vi.fn()
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: vi.fn(() => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	}))
}));

vi.mock('@portal/server/oracle/migrations', () => ({
	runMigrations: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@portal/server/oracle/repositories/webhook-repository', () => ({
	webhookRepository: {
		migratePlaintextSecrets: vi.fn().mockResolvedValue({ migrated: 0, remaining: 0 })
	}
}));

vi.mock('@portal/server/auth/config', () => ({
	auth: {
		api: {
			getSession: vi.fn().mockResolvedValue(null)
		}
	}
}));

vi.mock('@portal/server/health', () => ({
	runHealthChecks: vi.fn().mockResolvedValue({
		status: 'ok',
		checks: {
			database: { status: 'ok', latencyMs: 1 },
			connection_pool: { status: 'ok', latencyMs: 1 },
			oci_cli: { status: 'ok', latencyMs: 1 },
			sentry: { status: 'ok', latencyMs: 1 },
			metrics: { status: 'ok', latencyMs: 1 }
		},
		timestamp: new Date().toISOString(),
		uptime: 1,
		version: '0.1.0'
	})
}));

describe('GET /api/v1/openapi.json', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		// Re-setup mocks cleared by mockReset: true
		const oracleMod = await import('@portal/server/oracle/connection');
		(oracleMod.initPool as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
		(oracleMod.closePool as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
		(oracleMod.withConnection as ReturnType<typeof vi.fn>).mockImplementation(
			async (fn: (conn: unknown) => unknown) =>
				fn({
					execute: vi.fn().mockResolvedValue({ rows: [{ RESULT: 1 }] }),
					close: vi.fn().mockResolvedValue(undefined),
					commit: vi.fn(),
					rollback: vi.fn()
				})
		);
		(oracleMod.getPoolStats as ReturnType<typeof vi.fn>).mockResolvedValue({
			connectionsOpen: 5,
			connectionsInUse: 2,
			poolMin: 2,
			poolMax: 10
		});
		(oracleMod.isPoolInitialized as ReturnType<typeof vi.fn>).mockReturnValue(true);

		const healthMod = await import('@portal/server/health');
		(healthMod.runHealthChecks as ReturnType<typeof vi.fn>).mockResolvedValue({
			status: 'ok',
			checks: {
				database: { status: 'ok', latencyMs: 1 },
				connection_pool: { status: 'ok', latencyMs: 1 },
				oci_cli: { status: 'ok', latencyMs: 1 },
				sentry: { status: 'ok', latencyMs: 1 },
				metrics: { status: 'ok', latencyMs: 1 }
			},
			timestamp: new Date().toISOString(),
			uptime: 1,
			version: '0.1.0'
		});
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('should return 200 with valid JSON', async () => {
		// Enable swagger for this test
		app = await createApp({ enableRateLimit: false, enableDocs: true });
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/api/v1/openapi.json'
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers['content-type']).toContain('application/json');

		// Verify response is valid JSON
		const body = JSON.parse(response.body);
		expect(body).toBeDefined();
	});

	it('should contain valid OpenAPI 3.0 structure', async () => {
		app = await createApp({ enableRateLimit: false, enableDocs: true });
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/api/v1/openapi.json'
		});

		const spec = JSON.parse(response.body);

		// Verify OpenAPI structure
		expect(spec).toHaveProperty('openapi');
		expect(spec.openapi).toMatch(/^3\.\d+\.\d+$/); // OpenAPI 3.x.x
		expect(spec).toHaveProperty('info');
		expect(spec.info).toHaveProperty('title');
		expect(spec.info).toHaveProperty('version');
	});

	it('should include Cache-Control header', async () => {
		app = await createApp({ enableRateLimit: false, enableDocs: true });
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/api/v1/openapi.json'
		});

		expect(response.headers['cache-control']).toBe('public, max-age=3600');
	});

	it('should be accessible without authentication', async () => {
		app = await createApp({ enableRateLimit: false, enableDocs: true });
		await app.ready();

		// No auth headers
		const response = await app.inject({
			method: 'GET',
			url: '/api/v1/openapi.json'
		});

		// Should not return 401 Unauthorized
		expect(response.statusCode).toBe(200);
	});

	it('should not include itself in the spec', async () => {
		app = await createApp({ enableRateLimit: false, enableDocs: true });
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/api/v1/openapi.json'
		});

		const spec = JSON.parse(response.body);

		// The route should have schema.hide: true, so it should not appear in paths
		// If paths exist, verify /api/v1/openapi.json is not there
		if (spec.paths && Object.keys(spec.paths).length > 0) {
			expect(spec.paths).not.toHaveProperty('/api/v1/openapi.json');
		}
	});

	it('should return 503 when swagger is disabled', async () => {
		// When swagger is disabled (enableDocs: false), the route should return 503
		app = await createApp({ enableRateLimit: false, enableDocs: false });
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/api/v1/openapi.json'
		});

		// Should return 503 Service Unavailable
		expect(response.statusCode).toBe(503);
		const body = JSON.parse(response.body);
		expect(body.error).toBe('Service Unavailable');
		expect(body.message).toBe('OpenAPI documentation is not enabled');
	});
});
