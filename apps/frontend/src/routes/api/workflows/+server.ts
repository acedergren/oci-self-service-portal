import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { workflowRepository } from '@portal/shared/server/workflows/repository';
import { requirePermission } from '@portal/shared/server/auth/rbac';
import { createLogger } from '@portal/shared/server/logger';
import { ValidationError, DatabaseError, errorResponse } from '@portal/shared/server/errors';
import { WorkflowNodeSchema, WorkflowEdgeSchema } from '@portal/shared/workflows/types';
import { z } from 'zod';
import { addDeprecationHeaders } from '$lib/server/deprecation.js';

const log = createLogger('workflows-api');

const CreateWorkflowBody = z.object({
	name: z.string().min(1).max(255),
	description: z.string().max(2000).optional(),
	nodes: z.array(WorkflowNodeSchema),
	edges: z.array(WorkflowEdgeSchema),
	tags: z.array(z.string()).optional(),
	inputSchema: z.record(z.string(), z.unknown()).optional()
});

export const GET: RequestHandler = async (event) => {
	requirePermission(event, 'workflows:read');

	const { locals, url } = event;
	if (!locals.dbAvailable) {
		return json({ workflows: [], message: 'Database not available' });
	}

	const limit = Math.min(
		Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1),
		100
	);
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);
	const search = url.searchParams.get('search') || undefined;
	const status = url.searchParams.get('status') || undefined;

	try {
		const workflows = await workflowRepository.list({
			userId: locals.user?.id,
			limit,
			offset,
			search,
			status: status as 'draft' | 'published' | 'archived' | undefined
		});

		const headers = new Headers();
		addDeprecationHeaders(headers, '/api/v1/workflows');

		return json(
			{
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
				}))
			},
			{ headers }
		);
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

export const POST: RequestHandler = async (event) => {
	requirePermission(event, 'workflows:write');

	const { request, locals } = event;
	if (!locals.dbAvailable) {
		return errorResponse(
			new DatabaseError('Database not available', { operation: 'createWorkflow' }),
			locals.requestId
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return errorResponse(new ValidationError('Invalid JSON in request body'), locals.requestId);
	}

	const parsed = CreateWorkflowBody.safeParse(body);
	if (!parsed.success) {
		return errorResponse(
			new ValidationError('Invalid workflow data', {
				errors: parsed.error.issues.map((i) => i.message)
			}),
			locals.requestId
		);
	}

	try {
		const workflow = await workflowRepository.create({
			...parsed.data,
			userId: locals.user?.id
		});

		log.info({ workflowId: workflow.id, name: workflow.name }, 'Workflow created');

		const headers = new Headers();
		addDeprecationHeaders(headers, '/api/v1/workflows');

		return json({ workflow }, { status: 201, headers });
	} catch (err) {
		const dbErr = new DatabaseError(
			'Failed to create workflow',
			{ operation: 'createWorkflow' },
			err instanceof Error ? err : undefined
		);
		log.error({ err: dbErr }, 'Failed to create workflow');
		return errorResponse(dbErr, locals.requestId);
	}
};
