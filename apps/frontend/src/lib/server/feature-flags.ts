/**
 * Phase 9.15: Feature flag module for Fastify backend proxy.
 *
 * Controls whether SvelteKit should forward API requests to the Fastify backend.
 * When enabled, proxies /api/* routes to Fastify.
 */

// ── Environment Variables ─────────────────────────────────────────────────────

/** Fastify backend URL (default: http://localhost:3001) */
export const FASTIFY_URL = process.env.FASTIFY_URL || 'http://localhost:3001';

/** Whether Fastify proxying is enabled (default: false) */
const FASTIFY_ENABLED = process.env.FASTIFY_ENABLED === 'true';

/**
 * Comma-separated list of route prefixes to proxy (e.g., "/api/health,/api/sessions").
 * If empty and FASTIFY_ENABLED=true, all /api/* routes are proxied.
 * If populated, only specified prefixes are proxied.
 */
export const FASTIFY_PROXY_ROUTES: string[] = (process.env.FASTIFY_PROXY_ROUTES || '')
	.split(',')
	.map((route) => route.trim())
	.filter((route) => route.length > 0);

// ── Routing Logic ─────────────────────────────────────────────────────────────

/**
 * Determines whether the given pathname should be proxied to Fastify.
 *
 * Rules:
 * - If FASTIFY_ENABLED !== 'true', returns false
 * - If FASTIFY_PROXY_ROUTES is empty: proxies all /api/* routes
 * - If FASTIFY_PROXY_ROUTES is populated: only proxies matching prefixes
 *
 * @param pathname - Request pathname (e.g., "/api/health")
 * @returns true if request should be proxied to Fastify, false otherwise
 */
export function shouldProxyToFastify(pathname: string): boolean {
	// Feature flag disabled
	if (!FASTIFY_ENABLED) {
		return false;
	}

	// Empty route list = proxy all /api/*
	if (FASTIFY_PROXY_ROUTES.length === 0) {
		return pathname.startsWith('/api/');
	}

	// Specific routes configured = only proxy matching prefixes
	return FASTIFY_PROXY_ROUTES.some((prefix) => pathname.startsWith(prefix));
}

// ── Proxy Handler ─────────────────────────────────────────────────────────────

/**
 * Proxies a request to the Fastify backend.
 *
 * Forwards headers (including X-Request-Id) and query string.
 * Returns 502 with JSON error body if Fastify is unreachable.
 *
 * @param request - Original request object
 * @param pathname - Request pathname (e.g., "/api/health")
 * @returns Response from Fastify, or 502 error if unreachable
 */
export async function proxyToFastify(request: Request, pathname: string): Promise<Response> {
	// Construct target URL with query string
	const url = new URL(request.url);
	const targetUrl = `${FASTIFY_URL}${pathname}${url.search}`;

	try {
		// Forward request to Fastify with same method, headers, and body
		const response = await fetch(targetUrl, {
			method: request.method,
			headers: request.headers,
			body: request.body,
			// @ts-expect-error - duplex is required for streaming request bodies
			duplex: 'half'
		});

		return response;
	} catch {
		// Fastify unreachable (ECONNREFUSED, timeout, etc.)
		return new Response(JSON.stringify({ error: 'Backend unavailable' }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}
