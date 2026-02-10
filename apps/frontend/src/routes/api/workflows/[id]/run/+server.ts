import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	workflowRepository,
	workflowRunRepository
} from '@portal/shared/server/workflows/repository';
import { WorkflowExecutor } from '@portal/shared/server/workflows/executor';
import { requirePermission } from '@portal/server/auth/rbac';
import { createLogger } from '@portal/server/logger';
import {
	ValidationError,
	NotFoundError,
	DatabaseError,
	errorResponse,
	toPortalError
} from '@portal/server/errors';
import { addDeprecationHeaders } from '$lib/server/deprecation.js';

const log = createLogger('workflow-run-api');

export const POST: RequestHandler = async (event) => {
	requirePermission(event, 'workflows:execute');

	const { params, request, locals } = event;
	if (!locals.dbAvailable) {
		return errorResponse(
			new DatabaseError('Database not available', { operation: 'runWorkflow' }),
			locals.requestId
		);
	}

	// Get the workflow definition
	let definition;
	try {
		definition = await workflowRepository.getById(params.id);
	} catch (err) {
		const dbErr = new DatabaseError(
			'Failed to load workflow',
			{ operation: 'getWorkflow', workflowId: params.id },
			err instanceof Error ? err : undefined
		);
		log.error({ err: dbErr }, 'Failed to load workflow for execution');
		return errorResponse(dbErr, locals.requestId);
	}

	if (!definition) {
		return errorResponse(
			new NotFoundError('Workflow not found', { workflowId: params.id }),
			locals.requestId
		);
	}

	if (definition.status !== 'published' && definition.status !== 'draft') {
		return errorResponse(
			new ValidationError('Only published or draft workflows can be executed', {
				workflowId: params.id,
				status: definition.status
			}),
			locals.requestId
		);
	}

	// Parse input
	let input: Record<string, unknown> = {};
	try {
		const body = await request.json();
		if (body && typeof body === 'object' && 'input' in body) {
			input = body.input as Record<string, unknown>;
		}
	} catch {
		// No input body is fine
	}

	// Create the run record
	let run;
	try {
		run = await workflowRunRepository.create({
			definitionId: definition.id,
			workflowVersion: definition.version,
			userId: locals.user?.id,
			input
		});
	} catch (err) {
		const dbErr = new DatabaseError(
			'Failed to create workflow run',
			{ operation: 'createRun', workflowId: params.id },
			err instanceof Error ? err : undefined
		);
		log.error({ err: dbErr }, 'Failed to create workflow run');
		return errorResponse(dbErr, locals.requestId);
	}

	// Execute the workflow
	const executor = new WorkflowExecutor();
	try {
		await workflowRunRepository.updateStatus(run.id, { status: 'running' });

		const result = await executor.execute(definition, input);

		// Update the run with the result
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

		log.info(
			{ runId: run.id, workflowId: params.id, status: result.status },
			'Workflow execution finished'
		);

		const headers = new Headers();
		addDeprecationHeaders(headers, `/api/v1/workflows/${params.id}/run`);

		return json(
			{
				run: {
					id: run.id,
					workflowId: definition.id,
					status: result.status,
					output: result.output,
					error: result.error,
					engineState: result.engineState
						? { suspendedAtNodeId: result.engineState.suspendedAtNodeId }
						: undefined
				}
			},
			{ status: 201, headers }
		);
	} catch (err) {
		const portalErr = toPortalError(err, 'Workflow execution failed');
		log.error({ err: portalErr, runId: run.id }, 'Workflow execution failed');

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
