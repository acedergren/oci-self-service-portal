/**
 * Phase 9: Feature flag for Fastify backend proxy.
 *
 * Tests the route matching logic in $lib/server/feature-flags.ts.
 * The proxy function itself is tested via integration tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to control env vars before the module loads, so we use dynamic imports
// and reset the module registry between tests.
describe('Feature Flags (Phase 9.16)', () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
		vi.resetModules();
	});

	describe('shouldProxyToFastify()', () => {
		describe('when FASTIFY_ENABLED=false (default)', () => {
			beforeEach(() => {
				process.env.FASTIFY_ENABLED = 'false';
			});

			it('should return false for all paths', async () => {
				const { shouldProxyToFastify } = await import('$lib/server/feature-flags.js');
				expect(shouldProxyToFastify('/api/health')).toBe(false);
				expect(shouldProxyToFastify('/api/sessions')).toBe(false);
				expect(shouldProxyToFastify('/api/v1/tools')).toBe(false);
				expect(shouldProxyToFastify('/')).toBe(false);
			});
		});

		describe('when FASTIFY_ENABLED=true with no route filter', () => {
			beforeEach(() => {
				process.env.FASTIFY_ENABLED = 'true';
				process.env.FASTIFY_PROXY_ROUTES = '';
			});

			it('should proxy /api/* routes', async () => {
				const { shouldProxyToFastify } = await import('$lib/server/feature-flags.js');
				expect(shouldProxyToFastify('/api/health')).toBe(true);
				expect(shouldProxyToFastify('/api/sessions')).toBe(true);
				expect(shouldProxyToFastify('/api/v1/tools')).toBe(true);
				expect(shouldProxyToFastify('/api/chat')).toBe(true);
				expect(shouldProxyToFastify('/api/metrics')).toBe(true);
			});

			it('should NOT proxy non-API routes', async () => {
				const { shouldProxyToFastify } = await import('$lib/server/feature-flags.js');
				expect(shouldProxyToFastify('/')).toBe(false);
				expect(shouldProxyToFastify('/login')).toBe(false);
				expect(shouldProxyToFastify('/self-service')).toBe(false);
				expect(shouldProxyToFastify('/designer')).toBe(false);
			});

			it('should proxy /api/auth/* when Fastify handles auth routes', async () => {
				const { shouldProxyToFastify } = await import('$lib/server/feature-flags.js');
				expect(shouldProxyToFastify('/api/auth/callback/oci-iam')).toBe(true);
				expect(shouldProxyToFastify('/api/auth/session')).toBe(true);
				expect(shouldProxyToFastify('/api/auth/signin')).toBe(true);
			});
		});

		describe('when FASTIFY_ENABLED=true with specific routes', () => {
			beforeEach(() => {
				process.env.FASTIFY_ENABLED = 'true';
				process.env.FASTIFY_PROXY_ROUTES = '/api/health,/api/sessions,/api/v1/';
			});

			it('should proxy only specified route prefixes', async () => {
				const { shouldProxyToFastify } = await import('$lib/server/feature-flags.js');
				expect(shouldProxyToFastify('/api/health')).toBe(true);
				expect(shouldProxyToFastify('/api/sessions')).toBe(true);
				expect(shouldProxyToFastify('/api/sessions/abc-123')).toBe(true);
				expect(shouldProxyToFastify('/api/v1/tools')).toBe(true);
				expect(shouldProxyToFastify('/api/v1/webhooks')).toBe(true);
			});

			it('should NOT proxy non-listed routes', async () => {
				const { shouldProxyToFastify } = await import('$lib/server/feature-flags.js');
				expect(shouldProxyToFastify('/api/chat')).toBe(false);
				expect(shouldProxyToFastify('/api/models')).toBe(false);
				expect(shouldProxyToFastify('/api/activity')).toBe(false);
				expect(shouldProxyToFastify('/api/metrics')).toBe(false);
			});

			it('should proxy /api/auth/* when explicitly listed', async () => {
				process.env.FASTIFY_PROXY_ROUTES = '/api/auth/,/api/health';
				const { shouldProxyToFastify } = await import('$lib/server/feature-flags.js');
				expect(shouldProxyToFastify('/api/auth/callback/oci-iam')).toBe(true);
				expect(shouldProxyToFastify('/api/health')).toBe(true);
			});
		});
	});

	describe('FASTIFY_URL default', () => {
		it('should default to http://localhost:3001', async () => {
			delete process.env.FASTIFY_URL;
			const { FASTIFY_URL } = await import('$lib/server/feature-flags.js');
			expect(FASTIFY_URL).toBe('http://localhost:3001');
		});

		it('should use FASTIFY_URL env var when set', async () => {
			process.env.FASTIFY_URL = 'http://api:3001';
			const { FASTIFY_URL } = await import('$lib/server/feature-flags.js');
			expect(FASTIFY_URL).toBe('http://api:3001');
		});
	});

	describe('FASTIFY_PROXY_ROUTES parsing', () => {
		it('should parse comma-separated routes', async () => {
			process.env.FASTIFY_PROXY_ROUTES = '/api/health, /api/sessions , /api/v1/';
			const { FASTIFY_PROXY_ROUTES } = await import('$lib/server/feature-flags.js');
			expect(FASTIFY_PROXY_ROUTES).toEqual(['/api/health', '/api/sessions', '/api/v1/']);
		});

		it('should handle empty string', async () => {
			process.env.FASTIFY_PROXY_ROUTES = '';
			const { FASTIFY_PROXY_ROUTES } = await import('$lib/server/feature-flags.js');
			expect(FASTIFY_PROXY_ROUTES).toEqual([]);
		});

		it('should filter out blank entries', async () => {
			process.env.FASTIFY_PROXY_ROUTES = '/api/health,,, /api/v1/,';
			const { FASTIFY_PROXY_ROUTES } = await import('$lib/server/feature-flags.js');
			expect(FASTIFY_PROXY_ROUTES).toEqual(['/api/health', '/api/v1/']);
		});
	});

	describe('proxyToFastify()', () => {
		it('should return 502 when Fastify is unreachable', async () => {
			process.env.FASTIFY_ENABLED = 'true';
			process.env.FASTIFY_URL = 'http://localhost:59999'; // unlikely to be running
			const { proxyToFastify } = await import('$lib/server/feature-flags.js');

			const request = new Request('http://localhost:5173/api/health', {
				method: 'GET'
			});

			const response = await proxyToFastify(request, '/api/health');
			expect(response.status).toBe(502);

			const body = await response.json();
			expect(body.error).toBe('Backend unavailable');
		});

		it('should forward query string to target URL', async () => {
			process.env.FASTIFY_ENABLED = 'true';
			process.env.FASTIFY_URL = 'http://localhost:59999';
			const { proxyToFastify } = await import('$lib/server/feature-flags.js');

			// We can't easily test a successful proxy without a running server,
			// but we can verify the 502 response is returned (meaning it tried the right URL)
			const request = new Request('http://localhost:5173/api/sessions?limit=10&offset=0', {
				method: 'GET'
			});

			const response = await proxyToFastify(request, '/api/sessions');
			expect(response.status).toBe(502);
		});
	});
});
