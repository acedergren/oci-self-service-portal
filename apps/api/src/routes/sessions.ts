import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  SessionsQuerySchema,
  CreateSessionSchema,
  SessionParamsSchema,
  type SessionListResponse,
  type SessionResponse,
} from "./schemas.js";
import { DatabaseError, NotFoundError } from "@portal/shared";

/**
 * Helper to escape LIKE patterns for safe SQL LIKE queries.
 * Escapes: %, _, \
 */
function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Oracle row shape for enriched sessions (JOIN with chat_turns). */
interface EnrichedSessionRow {
  ID: string;
  USER_ID: string | null;
  ORG_ID: string | null;
  TITLE: string | null;
  MODEL: string;
  REGION: string;
  STATUS: string;
  CREATED_AT: Date;
  UPDATED_AT: Date;
  MESSAGE_COUNT: number;
  LAST_MESSAGE: string | null;
}

/**
 * Sessions route module.
 *
 * Registers:
 * - GET    /api/sessions     — list sessions (paginated, searchable)
 * - POST   /api/sessions     — create a new session
 * - DELETE /api/sessions/:id — delete a session by ID (owner-scoped)
 *
 * All routes require authentication + `sessions:read` or `sessions:write` permission.
 * Ported from SvelteKit: apps/frontend/src/routes/api/sessions/+server.ts
 */
const sessionRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /api/sessions — list sessions for the authenticated user
  app.get(
    "/api/sessions",
    {
      schema: { querystring: SessionsQuerySchema },
      preHandler: fastify.requirePermission("sessions:read"),
    },
    async (request): Promise<SessionListResponse> => {
      const { limit, offset, search } = request.query;
      const userId = request.user!.userId;

      try {
        // Count total matching sessions
        const conditions: string[] = ["s.user_id = :userId"];
        const binds: Record<string, unknown> = { userId };

        if (search) {
          conditions.push("LOWER(s.title) LIKE LOWER(:search) ESCAPE '\\'");
          binds.search = `%${escapeLikePattern(search)}%`;
        }

        const where = `WHERE ${conditions.join(" AND ")}`;

        const countResult = await fastify.withConnection(async (conn) => {
          return await conn.execute<{ CNT: number }>(
            `SELECT COUNT(*) AS "CNT" FROM chat_sessions s ${where}`,
            binds,
          );
        });

        const total = countResult.rows?.[0]?.CNT ?? 0;

        // Fetch enriched sessions with message count and last message
        const result = await fastify.withConnection(async (conn) => {
          return await conn.execute<EnrichedSessionRow>(
            `SELECT s.*,
                    NVL(t.msg_count, 0) AS "MESSAGE_COUNT",
                    t.last_msg AS "LAST_MESSAGE"
               FROM chat_sessions s
               LEFT JOIN (
                 SELECT session_id,
                        COUNT(*) AS msg_count,
                        MAX(user_message) KEEP (DENSE_RANK LAST ORDER BY turn_number) AS last_msg
                   FROM chat_turns
                  GROUP BY session_id
               ) t ON t.session_id = s.id
               ${where}
               ORDER BY s.updated_at DESC
               OFFSET :offset ROWS FETCH NEXT :maxRows ROWS ONLY`,
            { ...binds, offset, maxRows: limit },
          );
        });

        const sessions: SessionResponse[] = (result.rows ?? []).map((row) => ({
          id: row.ID,
          title: row.TITLE ?? null,
          model: row.MODEL,
          region: row.REGION,
          status: row.STATUS,
          messageCount: row.MESSAGE_COUNT,
          lastMessage: row.LAST_MESSAGE,
          createdAt: row.CREATED_AT.toISOString(),
          updatedAt: row.UPDATED_AT.toISOString(),
        }));

        return { sessions, total };
      } catch (err) {
        fastify.log.error({ err, userId }, "Failed to list sessions");
        throw new DatabaseError("Failed to list sessions", {
          operation: "listSessionsEnriched",
        });
      }
    },
  );

  // POST /api/sessions — create a new session
  app.post(
    "/api/sessions",
    {
      schema: { body: CreateSessionSchema },
      preHandler: fastify.requirePermission("sessions:write"),
    },
    async (request, reply): Promise<SessionResponse> => {
      const { title, model, region } = request.body;
      const userId = request.user!.userId;
      const orgId = request.user!.orgId;

      try {
        const id = crypto.randomUUID();

        await fastify.withConnection(async (conn) => {
          await conn.execute(
            `INSERT INTO chat_sessions (id, user_id, org_id, title, model, region, status)
             VALUES (:id, :userId, :orgId, :title, :model, :region, 'active')`,
            {
              id,
              userId,
              orgId: orgId ?? null,
              title: title ?? null,
              model: model ?? "default",
              region: region ?? "eu-frankfurt-1",
            },
          );
        });

        // Fetch the created session
        const result = await fastify.withConnection(async (conn) => {
          return await conn.execute<EnrichedSessionRow>(
            `SELECT s.*,
                    0 AS "MESSAGE_COUNT",
                    NULL AS "LAST_MESSAGE"
               FROM chat_sessions s
              WHERE s.id = :id`,
            { id },
          );
        });

        const row = result.rows?.[0];
        if (!row) {
          throw new DatabaseError("Failed to retrieve created session");
        }

        reply.code(201);
        return {
          id: row.ID,
          title: row.TITLE ?? null,
          model: row.MODEL,
          region: row.REGION,
          status: row.STATUS,
          messageCount: 0,
          lastMessage: null,
          createdAt: row.CREATED_AT.toISOString(),
          updatedAt: row.UPDATED_AT.toISOString(),
        };
      } catch (err) {
        fastify.log.error({ err, userId }, "Failed to create session");
        throw new DatabaseError("Failed to create session", {
          operation: "createSession",
        });
      }
    },
  );

  // DELETE /api/sessions/:id — delete a session owned by the user
  app.delete(
    "/api/sessions/:id",
    {
      schema: { params: SessionParamsSchema },
      preHandler: fastify.requirePermission("sessions:write"),
    },
    async (request, reply): Promise<{ success: true }> => {
      const { id } = request.params;
      const userId = request.user!.userId;

      try {
        const result = await fastify.withConnection(async (conn) => {
          return await conn.execute(
            `DELETE FROM chat_sessions WHERE id = :id AND user_id = :userId`,
            { id, userId },
          );
        });

        const rowsAffected = (result as { rowsAffected?: number }).rowsAffected;

        if (rowsAffected === 0) {
          throw new NotFoundError("Session not found or not owned by you");
        }

        reply.code(204);
        return { success: true };
      } catch (err) {
        if (err instanceof NotFoundError) {
          throw err;
        }
        fastify.log.error(
          { err, sessionId: id, userId },
          "Failed to delete session",
        );
        throw new DatabaseError("Failed to delete session", {
          operation: "deleteSession",
        });
      }
    },
  );
};

export default sessionRoutes;
