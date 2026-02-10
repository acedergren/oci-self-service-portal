import type { FastifyInstance } from 'fastify';
import { registry } from '@portal/server/metrics';

/**
 * Prometheus metrics endpoint.
 *
 * - GET /api/metrics — Prometheus text format metrics
 */
export async function metricsRoutes(app: FastifyInstance): Promise<void> {
	app.get('/api/metrics', async (_request, reply) => {
		const output = registry.collect();
		return reply.type('text/plain; charset=utf-8').send(output);
	});
}
