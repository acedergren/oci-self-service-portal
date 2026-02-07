import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withConnection } from '@portal/shared/server/oracle/connection';
import { createLogger } from '@portal/shared/server/logger';
import { requireAuth } from '../plugins/rbac.js';

const log = createLogger('api-activity');

/** Oracle row shape for tool_executions. */
interface ActivityRow {
	ID: string;
	TOOL_CATEGORY: string;
	TOOL_NAME: string;
	ACTION: string;
	SUCCESS: number | null;
	CREATED_AT: Date;
}

interface ActivityItem {
	id: string;
	type: string;
	action: string;
	time: string;
	status: 'completed' | 'pending' | 'failed';
}

function rowToActivityItem(row: ActivityRow): ActivityItem {
	const success = row.SUCCESS === null ? true : row.SUCCESS === 1;
	const action = row.ACTION;

	let status: ActivityItem['status'];
	if (action === 'requested' || action === 'approved') {
		status = 'pending';
	} else if (success && (action === 'executed' || action === 'completed')) {
		status = 'completed';
	} else {
		status = 'failed';
	}

	return {
		id: row.ID,
		type: row.TOOL_CATEGORY,
		action: `${row.TOOL_NAME} (${row.ACTION})`,
		time: row.CREATED_AT.toISOString(),
		status
	};
}

const ListActivityQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0)
});

/**
 * Activity feed routes.
 *
 * - GET /api/activity — list recent tool executions for the current user
 */
export async function activityRoutes(app: FastifyInstance): Promise<void> {
	app.get(
		'/api/activity',
		{
			preHandler: requireAuth('tools:read'),
			schema: {
				querystring: ListActivityQuerySchema
			}
		},
		async (request, reply) => {
			if (!request.dbAvailable) {
				return reply.send({ items: [], total: 0, message: 'Database not available' });
			}

			const { limit, offset } = request.query as z.infer<typeof ListActivityQuerySchema>;
			const userId = request.user?.id;

			if (!userId) {
				return reply.send({ items: [], total: 0 });
			}

			try {
				const { items, total } = await withConnection(async (conn) => {
					const countResult = await conn.execute<{ CNT: number }>(
						'SELECT COUNT(*) AS "CNT" FROM tool_executions WHERE user_id = :userId',
						{ userId }
					);
					const total = countResult.rows?.[0]?.CNT ?? 0;

					const result = await conn.execute<ActivityRow>(
						`SELECT id AS "ID",
						        tool_category AS "TOOL_CATEGORY",
						        tool_name AS "TOOL_NAME",
						        action AS "ACTION",
						        success AS "SUCCESS",
						        created_at AS "CREATED_AT"
						   FROM tool_executions
						  WHERE user_id = :userId
						  ORDER BY created_at DESC
						  OFFSET :offset ROWS FETCH NEXT :maxRows ROWS ONLY`,
						{ userId, offset, maxRows: limit }
					);

					const items = (result.rows ?? []).map(rowToActivityItem);
					return { items, total };
				});

				return reply.send({ items, total });
			} catch (err) {
				log.error({ err }, 'Failed to fetch activity');
				return reply.status(500).send({ items: [], total: 0, error: 'Failed to retrieve activity' });
			}
		}
	);
}
