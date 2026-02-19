/**
 * CloudAdvisor API routes.
 *
 * Registers:
 * - POST /api/cloud-advisor/analyse         — trigger on-demand analysis
 * - GET  /api/cloud-advisor/findings         — paginated findings list
 * - GET  /api/cloud-advisor/findings/:id     — single finding detail
 * - PATCH /api/cloud-advisor/findings/:id   — update finding status
 * - GET  /api/cloud-advisor/summary          — latest run summary + counts
 *
 * All routes require authentication (tools:execute permission).
 * SSE progress subscription uses the existing /api/workflows/:id/runs/:runId/stream
 * endpoint from workflows.ts.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
	FindingDomainSchema,
	FindingSeveritySchema,
	FindingStatusSchema
} from '../mastra/findings.js';
import { requireAuth } from '../plugins/rbac.js';
import { DatabaseError } from '@portal/server/errors.js';
import { createFindingsRepository } from '../services/findings-repository.js';
import { triggerAnalysis } from '../mastra/scheduler.js';
import type { SchedulerConfig } from '../mastra/scheduler.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

const AnalyseBodySchema = z.object({
	domain: z.enum(['cost', 'security', 'right-sizing', 'ai-performance', 'all']).default('all'),
	depth: z.enum(['light', 'deep']).default('deep')
});

const FindingsQuerySchema = z.object({
	domain: FindingDomainSchema.optional(),
	severity: FindingSeveritySchema.optional(),
	status: FindingStatusSchema.optional(),
	cloud: z.enum(['oci', 'aws', 'azure']).optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
	offset: z.coerce.number().int().min(0).default(0)
});

const FindingIdParamsSchema = z.object({
	findingId: z.string().uuid()
});

const UpdateFindingBodySchema = z.object({
	status: z.enum(['acknowledged', 'resolved', 'dismissed']),
	note: z.string().max(2000).optional()
});

// ── Plugin ────────────────────────────────────────────────────────────────────

const cloudAdvisorRoutes: FastifyPluginAsync = async (fastify) => {
	// Findings repository uses Fastify oracle plugin's withConnection
	const findingsRepo = createFindingsRepository(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(fastify as any).oracle?.withConnection ??
			(async () => {
				throw new DatabaseError('Oracle connection required for CloudAdvisor findings');
			})
	);

	const schedulerConfig: SchedulerConfig = {
		mastra: fastify.mastra,
		findingsRepository: findingsRepo,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		compartmentId: (fastify as any).mastra?.defaultCompartmentId
	};

	// ── POST /api/cloud-advisor/analyse ────────────────────────────────────

	fastify.withTypeProvider<ZodTypeProvider>().post(
		'/api/cloud-advisor/analyse',
		{
			schema: { body: AnalyseBodySchema },
			preHandler: requireAuth('tools:execute')
		},
		async (request, reply) => {
			const { domain, depth } = request.body;

			const runId = await triggerAnalysis(schedulerConfig, domain, depth);

			request.log.info({ domain, depth, runId }, 'on-demand CloudAdvisor analysis triggered');

			return reply.status(202).send({
				runId,
				domain,
				message: `Analysis started. Subscribe to /api/workflows/runs/${runId}/stream for progress.`
			});
		}
	);

	// ── GET /api/cloud-advisor/findings ───────────────────────────────────

	fastify.withTypeProvider<ZodTypeProvider>().get(
		'/api/cloud-advisor/findings',
		{
			schema: { querystring: FindingsQuerySchema },
			preHandler: requireAuth('tools:execute')
		},
		async (request, reply) => {
			const { domain, severity, status, cloud, limit, offset } = request.query;

			const findings = await findingsRepo.listFindings({
				domain,
				severity,
				status,
				cloud,
				limit,
				offset
			});

			return reply.send({ findings, count: findings.length, offset, limit });
		}
	);

	// ── GET /api/cloud-advisor/findings/:findingId ─────────────────────────

	fastify.withTypeProvider<ZodTypeProvider>().get(
		'/api/cloud-advisor/findings/:findingId',
		{
			schema: { params: FindingIdParamsSchema },
			preHandler: requireAuth('tools:execute')
		},
		async (request, reply) => {
			const finding = await findingsRepo.getFinding(request.params.findingId);

			if (!finding) {
				return reply.status(404).send({ error: 'Finding not found' });
			}

			return reply.send(finding);
		}
	);

	// ── PATCH /api/cloud-advisor/findings/:findingId ──────────────────────

	fastify.withTypeProvider<ZodTypeProvider>().patch(
		'/api/cloud-advisor/findings/:findingId',
		{
			schema: {
				params: FindingIdParamsSchema,
				body: UpdateFindingBodySchema
			},
			preHandler: requireAuth('tools:execute')
		},
		async (request, reply) => {
			const { findingId } = request.params;
			const { status, note } = request.body;

			const existing = await findingsRepo.getFinding(findingId);
			if (!existing) {
				return reply.status(404).send({ error: 'Finding not found' });
			}

			await findingsRepo.updateFindingStatus(findingId, status, note);

			request.log.info({ findingId, status, userId: request.user?.id }, 'finding status updated');

			return reply.send({ id: findingId, status });
		}
	);

	// ── GET /api/cloud-advisor/summary ────────────────────────────────────

	fastify.withTypeProvider<ZodTypeProvider>().get(
		'/api/cloud-advisor/summary',
		{
			preHandler: requireAuth('tools:execute')
		},
		async (_request, reply) => {
			const [summary, activeFindings] = await Promise.all([
				findingsRepo.getLatestRunSummary(),
				findingsRepo.listFindings({ status: 'active', limit: 5 })
			]);

			return reply.send({
				summary,
				recentFindings: activeFindings,
				hasActiveFindings: activeFindings.length > 0
			});
		}
	);
};

export { cloudAdvisorRoutes };
export default cloudAdvisorRoutes;
