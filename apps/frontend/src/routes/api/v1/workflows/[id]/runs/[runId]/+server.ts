/**
 * GET /api/v1/workflows/:id/runs/:runId — Get workflow run status and steps.
 *
 * Auth: API key with 'workflows:read' OR session with workflows:read permission.
 * IDOR prevention: filters by userId + orgId.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	workflowRunRepository,
	workflowRunStepRepository
} from '@portal/shared/server/workflows/repository';
import { requireApiAuth, resolveOrgId } from '@portal/shared/server/api/require-auth';
import { createLogger } from '@portal/server/logger';
import { NotFoundError, DatabaseError, errorResponse } from '@portal/server/errors';

const log = createLogger('v1-workflow-run-status');

export const GET: RequestHandler = async (event) => {
	requireApiAuth(event, 'workflows:read');

	const { params, locals } = event;
	if (!locals.dbAvailable) {
		return errorResponse(
			new DatabaseError('Database not available', { operation: 'getRunStatus' }),
			locals.requestId
		);
	}

	const orgId = resolveOrgId(event);

	try {
		const userId = locals.user?.id;
		const run = userId
			? await workflowRunRepository.getByIdForUser(params.runId, userId, orgId)
			: await workflowRunRepository.getByIdForOrg(params.runId, orgId!);

		if (!run) {
			return errorResponse(
				new NotFoundError('Workflow run not found', {
					workflowId: params.id,
					runId: params.runId
				}),
				locals.requestId
			);
		}

		// Verify the run belongs to this workflow (defense in depth)
		if (run.definitionId !== params.id) {
			return errorResponse(
				new NotFoundError('Workflow run not found for this workflow', {
					workflowId: params.id,
					runId: params.runId
				}),
				locals.requestId
			);
		}

		// Load steps for the run
		const steps = await workflowRunStepRepository.listByRun(params.runId);

		return json({
			id: run.id,
			workflowId: run.definitionId,
			status: run.status,
			input: run.input,
			output: run.output,
			error: run.error,
			startedAt: run.startedAt?.toISOString() ?? null,
			completedAt: run.completedAt?.toISOString() ?? null,
			steps: steps.map((s) => ({
				nodeId: s.nodeId,
				nodeType: s.nodeType,
				status: s.status,
				output: s.output,
				error: s.error,
				startedAt: s.startedAt?.toISOString() ?? null,
				completedAt: s.completedAt?.toISOString() ?? null,
				durationMs: s.durationMs
			}))
		});
	} catch (err) {
		const dbErr = new DatabaseError(
			'Failed to get run status',
			{ operation: 'getRunStatus', runId: params.runId },
			err instanceof Error ? err : undefined
		);
		log.error({ err: dbErr }, 'Failed to get run status');
		return errorResponse(dbErr, locals.requestId);
	}
};
