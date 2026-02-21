/**
 * MCP (Model Context Protocol) routes — Fastify plugin.
 *
 * Exposes portal tools as MCP endpoints for external AI agent access.
 * All routes require authentication and tools:execute permission.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PortalMCPServer, type MCPAuthContext } from '../mastra/mcp/portal-mcp-server.js';
import { getToolDefinition } from '../mastra/tools/registry.js';
import { requireAuth } from '../plugins/rbac.js';
import { ValidationError } from '@portal/server/errors.js';

const mcpServer = new PortalMCPServer();

const mcpRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();

	/**
	 * Build MCP auth context from Fastify request user.
	 * Permissions are already enforced by the Fastify RBAC preHandler —
	 * the permissions array here is for the MCP server's defense-in-depth check.
	 */
	function buildMCPContext(
		request: { user?: { id: string } | null; session?: Record<string, unknown> | null },
		verifiedPermission: string
	): MCPAuthContext | undefined {
		if (!request.user) return undefined;
		const orgId = (request.session?.activeOrganizationId as string | undefined) ?? '';
		return {
			userId: request.user.id,
			orgId,
			permissions: [verifiedPermission]
		};
	}

	// GET /api/mcp/tools — list all MCP tools
	app.get(
		'/api/mcp/tools',
		{
			preHandler: requireAuth('tools:read')
		},
		async () => {
			return { tools: mcpServer.listTools() };
		}
	);

	// POST /api/mcp/tools/:name/execute — execute a tool
	// Body is validated per-tool: the :name param is used to look up the tool's
	// Zod schema from the registry and validate the args at the route level.
	app.post(
		'/api/mcp/tools/:name/execute',
		{
			preHandler: requireAuth('tools:execute'),
			schema: {
				params: z.object({
					name: z
						.string()
						.min(1)
						.max(200)
						.regex(
							/^[a-zA-Z0-9_.-]+$/,
							'Tool name must contain only letters, digits, hyphens, dots, and underscores'
						)
				}),
				body: z
					.record(z.string().max(100), z.unknown())
					.default({})
					.refine((obj) => Object.keys(obj).length <= 30, 'Too many arguments (max 30)')
			}
		},
		async (request, reply) => {
			const { name } = request.params;
			const args = request.body as Record<string, unknown>;

			// Per-tool argument validation using the tool's registered Zod schema
			const toolDef = getToolDefinition(name);
			if (!toolDef) {
				return reply.code(404).send({
					error: `Unknown MCP tool: ${name}`,
					code: 'NOT_FOUND'
				});
			}

			const parseResult = toolDef.parameters.safeParse(args);
			if (!parseResult.success) {
				throw new ValidationError(`Invalid arguments for tool '${name}'`, {
					issues: parseResult.error.issues
				});
			}

			const context = buildMCPContext(request, 'tools:execute');
			const result = await mcpServer.executeTool(
				name,
				parseResult.data as Record<string, unknown>,
				context
			);
			return { result };
		}
	);

	// GET /api/mcp/resources — list MCP resources
	app.get(
		'/api/mcp/resources',
		{
			preHandler: requireAuth('tools:read'),
			schema: {
				querystring: z.object({
					type: z.enum(['tool', 'prompt', 'resource']).optional(),
					limit: z.coerce.number().int().min(1).max(100).default(50)
				})
			}
		},
		async () => {
			return { resources: mcpServer.listResources() };
		}
	);

	// GET /api/mcp/resources/:uri — get a specific resource
	// URI param is validated to reject path traversal, null bytes, and other injection attempts.
	app.get(
		'/api/mcp/resources/:uri',
		{
			preHandler: requireAuth('tools:read'),
			schema: {
				params: z.object({
					uri: z
						.string()
						.min(1)
						.max(500)
						.refine(
							(val) => !val.includes('..') && !val.includes('\0'),
							'URI must not contain path traversal sequences or null bytes'
						)
						.refine(
							(val) => /^[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/.test(val),
							'URI contains invalid characters'
						)
				})
			}
		},
		async (request) => {
			const { uri } = request.params;
			const decodedUri = decodeURIComponent(uri);
			const context = buildMCPContext(request, 'tools:read');
			return mcpServer.getResource(decodedUri, context);
		}
	);
};

export default mcpRoutes;
