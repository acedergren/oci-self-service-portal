import fp from 'fastify-plugin';
import fastifyHelmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

async function helmetPlugin(app: FastifyInstance): Promise<void> {
	await app.register(fastifyHelmet, {
		contentSecurityPolicy: {
			directives: {
				defaultSrc: ["'none'"],
				frameAncestors: ["'none'"]
			}
		}
	});
}

export default fp(helmetPlugin, { name: 'helmet' });
