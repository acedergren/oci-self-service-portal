/**
 * Feature flags for phased Fastify backend migration.
 *
 * When FASTIFY_ENABLED=true AND FASTIFY_URL is set, matched API routes
 * are proxied to the Fastify backend instead of being handled by SvelteKit.
 *
 * Routes to proxy can be controlled via FASTIFY_PROXY_ROUTES (comma-separated
 * path prefixes). When empty, ALL /api/* routes are proxied.
 */
import { createLogger } from './logger.js';

const log = createLogger('feature-flags');

/** Whether the Fastify backend proxy is enabled */
export const FASTIFY_ENABLED = process.env.FASTIFY_ENABLED === 'true';

/** Base URL of the Fastify API (e.g. http://api:3001) */
export const FASTIFY_URL = process.env.FASTIFY_URL ?? 'http://localhost:3001';

/**
 * Route prefixes that should be proxied to Fastify.
 * Empty array means ALL /api/* routes are proxied.
 * Example: "/api/health,/api/sessions,/api/v1/"
 */
export const FASTIFY_PROXY_ROUTES: string[] = (process.env.FASTIFY_PROXY_ROUTES ?? '')
	.split(',')
	.map((r) => r.trim())
	.filter(Boolean);

/**
 * Check if a given URL path should be proxied to Fastify.
 */
export function shouldProxyToFastify(pathname: string): boolean {
	if (!FASTIFY_ENABLED) return false;

	// Only proxy /api/* routes
	if (!pathname.startsWith('/api/')) return false;

	// If specific routes are configured, only proxy those
	if (FASTIFY_PROXY_ROUTES.length > 0) {
		return FASTIFY_PROXY_ROUTES.some((prefix) => pathname.startsWith(prefix));
	}

	// Default: proxy all /api/* routes
	return true;
}

/**
 * Proxy a request to the Fastify backend.
 * Forwards method, headers, and body; returns the Fastify response.
 */
export async function proxyToFastify(request: Request, pathname: string): Promise<Response> {
	const targetUrl = `${FASTIFY_URL}${pathname}${new URL(request.url).search}`;

	log.debug({ targetUrl, method: request.method }, 'proxying to Fastify');

	try {
		const proxyHeaders = new Headers(request.headers);
		// Remove host header — let fetch set it for the target
		proxyHeaders.delete('host');

		const fetchInit: RequestInit = {
			method: request.method,
			headers: proxyHeaders,
			// Forward body for non-GET/HEAD requests
			body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
			duplex: request.body ? 'half' : undefined,
			signal: AbortSignal.timeout(30_000)
		};

		const upstream = await fetch(targetUrl, fetchInit);

		// Forward the response back, preserving status and headers
		const responseHeaders = new Headers(upstream.headers);
		// Tag proxied responses for debugging
		responseHeaders.set('X-Proxied-By', 'sveltekit');

		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: responseHeaders
		}) as unknown as Response;
	} catch (err) {
		const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
		const status = isTimeout ? 504 : 502;
		const message = isTimeout ? 'Backend timeout' : 'Backend unavailable';
		log.error({ err, targetUrl, isTimeout }, 'Fastify proxy error');
		return new Response(JSON.stringify({ error: message }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		}) as unknown as Response;
	}
}

// Log feature flag state at startup
if (FASTIFY_ENABLED) {
	log.info(
		{
			fastifyUrl: FASTIFY_URL,
			proxyRoutes: FASTIFY_PROXY_ROUTES.length > 0 ? FASTIFY_PROXY_ROUTES : 'ALL /api/*'
		},
		'Fastify proxy ENABLED'
	);
}
