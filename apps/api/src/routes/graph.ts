import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	getUserActivity,
	getToolAffinity,
	getOrgImpact
} from '@portal/shared/server/oracle/graph-analytics';
import { createLogger } from '@portal/shared/server/logger';
import { requireAuth } from '../plugins/rbac.js';

const log = createLogger('api:graph');

const GraphQuerySchema = z.object({
	type: z.enum(['user-activity', 'tool-affinity', 'org-impact']),
	userId: z.string().optional(),
	toolName: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50)
});

const GraphResponseSchema = z.object({ type: z.string() }).passthrough();
const GraphErrorResponseSchema = z.object({ error: z.string() });

export async function graphRoutes(app: FastifyInstance): Promise<void> {
	app.get(
		'/api/v1/graph',
		{
			preHandler: requireAuth('admin:audit'),
			schema: {
				querystring: GraphQuerySchema,
				response: {
					200: GraphResponseSchema,
					400: GraphErrorResponseSchema,
					503: GraphErrorResponseSchema
				}
			}
		},
		async (request, reply) => {
			const { type, userId, toolName, limit } = request.query as z.infer<typeof GraphQuerySchema>;
			try {
				switch (type) {
					case 'user-activity': {
						if (!userId) return reply.status(400).send({ error: 'userId parameter required' });
						const result = await getUserActivity(userId, limit);
						return reply.send({ type, ...result });
					}
					case 'tool-affinity': {
						const result = await getToolAffinity(limit);
						return reply.send({ type, ...result });
					}
					case 'org-impact': {
						if (!toolName) return reply.status(400).send({ error: 'toolName parameter required' });
						const result = await getOrgImpact(toolName, limit);
						return reply.send({ type, ...result });
					}
				}
			} catch (err) {
				log.error({ err, type, requestId: request.headers['x-request-id'] }, 'Graph query failed');
				return reply.status(503).send({ error: 'Graph query failed' });
			}
		}
	);
}
