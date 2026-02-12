import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { logToolExecution } from '@portal/server/audit';
import {
	getAllToolDefinitions,
	getToolsByCategory,
	getToolDefinition,
	requiresApproval,
	getToolWarning,
	executeTool
} from '@portal/shared/tools/index';
import { hasPermission, type Permission } from '@portal/server/auth/rbac';
import { createLogger } from '@portal/server/logger';
import { toPortalError } from '@portal/server/errors';
import { captureError } from '@portal/server/sentry';
import { toolExecutions, toolDuration } from '@portal/server/metrics';
import { requireAuth } from '../plugins/rbac.js';
import {
	V1ToolsQuerySchema,
	V1ToolNameParamsSchema,
	V1ToolExecuteBodySchema,
	type ToolCategory
} from './schemas.js';

const log = createLogger('api-v1-tools');

/**
 * REST API v1 tool routes.
 *
 * - GET    /api/v1/tools              — list all tools (with optional category filter)
 * - GET    /api/v1/tools/:name        — get single tool definition
 * - POST   /api/v1/tools/:name/execute — execute a tool (with confirmation flow)
 *
 * These routes use API key auth (Authorization: Bearer portal_xxx) or session auth.
 */
export async function v1ToolRoutes(app: FastifyInstance): Promise<void> {
	// GET /api/v1/tools — list all tool definitions
	app.get(
		'/api/v1/tools',
		{
			preHandler: requireAuth('tools:read'),
			schema: {
				querystring: V1ToolsQuerySchema
			}
		},
		async (request, reply) => {
			const { category } = request.query as z.infer<typeof V1ToolsQuerySchema>;

			const tools = category
				? getToolsByCategory(category as ToolCategory)
				: getAllToolDefinitions();

			const response = tools.map((t) => ({
				name: t.name,
				description: t.description,
				category: t.category,
				approvalLevel: t.approvalLevel
			}));

			log.debug({ category, count: response.length }, 'v1 listed tools');

			return reply.send({ tools: response, total: response.length });
		}
	);

	// GET /api/v1/tools/:name — get single tool definition
	app.get(
		'/api/v1/tools/:name',
		{
			preHandler: requireAuth('tools:read'),
			schema: {
				params: V1ToolNameParamsSchema
			}
		},
		async (request, reply) => {
			const { name } = request.params as z.infer<typeof V1ToolNameParamsSchema>;
			const toolDef = getToolDefinition(name);

			if (!toolDef) {
				return reply.status(404).send({
					error: 'Not Found',
					message: `Tool not found: ${name}`,
					statusCode: 404
				});
			}

			const warning = getToolWarning(name);

			log.debug({ toolName: name }, 'v1 tool definition retrieved');

			return reply.send({
				tool: {
					name: toolDef.name,
					description: toolDef.description,
					category: toolDef.category,
					approvalLevel: toolDef.approvalLevel,
					requiresApproval: requiresApproval(toolDef.approvalLevel),
					...(warning ? { warning: warning.warning, impact: warning.impact } : {})
				}
			});
		}
	);

	// POST /api/v1/tools/:name/execute — execute a tool
	app.post(
		'/api/v1/tools/:name/execute',
		{
			preHandler: requireAuth('tools:execute'),
			schema: {
				params: V1ToolNameParamsSchema,
				body: V1ToolExecuteBodySchema
			}
		},
		async (request, reply) => {
			const { name } = request.params as z.infer<typeof V1ToolNameParamsSchema>;
			const body = request.body as z.infer<typeof V1ToolExecuteBodySchema>;

			const toolDef = getToolDefinition(name);

			if (!toolDef) {
				return reply.status(404).send({
					error: 'Not Found',
					message: `Tool not found: ${name}`,
					statusCode: 404
				});
			}

			// Danger-level tools require tools:danger permission (checked BEFORE confirmation)
			if (toolDef.approvalLevel === 'danger') {
				const userPerms = request.permissions as Permission[];
				const apiKeyPerms = (request.apiKeyContext?.permissions as Permission[]) || [];
				const allPerms = [...userPerms, ...apiKeyPerms];

				if (!hasPermission(allPerms, 'tools:danger') && !hasPermission(allPerms, 'admin:all')) {
					return reply.status(403).send({
						error: 'Forbidden',
						message: 'Danger-level tools require tools:danger permission',
						statusCode: 403
					});
				}
			}

			// Tools requiring approval need explicit confirmation
			if (requiresApproval(toolDef.approvalLevel)) {
				const confirmedHeader = request.headers['x-confirm'] === 'true';
				const confirmedBody = body.confirmed === true;

				if (!confirmedHeader && !confirmedBody) {
					return reply.status(422).send({
						error: 'Confirmation Required',
						message: `Tool "${name}" requires confirmation. Set "confirmed": true in body or X-Confirm: true header.`,
						statusCode: 422,
						toolName: name,
						approvalLevel: toolDef.approvalLevel,
						requiresConfirmation: true
					});
				}
			}

			// Execute the tool
			const startTime = Date.now();
			const endTimer = toolDuration.startTimer({ tool: name, category: toolDef.category });

			try {
				const result = await executeTool(name, body.args);
				const duration = Date.now() - startTime;
				endTimer();

				const userId = request.user?.id;

				log.info({ toolName: name, duration, userId }, 'v1 tool executed');
				toolExecutions.inc({
					tool: name,
					category: toolDef.category,
					approval_level: toolDef.approvalLevel,
					status: 'success'
				});

				logToolExecution(
					name,
					toolDef.category,
					toolDef.approvalLevel,
					body.args,
					true,
					duration,
					undefined,
					undefined,
					userId
				);

				return reply.send({
					success: true,
					tool: name,
					data: result,
					duration,
					approvalLevel: toolDef.approvalLevel
				});
			} catch (error) {
				const duration = Date.now() - startTime;
				endTimer();
				const portalErr = toPortalError(error);

				log.error({ err: portalErr, toolName: name, duration }, 'v1 tool execution failed');
				captureError(portalErr, { toolName: name, duration });
				toolExecutions.inc({
					tool: name,
					category: toolDef.category,
					approval_level: toolDef.approvalLevel,
					status: 'error'
				});

				const userId = request.user?.id;

				logToolExecution(
					name,
					toolDef.category,
					toolDef.approvalLevel,
					body.args,
					false,
					duration,
					portalErr.message,
					undefined,
					userId
				);

				return reply.status(portalErr.statusCode).send({
					success: false,
					tool: name,
					error: portalErr.message,
					code: portalErr.code,
					duration,
					approvalLevel: toolDef.approvalLevel
				});
			}
		}
	);
}
