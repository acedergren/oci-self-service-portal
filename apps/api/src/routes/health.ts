import type { FastifyInstance } from 'fastify';
import { runHealthChecks } from '@portal/shared/server/health';

const HEALTH_CHECK_TIMEOUT_MS = 3_000;

/**
 * Health check routes.
 *
 * - GET /healthz — lightweight liveness probe (plain text "ok")
 * - GET /health  — deep health check with subsystem details (3s timeout)
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
	// Lightweight liveness probe for load balancers / k8s
	app.get('/healthz', async (_request, reply) => {
		return reply.type('text/plain').send('ok');
	});

	// Deep health check with subsystem statuses
	app.get('/health', async (_request, reply) => {
		try {
			const result = await Promise.race([
				runHealthChecks(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT_MS)
				)
			]);
			const httpStatus = result.status === 'error' ? 503 : 200;
			return reply.status(httpStatus).send(result);
		} catch {
			return reply.status(503).send({
				status: 'error',
				message: 'Health check timed out',
				timestamp: new Date().toISOString()
			});
		}
	});
}
