import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { runHealthChecks } from '@portal/server/health';

const HEALTH_CHECK_TIMEOUT_MS = 3_000;

/**
 * Health check routes.
 *
 * - GET /healthz     — lightweight liveness probe (plain text "ok")
 * - GET /api/healthz — alias (Nginx proxies /api/* to Fastify)
 * - GET /health      — deep health check with subsystem details (3s timeout)
 * - GET /api/health  — alias (frontend observability dashboard)
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
	// ── Handlers ──────────────────────────────────────────────────────────

	async function livenessHandler(_request: FastifyRequest, reply: FastifyReply) {
		return reply.type('text/plain').send('ok');
	}

	async function deepHealthHandler(_request: FastifyRequest, reply: FastifyReply) {
		try {
			let timeoutId: ReturnType<typeof setTimeout>;
			const timeoutPromise = new Promise<never>((_, reject) => {
				timeoutId = setTimeout(
					() => reject(new Error('Health check timeout')),
					HEALTH_CHECK_TIMEOUT_MS
				);
			});
			const result = await Promise.race([runHealthChecks(), timeoutPromise]);
			clearTimeout(timeoutId!);
			const httpStatus = result.status === 'error' ? 503 : 200;
			return reply.status(httpStatus).send(result);
		} catch (err) {
			const isTimeout = err instanceof Error && err.message === 'Health check timeout';
			return reply.status(503).send({
				status: 'error',
				message: isTimeout ? 'Health check timed out' : 'Health check failed',
				...(isTimeout ? {} : { error: (err as Error).message }),
				timestamp: new Date().toISOString()
			});
		}
	}

	// ── Routes ────────────────────────────────────────────────────────────

	// Lightweight liveness probe (direct access for k8s / load balancers)
	app.get('/healthz', livenessHandler);
	app.get('/api/healthz', livenessHandler);

	// Deep health check with subsystem statuses
	app.get('/health', deepHealthHandler);
	app.get('/api/health', deepHealthHandler);
}
