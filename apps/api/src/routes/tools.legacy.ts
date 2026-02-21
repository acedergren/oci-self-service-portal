// LEGACY — superseded by routes/tools/ (execute.ts + approve.ts).
// Safe to delete after confirming no production traffic relies on this registration.
// Removed from app.ts registration on 2026-02-20.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { logToolExecution, logToolApproval } from '@portal/server/audit';
import {
	getToolDefinition,
	requiresApproval,
	getToolWarning,
	executeTool
} from '@portal/shared/tools/index';
import { consumeApproval, pendingApprovals, recordApproval } from '@portal/server/approvals';
import { createLogger } from '@portal/server/logger';
import { toPortalError } from '@portal/server/errors';
import { captureError } from '@portal/server/sentry';
import { toolExecutions, toolDuration } from '@portal/server/metrics';
import { requireAuth, resolveOrgId } from '../plugins/rbac.js';

const log = createLogger('api-tools');

// Request schemas
const ExecuteToolBodySchema = z.object({
	toolCallId: z.string().optional(),
	toolName: z.string().min(1),
	args: z.record(z.string(), z.unknown()),
	sessionId: z.string().optional()
});

const ApproveToolBodySchema = z.object({
	toolCallId: z.string().min(1),
	approved: z.boolean(),
	reason: z.string().optional()
});

const ToolNameQuerySchema = z.object({
	toolName: z.string().min(1)
});

/**
 * Tool execution and approval routes.
 *
 * - GET    /api/tools/execute?toolName=xxx — approval requirements for a tool
 * - POST   /api/tools/execute              — execute a tool
 * - GET    /api/tools/approve              — list pending approvals
 * - POST   /api/tools/approve              — approve/reject a tool execution
 */
export async function toolRoutes(app: FastifyInstance): Promise<void> {
	// GET /api/tools/execute?toolName=xxx — get approval requirements
	app.get(
		'/api/tools/execute',
		{
			preHandler: requireAuth('tools:execute'),
			schema: {
				querystring: ToolNameQuerySchema
			}
		},
		async (request, reply) => {
			const { toolName } = request.query as z.infer<typeof ToolNameQuerySchema>;
			const toolDef = getToolDefinition(toolName);

			if (!toolDef) {
				return reply.status(404).send({
					error: 'Not Found',
					message: `Unknown tool: ${toolName}`,
					statusCode: 404
				});
			}

			const warning = getToolWarning(toolName);
			const needsApproval = requiresApproval(toolDef.approvalLevel);

			return reply.send({
				toolName,
				category: toolDef.category,
				approvalLevel: toolDef.approvalLevel,
				requiresApproval: needsApproval,
				warning: warning?.warning,
				impact: warning?.impact,
				description: toolDef.description
			});
		}
	);

	// POST /api/tools/execute — execute a tool
	app.post(
		'/api/tools/execute',
		{
			preHandler: requireAuth('tools:execute'),
			schema: {
				body: ExecuteToolBodySchema
			}
		},
		async (request, reply) => {
			const { toolCallId, toolName, args, sessionId } = request.body as z.infer<
				typeof ExecuteToolBodySchema
			>;

			const toolDef = getToolDefinition(toolName);
			if (!toolDef) {
				return reply.status(404).send({
					error: 'Not Found',
					message: `Unknown tool: ${toolName}`,
					statusCode: 404
				});
			}

			const needsApproval = requiresApproval(toolDef.approvalLevel);

			// If tool requires approval, verify server-side approval record
			if (needsApproval) {
				if (!toolCallId || !(await consumeApproval(toolCallId, toolName))) {
					logToolApproval(
						toolName,
						toolDef.category,
						toolDef.approvalLevel,
						args,
						false,
						sessionId
					);
					return reply.status(403).send({
						error: 'Forbidden',
						message: 'Tool requires explicit approval via the approval endpoint',
						statusCode: 403
					});
				}
				logToolApproval(toolName, toolDef.category, toolDef.approvalLevel, args, true, sessionId);
			}

			// Execute the tool
			const startTime = Date.now();
			const endTimer = toolDuration.startTimer({ tool: toolName, category: toolDef.category });

			try {
				const result = await executeTool(toolName, args);
				const duration = Date.now() - startTime;
				endTimer();

				log.info({ toolName, duration }, 'tool executed');
				toolExecutions.inc({
					tool: toolName,
					category: toolDef.category,
					approval_level: toolDef.approvalLevel,
					status: 'success'
				});

				logToolExecution(
					toolName,
					toolDef.category,
					toolDef.approvalLevel,
					args,
					true,
					duration,
					undefined,
					sessionId
				);

				return reply.send({
					success: true,
					toolCallId,
					toolName,
					data: result,
					duration,
					approvalLevel: toolDef.approvalLevel
				});
			} catch (error) {
				const duration = Date.now() - startTime;
				endTimer();
				const portalErr = toPortalError(error);

				log.error({ err: portalErr, toolName, duration }, 'tool execution failed');
				captureError(portalErr, { toolName, duration });
				toolExecutions.inc({
					tool: toolName,
					category: toolDef.category,
					approval_level: toolDef.approvalLevel,
					status: 'error'
				});

				logToolExecution(
					toolName,
					toolDef.category,
					toolDef.approvalLevel,
					args,
					false,
					duration,
					portalErr.message,
					sessionId
				);

				return reply.status(portalErr.statusCode).send({
					success: false,
					toolCallId,
					toolName,
					error: portalErr.message,
					code: portalErr.code,
					duration,
					approvalLevel: toolDef.approvalLevel
				});
			}
		}
	);

	// GET /api/tools/approve — list pending approvals (scoped to caller's org)
	app.get(
		'/api/tools/approve',
		{ preHandler: requireAuth('tools:approve') },
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

	// POST /api/tools/approve — approve/reject a tool execution
	app.post(
		'/api/tools/approve',
		{
			preHandler: requireAuth('tools:approve'),
			schema: {
				body: ApproveToolBodySchema
			}
		},
		async (request, reply) => {
			const { toolCallId, approved } = request.body as z.infer<typeof ApproveToolBodySchema>;

			const pending = pendingApprovals.get(toolCallId);
			const orgId = resolveOrgId(request);
			if (!pending || (pending.orgId ?? null) !== orgId) {
				return reply.status(404).send({
					error: 'Not Found',
					message: 'No pending approval found for this tool call',
					statusCode: 404
				});
			}

			const toolDef = getToolDefinition(pending.toolName);

			logToolApproval(
				pending.toolName,
				toolDef?.category || 'unknown',
				toolDef?.approvalLevel || 'confirm',
				pending.args,
				approved,
				pending.sessionId
			);

			log.info({ toolName: pending.toolName, approved, toolCallId }, 'approval decision');

			if (approved) {
				await recordApproval(toolCallId, pending.toolName);
			}

			pending.resolve(approved);
			pendingApprovals.delete(toolCallId);

			return reply.send({
				success: true,
				approved,
				toolCallId,
				message: approved ? 'Tool execution approved' : 'Tool execution rejected'
			});
		}
	);
}
