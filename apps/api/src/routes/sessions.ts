import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	sessionRepository,
	listSessionsEnriched,
	deleteSession
} from '@portal/server/oracle/repositories/session-repository';
import { createLogger } from '@portal/server/logger';
import { DatabaseError, NotFoundError, errorResponse } from '@portal/server/errors';
import { requireAuth } from '../plugins/rbac.js';

const log = createLogger('api-sessions');

const SESSION_COOKIE = 'oci_chat_session';

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
 * - GET    /api/sessions                — list sessions (enriched with message count, isCurrent flag)
 * - POST   /api/sessions                — create a new session
 * - DELETE /api/sessions/:id            — delete a session (user-scoped)
 * - POST   /api/sessions/:id/continue   — switch to a specific session (set session cookie)
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
			if (!userId) {
				return reply.status(401).send({ error: 'Authentication required' });
			}

			try {
				const { sessions, total } = await listSessionsEnriched({
					userId,
					limit,
					offset,
					search
				});

				// Get current session ID from cookie to mark isCurrent
				const currentSessionId = request.cookies[SESSION_COOKIE];

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
						updatedAt: s.updatedAt.toISOString(),
						isCurrent: s.id === currentSessionId
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

			const userId = request.user?.id;
			if (!userId) {
				return reply.status(401).send({ error: 'Authentication required' });
			}

			const body = request.body as z.infer<typeof CreateSessionBodySchema>;

			try {
				const session = await sessionRepository.create({
					model: body.model,
					region: body.region,
					title: body.title,
					userId
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

	// POST /api/sessions/:id/continue — switch to a specific session
	app.post(
		'/api/sessions/:id/continue',
		{
			preHandler: requireAuth('sessions:read'),
			schema: {
				params: z.object({
					id: z.string().uuid()
				})
			}
		},
		async (request, reply) => {
			if (!request.dbAvailable) {
				const dbErr = new DatabaseError('Database not available', {
					operation: 'switchToSession'
				});
				const resp = errorResponse(dbErr);
				return reply.status(resp.status).send(resp);
			}

			const userId = request.user?.id;
			if (!userId) {
				return reply.status(401).send({ error: 'Authentication required' });
			}

			const { id: sessionId } = request.params as { id: string };

			try {
				// Retrieve the session to verify it exists and belongs to the user
				const session = await sessionRepository.getById(sessionId);

				if (!session) {
					const notFoundErr = new NotFoundError('Session not found', { sessionId });
					const resp = errorResponse(notFoundErr);
					return reply.status(resp.status).send(resp);
				}

				// Verify session ownership (prevent IDOR)
				if (session.userId && session.userId !== userId) {
					log.warn({ sessionId, userId, ownerId: session.userId }, 'Session ownership mismatch');
					return reply.status(403).send({
						error: 'Forbidden',
						message: 'Session does not belong to you'
					});
				}

				// Reactivate the session if it was completed
				if (session.status === 'completed') {
					await sessionRepository.update(sessionId, { status: 'active' });
				}

				// Set the session cookie
				reply.cookie(SESSION_COOKIE, sessionId, {
					path: '/',
					httpOnly: true,
					secure: process.env.NODE_ENV === 'production',
					sameSite: 'lax',
					maxAge: 60 * 60 * 24 * 30 // 30 days
				});

				return reply.send({ success: true, sessionId });
			} catch (err) {
				const dbErr = new DatabaseError(
					'Failed to switch session',
					{ operation: 'switchToSession', sessionId },
					err instanceof Error ? err : undefined
				);
				log.error({ err: dbErr }, 'Failed to switch session');
				const resp = errorResponse(dbErr);
				return reply.status(resp.status).send(resp);
			}
		}
	);
}
