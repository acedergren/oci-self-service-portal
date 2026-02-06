import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { workflowRepository } from '@portal/shared/server/workflows/repository.js';
import { requirePermission } from '@portal/shared/server/auth/rbac.js';
import { createLogger } from '@portal/shared/server/logger.js';
import {
	ValidationError,
	NotFoundError,
	DatabaseError,
	errorResponse
} from '@portal/shared/server/errors.js';
import {
	WorkflowNodeSchema,
	WorkflowEdgeSchema,
	WorkflowStatusSchema
} from '@portal/shared/workflows/types.js';
import { z } from 'zod';

const log = createLogger('workflow-detail-api');

const UpdateWorkflowBody = z
	.object({
		name: z.string().min(1).max(255).optional(),
		description: z.string().max(2000).optional(),
		status: WorkflowStatusSchema.optional(),
		nodes: z.array(WorkflowNodeSchema).optional(),
		edges: z.array(WorkflowEdgeSchema).optional(),
		tags: z.array(z.string()).optional(),
		inputSchema: z.record(z.string(), z.unknown()).optional()
	})
	.refine((data) => Object.keys(data).length > 0, {
		message: 'At least one field must be provided for update'
	});

export const GET: RequestHandler = async (event) => {
	requirePermission(event, 'workflows:read');

	const { params, locals } = event;
	if (!locals.dbAvailable) {
		return errorResponse(
			new DatabaseError('Database not available', { operation: 'getWorkflow' }),
			locals.requestId
		);
	}

	try {
		const userId = locals.user?.id;
		const workflow = userId
			? await workflowRepository.getByIdForUser(params.id, userId)
			: await workflowRepository.getById(params.id);
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

export const PUT: RequestHandler = async (event) => {
	requirePermission(event, 'workflows:write');

	const { params, request, locals } = event;
	if (!locals.dbAvailable) {
		return errorResponse(
			new DatabaseError('Database not available', { operation: 'updateWorkflow' }),
			locals.requestId
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return errorResponse(new ValidationError('Invalid JSON in request body'), locals.requestId);
	}

	const parsed = UpdateWorkflowBody.safeParse(body);
	if (!parsed.success) {
		return errorResponse(
			new ValidationError('Invalid update data', {
				errors: parsed.error.issues.map((i) => i.message)
			}),
			locals.requestId
		);
	}

	try {
		const userId = locals.user?.id;
		const workflow = userId
			? await workflowRepository.updateForUser(params.id, parsed.data, userId)
			: await workflowRepository.update(params.id, parsed.data);
		if (!workflow) {
			return errorResponse(
				new NotFoundError('Workflow not found or not owned by you', { workflowId: params.id }),
				locals.requestId
			);
		}

		log.info({ workflowId: params.id }, 'Workflow updated');
		return json({ workflow });
	} catch (err) {
		const dbErr = new DatabaseError(
			'Failed to update workflow',
			{ operation: 'updateWorkflow', workflowId: params.id },
			err instanceof Error ? err : undefined
		);
		log.error({ err: dbErr }, 'Failed to update workflow');
		return errorResponse(dbErr, locals.requestId);
	}
};

export const DELETE: RequestHandler = async (event) => {
	requirePermission(event, 'workflows:write');

	const { params, locals } = event;
	if (!locals.dbAvailable) {
		return errorResponse(
			new DatabaseError('Database not available', { operation: 'deleteWorkflow' }),
			locals.requestId
		);
	}

	try {
		const deleted = await workflowRepository.delete(params.id, locals.user?.id);
		if (!deleted) {
			return errorResponse(
				new NotFoundError('Workflow not found or not owned by you', { workflowId: params.id }),
				locals.requestId
			);
		}

		log.info({ workflowId: params.id }, 'Workflow deleted');
		return json({ success: true });
	} catch (err) {
		const dbErr = new DatabaseError(
			'Failed to delete workflow',
			{ operation: 'deleteWorkflow', workflowId: params.id },
			err instanceof Error ? err : undefined
		);
		log.error({ err: dbErr }, 'Failed to delete workflow');
		return errorResponse(dbErr, locals.requestId);
	}
};
