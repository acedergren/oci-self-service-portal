import fp from 'fastify-plugin';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

export interface RateLimitPluginOptions {
	rateLimitMax: number;
}

async function rateLimitPlugin(app: FastifyInstance, opts: RateLimitPluginOptions): Promise<void> {
	await app.register(fastifyRateLimit, {
		max: opts.rateLimitMax,
		timeWindow: '1 minute'
	});
}

export default fp(rateLimitPlugin, { name: 'rate-limit' });
