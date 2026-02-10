import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

// Mock logger first (required in every test)
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

describe('under-pressure plugin', () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) {
			await app.close();
		}
	});

	describe('registration', () => {
		it('should register successfully and decorate fastify instance', async () => {
			app = Fastify({ logger: false });

			// Import plugin after mocks are set up
			const { default: underPressurePlugin } = await import('../../plugins/under-pressure.js');
			await app.register(underPressurePlugin);
			await app.ready();

			// Check decorations exist
			expect(app).toHaveProperty('memoryUsage');
			expect(app).toHaveProperty('isUnderPressure');
			expect(typeof app.memoryUsage).toBe('function');
			expect(typeof app.isUnderPressure).toBe('function');
		});
	});

	describe('custom health check', () => {
		it('should return true when Oracle is available', async () => {
			app = Fastify({ logger: false });

			// Mock Oracle plugin decorator
			const mockOraclePlugin = fp(
				async (instance) => {
					instance.decorate('oracle', {
						isAvailable: vi.fn().mockResolvedValue(true)
					});
				},
				{ name: 'oracle', fastify: '5.x' }
			);

			await app.register(mockOraclePlugin);

			const { default: underPressurePlugin } = await import('../../plugins/under-pressure.js');
			await app.register(underPressurePlugin);
			await app.ready();

			// Access the health check function directly from under-pressure options
			// This is tricky - we need to verify the healthCheck was called with the right behavior
			// For now, we'll test indirectly through the /api/pressure endpoint
			const response = await app.inject({
				method: 'GET',
				url: '/api/pressure'
			});

			expect(response.statusCode).toBe(200);
		});

		it('should return false when Oracle is unavailable', async () => {
			app = Fastify({ logger: false });

			// Mock Oracle plugin decorator that returns false
			const mockOraclePlugin = fp(
				async (instance) => {
					instance.decorate('oracle', {
						isAvailable: vi.fn().mockResolvedValue(false)
					});
				},
				{ name: 'oracle', fastify: '5.x' }
			);

			await app.register(mockOraclePlugin);

			const { default: underPressurePlugin } = await import('../../plugins/under-pressure.js');
			await app.register(underPressurePlugin);
			await app.ready();

			// The pressure endpoint should reflect unhealthy state
			const response = await app.inject({
				method: 'GET',
				url: '/api/pressure'
			});

			// When Oracle is unavailable, the health check should fail
			// The exact status code depends on how @fastify/under-pressure handles failed health checks
			// It should return 503 Service Unavailable
			expect(response.statusCode).toBe(503);
		});

		it('should return true when Oracle plugin is not registered (graceful degradation)', async () => {
			app = Fastify({ logger: false });

			// Do NOT register Oracle plugin
			const { default: underPressurePlugin } = await import('../../plugins/under-pressure.js');
			await app.register(underPressurePlugin);
			await app.ready();

			// Should still be healthy when Oracle isn't registered
			const response = await app.inject({
				method: 'GET',
				url: '/api/pressure'
			});

			expect(response.statusCode).toBe(200);
		});

		it('should catch errors from Oracle.isAvailable and return false', async () => {
			app = Fastify({ logger: false });

			// Mock Oracle plugin that throws an error
			const mockOraclePlugin = fp(
				async (instance) => {
					instance.decorate('oracle', {
						isAvailable: vi.fn().mockRejectedValue(new Error('Connection failed'))
					});
				},
				{ name: 'oracle', fastify: '5.x' }
			);

			await app.register(mockOraclePlugin);

			const { default: underPressurePlugin } = await import('../../plugins/under-pressure.js');
			await app.register(underPressurePlugin);
			await app.ready();

			// Should handle errors gracefully and return 503
			const response = await app.inject({
				method: 'GET',
				url: '/api/pressure'
			});

			expect(response.statusCode).toBe(503);
		});
	});

	describe('overload response', () => {
		it('should return 503 with correct body when under pressure', async () => {
			app = Fastify({ logger: false });

			const { default: underPressurePlugin } = await import('../../plugins/under-pressure.js');
			// Register with very low thresholds to trigger overload
			await app.register(underPressurePlugin, {
				maxEventLoopDelay: 1, // 1ms - will definitely trigger
				maxHeapUsedBytes: 1, // 1 byte - will definitely trigger
				maxRssBytes: 1, // 1 byte - will definitely trigger
				sampleInterval: 10 // Sample every 10ms for faster testing
			});

			await app.get('/test', async () => ({ ok: true }));
			await app.ready();

			// Wait for sampling to occur
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Make a request that should trigger overload
			const response = await app.inject({
				method: 'GET',
				url: '/test'
			});

			expect(response.statusCode).toBe(503);
			const body = response.json();
			expect(body).toHaveProperty('error');
			expect(body).toHaveProperty('message');
			expect(body).toHaveProperty('statusCode', 503);
		});

		it('should include Retry-After header when under pressure', async () => {
			app = Fastify({ logger: false });

			const { default: underPressurePlugin } = await import('../../plugins/under-pressure.js');
			await app.register(underPressurePlugin, {
				maxEventLoopDelay: 1,
				maxHeapUsedBytes: 1,
				maxRssBytes: 1,
				sampleInterval: 10 // Sample every 10ms for faster testing
			});

			await app.get('/test', async () => ({ ok: true }));
			await app.ready();

			// Wait for sampling to occur
			await new Promise((resolve) => setTimeout(resolve, 50));

			const response = await app.inject({
				method: 'GET',
				url: '/test'
			});

			expect(response.statusCode).toBe(503);
			expect(response.headers).toHaveProperty('retry-after');
			expect(response.headers['retry-after']).toBe('30');
		});
	});

	describe('pass-through behavior', () => {
		it('should allow normal requests when not under pressure', async () => {
			app = Fastify({ logger: false });

			const { default: underPressurePlugin } = await import('../../plugins/under-pressure.js');
			await app.register(underPressurePlugin);

			await app.get('/test', async () => ({ ok: true }));
			await app.ready();

			const response = await app.inject({
				method: 'GET',
				url: '/test'
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ ok: true });
		});

		it('should expose /api/pressure status route', async () => {
			app = Fastify({ logger: false });

			const { default: underPressurePlugin } = await import('../../plugins/under-pressure.js');
			await app.register(underPressurePlugin);
			await app.ready();

			const response = await app.inject({
				method: 'GET',
				url: '/api/pressure'
			});

			expect(response.statusCode).toBe(200);
			// The body should contain metrics about the server's health
			const body = response.json();
			expect(body).toBeDefined();
		});
	});
});
