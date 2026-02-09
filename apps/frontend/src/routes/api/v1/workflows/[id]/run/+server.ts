/**
 * POST /api/v1/workflows/:id/run — Trigger workflow execution.
 *
 * Auth: API key with 'workflows:execute' OR session with workflows:execute permission.
 * Reuses existing WorkflowExecutor and workflowRepository.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	workflowRepository,
	workflowRunRepository
} from '@portal/shared/server/workflows/repository';
import { WorkflowExecutor } from '@portal/shared/server/workflows/executor';
import { requireApiAuth, resolveOrgId } from '@portal/shared/server/api/require-auth';
import { createLogger } from '@portal/shared/server/logger';
import {
	ValidationError,
	NotFoundError,
	DatabaseError,
	errorResponse,
	toPortalError
} from '@portal/shared/server/errors';

const log = createLogger('v1-workflow-run');

export const POST: RequestHandler = async (event) => {
	requireApiAuth(event, 'workflows:execute');

	const { params, request, locals } = event;
	if (!locals.dbAvailable) {
		return errorResponse(
			new DatabaseError('Database not available', { operation: 'runWorkflow' }),
			locals.requestId
		);
	}

	const orgId = resolveOrgId(event);

	// Load the workflow definition with IDOR check
	let definition;
	try {
		const userId = locals.user?.id;
		definition = userId
			? await workflowRepository.getByIdForUser(params.id, userId, orgId)
			: await workflowRepository.getByIdForOrg(params.id, orgId!);
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
			orgId,
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

		return json(
			{
				id: run.id,
				workflowId: definition.id,
				status: result.status,
				output: result.output,
				error: result.error
			},
			{ status: 201 }
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
