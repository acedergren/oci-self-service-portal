/**
 * GET /api/v1/workflows — List workflows for the authenticated org.
 *
 * Auth: API key with 'workflows:read' OR session with workflows:read permission.
 * Query params: limit, offset, status, search
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { workflowRepository } from '@portal/shared/server/workflows/repository';
import { requireApiAuth, resolveOrgId } from '@portal/shared/server/api/require-auth';
import { createLogger } from '@portal/shared/server/logger';
import { DatabaseError, errorResponse } from '@portal/shared/server/errors';

const log = createLogger('v1-workflows');

export const GET: RequestHandler = async (event) => {
	requireApiAuth(event, 'workflows:read');

	const { locals, url } = event;
	if (!locals.dbAvailable) {
		return json({ workflows: [], total: 0, message: 'Database not available' });
	}

	const limit = Math.min(
		Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1),
		100
	);
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);
	const search = url.searchParams.get('search') || undefined;
	const status = url.searchParams.get('status') || undefined;

	const orgId = resolveOrgId(event);

	try {
		const workflows = await workflowRepository.list({
			orgId,
			userId: locals.user?.id,
			limit,
			offset,
			search,
			status: status as 'draft' | 'published' | 'archived' | undefined
		});

		return json({
			workflows: workflows.map((w) => ({
				id: w.id,
				name: w.name,
				description: w.description,
				status: w.status,
				version: w.version,
				tags: w.tags,
				nodeCount: w.nodes.length,
				edgeCount: w.edges.length,
				createdAt: w.createdAt.toISOString(),
				updatedAt: w.updatedAt.toISOString()
			})),
			total: workflows.length
		});
	} catch (err) {
		const dbErr = new DatabaseError(
			'Failed to list workflows',
			{ operation: 'listWorkflows' },
			err instanceof Error ? err : undefined
		);
		log.error({ err: dbErr }, 'Failed to list workflows');
		return errorResponse(dbErr, locals.requestId);
	}
};
