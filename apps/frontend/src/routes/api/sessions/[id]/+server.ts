import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSession } from '$lib/server/oracle/repositories/session-repository.js';
import { createLogger } from '$lib/server/logger.js';
import { requirePermission } from '$lib/server/auth/rbac.js';

const log = createLogger('sessions-api');

export const DELETE: RequestHandler = async (event) => {
	requirePermission(event, 'sessions:write');

	const { locals, params } = event;

	if (!locals.dbAvailable) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	const userId = locals.user?.id;
	if (!userId) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const sessionId = params.id;
	if (!sessionId) {
		return json({ error: 'Session ID required' }, { status: 400 });
	}

	try {
		const deleted = await deleteSession(sessionId, userId);

		if (!deleted) {
			return json({ error: 'Session not found or not owned by you' }, { status: 404 });
		}

		return json({ success: true });
	} catch (err) {
		log.error({ err, sessionId }, 'Failed to delete session');
		return json({ error: 'Failed to delete session' }, { status: 500 });
	}
};
