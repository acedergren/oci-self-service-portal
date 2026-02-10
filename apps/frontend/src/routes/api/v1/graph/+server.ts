/**
 * GET /api/v1/graph/insights — Property graph analytics queries.
 *
 * Requires admin:audit permission. Supports three query types:
 * - user-activity: User's tool execution graph (requires userId param)
 * - tool-affinity: Tool co-occurrence within sessions
 * - org-impact: Which orgs use a specific tool (requires toolName param)
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireApiAuth } from '@portal/shared/server/api/require-auth';
import {
	getUserActivity,
	getToolAffinity,
	getOrgImpact
} from '@portal/server/oracle/graph-analytics';
import { createLogger } from '@portal/server/logger';

const log = createLogger('api:graph');

export const GET: RequestHandler = async (event) => {
	requireApiAuth(event, 'admin:audit');

	const type = event.url.searchParams.get('type');
	const limit = Math.min(parseInt(event.url.searchParams.get('limit') ?? '50', 10) || 50, 200);

	try {
		switch (type) {
			case 'user-activity': {
				const userId = event.url.searchParams.get('userId');
				if (!userId) {
					return json({ error: 'userId parameter required' }, { status: 400 });
				}
				const result = await getUserActivity(userId, limit);
				return json({ type, ...result });
			}

			case 'tool-affinity': {
				const result = await getToolAffinity(limit);
				return json({ type, ...result });
			}

			case 'org-impact': {
				const toolName = event.url.searchParams.get('toolName');
				if (!toolName) {
					return json({ error: 'toolName parameter required' }, { status: 400 });
				}
				const result = await getOrgImpact(toolName, limit);
				return json({ type, ...result });
			}

			default:
				return json(
					{ error: 'Invalid type. Must be: user-activity, tool-affinity, or org-impact' },
					{ status: 400 }
				);
		}
	} catch (err) {
		log.error({ err, type, requestId: event.locals.requestId }, 'Graph query failed');
		return json({ error: 'Graph query failed' }, { status: 503 });
	}
};
