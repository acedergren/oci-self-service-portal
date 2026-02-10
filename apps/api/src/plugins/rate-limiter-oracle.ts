import fp from 'fastify-plugin';
import type { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import { checkRateLimit, RATE_LIMIT_CONFIG } from '@portal/shared/server/rate-limiter';
import { createLogger } from '@portal/shared/server/logger';

const log = createLogger('rate-limiter-oracle');

/**
 * Paths that bypass rate limiting entirely.
 */
const EXCLUDE_PATHS = ['/healthz', '/health', '/api/metrics'];

/**
 * Maps endpoint paths to rate limit categories.
 * Endpoints matching these paths use specific limits from RATE_LIMIT_CONFIG.
 * All other endpoints default to the 'api' limit.
 */
const ENDPOINT_LIMITS: Record<string, string> = {
	'/api/chat': 'chat',
	'/api/tools': 'chat'
};

/**
 * Resolve a unique client identifier from the request context.
 * Priority: authenticated user > API key > IP address
 */
function resolveClientId(request: FastifyRequest): string {
	if (request.user?.id) {
		return `user:${request.user.id}`;
	}
	if (request.apiKeyContext?.keyId) {
		return `key:${request.apiKeyContext.keyId}`;
	}
	return `ip:${request.ip}`;
}

/**
 * Resolve the rate limit category for a given endpoint path.
 * Returns the category key (e.g., 'chat', 'api') used to look up the limit.
 */
function resolveEndpointCategory(path: string): string {
	return ENDPOINT_LIMITS[path] ?? 'api';
}

/**
 * Fastify plugin that enforces per-user, per-endpoint rate limits using Oracle Database.
 * This provides a second layer of defense beyond in-memory rate limiting.
 *
 * - Authenticated users are tracked by their user ID
 * - API keys are tracked by key ID
 * - Unauthenticated requests are tracked by IP address
 * - Different endpoints have different limits (chat: 20/min, api: 60/min)
 * - Fail-open: allows requests through when Oracle is unavailable
 * - Excludes health check and metrics endpoints from rate limiting
 */
const rateLimiterOraclePluginImpl: FastifyPluginAsync = async (fastify) => {
	fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
		const path = request.url.split('?')[0]; // Strip query params

		// Skip rate limiting for excluded paths
		if (EXCLUDE_PATHS.includes(path)) {
			return;
		}

		const clientId = resolveClientId(request);
		const endpoint = resolveEndpointCategory(path);

		try {
			const result = await checkRateLimit(clientId, endpoint, RATE_LIMIT_CONFIG);

			if (result === null) {
				// Limit exceeded — return 429
				const retryAfter = Math.ceil(RATE_LIMIT_CONFIG.windowMs / 1000);

				reply.status(429);
				reply.header('X-RateLimit-Remaining', '0');
				reply.header('X-RateLimit-Reset', Math.floor((Date.now() + RATE_LIMIT_CONFIG.windowMs) / 1000).toString());
				reply.header('Retry-After', retryAfter.toString());

				return reply.send({
					error: 'RATE_LIMIT',
					message: 'Too many requests. Please try again later.'
				});
			}

			// Set rate limit headers
			reply.header('X-RateLimit-Remaining', result.remaining.toString());
			reply.header('X-RateLimit-Reset', Math.floor(result.resetAt / 1000).toString());
		} catch (err) {
			// Fail-open: allow the request through on errors
			log.warn({ err, clientId, endpoint, path }, 'rate limit check failed — allowing request');
		}
	});
};

export const rateLimiterOraclePlugin = fp(rateLimiterOraclePluginImpl, {
	name: 'rate-limiter-oracle',
	fastify: '5.x'
});
