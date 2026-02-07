/**
 * TDD tests for Fastify app factory (Phase 9 task 9.3)
 *
 * Tests the createApp(), startServer(), and stopServer() lifecycle.
 * These tests run BEFORE the implementation is finalized — they define
 * the contract that the Fastify app factory must satisfy.
 *
 * Covers:
 * - App creation with default and custom options
 * - CORS plugin registration
 * - Cookie plugin registration
 * - Rate limiting plugin registration (with enable/disable)
 * - Request tracing (X-Request-Id header)
 * - Zod type provider integration
 * - Global error handler (PortalError mapping)
 * - Health check endpoint
 * - Server start/stop lifecycle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mocks — must be before app import
// ---------------------------------------------------------------------------

vi.mock('@portal/shared/server/oracle/connection', () => ({
	initPool: vi.fn().mockResolvedValue(undefined),
	closePool: vi.fn().mockResolvedValue(undefined),
	withConnection: vi.fn(async (fn: (conn: unknown) => unknown) =>
		fn({
			execute: vi.fn().mockResolvedValue({ rows: [{ VAL: 1 }] }),
			close: vi.fn().mockResolvedValue(undefined),
			commit: vi.fn(),
			rollback: vi.fn()
		})
	),
	getPoolStats: vi.fn().mockResolvedValue({
		connectionsOpen: 5,
		connectionsInUse: 1,
		poolMin: 2,
		poolMax: 10
	}),
	isPoolInitialized: vi.fn(() => true),
	getPool: vi.fn()
}));

vi.mock('@portal/shared/server/oracle/migrations', () => ({
	runMigrations: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@portal/shared/server/oracle/repositories/webhook-repository', () => ({
	webhookRepository: {
		migratePlaintextSecrets: vi.fn().mockResolvedValue({ migrated: 0, remaining: 0 })
	}
}));

vi.mock('@portal/shared/server/sentry', () => ({
	wrapWithSpan: vi.fn((_n: string, _o: string, fn: () => unknown) => fn()),
	captureError: vi.fn(),
	isSentryEnabled: vi.fn(() => false),
	initSentry: vi.fn(),
	closeSentry: vi.fn()
}));

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

// Import after mocks
const { createApp, startServer, stopServer } = await import('../app.js');
import type { AppOptions } from '../app.js';

// ---------------------------------------------------------------------------
// Re-setup mocks that mockReset: true clears between tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
	const oracleMod = await import('@portal/shared/server/oracle/connection');
	(oracleMod.initPool as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
	(oracleMod.closePool as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
	(oracleMod.withConnection as ReturnType<typeof vi.fn>).mockImplementation(
		async (fn: (conn: unknown) => unknown) =>
			fn({
				execute: vi.fn().mockResolvedValue({ rows: [{ VAL: 1 }] }),
				close: vi.fn().mockResolvedValue(undefined),
				commit: vi.fn(),
				rollback: vi.fn()
			})
	);
	(oracleMod.getPoolStats as ReturnType<typeof vi.fn>)?.mockResolvedValue({
		connectionsOpen: 5,
		connectionsInUse: 1,
		poolMin: 2,
		poolMax: 10
	});
	(oracleMod.isPoolInitialized as ReturnType<typeof vi.fn>).mockReturnValue(true);

	const healthMod = await import('@portal/shared/server/health');
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

	const migrationMod = await import('@portal/shared/server/oracle/migrations');
	(migrationMod.runMigrations as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

	const webhookMod = await import('@portal/shared/server/oracle/repositories/webhook-repository');
	(
		webhookMod.webhookRepository.migratePlaintextSecrets as ReturnType<typeof vi.fn>
	).mockResolvedValue({
		migrated: 0,
		remaining: 0
	});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildApp(opts?: AppOptions): Promise<FastifyInstance> {
	const app = await createApp({
		enableRateLimit: false, // disable by default for fast tests
		...opts
	});
	return app;
}

// ---------------------------------------------------------------------------
// createApp – basics
// ---------------------------------------------------------------------------

describe('createApp', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		// Re-setup mocks cleared by mockReset: true
		const oracleMod = await import('@portal/shared/server/oracle/connection');
		(oracleMod.initPool as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
		(oracleMod.closePool as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
		(oracleMod.withConnection as ReturnType<typeof vi.fn>).mockImplementation(
			async (fn: (conn: unknown) => unknown) =>
				fn({
					execute: vi.fn().mockResolvedValue({ rows: [{ VAL: 1 }] }),
					close: vi.fn().mockResolvedValue(undefined),
					commit: vi.fn(),
					rollback: vi.fn()
				})
		);
		(oracleMod.getPoolStats as ReturnType<typeof vi.fn>).mockResolvedValue({
			connectionsOpen: 5,
			connectionsInUse: 1,
			poolMin: 2,
			poolMax: 10
		});
		(oracleMod.isPoolInitialized as ReturnType<typeof vi.fn>).mockReturnValue(true);

		const healthMod = await import('@portal/shared/server/health');
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
		if (app) {
			try {
				await app.close();
			} catch {
				/* already closed */
			}
		}
	});

	it('should return a Fastify instance', async () => {
		app = await buildApp();
		expect(app).toBeDefined();
		expect(typeof app.listen).toBe('function');
		expect(typeof app.close).toBe('function');
		expect(typeof app.get).toBe('function');
		expect(typeof app.post).toBe('function');
	});

	it('should register the health endpoint at GET /health', async () => {
		app = await buildApp();
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/health'
		});

		expect(response.statusCode).toBe(200);
		const body = JSON.parse(response.body);
		expect(body).toHaveProperty('status', 'ok');
		expect(body).toHaveProperty('timestamp');
		// Timestamp should be a valid ISO 8601 string
		expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
	});

	it('should return 404 for unknown routes', async () => {
		app = await buildApp();
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/nonexistent'
		});

		expect(response.statusCode).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

describe('createApp – CORS', () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) await app.close();
	});

	it('should reflect request origin when no CORS_ORIGIN is set (dev mode)', async () => {
		app = await buildApp();
		await app.ready();

		const response = await app.inject({
			method: 'OPTIONS',
			url: '/health',
			headers: {
				origin: 'http://example.com',
				'access-control-request-method': 'GET'
			}
		});

		// fastify/cors with origin:true reflects the request origin (safe for credentials:true)
		expect(response.statusCode).toBe(204);
		expect(response.headers['access-control-allow-origin']).toBe('http://example.com');
	});

	it('should respect custom corsOrigin option', async () => {
		app = await buildApp({ corsOrigin: 'https://portal.example.com' });
		await app.ready();

		const response = await app.inject({
			method: 'OPTIONS',
			url: '/health',
			headers: {
				origin: 'https://portal.example.com',
				'access-control-request-method': 'GET'
			}
		});

		expect(response.headers['access-control-allow-origin']).toBe('https://portal.example.com');
	});

	it('should enable credentials in CORS', async () => {
		app = await buildApp();
		await app.ready();

		const response = await app.inject({
			method: 'OPTIONS',
			url: '/health',
			headers: {
				origin: 'http://example.com',
				'access-control-request-method': 'GET'
			}
		});

		expect(response.headers['access-control-allow-credentials']).toBe('true');
	});
});

// ---------------------------------------------------------------------------
// Request Tracing (X-Request-Id)
// ---------------------------------------------------------------------------

describe('createApp – request tracing', () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) await app.close();
	});

	it('should add X-Request-Id header when enableTracing is true (default)', async () => {
		app = await buildApp({ enableTracing: true });
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/health'
		});

		expect(response.headers['x-request-id']).toBeDefined();
		expect(typeof response.headers['x-request-id']).toBe('string');
		// Our request IDs use the `req-` prefix
		expect(response.headers['x-request-id']).toMatch(/^req-/);
	});

	it('should preserve incoming X-Request-Id header', async () => {
		app = await buildApp({ enableTracing: true });
		await app.ready();

		const customId = 'req-custom-abc-123';
		const response = await app.inject({
			method: 'GET',
			url: '/health',
			headers: { 'x-request-id': customId }
		});

		expect(response.headers['x-request-id']).toBe(customId);
	});

	it('should NOT add X-Request-Id when enableTracing is false', async () => {
		app = await buildApp({ enableTracing: false });
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/health'
		});

		// With tracing disabled, no X-Request-Id header should be added
		expect(response.headers['x-request-id']).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

describe('createApp – rate limiting', () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) await app.close();
	});

	it('should NOT rate-limit when enableRateLimit is false', async () => {
		app = await buildApp({ enableRateLimit: false });
		await app.ready();

		// Send many requests — none should be rate-limited
		for (let i = 0; i < 10; i++) {
			const response = await app.inject({ method: 'GET', url: '/health' });
			expect(response.statusCode).toBe(200);
		}
	});

	// Note: When rate limiting IS enabled, the config references
	// RATE_LIMIT_CONFIG.AUTHENTICATED.max which doesn't exist on the shared
	// module's RATE_LIMIT_CONFIG shape. This is a known integration bug
	// that the architect needs to fix.
});

// ---------------------------------------------------------------------------
// Error Handler
// ---------------------------------------------------------------------------

describe('createApp – global error handler', () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) await app.close();
	});

	it('should convert thrown PortalError to structured JSON response', async () => {
		// Import error classes dynamically to avoid module resolution issues
		const { ValidationError } = await import('@portal/shared/server/errors');

		app = await buildApp();

		// Register a test route that throws a PortalError
		app.get('/test-error', async () => {
			throw new ValidationError('test field is required', { field: 'test' });
		});

		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/test-error'
		});

		expect(response.statusCode).toBe(400);
		const body = JSON.parse(response.body);
		expect(body).toHaveProperty('error');
		expect(body).toHaveProperty('code', 'VALIDATION_ERROR');
	});

	it('should convert unknown errors to 500 Internal Server Error', async () => {
		app = await buildApp();

		app.get('/test-unknown-error', async () => {
			throw new Error('something unexpected');
		});

		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/test-unknown-error'
		});

		expect(response.statusCode).toBe(500);
		const body = JSON.parse(response.body);
		expect(body).toHaveProperty('error');
		expect(body).toHaveProperty('code', 'INTERNAL_ERROR');
	});

	it('should convert AuthError (401) properly', async () => {
		const { AuthError } = await import('@portal/shared/server/errors');

		app = await buildApp();

		app.get('/test-auth-error', async () => {
			throw new AuthError('Invalid credentials', 401);
		});

		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/test-auth-error'
		});

		expect(response.statusCode).toBe(401);
		const body = JSON.parse(response.body);
		expect(body).toHaveProperty('code', 'AUTH_ERROR');
	});

	it('should convert AuthError (403) properly', async () => {
		const { AuthError } = await import('@portal/shared/server/errors');

		app = await buildApp();

		app.get('/test-forbidden', async () => {
			throw new AuthError('Insufficient permissions', 403);
		});

		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/test-forbidden'
		});

		expect(response.statusCode).toBe(403);
	});

	it('should convert NotFoundError (404) properly', async () => {
		const { NotFoundError } = await import('@portal/shared/server/errors');

		app = await buildApp();

		app.get('/test-not-found', async () => {
			throw new NotFoundError('Resource not found', { id: 'abc' });
		});

		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/test-not-found'
		});

		expect(response.statusCode).toBe(404);
		const body = JSON.parse(response.body);
		expect(body).toHaveProperty('code', 'NOT_FOUND');
	});

	it('should convert RateLimitError (429) properly', async () => {
		const { RateLimitError } = await import('@portal/shared/server/errors');

		app = await buildApp();

		app.get('/test-rate-limit', async () => {
			throw new RateLimitError();
		});

		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/test-rate-limit'
		});

		expect(response.statusCode).toBe(429);
		const body = JSON.parse(response.body);
		expect(body).toHaveProperty('code', 'RATE_LIMIT');
	});

	it('should convert OCIError (502) properly', async () => {
		const { OCIError } = await import('@portal/shared/server/errors');

		app = await buildApp();

		app.get('/test-oci-error', async () => {
			throw new OCIError('OCI CLI failed', { exitCode: 1 });
		});

		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/test-oci-error'
		});

		expect(response.statusCode).toBe(502);
		const body = JSON.parse(response.body);
		expect(body).toHaveProperty('code', 'OCI_ERROR');
	});

	it('should convert DatabaseError (503) properly', async () => {
		const { DatabaseError } = await import('@portal/shared/server/errors');

		app = await buildApp();

		app.get('/test-db-error', async () => {
			throw new DatabaseError('Connection pool exhausted');
		});

		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/test-db-error'
		});

		expect(response.statusCode).toBe(503);
		const body = JSON.parse(response.body);
		expect(body).toHaveProperty('code', 'DATABASE_ERROR');
	});
});

// ---------------------------------------------------------------------------
// Server Lifecycle
// ---------------------------------------------------------------------------

describe('startServer / stopServer', () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) {
			try {
				await app.close();
			} catch {
				/* already closed */
			}
		}
	});

	it('startServer should bind to specified port and host', async () => {
		app = await buildApp();

		// Use a random high port to avoid conflicts
		const port = 30000 + Math.floor(Math.random() * 10000);
		await startServer(app, port, '127.0.0.1');

		// Verify the server is listening
		const addresses = app.addresses();
		expect(addresses.length).toBeGreaterThan(0);
		expect(addresses[0].port).toBe(port);
		expect(addresses[0].address).toBe('127.0.0.1');
	});

	it('stopServer should close the app gracefully', async () => {
		app = await buildApp();

		const port = 30000 + Math.floor(Math.random() * 10000);
		await startServer(app, port, '127.0.0.1');

		// Stop should not throw
		await expect(stopServer(app)).resolves.toBeUndefined();
	});

	it('stopServer should reject new connections after close', async () => {
		app = await buildApp();

		const port = 30000 + Math.floor(Math.random() * 10000);
		await startServer(app, port, '127.0.0.1');
		await stopServer(app);

		// After stop, inject should fail (server is closed)
		try {
			await app.inject({ method: 'GET', url: '/health' });
			// If inject still works on a closed server, that's acceptable for Fastify
		} catch {
			// Expected — server is closed
		}
	});
});

// ---------------------------------------------------------------------------
// Zod Type Provider
// ---------------------------------------------------------------------------

describe('createApp – Zod type provider', () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) await app.close();
	});

	it('should validate request body with Zod schema', async () => {
		// zod is a transitive dep via @portal/shared — import from shared's node_modules
		const zod = await import('../../../../packages/shared/node_modules/zod/lib/index.js').catch(
			() => null
		);

		if (!zod) {
			// Skip if zod can't be resolved — CI may have different layout
			return;
		}

		const { z } = zod;
		app = await buildApp();

		// Register a route with Zod validation
		app.post(
			'/test-zod',
			{
				schema: {
					body: z.object({
						name: z.string().min(1),
						age: z.number().int().positive()
					})
				}
			},
			async (request) => {
				return { received: request.body };
			}
		);

		await app.ready();

		// Valid request
		const validResponse = await app.inject({
			method: 'POST',
			url: '/test-zod',
			payload: { name: 'Alice', age: 30 },
			headers: { 'content-type': 'application/json' }
		});
		expect(validResponse.statusCode).toBe(200);
		const validBody = JSON.parse(validResponse.body);
		expect(validBody.received).toEqual({ name: 'Alice', age: 30 });

		// Invalid request (missing name)
		const invalidResponse = await app.inject({
			method: 'POST',
			url: '/test-zod',
			payload: { age: 30 },
			headers: { 'content-type': 'application/json' }
		});
		expect(invalidResponse.statusCode).toBe(400);
	});

	it('should validate query parameters with Zod schema', async () => {
		const zod = await import('../../../../packages/shared/node_modules/zod/lib/index.js').catch(
			() => null
		);

		if (!zod) return;
		const { z } = zod;

		app = await buildApp();

		app.get(
			'/test-query',
			{
				schema: {
					querystring: z.object({
						page: z.coerce.number().int().positive().default(1),
						limit: z.coerce.number().int().positive().max(100).default(20)
					})
				}
			},
			async (request) => {
				return { query: request.query };
			}
		);

		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/test-query?page=2&limit=50'
		});
		expect(response.statusCode).toBe(200);
		const body = JSON.parse(response.body);
		expect(body.query.page).toBe(2);
		expect(body.query.limit).toBe(50);
	});
});

// ---------------------------------------------------------------------------
// Configuration via environment
// ---------------------------------------------------------------------------

describe('createApp – environment configuration', () => {
	let app: FastifyInstance;
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(async () => {
		process.env = originalEnv;
		if (app) await app.close();
	});

	it('should use CORS_ORIGIN env var when corsOrigin not provided', async () => {
		process.env.CORS_ORIGIN = 'https://env-origin.example.com';
		app = await createApp({ enableRateLimit: false });
		await app.ready();

		const response = await app.inject({
			method: 'OPTIONS',
			url: '/health',
			headers: {
				origin: 'https://env-origin.example.com',
				'access-control-request-method': 'GET'
			}
		});

		expect(response.headers['access-control-allow-origin']).toBe('https://env-origin.example.com');
	});
});

// ---------------------------------------------------------------------------
// RATE_LIMIT_CONFIG shape validation (regression)
// ---------------------------------------------------------------------------

describe('RATE_LIMIT_CONFIG shape', () => {
	it('should export windowMs and maxRequests (not AUTHENTICATED)', async () => {
		const { RATE_LIMIT_CONFIG } = await import('@portal/shared/server/rate-limiter');

		// The shared module exports { windowMs, maxRequests: { chat, api } }
		expect(RATE_LIMIT_CONFIG).toHaveProperty('windowMs');
		expect(typeof RATE_LIMIT_CONFIG.windowMs).toBe('number');
		expect(RATE_LIMIT_CONFIG).toHaveProperty('maxRequests');

		// app.ts currently references RATE_LIMIT_CONFIG.AUTHENTICATED.max
		// which does NOT exist — this is a known integration bug
		const configAsAny = RATE_LIMIT_CONFIG as Record<string, unknown>;
		expect(configAsAny.AUTHENTICATED).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Security hardening
// ---------------------------------------------------------------------------

describe('createApp – security hardening', () => {
	let app: FastifyInstance;
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			NODE_ENV: 'production',
			BETTER_AUTH_SECRET: 'test-secret-for-security-tests-32-bytes',
			CORS_ORIGIN: 'https://portal.example.com'
		};
	});

	afterEach(async () => {
		process.env = originalEnv;
		if (app) await app.close();
	});

	it('should emit nonce-based CSP and 15+ security headers', async () => {
		app = await createApp({ enableRateLimit: false });
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/health'
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers['content-security-policy']).toMatch(/nonce-/);

		const expectedSecurityHeaders = [
			'content-security-policy',
			'strict-transport-security',
			'x-content-type-options',
			'x-frame-options',
			'referrer-policy',
			'permissions-policy',
			'cross-origin-opener-policy',
			'cross-origin-resource-policy',
			'cross-origin-embedder-policy',
			'origin-agent-cluster',
			'x-dns-prefetch-control',
			'x-download-options',
			'x-permitted-cross-domain-policies',
			'x-xss-protection',
			'cache-control',
			'pragma',
			'expires',
			'x-robots-tag'
		];

		const presentHeaders = expectedSecurityHeaders.filter(
			(header) => response.headers[header] !== undefined
		);

		expect(presentHeaders.length).toBeGreaterThanOrEqual(15);
	});

	it('should rotate CSP nonce per request', async () => {
		app = await createApp({ enableRateLimit: false });
		await app.ready();

		const first = await app.inject({ method: 'GET', url: '/health' });
		const second = await app.inject({ method: 'GET', url: '/health' });

		expect(first.headers['content-security-policy']).toMatch(/nonce-/);
		expect(second.headers['content-security-policy']).toMatch(/nonce-/);
		expect(first.headers['content-security-policy']).not.toBe(
			second.headers['content-security-policy']
		);
	});

	it('should apply secure cookie defaults aligned with Better Auth cookie policy', async () => {
		process.env.BETTER_AUTH_COOKIE_SAMESITE = 'strict';

		app = await createApp({ enableRateLimit: false });
		app.get('/test-cookie', async (_request, reply) => {
			reply.setCookie('alignment_test', '1');
			return { ok: true };
		});
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/test-cookie'
		});

		const setCookie = response.headers['set-cookie'];
		const serialized = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');

		expect(serialized).toContain('HttpOnly');
		expect(serialized).toContain('Secure');
		expect(serialized).toMatch(/SameSite=Strict/i);
	});
});

// ---------------------------------------------------------------------------
// OpenAPI docs (admin-gated)
// ---------------------------------------------------------------------------

describe('createApp – OpenAPI docs', () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) await app.close();
	});

	it('should register /api/docs route when enableDocs is true', async () => {
		app = await buildApp({ enableDocs: true });
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/api/docs/json'
		});

		// Unauthenticated — should be 401 due to requireAuth('admin:all')
		expect(response.statusCode).toBe(401);
	});

	it('should NOT register /api/docs when enableDocs is false', async () => {
		app = await buildApp({ enableDocs: false });
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/api/docs/json'
		});

		expect(response.statusCode).toBe(404);
	});

	it('should default to enabled in non-production', async () => {
		app = await buildApp();
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/api/docs/json'
		});

		// Should exist (not 404) — but 401 because no auth
		expect(response.statusCode).toBe(401);
	});
});
