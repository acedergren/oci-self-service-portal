/**
 * Phase 9.17: Proxy integration tests.
 *
 * Tests the Fastify proxy behavior in hooks.server.ts integration.
 * Verifies header forwarding, query string preservation, and route filtering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Proxy Integration (Phase 9.17)', () => {
	const originalEnv = { ...process.env };
	const originalFetch = global.fetch;

	// Mock fetch with forwarding pattern (survives mockReset: true)
	const mockFetch = vi.fn();
	beforeEach(() => {
		global.fetch = vi.fn((...args) => mockFetch(...args)) as typeof fetch;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		global.fetch = originalFetch;
		vi.resetModules();
		vi.clearAllMocks();
	});

	describe('Proxy disabled', () => {
		beforeEach(() => {
			process.env.FASTIFY_ENABLED = 'false';
		});

		it('should return false for all paths when proxy is disabled', async () => {
			const { shouldProxyToFastify } = await import('$lib/server/feature-flags.js');
			expect(shouldProxyToFastify('/api/health')).toBe(false);
			expect(shouldProxyToFastify('/api/sessions')).toBe(false);
			expect(shouldProxyToFastify('/api/v1/tools')).toBe(false);
			expect(shouldProxyToFastify('/api/auth/callback/oci-iam')).toBe(false);
		});
	});

	describe('Proxy enabled + Fastify unreachable', () => {
		beforeEach(() => {
			process.env.FASTIFY_ENABLED = 'true';
			process.env.FASTIFY_URL = 'http://localhost:59999';
			process.env.FASTIFY_PROXY_ROUTES = '';

			// Mock fetch to throw connection error
			mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
		});

		it('should return 502 JSON when Fastify is unreachable', async () => {
			const { proxyToFastify } = await import('$lib/server/feature-flags.js');

			const request = new Request('http://localhost:5173/api/health', {
				method: 'GET'
			});

			const response = await proxyToFastify(request, '/api/health');
			expect(response.status).toBe(502);

			const body = await response.json();
			expect(body).toEqual({ error: 'Backend unavailable' });
		});
	});

	describe('Auth exclusion', () => {
		beforeEach(() => {
			process.env.FASTIFY_ENABLED = 'true';
			process.env.FASTIFY_PROXY_ROUTES = '';
		});

		it('should never proxy /api/auth/* even when enabled', async () => {
			const { shouldProxyToFastify } = await import('$lib/server/feature-flags.js');

			expect(shouldProxyToFastify('/api/auth/callback/oci-iam')).toBe(false);
			expect(shouldProxyToFastify('/api/auth/session')).toBe(false);
			expect(shouldProxyToFastify('/api/auth/signin')).toBe(false);
			expect(shouldProxyToFastify('/api/auth/signout')).toBe(false);
		});

		it('should still proxy other /api/* routes', async () => {
			const { shouldProxyToFastify } = await import('$lib/server/feature-flags.js');

			expect(shouldProxyToFastify('/api/health')).toBe(true);
			expect(shouldProxyToFastify('/api/sessions')).toBe(true);
			expect(shouldProxyToFastify('/api/v1/tools')).toBe(true);
		});
	});

	describe('Header forwarding', () => {
		beforeEach(() => {
			process.env.FASTIFY_ENABLED = 'true';
			process.env.FASTIFY_URL = 'http://localhost:3001';
			process.env.FASTIFY_PROXY_ROUTES = '';

			// Mock successful fetch
			mockFetch.mockResolvedValue(
				new Response(JSON.stringify({ status: 'ok' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			);
		});

		it('should forward X-Request-Id header', async () => {
			const { proxyToFastify } = await import('$lib/server/feature-flags.js');

			const request = new Request('http://localhost:5173/api/health', {
				method: 'GET',
				headers: {
					'X-Request-Id': 'req-12345'
				}
			});

			await proxyToFastify(request, '/api/health');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/api/health',
				expect.objectContaining({
					headers: expect.objectContaining({
						get: expect.any(Function)
					})
				})
			);

			// Verify headers were passed through
			const fetchCall = mockFetch.mock.calls[0];
			const headers = fetchCall[1].headers as Headers;
			expect(headers.get('X-Request-Id')).toBe('req-12345');
		});

		it('should forward Cookie header', async () => {
			const { proxyToFastify } = await import('$lib/server/feature-flags.js');

			const request = new Request('http://localhost:5173/api/sessions', {
				method: 'GET',
				headers: {
					Cookie: 'session=abc123; Path=/'
				}
			});

			await proxyToFastify(request, '/api/sessions');

			const fetchCall = mockFetch.mock.calls[0];
			const headers = fetchCall[1].headers as Headers;
			expect(headers.get('Cookie')).toBe('session=abc123; Path=/');
		});

		it('should forward Authorization header', async () => {
			const { proxyToFastify } = await import('$lib/server/feature-flags.js');

			const request = new Request('http://localhost:5173/api/v1/tools', {
				method: 'GET',
				headers: {
					Authorization: 'Bearer portal_abc123'
				}
			});

			await proxyToFastify(request, '/api/v1/tools');

			const fetchCall = mockFetch.mock.calls[0];
			const headers = fetchCall[1].headers as Headers;
			expect(headers.get('Authorization')).toBe('Bearer portal_abc123');
		});
	});

	describe('Query string preservation', () => {
		beforeEach(() => {
			process.env.FASTIFY_ENABLED = 'true';
			process.env.FASTIFY_URL = 'http://localhost:3001';
			process.env.FASTIFY_PROXY_ROUTES = '';

			mockFetch.mockResolvedValue(
				new Response(JSON.stringify([]), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			);
		});

		it('should preserve query string in proxied URL', async () => {
			const { proxyToFastify } = await import('$lib/server/feature-flags.js');

			const request = new Request('http://localhost:5173/api/sessions?limit=10&offset=0', {
				method: 'GET'
			});

			await proxyToFastify(request, '/api/sessions');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/api/sessions?limit=10&offset=0',
				expect.any(Object)
			);
		});

		it('should preserve complex query strings with encoding', async () => {
			const { proxyToFastify } = await import('$lib/server/feature-flags.js');

			const request = new Request(
				'http://localhost:5173/api/search?q=test%20query&filter=active&sort=name',
				{
					method: 'GET'
				}
			);

			await proxyToFastify(request, '/api/search');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/api/search?q=test%20query&filter=active&sort=name',
				expect.any(Object)
			);
		});

		it('should work with empty query string', async () => {
			const { proxyToFastify } = await import('$lib/server/feature-flags.js');

			const request = new Request('http://localhost:5173/api/health', {
				method: 'GET'
			});

			await proxyToFastify(request, '/api/health');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/api/health',
				expect.any(Object)
			);
		});
	});

	describe('Selective route proxying', () => {
		beforeEach(() => {
			process.env.FASTIFY_ENABLED = 'true';
			process.env.FASTIFY_PROXY_ROUTES = '/api/health,/api/sessions,/api/v1/';
		});

		it('should only proxy specified route prefixes', async () => {
			const { shouldProxyToFastify } = await import('$lib/server/feature-flags.js');

			// Should proxy - in the list
			expect(shouldProxyToFastify('/api/health')).toBe(true);
			expect(shouldProxyToFastify('/api/sessions')).toBe(true);
			expect(shouldProxyToFastify('/api/sessions/abc-123')).toBe(true);
			expect(shouldProxyToFastify('/api/v1/tools')).toBe(true);
			expect(shouldProxyToFastify('/api/v1/webhooks')).toBe(true);
		});

		it('should not proxy non-listed routes', async () => {
			const { shouldProxyToFastify } = await import('$lib/server/feature-flags.js');

			expect(shouldProxyToFastify('/api/chat')).toBe(false);
			expect(shouldProxyToFastify('/api/models')).toBe(false);
			expect(shouldProxyToFastify('/api/activity')).toBe(false);
			expect(shouldProxyToFastify('/api/metrics')).toBe(false);
		});

		it('should still exclude /api/auth/* even when listed', async () => {
			process.env.FASTIFY_PROXY_ROUTES = '/api/auth/,/api/health';
			const { shouldProxyToFastify } = await import('$lib/server/feature-flags.js');

			expect(shouldProxyToFastify('/api/auth/callback/oci-iam')).toBe(false);
			expect(shouldProxyToFastify('/api/auth/session')).toBe(false);
			expect(shouldProxyToFastify('/api/health')).toBe(true);
		});
	});
});
