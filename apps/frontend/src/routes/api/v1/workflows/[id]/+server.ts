/**
 * GET /api/v1/workflows/:id — Get workflow details.
 *
 * Auth: API key with 'workflows:read' OR session with workflows:read permission.
 * IDOR prevention: filters by userId + orgId.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { workflowRepository } from '$lib/server/workflows/repository.js';
import { requireApiAuth, resolveOrgId } from '$lib/server/api/require-auth.js';
import { createLogger } from '$lib/server/logger.js';
import { NotFoundError, DatabaseError, errorResponse } from '$lib/server/errors.js';

const log = createLogger('v1-workflow-detail');

export const GET: RequestHandler = async (event) => {
	requireApiAuth(event, 'workflows:read');

	const { params, locals } = event;
	if (!locals.dbAvailable) {
		return errorResponse(
			new DatabaseError('Database not available', { operation: 'getWorkflow' }),
			locals.requestId
		);
	}

	const orgId = resolveOrgId(event);

	try {
		const userId = locals.user?.id;
		const workflow = userId
			? await workflowRepository.getByIdForUser(params.id, userId, orgId)
			: await workflowRepository.getByIdForOrg(params.id, orgId!);

		if (!workflow) {
			return errorResponse(
				new NotFoundError('Workflow not found', { workflowId: params.id }),
				locals.requestId
			);
		}

		return json({ workflow });
	} catch (err) {
		const dbErr = new DatabaseError(
			'Failed to get workflow',
			{ operation: 'getWorkflow', workflowId: params.id },
			err instanceof Error ? err : undefined
		);
		log.error({ err: dbErr }, 'Failed to get workflow');
		return errorResponse(dbErr, locals.requestId);
	}
};
