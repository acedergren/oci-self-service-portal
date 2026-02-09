/**
 * Workflow route module — CRUD, execution, and approval.
 *
 * Registers:
 * - GET    /api/v1/workflows            — list workflows
 * - POST   /api/v1/workflows            — create workflow
 * - GET    /api/v1/workflows/:id        — get workflow detail
 * - PUT    /api/v1/workflows/:id        — update workflow
 * - DELETE /api/v1/workflows/:id        — delete workflow
 * - POST   /api/v1/workflows/:id/run    — execute workflow
 * - GET    /api/v1/workflows/:id/runs/:runId         — get run detail
 * - POST   /api/v1/workflows/:id/runs/:runId/approve — approve suspended run
 *
 * All routes require authentication and `workflows:read` or `workflows:execute`.
 * IDOR prevention: all queries scoped by orgId (and optionally userId).
 */
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { WorkflowStatusSchema } from '@portal/shared/workflows/types.js';
import { ValidationError, NotFoundError, toPortalError } from '@portal/shared/server/errors.js';
import {
	createWorkflowRepository,
	createWorkflowRunRepository,
	createWorkflowRunStepRepository
} from '../services/workflow-repository.js';
import { WorkflowExecutor, type EngineState } from '../mastra/workflows/executor.js';
import { requireAuth, resolveOrgId } from '../plugins/rbac.js';

// ── Zod schemas for route validation ────────────────────────────────────

const WorkflowIdParamsSchema = z.object({
	id: z.string().uuid()
});

const RunIdParamsSchema = z.object({
	id: z.string().uuid(),
	runId: z.string().uuid()
});

const ListQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
	status: WorkflowStatusSchema.optional(),
	search: z.string().max(200).optional()
});

const CreateWorkflowBodySchema = z.object({
	name: z.string().min(1).max(255),
	description: z.string().max(2000).optional(),
	status: WorkflowStatusSchema.optional(),
	tags: z.array(z.string()).optional(),
	nodes: z.array(z.record(z.string(), z.unknown())),
	edges: z.array(z.record(z.string(), z.unknown())),
	inputSchema: z.record(z.string(), z.unknown()).optional()
});

const UpdateWorkflowBodySchema = z.object({
	name: z.string().min(1).max(255).optional(),
	description: z.string().max(2000).optional(),
	status: WorkflowStatusSchema.optional(),
	tags: z.array(z.string()).optional(),
	nodes: z.array(z.record(z.string(), z.unknown())).optional(),
	edges: z.array(z.record(z.string(), z.unknown())).optional(),
	inputSchema: z.record(z.string(), z.unknown()).optional()
});

const RunWorkflowBodySchema = z.object({
	input: z.record(z.string(), z.unknown()).optional()
});

// ── Route module ────────────────────────────────────────────────────────

const workflowRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();

	// Create repositories lazily — oracle plugin may not be registered (tests)
	function getRepos() {
		if (!fastify.hasDecorator('oracle') || !fastify.oracle.isAvailable()) {
			throw new Error('Database not available');
		}
		return {
			workflows: createWorkflowRepository(fastify.oracle.withConnection),
			runs: createWorkflowRunRepository(fastify.oracle.withConnection),
			steps: createWorkflowRunStepRepository(fastify.oracle.withConnection)
		};
	}

	// ── GET /api/v1/workflows ───────────────────────────────────────────

	app.get(
		'/api/v1/workflows',
		{
			schema: { querystring: ListQuerySchema },
			preHandler: requireAuth('workflows:read')
		},
		async (request, reply) => {
			const { workflows } = getRepos();
			const { limit, offset, status, search } = request.query;
			const orgId = resolveOrgId(request);

			if (!orgId) {
				return reply.code(400).send({ error: 'Organization context required' });
			}

			const listOptions = {
				orgId,
				userId: request.user?.id,
				limit,
				offset,
				search,
				status
			};

			const [results, total] = await Promise.all([
				workflows.list(listOptions),
				workflows.count(listOptions)
			]);

			return reply.send({
				workflows: results.map((w) => ({
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
				total
			});
		}
	);

	// ── POST /api/v1/workflows ──────────────────────────────────────────

	app.post(
		'/api/v1/workflows',
		{
			schema: { body: CreateWorkflowBodySchema },
			preHandler: requireAuth('workflows:execute')
		},
		async (request, reply) => {
			const { workflows } = getRepos();
			const orgId = resolveOrgId(request);

			if (!orgId) {
				return reply.code(400).send({ error: 'Organization context required' });
			}

			const workflow = await workflows.create({
				...request.body,
				userId: request.user?.id,
				orgId
			});

			return reply.code(201).send({ workflow });
		}
	);

	// ── GET /api/v1/workflows/:id ───────────────────────────────────────

	app.get(
		'/api/v1/workflows/:id',
		{
			schema: { params: WorkflowIdParamsSchema },
			preHandler: requireAuth('workflows:read')
		},
		async (request, reply) => {
			const { workflows } = getRepos();
			const orgId = resolveOrgId(request);

			if (!orgId) {
				return reply.code(400).send({ error: 'Organization context required' });
			}

			const userId = request.user?.id;
			const workflow = userId
				? await workflows.getByIdForUser(request.params.id, userId, orgId)
				: await workflows.getByIdForOrg(request.params.id, orgId);

			if (!workflow) {
				return reply.code(404).send({ error: 'Workflow not found' });
			}

			return reply.send({ workflow });
		}
	);

	// ── PUT /api/v1/workflows/:id ───────────────────────────────────────

	app.put(
		'/api/v1/workflows/:id',
		{
			schema: {
				params: WorkflowIdParamsSchema,
				body: UpdateWorkflowBodySchema
			},
			preHandler: requireAuth('workflows:execute')
		},
		async (request, reply) => {
			const { workflows } = getRepos();
			const userId = request.user?.id;

			if (!userId) {
				return reply.code(400).send({ error: 'User context required' });
			}

			const workflow = await workflows.updateForUser(request.params.id, request.body, userId);

			if (!workflow) {
				return reply.code(404).send({ error: 'Workflow not found' });
			}

			return reply.send({ workflow });
		}
	);

	// ── DELETE /api/v1/workflows/:id ────────────────────────────────────

	app.delete(
		'/api/v1/workflows/:id',
		{
			schema: { params: WorkflowIdParamsSchema },
			preHandler: requireAuth('workflows:execute')
		},
		async (request, reply) => {
			const { workflows } = getRepos();
			const orgId = resolveOrgId(request);

			if (!orgId) {
				return reply.code(400).send({ error: 'Organization context required' });
			}

			const deleted = await workflows.delete(
				request.params.id,
				request.user?.id ?? undefined,
				orgId
			);

			if (!deleted) {
				return reply.code(404).send({ error: 'Workflow not found' });
			}

			return reply.code(204).send();
		}
	);

	// ── POST /api/v1/workflows/:id/run ──────────────────────────────────

	app.post(
		'/api/v1/workflows/:id/run',
		{
			schema: {
				params: WorkflowIdParamsSchema,
				body: RunWorkflowBodySchema
			},
			preHandler: requireAuth('workflows:execute')
		},
		async (request, reply) => {
			const { workflows, runs } = getRepos();
			const orgId = resolveOrgId(request);

			if (!orgId) {
				return reply.code(400).send({ error: 'Organization context required' });
			}

			// Load with IDOR check
			const userId = request.user?.id;
			const definition = userId
				? await workflows.getByIdForUser(request.params.id, userId, orgId)
				: await workflows.getByIdForOrg(request.params.id, orgId);

			if (!definition) {
				return reply.code(404).send({ error: 'Workflow not found' });
			}

			if (definition.status !== 'published' && definition.status !== 'draft') {
				throw new ValidationError('Only published or draft workflows can be executed', {
					workflowId: request.params.id,
					status: definition.status
				});
			}

			const input = request.body.input ?? {};

			// Create run record
			const run = await runs.create({
				definitionId: definition.id,
				workflowVersion: definition.version,
				userId,
				orgId,
				input
			});

			// Execute
			const executor = new WorkflowExecutor();
			try {
				await runs.updateStatus(run.id, { status: 'running' });

				const result = await executor.execute(definition, input);

				await runs.updateStatus(run.id, {
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

				return reply.code(201).send({
					id: run.id,
					workflowId: definition.id,
					status: result.status,
					output: result.output,
					error: result.error
				});
			} catch (err) {
				const portalErr = toPortalError(err, 'Workflow execution failed');
				fastify.log.error({ err: portalErr, runId: run.id }, 'Workflow execution failed');

				try {
					await runs.updateStatus(run.id, {
						status: 'failed',
						error: { message: portalErr.message, code: portalErr.code }
					});
				} catch (updateErr) {
					fastify.log.error({ err: updateErr }, 'Failed to update run status after error');
				}

				throw portalErr;
			}
		}
	);

	// ── GET /api/v1/workflows/:id/runs/:runId ───────────────────────────

	app.get(
		'/api/v1/workflows/:id/runs/:runId',
		{
			schema: { params: RunIdParamsSchema },
			preHandler: requireAuth('workflows:read')
		},
		async (request, reply) => {
			const { runs, steps } = getRepos();
			const orgId = resolveOrgId(request);

			if (!orgId) {
				return reply.code(400).send({ error: 'Organization context required' });
			}

			const userId = request.user?.id;
			const run = userId
				? await runs.getByIdForUser(request.params.runId, userId, orgId)
				: await runs.getByIdForOrg(request.params.runId, orgId);

			if (!run) {
				return reply.code(404).send({ error: 'Workflow run not found' });
			}

			// Defense in depth: verify run belongs to this workflow
			if (run.definitionId !== request.params.id) {
				return reply.code(404).send({ error: 'Workflow run not found for this workflow' });
			}

			const runSteps = await steps.listByRun(request.params.runId);

			return reply.send({
				id: run.id,
				workflowId: run.definitionId,
				status: run.status,
				input: run.input,
				output: run.output,
				error: run.error,
				startedAt: run.startedAt?.toISOString() ?? null,
				completedAt: run.completedAt?.toISOString() ?? null,
				steps: runSteps.map((s) => ({
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
		}
	);

	// ── POST /api/v1/workflows/:id/runs/:runId/approve ──────────────────

	app.post(
		'/api/v1/workflows/:id/runs/:runId/approve',
		{
			schema: { params: RunIdParamsSchema },
			preHandler: requireAuth('workflows:execute')
		},
		async (request, reply) => {
			const { workflows, runs } = getRepos();
			const userId = request.user?.id;

			if (!userId) {
				return reply.code(400).send({ error: 'User context required' });
			}

			// Load run (IDOR via userId)
			const run = await runs.getByIdForUser(request.params.runId, userId);

			if (!run) {
				throw new NotFoundError('Workflow run not found', {
					runId: request.params.runId
				});
			}

			if (run.status !== 'suspended') {
				throw new ValidationError('Run is not suspended — cannot approve', {
					runId: request.params.runId,
					currentStatus: run.status
				});
			}

			if (!run.engineState) {
				throw new ValidationError('Run has no engine state — cannot resume', {
					runId: request.params.runId
				});
			}

			// Defense in depth: verify run belongs to this workflow
			if (run.definitionId !== request.params.id) {
				throw new NotFoundError('Workflow run not found for this workflow', {
					workflowId: request.params.id,
					runId: request.params.runId
				});
			}

			// Load definition (IDOR via userId)
			const definition = await workflows.getByIdForUser(run.definitionId, userId);

			if (!definition) {
				throw new NotFoundError('Workflow definition not found', {
					workflowId: run.definitionId
				});
			}

			// Resume execution
			const executor = new WorkflowExecutor();
			try {
				await runs.updateStatus(run.id, { status: 'running' });

				const result = await executor.resume(
					definition,
					run.engineState as unknown as EngineState,
					run.input ?? {}
				);

				await runs.updateStatus(run.id, {
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

				return reply.send({
					run: {
						id: run.id,
						workflowId: definition.id,
						status: result.status,
						output: result.output,
						error: result.error
					}
				});
			} catch (err) {
				const portalErr = toPortalError(err, 'Workflow resume failed');
				fastify.log.error({ err: portalErr, runId: run.id }, 'Workflow resume failed');

				try {
					await runs.updateStatus(run.id, {
						status: 'failed',
						error: { message: portalErr.message, code: portalErr.code }
					});
				} catch (updateErr) {
					fastify.log.error({ err: updateErr }, 'Failed to update run status after error');
				}

				throw portalErr;
			}
		}
	);
};

export default workflowRoutes;
