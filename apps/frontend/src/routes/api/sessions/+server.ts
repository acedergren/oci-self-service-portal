import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	sessionRepository,
	listSessionsEnriched
} from '@portal/shared/server/oracle/repositories/session-repository.js';
import { getCurrentSessionId } from '@portal/shared/server/session.js';
import { createLogger } from '@portal/shared/server/logger.js';
import { requirePermission } from '@portal/shared/server/auth/rbac.js';
import {
	ValidationError,
	DatabaseError,
	toPortalError,
	errorResponse
} from '@portal/shared/server/errors.js';

const log = createLogger('sessions-api');

export const GET: RequestHandler = async (event) => {
	requirePermission(event, 'sessions:read');

	const { cookies, locals, url } = event;
	if (!locals.dbAvailable) {
		return json({ sessions: [], total: 0, message: 'Database not available' });
	}

	const limit = Math.min(
		Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1),
		100
	);
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);
	const search = url.searchParams.get('search') || undefined;

	try {
		const { sessions, total } = await listSessionsEnriched({
			userId: locals.user?.id,
			limit,
			offset,
			search
		});

		const currentSessionId = getCurrentSessionId(cookies);

		return json({
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
		return errorResponse(dbErr, locals.requestId);
	}
};

export const POST: RequestHandler = async (event) => {
	requirePermission(event, 'sessions:write');

	const { request, locals } = event;
	if (!locals.dbAvailable) {
		return errorResponse(
			new DatabaseError('Database not available', { operation: 'createSession' }),
			locals.requestId
		);
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return errorResponse(new ValidationError('Invalid JSON in request body'), locals.requestId);
	}

	try {
		const session = await sessionRepository.create({
			model: (body.model as string) || 'default',
			region: (body.region as string) || 'eu-frankfurt-1',
			title: body.title as string | undefined,
			userId: locals.user?.id
		});

		return json({ session }, { status: 201 });
	} catch (err) {
		const dbErr = new DatabaseError(
			'Failed to create session',
			{ operation: 'createSession' },
			err instanceof Error ? err : undefined
		);
		log.error({ err: dbErr }, 'Failed to create session');
		return errorResponse(dbErr, locals.requestId);
	}
};
