import type { RequestHandler } from './$types';
import { registry } from '@portal/shared/server/metrics.js';

/**
 * GET /api/metrics — Prometheus scrape endpoint.
 *
 * Returns all registered metrics in Prometheus text exposition format.
 * Intentionally public (listed in PUBLIC_PATHS in hooks.server.ts) so that
 * Prometheus can scrape without authentication.
 */
export const GET: RequestHandler = async () => {
	return new Response(registry.collect(), {
		status: 200,
		headers: { 'Content-Type': registry.contentType }
	});
};
