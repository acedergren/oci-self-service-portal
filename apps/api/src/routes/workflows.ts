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
 * - GET    /api/v1/workflows/runs                    — list all runs (admin)
 * - GET    /api/v1/workflows/:id/runs               — list runs for workflow
 * - GET    /api/v1/workflows/:id/runs/:runId         — get run detail
 * - GET    /api/v1/workflows/:id/runs/:runId/stream  — SSE stream for run progress
 * - POST   /api/v1/workflows/:id/runs/:runId/approve — approve suspended run
 *
 * All routes require authentication and `workflows:read` or `workflows:execute`.
 * IDOR prevention: all queries scoped by orgId (and optionally userId).
 */
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { WorkflowStatusSchema, type WorkflowRun } from '@portal/shared/workflows/types.js';
import {
	ValidationError,
	NotFoundError,
	DatabaseError,
	toPortalError
} from '@portal/server/errors.js';
import {
	createWorkflowRepository,
	createWorkflowRunRepository,
	createWorkflowRunStepRepository
} from '../services/workflow-repository.js';
import {
	WorkflowExecutor,
	type EngineState,
	type WorkflowProgressEmitter
} from '@portal/shared/server/workflows/executor.js';
import { requireAuth, resolveOrgId } from '../plugins/rbac.js';
import {
	emitWorkflowStream,
	getLatestWorkflowStatus,
	subscribeWorkflowStream
} from '../services/workflow-stream-bus.js';

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
			throw new DatabaseError('Oracle connection required');
		}
		return {
			workflows: createWorkflowRepository(fastify.oracle.withConnection),
			runs: createWorkflowRunRepository(fastify.oracle.withConnection),
			steps: createWorkflowRunStepRepository(fastify.oracle.withConnection)
		};
	}

	const TERMINAL_RUN_STATUSES = new Set<WorkflowRun['status']>([
		'completed',
		'failed',
		'suspended'
	]);

	function emitRunStatus(
		runId: string,
		status: WorkflowRun['status'],
		options: { output?: Record<string, unknown> | null; error?: string | null } = {}
	): void {
		emitWorkflowStream({
			type: 'status',
			runId,
			status,
			output: options.output ?? null,
			error: options.error ?? null
		});
	}

	function isTerminalStatus(status: WorkflowRun['status']): boolean {
		return TERMINAL_RUN_STATUSES.has(status);
	}

	function normalizeRunError(error: unknown): string | null {
		if (!error) return null;
		if (typeof error === 'string') return error;
		if (typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
			return String((error as Record<string, unknown>).message);
		}
		try {
			return JSON.stringify(error);
		} catch {
			return 'unknown error';
		}
	}

	function createProgressEmitter(runId: string): WorkflowProgressEmitter {
		return (event) => {
			if (event.type === 'status') {
				emitRunStatus(runId, event.status, {
					output: event.output ?? null,
					error: event.error ?? null
				});
				return;
			}

			emitWorkflowStream({
				type: 'step',
				runId,
				stage: event.stage,
				nodeId: event.nodeId,
				nodeType: event.nodeType,
				payload: event.payload
			});
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
			const executor = new WorkflowExecutor({
				progressEmitter: createProgressEmitter(run.id)
			});
			try {
				await runs.updateStatus(run.id, { status: 'running' });
				emitRunStatus(run.id, 'running');

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
					emitRunStatus(run.id, 'failed', { error: portalErr.message });
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

	// ── GET /api/v1/workflows/:id/runs/:runId/stream ────────────────────

	app.get(
		'/api/v1/workflows/:id/runs/:runId/stream',
		{
			schema: { params: RunIdParamsSchema },
			preHandler: requireAuth('workflows:read')
		},
		async (request, reply) => {
			const { runs } = getRepos();
			const orgId = resolveOrgId(request);
			if (!orgId) return reply.code(400).send({ error: 'Organization context required' });

			const userId = request.user?.id;
			const run = userId
				? await runs.getByIdForUser(request.params.runId, userId, orgId)
				: await runs.getByIdForOrg(request.params.runId, orgId);

			if (!run) return reply.code(404).send({ error: 'Workflow run not found' });
			if (run.definitionId !== request.params.id) {
				return reply.code(404).send({ error: 'Run not found for this workflow' });
			}

			// Set SSE headers
			reply.raw.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			});

			const writeEvent = (event: string, payload: Record<string, unknown>) => {
				reply.raw.write(`event: ${event}\n`);
				reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
			};

			const sendStatus = (
				status: WorkflowRun['status'],
				options: { output?: Record<string, unknown> | null; error?: string | null } = {}
			) => {
				writeEvent('status', {
					status,
					output: options.output ?? null,
					error: options.error ?? null
				});
			};

			const sendStep = (event: {
				stage: 'start' | 'complete' | 'error';
				nodeId: string;
				nodeType: string;
				payload?: unknown;
			}) => {
				writeEvent('step', {
					stage: event.stage,
					nodeId: event.nodeId,
					nodeType: event.nodeType,
					payload: event.payload ?? null
				});
			};

			const latest = getLatestWorkflowStatus(run.id) ?? {
				type: 'status' as const,
				runId: run.id,
				status: run.status,
				output: run.output ?? null,
				error: normalizeRunError(run.error)
			};

			sendStatus(latest.status, {
				output: (latest.output as Record<string, unknown> | null) ?? null,
				error: normalizeRunError(latest.error)
			});

			if (isTerminalStatus(latest.status)) {
				reply.raw.end();
				return;
			}

			let closed = false;
			// eslint-disable-next-line prefer-const -- assigned after cleanup closure is defined
			let timeoutId: NodeJS.Timeout | undefined;
			let unsubscribe: () => void = () => {};

			const cleanup = () => {
				if (closed) return;
				closed = true;
				unsubscribe();
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				reply.raw.end();
			};

			unsubscribe = subscribeWorkflowStream(run.id, (event) => {
				if (event.type === 'status') {
					sendStatus(event.status, {
						output: event.output ?? null,
						error: normalizeRunError(event.error)
					});
					if (isTerminalStatus(event.status)) {
						cleanup();
					}
					return;
				}

				sendStep(event);
			});

			timeoutId = setTimeout(() => {
				if (closed) return;
				writeEvent('timeout', {});
				cleanup();
			}, 300_000);

			request.raw.on('close', cleanup);
			reply.raw.on('close', cleanup);
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
			const orgId = resolveOrgId(request);

			if (!orgId) {
				return reply.code(400).send({ error: 'Organization context required' });
			}

			const userId = request.user?.id;

			if (!userId) {
				return reply.code(400).send({ error: 'User context required' });
			}

			// Load run (IDOR via userId + orgId)
			const run = await runs.getByIdForUser(request.params.runId, userId, orgId);

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

			// Load definition (IDOR via userId + orgId)
			const definition = await workflows.getByIdForUser(run.definitionId, userId, orgId);

			if (!definition) {
				throw new NotFoundError('Workflow definition not found', {
					workflowId: run.definitionId
				});
			}

			// Resume execution
			const executor = new WorkflowExecutor({
				progressEmitter: createProgressEmitter(run.id)
			});
			try {
				await runs.updateStatus(run.id, { status: 'running' });
				emitRunStatus(run.id, 'running');

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
					emitRunStatus(run.id, 'failed', { error: portalErr.message });
				} catch (updateErr) {
					fastify.log.error({ err: updateErr }, 'Failed to update run status after error');
				}

				throw portalErr;
			}
		}
	);

	// ── POST /api/v1/workflows/:id/runs/:runId/cancel ─────────────────────
	// Admin control to cancel pending/running/suspended runs.

	app.post(
		'/api/v1/workflows/:id/runs/:runId/cancel',
		{
			schema: { params: RunIdParamsSchema },
			preHandler: requireAuth('workflows:execute')
		},
		async (request, reply) => {
			const { runs } = getRepos();
			const orgId = resolveOrgId(request);
			if (!orgId) {
				return reply.code(400).send({ error: 'Organization context required' });
			}

			const run = await runs.getByIdForOrg(request.params.runId, orgId);
			if (!run) {
				throw new NotFoundError('Workflow run not found', {
					runId: request.params.runId
				});
			}

			if (run.definitionId !== request.params.id) {
				throw new NotFoundError('Workflow run not found for this workflow', {
					workflowId: request.params.id,
					runId: request.params.runId
				});
			}

			const cancellableStatuses = new Set(['pending', 'running', 'suspended']);
			if (!cancellableStatuses.has(run.status)) {
				throw new ValidationError('Run cannot be cancelled in its current status', {
					runId: request.params.runId,
					currentStatus: run.status
				});
			}

			const cancellationInfo = {
				message: 'Run cancelled by administrator',
				code: 'RUN_CANCELLED',
				cancelledBy: request.user?.id ?? 'system'
			};

			const updated = await runs.updateStatus(run.id, {
				status: 'cancelled',
				error: cancellationInfo
			});

			return reply.send({
				run: {
					id: updated?.id ?? run.id,
					workflowId: run.definitionId,
					status: updated?.status ?? 'cancelled',
					error: updated?.error ?? cancellationInfo
				}
			});
		}
	);

	// ── POST /api/v1/workflows/:id/runs/:runId/resume ─────────────────────
	// Admin control to resume suspended runs (without approval token flow).

	app.post(
		'/api/v1/workflows/:id/runs/:runId/resume',
		{
			schema: { params: RunIdParamsSchema },
			preHandler: requireAuth('workflows:execute')
		},
		async (request, reply) => {
			const { workflows, runs } = getRepos();
			const orgId = resolveOrgId(request);
			if (!orgId) {
				return reply.code(400).send({ error: 'Organization context required' });
			}

			const run = await runs.getByIdForOrg(request.params.runId, orgId);
			if (!run) {
				throw new NotFoundError('Workflow run not found', {
					runId: request.params.runId
				});
			}

			if (run.definitionId !== request.params.id) {
				throw new NotFoundError('Workflow run not found for this workflow', {
					workflowId: request.params.id,
					runId: request.params.runId
				});
			}

			if (run.status !== 'suspended') {
				throw new ValidationError('Only suspended runs can be resumed', {
					runId: request.params.runId,
					currentStatus: run.status
				});
			}

			if (!run.engineState) {
				throw new ValidationError('Run has no engine state — cannot resume', {
					runId: request.params.runId
				});
			}

			const definition = await workflows.getByIdForOrg(run.definitionId, orgId);
			if (!definition) {
				throw new NotFoundError('Workflow definition not found', {
					workflowId: run.definitionId
				});
			}

			const executor = new WorkflowExecutor({
				progressEmitter: createProgressEmitter(run.id)
			});
			try {
				await runs.updateStatus(run.id, { status: 'running' });
				emitRunStatus(run.id, 'running');

				const result = await executor.resume(
					definition,
					run.engineState as unknown as EngineState,
					run.input ?? {}
				);

				const resumed = await runs.updateStatus(run.id, {
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
						status: resumed?.status ?? result.status,
						output: resumed?.output ?? result.output,
						error: resumed?.error ?? (result.error ? { message: result.error } : undefined)
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
					emitRunStatus(run.id, 'failed', { error: portalErr.message });
				} catch (updateErr) {
					fastify.log.error({ err: updateErr }, 'Failed to update run status after resume error');
				}

				throw portalErr;
			}
		}
	);

	// ── GET /api/v1/workflows/runs ──────────────────────────────────────
	// Admin view: list all runs across all workflows for the org.

	app.get(
		'/api/v1/workflows/runs',
		{
			schema: {
				querystring: z.object({
					limit: z.coerce.number().int().min(1).max(100).default(50),
					offset: z.coerce.number().int().min(0).default(0),
					status: z
						.enum(['pending', 'running', 'completed', 'failed', 'suspended', 'cancelled'])
						.optional()
				})
			},
			preHandler: requireAuth('workflows:read')
		},
		async (request, reply) => {
			const { runs } = getRepos();
			const orgId = resolveOrgId(request);
			if (!orgId) {
				return reply.code(400).send({ error: 'Organization context required' });
			}

			const { limit, offset, status } = request.query;
			const result = await runs.listByOrg(orgId, { limit, offset, status });

			return reply.send({
				runs: result.runs.map((r) => ({
					id: r.id,
					definitionId: r.definitionId,
					status: r.status,
					startedAt: r.startedAt?.toISOString() ?? null,
					completedAt: r.completedAt?.toISOString() ?? null,
					createdAt: r.createdAt?.toISOString() ?? null
				})),
				total: result.total
			});
		}
	);

	// ── GET /api/v1/workflows/runs/:runId ───────────────────────────────
	// Convenience: get a single run by ID without requiring workflowId in the URL.
	// Used by the frontend runs detail page which only has the runId in its route.

	app.get(
		'/api/v1/workflows/runs/:runId',
		{
			schema: { params: z.object({ runId: z.string().uuid() }) },
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

			const runSteps = await steps.listByRun(request.params.runId);

			return reply.send({
				run: {
					id: run.id,
					definitionId: run.definitionId,
					status: run.status,
					input: run.input,
					output: run.output,
					error: run.error,
					startedAt: run.startedAt?.toISOString() ?? null,
					completedAt: run.completedAt?.toISOString() ?? null,
					steps: runSteps.map((s) => ({
						id: s.id,
						nodeId: s.nodeId,
						nodeType: s.nodeType,
						stepNumber: s.stepNumber,
						status: s.status,
						input: s.input,
						output: s.output,
						error: s.error,
						startedAt: s.startedAt?.toISOString() ?? null,
						completedAt: s.completedAt?.toISOString() ?? null,
						durationMs: s.durationMs
					}))
				}
			});
		}
	);

	// ── POST /api/v1/workflows/runs/:runId/approve ──────────────────────
	// Convenience: approve a suspended run without requiring workflowId in the URL.

	app.post(
		'/api/v1/workflows/runs/:runId/approve',
		{
			schema: { params: z.object({ runId: z.string().uuid() }) },
			preHandler: requireAuth('workflows:execute')
		},
		async (request, reply) => {
			const { workflows, runs } = getRepos();
			const orgId = resolveOrgId(request);
			if (!orgId) {
				return reply.code(400).send({ error: 'Organization context required' });
			}

			const userId = request.user?.id;
			if (!userId) {
				return reply.code(400).send({ error: 'User context required' });
			}

			const run = await runs.getByIdForUser(request.params.runId, userId, orgId);
			if (!run) {
				throw new NotFoundError('Workflow run not found', { runId: request.params.runId });
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

			const definition = await workflows.getByIdForUser(run.definitionId, userId, orgId);
			if (!definition) {
				throw new NotFoundError('Workflow definition not found', {
					workflowId: run.definitionId
				});
			}

			const executor = new WorkflowExecutor({
				progressEmitter: createProgressEmitter(run.id)
			});
			try {
				await runs.updateStatus(run.id, { status: 'running' });
				emitRunStatus(run.id, 'running');

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
					emitRunStatus(run.id, 'failed', { error: portalErr.message });
				} catch (updateErr) {
					fastify.log.error({ err: updateErr }, 'Failed to update run status after error');
				}

				throw portalErr;
			}
		}
	);

	// ── GET /api/v1/workflows/:id/runs ──────────────────────────────────
	// List all runs for a specific workflow (org-scoped).

	app.get(
		'/api/v1/workflows/:id/runs',
		{
			schema: {
				params: WorkflowIdParamsSchema,
				querystring: z.object({
					limit: z.coerce.number().int().min(1).max(100).default(50),
					offset: z.coerce.number().int().min(0).default(0),
					status: z
						.enum(['pending', 'running', 'completed', 'failed', 'suspended', 'cancelled'])
						.optional()
				})
			},
			preHandler: requireAuth('workflows:read')
		},
		async (request, reply) => {
			const { workflows, runs } = getRepos();
			const orgId = resolveOrgId(request);
			if (!orgId) {
				return reply.code(400).send({ error: 'Organization context required' });
			}

			// Verify the workflow exists and belongs to this org
			const workflow = await workflows.getByIdForOrg(request.params.id, orgId);
			if (!workflow) {
				throw new NotFoundError(`Workflow ${request.params.id} not found`);
			}

			const { limit, offset, status } = request.query;
			const runsList = await runs.listByWorkflowForOrg(request.params.id, orgId, {
				limit,
				offset,
				status
			});

			return reply.send({
				runs: runsList.map((r) => ({
					id: r.id,
					definitionId: r.definitionId,
					status: r.status,
					startedAt: r.startedAt?.toISOString() ?? null,
					completedAt: r.completedAt?.toISOString() ?? null,
					createdAt: r.createdAt?.toISOString() ?? null
				})),
				workflowId: request.params.id,
				workflowName: workflow.name
			});
		}
	);

	// ── POST /api/v1/workflows/charlie/:runId/approve ────────────────────
	// Approves a suspended charlieActionWorkflow run, resuming execution.

	app.post(
		'/api/v1/workflows/charlie/:runId/approve',
		{
			schema: {
				params: z.object({ runId: z.string().uuid() }),
				body: z.object({ note: z.string().optional() })
			},
			preHandler: requireAuth('workflows:execute')
		},
		async (request, reply) => {
			const { runId } = request.params;
			const orgId = resolveOrgId(request);
			if (!orgId) return reply.code(400).send({ error: 'Organization context required' });

			const userId = request.user?.id;
			if (!userId) return reply.code(400).send({ error: 'User context required' });

			// IDOR guard: verify run belongs to this user's org before resuming
			const { runs } = getRepos();
			const existingRun = await runs.getByIdForUser(runId, userId, orgId);
			if (!existingRun) throw new NotFoundError('Workflow run not found', { runId });

			try {
				const run = await fastify.mastra.getWorkflow('charlieActionWorkflow').createRun({ runId });
				await run.resume({
					step: 'pre_execution_summary',
					resumeData: { approved: true }
				});
				fastify.log.info({ orgId, userId, runId }, 'Charlie workflow approved');
			} catch (err) {
				throw toPortalError(err);
			}

			return reply.send({ status: 'resumed', runId });
		}
	);

	// ── POST /api/v1/workflows/charlie/:runId/reject ──────────────────────
	// Rejects a suspended charlieActionWorkflow run, cancelling execution.

	app.post(
		'/api/v1/workflows/charlie/:runId/reject',
		{
			schema: {
				params: z.object({ runId: z.string().uuid() }),
				body: z.object({ reason: z.string().optional() })
			},
			preHandler: requireAuth('workflows:execute')
		},
		async (request, reply) => {
			const { runId } = request.params;
			const orgId = resolveOrgId(request);
			if (!orgId) return reply.code(400).send({ error: 'Organization context required' });

			const userId = request.user?.id;
			if (!userId) return reply.code(400).send({ error: 'User context required' });

			// IDOR guard: verify run belongs to this user's org before cancelling
			const { runs } = getRepos();
			const existingRun = await runs.getByIdForUser(runId, userId, orgId);
			if (!existingRun) throw new NotFoundError('Workflow run not found', { runId });

			try {
				const run = await fastify.mastra.getWorkflow('charlieActionWorkflow').createRun({ runId });
				await run.resume({
					step: 'pre_execution_summary',
					resumeData: { approved: false, reason: request.body.reason }
				});
				fastify.log.info({ orgId, userId, runId }, 'Charlie workflow rejected');
			} catch (err) {
				throw toPortalError(err);
			}

			return reply.send({ status: 'cancelled', runId });
		}
	);

	// ── Crash Recovery ──────────────────────────────────────────────────
	// On server start, mark any runs stuck in 'running' status as failed.
	// These are runs that were interrupted by a server crash/restart.
	fastify.addHook('onReady', async () => {
		try {
			if (!fastify.hasDecorator('oracle') || !fastify.oracle.isAvailable()) return;
			const { runs } = getRepos();
			// listStale may not exist yet — will be added to repository interface later
			const staleRuns = await (
				runs as typeof runs & {
					listStale?: (status: string, timeoutMs: number) => Promise<WorkflowRun[]>;
				}
			).listStale?.('running', 300_000); // 5 min timeout
			if (!staleRuns?.length) return;

			for (const staleRun of staleRuns) {
				await runs.updateStatus(staleRun.id, {
					status: 'failed',
					error: { message: 'Interrupted by server restart', code: 'CRASH_RECOVERY' }
				});
			}

			fastify.log.info({ count: staleRuns.length }, 'Recovered stale workflow runs');
		} catch (err) {
			fastify.log.warn({ err }, 'Crash recovery check failed (non-critical)');
		}
	});
};

export default workflowRoutes;
