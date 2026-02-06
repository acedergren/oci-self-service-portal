import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runHealthChecks } from '@portal/shared/server/health';

/**
 * GET /api/health — Deep health check endpoint.
 *
 * Returns 200 for ok/degraded, 503 only when critical checks fail.
 * Prometheus can scrape this for up/down alerting.
 */
export const GET: RequestHandler = async () => {
	const result = await runHealthChecks();

	const httpStatus = result.status === 'error' ? 503 : 200;

	return json(result, { status: httpStatus });
};
