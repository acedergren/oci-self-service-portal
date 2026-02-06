import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withConnection } from '$lib/server/oracle/connection.js';
import { createLogger } from '$lib/server/logger.js';
import { requirePermission } from '$lib/server/auth/rbac.js';
import type { ActivityItem } from '$lib/components/portal/types.js';

const log = createLogger('activity-api');

/** Oracle row shape for tool_executions (OUT_FORMAT_OBJECT, uppercase keys). */
interface ActivityRow {
	ID: string;
	TOOL_CATEGORY: string;
	TOOL_NAME: string;
	ACTION: string;
	SUCCESS: number | null;
	CREATED_AT: Date;
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
		status,
	};
}

export const GET: RequestHandler = async (event) => {
	requirePermission(event, 'tools:read');

	const { locals, url } = event;

	if (!locals.dbAvailable) {
		return json({ items: [], total: 0, message: 'Database not available' });
	}

	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 100);
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);
	const userId = locals.user?.id;

	if (!userId) {
		return json({ items: [], total: 0 });
	}

	try {
		const { items, total } = await withConnection(async (conn) => {
			const countResult = await conn.execute<{ CNT: number }>(
				`SELECT COUNT(*) AS "CNT" FROM tool_executions WHERE user_id = :userId`,
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

		return json({ items, total });
	} catch (err) {
		log.error({ err }, 'Failed to fetch activity');
		return json({ items: [], total: 0, error: 'Failed to retrieve activity' }, { status: 500 });
	}
};
