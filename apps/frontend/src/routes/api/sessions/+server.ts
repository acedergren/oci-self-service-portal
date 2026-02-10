import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import {
	sessionRepository,
	listSessionsEnriched
} from '@portal/server/oracle/repositories/session-repository';
import { getCurrentSessionId } from '@portal/shared/server/session';
import { createLogger } from '@portal/server/logger';
import { requirePermission } from '@portal/server/auth/rbac';
import {
	ValidationError,
	DatabaseError,
	toPortalError,
	errorResponse
} from '@portal/server/errors';

const log = createLogger('sessions-api');

const CreateSessionSchema = z.object({
	model: z.string().optional(),
	region: z.string().optional(),
	title: z.string().optional()
});

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

	// Validate request body with Zod
	const parseResult = CreateSessionSchema.safeParse(body);
	if (!parseResult.success) {
		return errorResponse(
			new ValidationError('Invalid request body', { zodError: parseResult.error }),
			locals.requestId
		);
	}

	const validatedBody = parseResult.data;

	try {
		const session = await sessionRepository.create({
			model: validatedBody.model || 'default',
			region: validatedBody.region || 'eu-frankfurt-1',
			title: validatedBody.title,
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
