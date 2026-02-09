import fp from 'fastify-plugin';
import fastifyCors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

export interface CorsPluginOptions {
	corsOrigin: string;
}

async function corsPlugin(app: FastifyInstance, opts: CorsPluginOptions): Promise<void> {
	await app.register(fastifyCors, {
		origin: opts.corsOrigin,
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-API-Key'],
		exposedHeaders: ['x-request-id']
	});
}

export default fp(corsPlugin, { name: 'cors' });
