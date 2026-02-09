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
import { requireAuth } from '../plugins/rbac.js';

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
	app.post(
		'/api/mcp/tools/:name/execute',
		{
			preHandler: requireAuth('tools:execute'),
			schema: {
				params: z.object({ name: z.string() }),
				body: z.record(z.string(), z.unknown()).default({})
			}
		},
		async (request) => {
			const { name } = request.params;
			const args = request.body as Record<string, unknown>;
			const context = buildMCPContext(request, 'tools:execute');
			const result = await mcpServer.executeTool(name, args, context);
			return { result };
		}
	);

	// GET /api/mcp/resources — list MCP resources
	app.get(
		'/api/mcp/resources',
		{
			preHandler: requireAuth('tools:read')
		},
		async () => {
			return { resources: mcpServer.listResources() };
		}
	);

	// GET /api/mcp/resources/:uri — get a specific resource
	app.get(
		'/api/mcp/resources/:uri',
		{
			preHandler: requireAuth('tools:read'),
			schema: {
				params: z.object({ uri: z.string() })
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
