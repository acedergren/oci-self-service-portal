/**
 * Route tests for health check endpoints.
 *
 * Tests:
 * - GET /healthz      — lightweight liveness probe (plain text "ok")
 * - GET /api/healthz  — Nginx-proxied alias
 * - GET /health       — deep health check with subsystem statuses
 * - GET /api/health   — frontend observability alias
 *
 * No authentication required — these are public endpoints for load balancers
 * and Kubernetes probes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockRunHealthChecks = vi.fn();

vi.mock('@portal/server/health', () => ({
	runHealthChecks: (...args: unknown[]) => mockRunHealthChecks(...args)
}));

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

// ── Test data ─────────────────────────────────────────────────────────────

const HEALTHY_RESULT = {
	status: 'ok',
	checks: {
		database: { status: 'ok', latencyMs: 2 },
		connection_pool: { status: 'ok', latencyMs: 1 }
	},
	timestamp: '2026-02-17T00:00:00.000Z',
	uptime: 3600,
	version: '0.1.0'
};

const ERROR_RESULT = {
	status: 'error',
	checks: {
		database: { status: 'error', latencyMs: 5000 },
		connection_pool: { status: 'ok', latencyMs: 1 }
	},
	timestamp: '2026-02-17T00:00:00.000Z',
	uptime: 3600,
	version: '0.1.0'
};

// ── Helpers ───────────────────────────────────────────────────────────────

let app: FastifyInstance;

async function buildHealthApp(): Promise<FastifyInstance> {
	const a = Fastify({ logger: false });
	const { healthRoutes } = await import('../../routes/health.js');
	await a.register(healthRoutes);
	await a.ready();
	return a;
}

beforeEach(() => {
	mockRunHealthChecks.mockResolvedValue(HEALTHY_RESULT);
});

afterEach(async () => {
	if (app) await app.close();
});

// ── GET /healthz (liveness probe) ───────────────────────────────────────

describe('GET /healthz', () => {
	it('returns 200 with plain text "ok"', async () => {
		app = await buildHealthApp();

		const res = await app.inject({ method: 'GET', url: '/healthz' });

		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toContain('text/plain');
		expect(res.body).toBe('ok');
	});

	it('does not call runHealthChecks (lightweight probe)', async () => {
		app = await buildHealthApp();

		await app.inject({ method: 'GET', url: '/healthz' });

		expect(mockRunHealthChecks).not.toHaveBeenCalled();
	});
});

// ── GET /api/healthz (Nginx alias) ─────────────────────────────────────

describe('GET /api/healthz', () => {
	it('returns 200 with plain text "ok"', async () => {
		app = await buildHealthApp();

		const res = await app.inject({ method: 'GET', url: '/api/healthz' });

		expect(res.statusCode).toBe(200);
		expect(res.body).toBe('ok');
	});
});

// ── GET /health (deep health check) ────────────────────────────────────

describe('GET /health', () => {
	it('returns 200 with subsystem statuses when healthy', async () => {
		app = await buildHealthApp();

		const res = await app.inject({ method: 'GET', url: '/health' });

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.status).toBe('ok');
		expect(body.checks).toBeDefined();
		expect(body.checks.database.status).toBe('ok');
	});

	it('returns 503 when health check reports error status', async () => {
		mockRunHealthChecks.mockResolvedValue(ERROR_RESULT);
		app = await buildHealthApp();

		const res = await app.inject({ method: 'GET', url: '/health' });

		expect(res.statusCode).toBe(503);
		expect(res.json().status).toBe('error');
	});

	it('returns 503 with timeout message when health check exceeds 3s', async () => {
		// Simulate a check that never resolves within the 3s timeout
		mockRunHealthChecks.mockImplementation(
			() => new Promise((resolve) => setTimeout(resolve, 5000))
		);
		app = await buildHealthApp();

		const res = await app.inject({ method: 'GET', url: '/health' });

		expect(res.statusCode).toBe(503);
		expect(res.json().message).toBe('Health check timed out');
	}, 10000);

	it('returns 503 with error details when health check throws', async () => {
		mockRunHealthChecks.mockRejectedValue(new Error('DB connection refused'));
		app = await buildHealthApp();

		const res = await app.inject({ method: 'GET', url: '/health' });

		expect(res.statusCode).toBe(503);
		const body = res.json();
		expect(body.status).toBe('error');
		expect(body.message).toBe('Health check failed');
		expect(body.error).toBe('DB connection refused');
	});
});

// ── GET /api/health (frontend alias) ───────────────────────────────────

describe('GET /api/health', () => {
	it('returns 200 with subsystem statuses (same as /health)', async () => {
		app = await buildHealthApp();

		const res = await app.inject({ method: 'GET', url: '/api/health' });

		expect(res.statusCode).toBe(200);
		expect(res.json().status).toBe('ok');
	});

	it('returns 503 on error (same behavior as /health)', async () => {
		mockRunHealthChecks.mockResolvedValue(ERROR_RESULT);
		app = await buildHealthApp();

		const res = await app.inject({ method: 'GET', url: '/api/health' });

		expect(res.statusCode).toBe(503);
	});
});
