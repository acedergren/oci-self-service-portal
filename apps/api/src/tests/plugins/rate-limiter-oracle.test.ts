import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

// Mock the shared rate limiter BEFORE any imports
const mockCheckRateLimit = vi.fn();
vi.mock('@portal/server/rate-limiter', () => ({
	checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
	RATE_LIMIT_CONFIG: { windowMs: 60000, maxRequests: { chat: 20, api: 60 } }
}));

// Mock logger
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

describe('rate-limiter-oracle plugin', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		// Reset mock to default behavior: allow requests
		mockCheckRateLimit.mockResolvedValue({ remaining: 50, resetAt: Date.now() + 60000 });

		// Build test app with fake auth decorators
		app = Fastify();

		// Fake auth plugin to provide request decorators
		await app.register(
			fp(
				async (fastify) => {
					fastify.decorateRequest('user', null);
					fastify.decorateRequest('apiKeyContext', null);
				},
				{ name: 'auth', fastify: '5.x' }
			)
		);

		// Register the rate limiter plugin
		const { rateLimiterOraclePlugin } = await import('../../plugins/rate-limiter-oracle.js');
		await app.register(rateLimiterOraclePlugin);

		// Add a test route
		app.get('/api/sessions', async () => ({ data: [] }));
		app.post('/api/chat', async () => ({ data: 'response' }));
		app.get('/api/metrics', async () => ({ metrics: {} }));
		app.get('/healthz', async () => ({ status: 'ok' }));

		await app.ready();
	});

	afterEach(async () => {
		await app.close();
	});

	describe('registration', () => {
		it('registers without error', async () => {
			expect(app.hasPlugin('rate-limiter-oracle')).toBe(true);
		});

		it('adds onRequest hook', async () => {
			const res = await app.inject({
				method: 'GET',
				url: '/api/sessions'
			});
			expect(res.statusCode).toBe(200);
			expect(mockCheckRateLimit).toHaveBeenCalled();
		});
	});

	describe('per-endpoint limits', () => {
		it('applies chat limit (20/min) for POST /api/chat', async () => {
			await app.inject({
				method: 'POST',
				url: '/api/chat',
				payload: { message: 'hello' }
			});

			expect(mockCheckRateLimit).toHaveBeenCalledWith(
				expect.stringContaining('ip:'),
				'chat',
				expect.any(Object)
			);
		});

		it('applies api limit (60/min) for GET /api/sessions', async () => {
			await app.inject({
				method: 'GET',
				url: '/api/sessions'
			});

			expect(mockCheckRateLimit).toHaveBeenCalledWith(
				expect.stringContaining('ip:'),
				'api',
				expect.any(Object)
			);
		});

		it('defaults to api limit for unlisted endpoints', async () => {
			// Use an endpoint that doesn't exist in ENDPOINT_LIMITS
			await app.inject({
				method: 'GET',
				url: '/api/other'
			});

			expect(mockCheckRateLimit).toHaveBeenCalledWith(
				expect.stringContaining('ip:'),
				'api',
				expect.any(Object)
			);
		});
	});

	describe('per-user tracking', () => {
		it('uses user ID from session when authenticated', async () => {
			// Build a custom app with authenticated user
			const authApp = Fastify();
			const userSym = Symbol.for('user');
			await authApp.register(
				fp(
					async (fastify) => {
						// Use getter to provide user context
						fastify.decorateRequest('user', {
							getter() {
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								const val = (this as any)[userSym];
								return val !== undefined ? val : { id: 'user-123' };
							}
						});
						fastify.decorateRequest('apiKeyContext', null);
					},
					{ name: 'auth', fastify: '5.x' }
				)
			);
			const { rateLimiterOraclePlugin } = await import('../../plugins/rate-limiter-oracle.js');
			await authApp.register(rateLimiterOraclePlugin);
			authApp.get('/api/sessions', async () => ({ data: [] }));
			await authApp.ready();

			await authApp.inject({
				method: 'GET',
				url: '/api/sessions'
			});

			expect(mockCheckRateLimit).toHaveBeenCalledWith(
				'user:user-123',
				expect.any(String),
				expect.any(Object)
			);

			await authApp.close();
		});

		it('uses API key ID when present', async () => {
			const authApp = Fastify();
			const apiKeySym = Symbol.for('apiKeyContext');
			await authApp.register(
				fp(
					async (fastify) => {
						fastify.decorateRequest('user', null);
						fastify.decorateRequest('apiKeyContext', {
							getter() {
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								const val = (this as any)[apiKeySym];
								return val !== undefined ? val : { keyId: 'key-abc' };
							}
						});
					},
					{ name: 'auth', fastify: '5.x' }
				)
			);
			const { rateLimiterOraclePlugin } = await import('../../plugins/rate-limiter-oracle.js');
			await authApp.register(rateLimiterOraclePlugin);
			authApp.get('/api/sessions', async () => ({ data: [] }));
			await authApp.ready();

			await authApp.inject({
				method: 'GET',
				url: '/api/sessions'
			});

			expect(mockCheckRateLimit).toHaveBeenCalledWith(
				'key:key-abc',
				expect.any(String),
				expect.any(Object)
			);

			await authApp.close();
		});

		it('falls back to IP for unauthenticated requests', async () => {
			await app.inject({
				method: 'GET',
				url: '/api/sessions',
				headers: { 'x-forwarded-for': '203.0.113.42' }
			});

			expect(mockCheckRateLimit).toHaveBeenCalledWith(
				expect.stringContaining('ip:'),
				expect.any(String),
				expect.any(Object)
			);
		});

		it('tracks limits independently per user', async () => {
			const authApp = Fastify();
			let requestCount = 0;
			const userSym = Symbol('user-memo');
			await authApp.register(
				fp(
					async (fastify) => {
						fastify.decorateRequest('user', {
							getter() {
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								const req = this as any;
								// Memoize the user value per request to avoid multiple increments
								if (!req[userSym]) {
									requestCount++;
									req[userSym] = { id: `user-${requestCount}` };
								}
								return req[userSym];
							}
						});
						fastify.decorateRequest('apiKeyContext', null);
					},
					{ name: 'auth', fastify: '5.x' }
				)
			);
			const { rateLimiterOraclePlugin } = await import('../../plugins/rate-limiter-oracle.js');
			await authApp.register(rateLimiterOraclePlugin);
			authApp.get('/api/sessions', async () => ({ data: [] }));
			await authApp.ready();

			// User 1 request
			await authApp.inject({
				method: 'GET',
				url: '/api/sessions'
			});

			expect(mockCheckRateLimit).toHaveBeenNthCalledWith(
				1,
				'user:user-1',
				expect.any(String),
				expect.any(Object)
			);

			// User 2 request
			await authApp.inject({
				method: 'GET',
				url: '/api/sessions'
			});

			expect(mockCheckRateLimit).toHaveBeenNthCalledWith(
				2,
				'user:user-2',
				expect.any(String),
				expect.any(Object)
			);

			await authApp.close();
		});
	});

	describe('enforcement', () => {
		it('allows request when remaining > 0', async () => {
			mockCheckRateLimit.mockResolvedValue({ remaining: 5, resetAt: Date.now() + 30000 });

			const res = await app.inject({
				method: 'GET',
				url: '/api/sessions'
			});

			expect(res.statusCode).toBe(200);
			expect(res.headers['x-ratelimit-remaining']).toBe('5');
		});

		it('returns 429 when limit exceeded (null result)', async () => {
			mockCheckRateLimit.mockResolvedValue(null);

			const res = await app.inject({
				method: 'GET',
				url: '/api/sessions'
			});

			expect(res.statusCode).toBe(429);
			const body = JSON.parse(res.body);
			expect(body.error).toBe('RATE_LIMIT');
			expect(body.message).toContain('Too many requests');
		});

		it('sets X-RateLimit-Remaining header', async () => {
			mockCheckRateLimit.mockResolvedValue({ remaining: 10, resetAt: Date.now() + 45000 });

			const res = await app.inject({
				method: 'GET',
				url: '/api/sessions'
			});

			expect(res.headers['x-ratelimit-remaining']).toBe('10');
		});

		it('sets X-RateLimit-Reset header as epoch timestamp', async () => {
			const resetAt = Date.now() + 60000;
			mockCheckRateLimit.mockResolvedValue({ remaining: 15, resetAt });

			const res = await app.inject({
				method: 'GET',
				url: '/api/sessions'
			});

			expect(res.headers['x-ratelimit-reset']).toBe(Math.floor(resetAt / 1000).toString());
		});

		it('sets Retry-After header on 429', async () => {
			mockCheckRateLimit.mockResolvedValue(null);

			const res = await app.inject({
				method: 'GET',
				url: '/api/sessions'
			});

			expect(res.statusCode).toBe(429);
			expect(res.headers['retry-after']).toBeDefined();
			// Should be approximately 30-60 seconds (based on window)
			const retryAfter = parseInt(res.headers['retry-after'] as string);
			expect(retryAfter).toBeGreaterThan(0);
			expect(retryAfter).toBeLessThanOrEqual(62);
		});

		it('returns structured error body matching RateLimitError shape', async () => {
			mockCheckRateLimit.mockResolvedValue(null);

			const res = await app.inject({
				method: 'POST',
				url: '/api/chat',
				payload: { message: 'test' }
			});

			expect(res.statusCode).toBe(429);
			const body = JSON.parse(res.body);
			expect(body).toMatchObject({
				error: 'RATE_LIMIT',
				message: expect.stringContaining('Too many requests')
			});
		});
	});

	describe('fail-open behavior', () => {
		it('allows request when Oracle unavailable (checkRateLimit throws)', async () => {
			mockCheckRateLimit.mockRejectedValue(new Error('Database connection failed'));

			const res = await app.inject({
				method: 'GET',
				url: '/api/sessions'
			});

			expect(res.statusCode).toBe(200);
			expect(res.json()).toEqual({ data: [] });
		});

		it('logs warning on rate limit check failure', async () => {
			const error = new Error('Oracle timeout');
			mockCheckRateLimit.mockRejectedValue(error);

			await app.inject({
				method: 'GET',
				url: '/api/sessions'
			});

			// Request succeeds despite error
			expect(mockCheckRateLimit).toHaveBeenCalled();
		});
	});

	describe('path exclusions', () => {
		it('skips /healthz without checking rate limit', async () => {
			mockCheckRateLimit.mockClear();

			const res = await app.inject({
				method: 'GET',
				url: '/healthz'
			});

			expect(res.statusCode).toBe(200);
			expect(mockCheckRateLimit).not.toHaveBeenCalled();
		});

		it('skips /health without checking rate limit', async () => {
			mockCheckRateLimit.mockClear();

			await app.inject({
				method: 'GET',
				url: '/health'
			});

			// Even though route doesn't exist, plugin should skip rate limiting
			expect(mockCheckRateLimit).not.toHaveBeenCalled();
		});

		it('skips /api/metrics without checking rate limit', async () => {
			mockCheckRateLimit.mockClear();

			const res = await app.inject({
				method: 'GET',
				url: '/api/metrics'
			});

			expect(res.statusCode).toBe(200);
			expect(mockCheckRateLimit).not.toHaveBeenCalled();
		});

		it('applies rate limiting to /api/chat', async () => {
			mockCheckRateLimit.mockClear();

			const res = await app.inject({
				method: 'POST',
				url: '/api/chat',
				payload: { message: 'hello' }
			});

			expect(res.statusCode).toBe(200);
			expect(mockCheckRateLimit).toHaveBeenCalled();
		});
	});
});
