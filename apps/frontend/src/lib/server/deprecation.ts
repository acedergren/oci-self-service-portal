/**
 * Phase 9.19: Deprecation headers for legacy workflow routes.
 *
 * Adds RFC 8594 Deprecation and Sunset headers to legacy SvelteKit API routes
 * to signal migration to Fastify backend (/api/v1/*).
 */

/**
 * Adds deprecation headers to a response.
 *
 * Sets:
 * - `Deprecation: true` — RFC 8594 deprecation signal
 * - `Sunset: <date>` — Date when endpoint will be removed
 * - `Link: <successor>; rel="successor-version"` — Replacement endpoint
 *
 * @param headers - Response headers object
 * @param successorPath - Path to the replacement endpoint (e.g., "/api/v1/workflows")
 * @param sunsetDate - Optional sunset date (defaults to May 30, 2026)
 */
export function addDeprecationHeaders(
	headers: Headers,
	successorPath: string,
	sunsetDate?: string
): void {
	headers.set('Deprecation', 'true');
	headers.set('Sunset', sunsetDate ?? 'Sat, 30 May 2026 00:00:00 GMT');
	headers.set('Link', `<${successorPath}>; rel="successor-version"`);
}
