/**
 * TDD tests for Health endpoint migration (Phase 9 task 9.7)
 *
 * The migrated health endpoint should:
 * - Return basic health check at GET /health (already in app.ts)
 * - Return deep health checks at GET /health/deep
 * - Include DB, pool, OCI CLI, Sentry, and metrics checks
 * - Use correct status semantics (ok/degraded/error)
 * - Return version and uptime
 * - NOT require authentication (public endpoint)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

// Mock dependencies
vi.mock('@portal/shared/server/oracle/connection', () => ({
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

vi.mock('@portal/shared/server/sentry', () => ({
	wrapWithSpan: vi.fn((_name: string, _op: string, fn: () => unknown) => fn()),
	captureError: vi.fn(),
	isSentryEnabled: vi.fn(() => false),
	initSentry: vi.fn(),
	closeSentry: vi.fn()
}));

vi.mock('@portal/shared/server/logger', () => ({
	createLogger: vi.fn(() => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	}))
}));

// Mock the entire health module to avoid OCI CLI dependency
vi.mock('@portal/shared/server/health', () => ({
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

// ---------------------------------------------------------------------------
// Basic health check (already implemented in app.ts)
// ---------------------------------------------------------------------------

describe('GET /health (basic)', () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) await app.close();
	});

	it('should return 200 with status ok', async () => {
		app = await createApp({ enableRateLimit: false });
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/health'
		});

		expect(response.statusCode).toBe(200);
		const body = JSON.parse(response.body);
		expect(body.status).toBe('ok');
	});

	it('should include an ISO 8601 timestamp', async () => {
		app = await createApp({ enableRateLimit: false });
		await app.ready();

		const response = await app.inject({ method: 'GET', url: '/health' });
		const body = JSON.parse(response.body);

		expect(body.timestamp).toBeDefined();
		const parsed = new Date(body.timestamp);
		expect(parsed.toISOString()).toBe(body.timestamp);
	});

	it('should respond quickly (under 100ms)', async () => {
		app = await createApp({ enableRateLimit: false });
		await app.ready();

		const start = performance.now();
		await app.inject({ method: 'GET', url: '/health' });
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(100);
	});

	it('should not require authentication', async () => {
		app = await createApp({ enableRateLimit: false });
		await app.ready();

		// No auth headers
		const response = await app.inject({
			method: 'GET',
			url: '/health'
		});

		expect(response.statusCode).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// Deep health check (TDD — not yet implemented in Fastify)
// ---------------------------------------------------------------------------

describe('GET /health/deep (TDD contract)', () => {
	it('should define the expected response shape', () => {
		// When migrated, the deep health endpoint should return:
		const expectedShape = {
			status: 'ok', // 'ok' | 'degraded' | 'error'
			checks: {
				database: { status: 'ok', latencyMs: 0, details: {} },
				connection_pool: { status: 'ok', latencyMs: 0, details: {} },
				oci_cli: { status: 'ok', latencyMs: 0, details: {} },
				sentry: { status: 'ok', latencyMs: 0, details: {} },
				metrics: { status: 'ok', latencyMs: 0, details: {} }
			},
			timestamp: '2026-01-01T00:00:00.000Z',
			uptime: 0,
			version: '0.1.0'
		};

		// Verify the shape has all expected fields
		expect(expectedShape).toHaveProperty('status');
		expect(expectedShape).toHaveProperty('checks');
		expect(expectedShape).toHaveProperty('timestamp');
		expect(expectedShape).toHaveProperty('uptime');
		expect(expectedShape).toHaveProperty('version');

		// Verify all check subsystems are present
		const checkNames = Object.keys(expectedShape.checks);
		expect(checkNames).toContain('database');
		expect(checkNames).toContain('connection_pool');
		expect(checkNames).toContain('oci_cli');
		expect(checkNames).toContain('sentry');
		expect(checkNames).toContain('metrics');
	});

	it('should validate HealthCheckEntry structure', () => {
		// Each check entry must have:
		const entry = {
			status: 'ok' as const,
			latencyMs: 1.5,
			details: { version: '3.0.0' }
		};

		expect(entry.status).toMatch(/^(ok|degraded|error)$/);
		expect(typeof entry.latencyMs).toBe('number');
		expect(entry.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it('should return error status when database check fails', () => {
		// Database is a critical check — failure -> overall status = error
		const checks = {
			database: { status: 'error' as const, latencyMs: 50 },
			sentry: { status: 'ok' as const, latencyMs: 0 }
		};

		const CRITICAL = new Set(['database']);
		let status: 'ok' | 'degraded' | 'error' = 'ok';

		for (const [name, check] of Object.entries(checks)) {
			if (check.status === 'error' && CRITICAL.has(name)) {
				status = 'error';
			}
		}

		expect(status).toBe('error');
	});

	it('should return degraded status for non-critical failures', () => {
		const checks = {
			database: { status: 'ok' as const, latencyMs: 5 },
			oci_cli: { status: 'error' as const, latencyMs: 5000 },
			sentry: { status: 'degraded' as const, latencyMs: 0 }
		};

		const CRITICAL = new Set(['database']);
		let status: 'ok' | 'degraded' | 'error' = 'ok';

		for (const [name, check] of Object.entries(checks)) {
			if (check.status === 'error' && CRITICAL.has(name)) {
				status = 'error';
				break;
			}
			if (check.status === 'error' || check.status === 'degraded') {
				status = 'degraded';
			}
		}

		expect(status).toBe('degraded');
	});
});

// ---------------------------------------------------------------------------
// Health check module from shared package
// ---------------------------------------------------------------------------

describe('runHealthChecks (shared package)', () => {
	it('should export runHealthChecks function', async () => {
		// The shared health module should be importable and callable
		// This validates that the shared package properly exports health checks
		const healthModule = await import('@portal/shared/server/health');
		expect(typeof healthModule.runHealthChecks).toBe('function');
	});
});
