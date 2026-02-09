import type { FastifyPluginAsync } from 'fastify';

/**
 * OpenAPI spec endpoint
 *
 * Exposes the generated OpenAPI 3.0 JSON spec at /api/v1/openapi.json
 * for client generation and documentation.
 *
 * This is a public endpoint (no auth required) with caching enabled.
 */
const openApiRoute: FastifyPluginAsync = async (fastify) => {
	fastify.get(
		'/api/v1/openapi.json',
		{
			schema: { hide: true }, // Don't include this meta-route in the spec
			onSend: async (_request, reply, payload) => {
				// Override the global no-cache header for this endpoint
				reply.header('Cache-Control', 'public, max-age=3600');
				return payload;
			}
		},
		async (_request, reply) => {
			// Check if swagger plugin is registered
			if (!fastify.swagger) {
				return reply.code(503).send({
					error: 'Service Unavailable',
					message: 'OpenAPI documentation is not enabled'
				});
			}

			const spec = fastify.swagger();
			reply.header('Content-Type', 'application/json');
			return spec;
		}
	);
};

export default openApiRoute;
