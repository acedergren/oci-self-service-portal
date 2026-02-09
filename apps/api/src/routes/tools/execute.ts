import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ToolExecuteQuerySchema, ToolExecuteBodySchema } from '../schemas.js';
import {
	getToolDefinition,
	requiresApproval,
	getToolWarning,
	executeTool
} from '../../services/tools.js';
import { consumeApproval } from '../../services/approvals.js';
import { requireAuth } from '../../plugins/rbac.js';

/**
 * Tool execution route module.
 *
 * Registers:
 * - GET  /api/tools/execute?toolName=xxx — get approval requirements for a tool
 * - POST /api/tools/execute              — execute a tool (with approval verification)
 *
 * Requires authentication + `tools:execute` permission.
 */
const toolExecuteRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();

	// GET /api/tools/execute — get tool approval requirements
	app.get(
		'/api/tools/execute',
		{
			schema: { querystring: ToolExecuteQuerySchema },
			preHandler: requireAuth('tools:execute')
		},
		async (request, reply) => {
			const { toolName } = request.query;

			const toolDef = getToolDefinition(toolName);
			if (!toolDef) {
				return reply.code(404).send({
					error: `Unknown tool: ${toolName}`,
					code: 'NOT_FOUND'
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
			schema: { body: ToolExecuteBodySchema },
			preHandler: requireAuth('tools:execute')
		},
		async (request, reply) => {
			const { toolCallId, toolName, args } = request.body;

			const toolDef = getToolDefinition(toolName);
			if (!toolDef) {
				return reply.code(404).send({
					error: `Unknown tool: ${toolName}`,
					code: 'NOT_FOUND'
				});
			}

			const needsApproval = requiresApproval(toolDef.approvalLevel);

			// Verify server-side approval token if required
			if (needsApproval) {
				if (!toolCallId || !(await consumeApproval(toolCallId, toolName))) {
					return reply.code(403).send({
						error: 'Tool requires explicit approval via the approval endpoint',
						code: 'APPROVAL_REQUIRED',
						toolName,
						approvalLevel: toolDef.approvalLevel
					});
				}
			}

			const startTime = Date.now();

			try {
				const result = await executeTool(toolName, args);
				const duration = Date.now() - startTime;

				fastify.log.info({ toolName, duration }, 'tool executed');

				return reply.send({
					success: true,
					toolCallId,
					toolName,
					data: result,
					duration,
					approvalLevel: toolDef.approvalLevel
				});
			} catch (err) {
				const duration = Date.now() - startTime;

				// Log full error server-side; return generic message to client
				fastify.log.error({ err, toolName, duration }, 'tool execution failed');

				return reply.code(500).send({
					success: false,
					toolCallId,
					toolName,
					error: 'Tool execution failed',
					duration,
					approvalLevel: toolDef.approvalLevel
				});
			}
		}
	);
};

export default toolExecuteRoutes;
