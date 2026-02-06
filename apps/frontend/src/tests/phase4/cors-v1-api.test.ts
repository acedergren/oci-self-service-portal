/**
 * CORS for /api/v1/* routes
 *
 * Tests that cross-origin requests to the v1 REST API receive proper
 * CORS headers, while non-v1 routes remain unaffected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (same pattern as csp-nonce.test.ts) ──────────────────────────────

vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(),
	initPool: vi.fn().mockResolvedValue(undefined),
	closePool: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/server/oracle/migrations.js', () => ({
	runMigrations: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

vi.mock('$lib/server/auth/config.js', () => ({
	auth: { api: { getSession: vi.fn() } }
}));

vi.mock('$lib/server/auth/rbac.js', () => ({
	getPermissionsForRole: vi.fn().mockReturnValue([])
}));

vi.mock('$lib/server/auth/tenancy.js', () => ({
	getOrgRole: vi.fn().mockResolvedValue('viewer')
}));

vi.mock('$lib/server/rate-limiter.js', () => ({
	checkRateLimit: vi.fn().mockResolvedValue({ remaining: 59, resetAt: Date.now() + 60000 }),
	RATE_LIMIT_CONFIG: { windowMs: 60000, maxRequests: { chat: 20, api: 60 } }
}));

vi.mock('$lib/server/tracing.js', () => ({
	generateRequestId: vi.fn().mockReturnValue('req-test-cors'),
	REQUEST_ID_HEADER: 'x-request-id'
}));

vi.mock('$lib/server/errors.js', () => ({
	RateLimitError: class extends Error {
		constructor(m: string) {
			super(m);
		}
	},
	AuthError: class extends Error {
		constructor(m: string) {
			super(m);
		}
	},
	PortalError: class extends Error {
		constructor(c: string, m: string) {
			super(m);
		}
	},
	errorResponse: vi
		.fn()
		.mockImplementation(
			() => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
		)
}));

vi.mock('$lib/server/metrics.js', () => ({
	httpRequestDuration: { observe: vi.fn() }
}));

vi.mock('$lib/server/sentry.js', () => ({
	initSentry: vi.fn().mockResolvedValue(undefined),
	captureError: vi.fn(),
	closeSentry: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/server/auth/api-keys.js', () => ({
	validateApiKey: vi.fn().mockResolvedValue(null)
}));

vi.mock('$app/environment', () => ({
	dev: true // dev mode sets ALLOWED_ORIGINS to '*'
}));

describe('CORS for /api/v1/* routes', () => {
	let handleFn: (args: { event: unknown; resolve: unknown }) => Promise<Response>;

	beforeEach(async () => {
		vi.clearAllMocks();
		// Re-import to pick up mocks
		const hooks = await import('../../hooks.server.js');
		handleFn = hooks.handle as typeof handleFn;
	});

	function createEvent(method: string, pathname: string, origin?: string) {
		const headers = new Headers();
		if (origin) headers.set('origin', origin);

		return {
			request: { method, headers },
			url: { pathname, searchParams: new URLSearchParams() },
			locals: {} as Record<string, unknown>,
			getClientAddress: () => '127.0.0.1'
		};
	}

	function mockResolve() {
		return vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
	}

	it('returns 204 with CORS headers for OPTIONS preflight on /api/v1/', async () => {
		const event = createEvent('OPTIONS', '/api/v1/tools', 'https://example.com');
		const resolve = mockResolve();
		const response = await handleFn({ event, resolve });

		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
		expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
		expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
		expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-API-Key');
		expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
		// Should NOT call resolve — preflight is handled entirely in hooks
		expect(resolve).not.toHaveBeenCalled();
	});

	it('does not add CORS headers for OPTIONS on non-v1 routes', async () => {
		const event = createEvent('OPTIONS', '/api/chat', 'https://example.com');
		const resolve = mockResolve();
		const response = await handleFn({ event, resolve });

		// Non-v1 route should go through normal flow (resolve called)
		expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('does not add CORS headers when no Origin header is present', async () => {
		const event = createEvent('OPTIONS', '/api/v1/tools');
		const resolve = mockResolve();
		const response = await handleFn({ event, resolve });

		// No origin = no CORS (not a cross-origin request)
		expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('adds CORS headers to error responses for v1 routes', async () => {
		// No auth → errorResponse returns 401
		const event = createEvent('GET', '/api/v1/tools', 'https://app.example.com');
		const resolve = mockResolve();
		const response = await handleFn({ event, resolve });

		// Auth fails (no session, no API key) → 401 with CORS
		expect(response.status).toBe(401);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
	});

	it('does not add CORS to non-v1 error responses', async () => {
		const event = createEvent('GET', '/api/chat', 'https://app.example.com');
		const resolve = mockResolve();
		const response = await handleFn({ event, resolve });

		// Auth fails on /api/chat but no CORS headers
		expect(response.status).toBe(401);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});
});
