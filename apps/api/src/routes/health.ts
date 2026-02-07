import type { FastifyInstance } from 'fastify';
import { runHealthChecks } from '@portal/shared/server/health';

/**
 * Health check routes.
 *
 * - GET /healthz — lightweight liveness probe (plain text "ok")
 * - GET /health  — deep health check with subsystem details
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
	// Lightweight liveness probe for load balancers / k8s
	app.get('/healthz', async (_request, reply) => {
		return reply.type('text/plain').send('ok');
	});

	// Deep health check with subsystem statuses
	app.get('/health', async (_request, reply) => {
		const result = await runHealthChecks();
		const httpStatus = result.status === 'error' ? 503 : 200;
		return reply.status(httpStatus).send(result);
	});
}
