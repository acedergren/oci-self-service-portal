/**
 * Phase 10 W1-1: Strip /api/* middleware from SvelteKit hooks.server.ts
 *
 * After stripping, hooks.server.ts should:
 * - NOT handle CORS for /api/v1/* (Fastify does this via @fastify/cors)
 * - NOT apply rate limiting for /api/* (Fastify does this via rateLimiterOraclePlugin)
 * - STILL apply security headers to all page responses
 * - STILL inject CSP nonce for page responses
 * - STILL run Oracle DB initialization for SSR pages
 * - STILL do request tracing (X-Request-Id)
 * - STILL do graceful shutdown on SIGTERM/SIGINT
 *
 * The handle function should have a single unified code path — no special /api/* branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@portal/server/oracle/connection', () => ({
	initPool: vi.fn().mockResolvedValue(undefined),
	closePool: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@portal/server/oracle/migrations', () => ({
	runMigrations: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@portal/server/oracle/repositories/webhook-repository', () => ({
	webhookRepository: {
		migratePlaintextSecrets: vi.fn().mockResolvedValue({ migrated: 0, remaining: 0 })
	}
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		fatal: vi.fn()
	})
}));

vi.mock('@portal/server/sentry', () => ({
	initSentry: vi.fn().mockResolvedValue(undefined),
	captureError: vi.fn(),
	closeSentry: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@portal/server/tracing', () => ({
	generateRequestId: vi.fn().mockReturnValue('req-test-123'),
	REQUEST_ID_HEADER: 'X-Request-Id'
}));

vi.mock('@portal/server/metrics', () => ({
	httpRequestDuration: { observe: vi.fn() }
}));

vi.mock('$app/environment', () => ({
	dev: false
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('W1-1: hooks.server.ts — /api/* middleware stripped', () => {
	let hooksModule: {
		handle: (args: { event: unknown; resolve: unknown }) => Promise<Response>;
		getCSPHeader: (nonce?: string) => string;
	};

	beforeEach(async () => {
		// Satisfy startup guard: BETTER_AUTH_SECRET must be set when dev=false
		process.env.BETTER_AUTH_SECRET ??= 'test-only-secret';
		vi.clearAllMocks();
		// Dynamic import after mocks are registered
		hooksModule = (await import('../../hooks.server.js')) as typeof hooksModule;
	});

	describe('no CORS logic remaining for /api/v1/*', () => {
		it('should not export getCorsOrigin or CORS-related functions', () => {
			const mod = hooksModule as Record<string, unknown>;
			// These were removed — only getCSPHeader and handle should be exported
			expect(mod.getCorsOrigin).toBeUndefined();
			expect(mod.addCorsHeaders).toBeUndefined();
			expect(mod.withV1Cors).toBeUndefined();
		});

		it('should not reference checkRateLimit — not imported', () => {
			const mod = hooksModule as Record<string, unknown>;
			expect(mod.checkRateLimit).toBeUndefined();
			expect(mod.addRateLimitHeaders).toBeUndefined();
		});
	});

	describe('security headers still applied', () => {
		it('getCSPHeader still exported for testing', () => {
			expect(typeof hooksModule.getCSPHeader).toBe('function');
		});

		it('getCSPHeader with nonce should include nonce in script-src', () => {
			const csp = hooksModule.getCSPHeader('test-nonce-abc');
			expect(csp).toContain("'nonce-test-nonce-abc'");
		});

		it('getCSPHeader without nonce should include unsafe-inline (fallback)', () => {
			const csp = hooksModule.getCSPHeader();
			const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'));
			expect(scriptSrc).toContain('unsafe-inline');
		});

		it('CSP header should include required security directives', () => {
			const csp = hooksModule.getCSPHeader('nonce-123');
			expect(csp).toContain("default-src 'self'");
			expect(csp).toContain("frame-src 'none'");
			expect(csp).toContain("object-src 'none'");
		});
	});

	describe('handle function — unified page path', () => {
		function makeEvent(pathname: string, method = 'GET') {
			return {
				url: new URL(`https://example.com${pathname}`),
				request: {
					method,
					headers: new Headers({ 'x-request-id': 'incoming-req-id' })
				},
				locals: {} as Record<string, unknown>,
				getClientAddress: () => '127.0.0.1'
			};
		}

		it('handle should process a page request without error', async () => {
			const event = makeEvent('/dashboard');
			const resolve = vi.fn().mockResolvedValue(
				new Response('<html>page</html>', {
					status: 200,
					headers: { 'content-type': 'text/html' }
				})
			);

			const response = await hooksModule.handle({ event, resolve });
			expect(response.status).toBe(200);
			expect(resolve).toHaveBeenCalledOnce();
		});

		it('handle should add security headers to page responses', async () => {
			const event = makeEvent('/dashboard');
			const resolve = vi.fn().mockResolvedValue(new Response('<html>page</html>', { status: 200 }));

			const response = await hooksModule.handle({ event, resolve });

			// Security headers should be present
			expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
			expect(response.headers.get('X-Frame-Options')).toBe('DENY');
			expect(response.headers.get('Content-Security-Policy')).toBeTruthy();
		});

		it('handle should set X-Request-Id on response', async () => {
			const event = makeEvent('/dashboard');
			const resolve = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

			const response = await hooksModule.handle({ event, resolve });
			expect(response.headers.get('X-Request-Id')).toBeTruthy();
		});

		it('handle should use the same code path for /api/* as for pages', async () => {
			// After stripping, /api/* routes go through the same unified path.
			// There's no special branching for API paths in hooks — Fastify handles all /api/*.
			// In practice, nginx routes /api/* directly to Fastify so SvelteKit hooks
			// should never receive /api/* requests. But if they do, no special handling occurs.
			const event = makeEvent('/api/health');
			const resolve = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

			// Should not throw — just resolve normally with security headers
			const response = await hooksModule.handle({ event, resolve });
			expect(response).toBeInstanceOf(Response);
			expect(resolve).toHaveBeenCalledOnce();
		});
	});
});
