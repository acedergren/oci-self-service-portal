import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	workflowRepository,
	workflowRunRepository
} from '@portal/shared/server/workflows/repository';
import { WorkflowExecutor } from '@portal/shared/server/workflows/executor';
import { requirePermission } from '@portal/shared/server/auth/rbac';
import { createLogger } from '@portal/shared/server/logger';
import {
	ValidationError,
	NotFoundError,
	DatabaseError,
	errorResponse,
	toPortalError
} from '@portal/shared/server/errors';
import type { EngineState } from '@portal/shared/server/workflows/executor';
import { addDeprecationHeaders } from '$lib/server/deprecation.js';

const log = createLogger('workflow-approve-api');

export const POST: RequestHandler = async (event) => {
	requirePermission(event, 'workflows:execute');

	const { params, locals } = event;
	if (!locals.dbAvailable) {
		return errorResponse(
			new DatabaseError('Database not available', { operation: 'approveWorkflowRun' }),
			locals.requestId
		);
	}

	// Get the run
	let run;
	try {
		run = await workflowRunRepository.getById(params.runId);
	} catch (err) {
		const dbErr = new DatabaseError(
			'Failed to load workflow run',
			{ operation: 'getWorkflowRun', runId: params.runId },
			err instanceof Error ? err : undefined
		);
		log.error({ err: dbErr }, 'Failed to load workflow run');
		return errorResponse(dbErr, locals.requestId);
	}

	if (!run) {
		return errorResponse(
			new NotFoundError('Workflow run not found', { runId: params.runId }),
			locals.requestId
		);
	}

	if (run.status !== 'suspended') {
		return errorResponse(
			new ValidationError('Run is not suspended — cannot approve', {
				runId: params.runId,
				currentStatus: run.status
			}),
			locals.requestId
		);
	}

	if (!run.engineState) {
		return errorResponse(
			new ValidationError('Run has no engine state — cannot resume', {
				runId: params.runId
			}),
			locals.requestId
		);
	}

	// Get the workflow definition
	let definition;
	try {
		definition = await workflowRepository.getById(run.definitionId);
	} catch (err) {
		const dbErr = new DatabaseError(
			'Failed to load workflow definition',
			{ operation: 'getWorkflow', workflowId: run.definitionId },
			err instanceof Error ? err : undefined
		);
		log.error({ err: dbErr }, 'Failed to load workflow for resume');
		return errorResponse(dbErr, locals.requestId);
	}

	if (!definition) {
		return errorResponse(
			new NotFoundError('Workflow definition not found', { workflowId: run.definitionId }),
			locals.requestId
		);
	}

	// Resume execution
	const executor = new WorkflowExecutor();
	try {
		await workflowRunRepository.updateStatus(run.id, { status: 'running' });

		const result = await executor.resume(
			definition,
			run.engineState as unknown as EngineState,
			run.input ?? {}
		);

		await workflowRunRepository.updateStatus(run.id, {
			status:
				result.status === 'completed'
					? 'completed'
					: result.status === 'suspended'
						? 'suspended'
						: 'failed',
			output: result.output,
			error: result.error ? { message: result.error } : undefined,
			engineState: result.engineState as Record<string, unknown> | undefined
		});

		log.info({ runId: run.id, status: result.status }, 'Workflow resumed after approval');

		const headers = new Headers();
		addDeprecationHeaders(headers, `/api/v1/workflows/${definition.id}/runs/${run.id}/approve`);

		return json(
			{
				run: {
					id: run.id,
					workflowId: definition.id,
					status: result.status,
					output: result.output,
					error: result.error
				}
			},
			{ headers }
		);
	} catch (err) {
		const portalErr = toPortalError(err, 'Workflow resume failed');
		log.error({ err: portalErr, runId: run.id }, 'Workflow resume failed');

		try {
			await workflowRunRepository.updateStatus(run.id, {
				status: 'failed',
				error: { message: portalErr.message, code: portalErr.code }
			});
		} catch (updateErr) {
			log.error({ err: updateErr }, 'Failed to update run status after error');
		}

		return errorResponse(portalErr, locals.requestId);
	}
};
