import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	workflowRunRepository,
	workflowRunStepRepository
} from '@portal/shared/server/workflows/repository';
import { requirePermission } from '@portal/server/auth/rbac';
import { createLogger } from '@portal/server/logger';
import { NotFoundError, DatabaseError, errorResponse } from '@portal/server/errors';

const log = createLogger('workflow-run-detail-api');

export const GET: RequestHandler = async (event) => {
	requirePermission(event, 'workflows:read');

	const { params, locals } = event;
	if (!locals.dbAvailable) {
		return errorResponse(
			new DatabaseError('Database not available', { operation: 'getWorkflowRun' }),
			locals.requestId
		);
	}

	try {
		const run = await workflowRunRepository.getById(params.runId);
		if (!run) {
			return errorResponse(
				new NotFoundError('Workflow run not found', { runId: params.runId }),
				locals.requestId
			);
		}

		const steps = await workflowRunStepRepository.listByRun(params.runId);

		return json({
			run,
			steps: steps.map((s) => ({
				id: s.id,
				nodeId: s.nodeId,
				nodeType: s.nodeType,
				stepNumber: s.stepNumber,
				status: s.status,
				input: s.input,
				output: s.output,
				error: s.error,
				durationMs: s.durationMs,
				startedAt: s.startedAt,
				completedAt: s.completedAt
			}))
		});
	} catch (err) {
		const dbErr = new DatabaseError(
			'Failed to get workflow run',
			{ operation: 'getWorkflowRun', runId: params.runId },
			err instanceof Error ? err : undefined
		);
		log.error({ err: dbErr }, 'Failed to get workflow run');
		return errorResponse(dbErr, locals.requestId);
	}
};
