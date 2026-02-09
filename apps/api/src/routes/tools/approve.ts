import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ToolApproveBodySchema } from '../schemas.js';
import { getToolDefinition } from '../../services/tools.js';
import { pendingApprovals, recordApproval } from '../../services/approvals.js';
import { requireAuth, resolveOrgId } from '../../plugins/rbac.js';

/**
 * Tool approval route module.
 *
 * Registers:
 * - GET  /api/tools/approve — list pending approval requests
 * - POST /api/tools/approve — approve or reject a pending tool execution
 *
 * Requires authentication + `tools:approve` permission.
 */
const toolApproveRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();

	// GET /api/tools/approve — list pending approvals
	app.get(
		'/api/tools/approve',
		{
			preHandler: requireAuth('tools:approve')
		},
		async (request, reply) => {
			const orgId = resolveOrgId(request);
			const pending = Array.from(pendingApprovals.entries())
				.filter(([, data]) => (data.orgId ?? null) === orgId)
				.map(([id, data]) => ({
					toolCallId: id,
					toolName: data.toolName,
					args: data.args,
					sessionId: data.sessionId,
					createdAt: new Date(data.createdAt).toISOString(),
					age: Date.now() - data.createdAt
				}));

			return reply.send({ pending, count: pending.length });
		}
	);

	// POST /api/tools/approve — approve or reject a tool execution
	app.post(
		'/api/tools/approve',
		{
			schema: { body: ToolApproveBodySchema },
			preHandler: requireAuth('tools:approve')
		},
		async (request, reply) => {
			const { toolCallId, approved } = request.body;

			// Atomic get-and-delete to prevent double-approval race (S-10)
			const pending = pendingApprovals.get(toolCallId);
			const orgId = resolveOrgId(request);
			if (!pending || (pending.orgId ?? null) !== orgId) {
				return reply.code(404).send({
					error: 'No pending approval found for this tool call',
					code: 'NOT_FOUND'
				});
			}

			const toolDef = getToolDefinition(pending.toolName);

			fastify.log.info({ toolName: pending.toolName, approved, toolCallId }, 'approval decision');

			// Record server-side approval BEFORE removing from map.
			// If recordApproval throws, the entry stays in the map so
			// the caller can retry — prevents lost approvals.
			if (approved) {
				await recordApproval(toolCallId, pending.toolName);
			}

			// Only delete from map after successful recording
			pendingApprovals.delete(toolCallId);

			// Resolve the pending promise (now removed from map)
			pending.resolve(approved);

			return reply.send({
				success: true,
				approved,
				toolCallId,
				toolName: pending.toolName,
				category: toolDef?.category ?? 'unknown',
				message: approved ? 'Tool execution approved' : 'Tool execution rejected'
			});
		}
	);
};

export default toolApproveRoutes;
