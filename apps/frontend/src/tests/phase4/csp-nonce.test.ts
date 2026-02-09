/**
 * Phase 4 Security: CSP nonce-based script-src (I-2)
 *
 * Problem: hooks.server.ts uses 'unsafe-inline' for script-src in production.
 * Fix: Generate crypto nonce per request, use nonce in CSP header.
 *
 * Tests the getCSPHeader function directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
	generateRequestId: vi.fn().mockReturnValue('req-test-123'),
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
	errorResponse: vi.fn().mockReturnValue(new Response('error', { status: 500 }))
}));

vi.mock('$lib/server/metrics.js', () => ({
	httpRequestDuration: { observe: vi.fn() }
}));

vi.mock('$lib/server/sentry.js', () => ({
	initSentry: vi.fn().mockResolvedValue(undefined),
	captureError: vi.fn(),
	closeSentry: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$app/environment', () => ({
	dev: false
}));

describe('I-2: CSP nonce-based script-src', () => {
	let hooksModule: Record<string, unknown>;

	beforeEach(async () => {
		vi.clearAllMocks();
		hooksModule = await import('../../hooks.server.js');
	});

	it('should export getCSPHeader function', () => {
		expect(typeof hooksModule.getCSPHeader).toBe('function');
	});

	it('getCSPHeader with nonce should include nonce in script-src', () => {
		const getCSPHeader = hooksModule.getCSPHeader as (nonce?: string) => string;
		const nonce = 'test-nonce-abc123';
		const csp = getCSPHeader(nonce);

		expect(csp).toContain(`'nonce-${nonce}'`);
	});

	it('getCSPHeader with nonce should NOT include unsafe-inline in script-src', () => {
		const getCSPHeader = hooksModule.getCSPHeader as (nonce?: string) => string;
		const nonce = 'test-nonce-abc123';
		const csp = getCSPHeader(nonce);

		// script-src should not have unsafe-inline when nonce is provided
		// Parse out the script-src directive
		const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'));
		expect(scriptSrc).toBeDefined();
		expect(scriptSrc).not.toContain('unsafe-inline');
	});

	it('getCSPHeader without nonce should keep unsafe-inline (dev mode fallback)', () => {
		const getCSPHeader = hooksModule.getCSPHeader as (nonce?: string) => string;
		const csp = getCSPHeader();

		// Without nonce, should fall back to unsafe-inline for compatibility
		const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'));
		expect(scriptSrc).toBeDefined();
		expect(scriptSrc).toContain('unsafe-inline');
	});

	it('CSP header should always include standard security directives', () => {
		const getCSPHeader = hooksModule.getCSPHeader as (nonce?: string) => string;
		const csp = getCSPHeader('test-nonce');

		expect(csp).toContain("default-src 'self'");
		expect(csp).toContain("frame-src 'none'");
		expect(csp).toContain("object-src 'none'");
		expect(csp).toContain("base-uri 'self'");
	});

	it('nonce should be a valid UUID format when generated', () => {
		// Test that crypto.randomUUID produces valid nonces
		const nonce = crypto.randomUUID();
		expect(nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	});
});
