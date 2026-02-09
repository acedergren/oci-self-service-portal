import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	sessionRepository,
	listSessionsEnriched,
	deleteSession
} from '@portal/shared/server/oracle/repositories/session-repository';
import { createLogger } from '@portal/shared/server/logger';
import { DatabaseError, errorResponse } from '@portal/shared/server/errors';
import { requireAuth } from '../plugins/rbac.js';

const log = createLogger('api-sessions');

// Zod schemas for request validation
const ListSessionsQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
	search: z.string().optional()
});

const CreateSessionBodySchema = z.object({
	model: z.string().default('default'),
	region: z.string().default('eu-frankfurt-1'),
	title: z.string().optional()
});

/**
 * Session management routes.
 *
 * - GET    /api/sessions        — list sessions (enriched with message count)
 * - POST   /api/sessions        — create a new session
 * - DELETE  /api/sessions/:id    — delete a session (user-scoped)
 */
export async function sessionRoutes(app: FastifyInstance): Promise<void> {
	// GET /api/sessions — list enriched sessions
	app.get(
		'/api/sessions',
		{
			preHandler: requireAuth('sessions:read'),
			schema: {
				querystring: ListSessionsQuerySchema
			}
		},
		async (request, reply) => {
			if (!request.dbAvailable) {
				return reply.send({ sessions: [], total: 0, message: 'Database not available' });
			}

			const { limit, offset, search } = request.query as z.infer<typeof ListSessionsQuerySchema>;
			const userId = request.user?.id;

			try {
				const { sessions, total } = await listSessionsEnriched({
					userId,
					limit,
					offset,
					search
				});

				return reply.send({
					sessions: sessions.map((s) => ({
						id: s.id,
						title: s.title,
						model: s.model,
						region: s.region,
						status: s.status,
						messageCount: s.messageCount,
						lastMessage: s.lastMessage,
						createdAt: s.createdAt.toISOString(),
						updatedAt: s.updatedAt.toISOString()
					})),
					total
				});
			} catch (err) {
				const dbErr = new DatabaseError(
					'Failed to retrieve sessions',
					{ operation: 'listSessionsEnriched' },
					err instanceof Error ? err : undefined
				);
				log.error({ err: dbErr }, 'Failed to list sessions');
				const resp = errorResponse(dbErr);
				return reply.status(resp.status).send(resp);
			}
		}
	);

	// POST /api/sessions — create session
	app.post(
		'/api/sessions',
		{
			preHandler: requireAuth('sessions:write'),
			schema: {
				body: CreateSessionBodySchema
			}
		},
		async (request, reply) => {
			if (!request.dbAvailable) {
				const dbErr = new DatabaseError('Database not available', { operation: 'createSession' });
				const resp = errorResponse(dbErr);
				return reply.status(resp.status).send(resp);
			}

			const body = request.body as z.infer<typeof CreateSessionBodySchema>;

			try {
				const session = await sessionRepository.create({
					model: body.model,
					region: body.region,
					title: body.title,
					userId: request.user?.id
				});

				return reply.status(201).send({ session });
			} catch (err) {
				const dbErr = new DatabaseError(
					'Failed to create session',
					{ operation: 'createSession' },
					err instanceof Error ? err : undefined
				);
				log.error({ err: dbErr }, 'Failed to create session');
				const resp = errorResponse(dbErr);
				return reply.status(resp.status).send(resp);
			}
		}
	);

	// DELETE /api/sessions/:id — delete session (user-scoped)
	app.delete(
		'/api/sessions/:id',
		{
			preHandler: requireAuth('sessions:write'),
			schema: {
				params: z.object({
					id: z.string().uuid()
				})
			}
		},
		async (request, reply) => {
			if (!request.dbAvailable) {
				return reply.status(503).send({ error: 'Database not available' });
			}

			const userId = request.user?.id;
			if (!userId) {
				return reply.status(401).send({ error: 'Authentication required' });
			}

			const { id } = request.params as { id: string };

			try {
				const deleted = await deleteSession(id, userId);
				if (!deleted) {
					return reply.status(404).send({ error: 'Session not found or not owned by you' });
				}
				return reply.send({ success: true });
			} catch (err) {
				log.error({ err, sessionId: id }, 'Failed to delete session');
				return reply.status(500).send({ error: 'Failed to delete session' });
			}
		}
	);
}
