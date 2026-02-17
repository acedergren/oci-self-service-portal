import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, resolveOrgId } from '../../plugins/rbac.js';
import { mcpServerRepository } from '@portal/server/admin/mcp-repository.js';
import {
	CreateMcpServerInputSchema,
	UpdateMcpServerInputSchema,
	InstallFromCatalogInputSchema,
	SetCredentialInputSchema,
	TestToolInputSchema,
	McpServerSchema,
	McpCatalogItemSchema,
	CachedToolSchema,
	MetricsSummarySchema,
	type MetricsSummary
} from '@portal/server/admin/mcp-types.js';
import { mcpConnectionManager } from '../../services/mcp-connection-manager.js';
import { NotFoundError, ValidationError, toPortalError } from '@portal/server/errors.js';
import { createLogger } from '@portal/server/logger.js';

const log = createLogger('api:admin:mcp');

// ============================================================================
// Response Schemas
// ============================================================================

const McpServerListResponseSchema = z.object({
	servers: z.array(McpServerSchema.omit({ credentials: true }))
});

const McpCatalogResponseSchema = z.object({
	items: z.array(McpCatalogItemSchema)
});

const ConnectionStatusResponseSchema = z.object({
	status: z.enum(['connected', 'disconnected', 'error', 'connecting'])
});

const ToolListResponseSchema = z.object({
	tools: z.array(CachedToolSchema)
});

const ToolTestResponseSchema = z.object({
	result: z.unknown(),
	durationMs: z.number().int().nonnegative()
});

const HealthStatusResponseSchema = z.object({
	status: z.enum(['connected', 'disconnected', 'error', 'connecting']),
	tools: z.number().int().nonnegative(),
	uptime: z.number().int().nonnegative().optional(),
	lastError: z.string().optional()
});

// ============================================================================
// Admin MCP Routes
// ============================================================================

/**
 * Admin MCP management API routes.
 * All endpoints require admin:all permission.
 */
export async function mcpAdminRoutes(app: FastifyInstance): Promise<void> {
	// ========================================================================
	// CATALOG
	// ========================================================================

	/**
	 * GET /api/admin/mcp/catalog
	 * List all active catalog items for server installation.
	 */
	app.get(
		'/api/admin/mcp/catalog',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				response: {
					200: McpCatalogResponseSchema
				}
			}
		},
		async (_request, reply) => {
			try {
				const items = await mcpServerRepository.getCatalog();
				return reply.send({ items });
			} catch (err) {
				log.error({ err }, 'Failed to fetch catalog');
				throw toPortalError(err);
			}
		}
	);

	/**
	 * GET /api/admin/mcp/catalog/:catalogId
	 * Get a single catalog item by catalog_id.
	 */
	app.get(
		'/api/admin/mcp/catalog/:catalogId',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({
					catalogId: z.string().min(1)
				}),
				response: {
					200: McpCatalogItemSchema,
					404: z.object({ error: z.string(), statusCode: z.literal(404) })
				}
			}
		},
		async (request, reply) => {
			try {
				const { catalogId } = request.params as { catalogId: string };
				const item = await mcpServerRepository.getCatalogItem(catalogId);

				if (!item) {
					throw new NotFoundError(`Catalog item not found: ${catalogId}`);
				}

				return reply.send(item);
			} catch (err) {
				log.error(
					{ err, catalogId: (request.params as { catalogId: string }).catalogId },
					'Failed to fetch catalog item'
				);
				throw toPortalError(err);
			}
		}
	);

	// ========================================================================
	// SERVERS
	// ========================================================================

	/**
	 * GET /api/admin/mcp/servers
	 * List all MCP servers for the current organization (no credentials).
	 */
	app.get(
		'/api/admin/mcp/servers',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				response: {
					200: McpServerListResponseSchema
				}
			}
		},
		async (request, reply) => {
			try {
				const orgId = resolveOrgId(request);
				if (!orgId) {
					throw new ValidationError('Organization context required');
				}

				const servers = await mcpServerRepository.listByOrg(orgId);
				return reply.send({ servers });
			} catch (err) {
				log.error({ err }, 'Failed to list MCP servers');
				throw toPortalError(err);
			}
		}
	);

	/**
	 * GET /api/admin/mcp/servers/:id
	 * Get a single MCP server by ID (includes decrypted credentials).
	 */
	app.get(
		'/api/admin/mcp/servers/:id',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({
					id: z.string().uuid()
				}),
				response: {
					200: McpServerSchema,
					404: z.object({ error: z.string(), statusCode: z.literal(404) })
				}
			}
		},
		async (request, reply) => {
			try {
				const { id } = request.params as { id: string };
				const server = await mcpServerRepository.getById(id);

				if (!server) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				// Verify org ownership (IDOR prevention)
				const orgId = resolveOrgId(request);
				if (orgId && server.orgId !== orgId) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				return reply.send(server);
			} catch (err) {
				log.error(
					{ err, serverId: (request.params as { id: string }).id },
					'Failed to fetch MCP server'
				);
				throw toPortalError(err);
			}
		}
	);

	/**
	 * POST /api/admin/mcp/servers
	 * Create a custom MCP server.
	 */
	app.post(
		'/api/admin/mcp/servers',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				body: CreateMcpServerInputSchema,
				response: {
					201: McpServerSchema.omit({ credentials: true })
				}
			}
		},
		async (request, reply) => {
			try {
				const orgId = resolveOrgId(request);
				if (!orgId) {
					throw new ValidationError('Organization context required');
				}

				const input = request.body as z.infer<typeof CreateMcpServerInputSchema>;
				const server = await mcpServerRepository.create(orgId, input);

				log.info(
					{ serverId: server.id, serverName: server.serverName },
					'Created custom MCP server'
				);
				return reply.code(201).send(server);
			} catch (err) {
				log.error({ err }, 'Failed to create MCP server');
				throw toPortalError(err);
			}
		}
	);

	/**
	 * POST /api/admin/mcp/servers/install
	 * Install an MCP server from the catalog.
	 */
	app.post(
		'/api/admin/mcp/servers/install',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				body: InstallFromCatalogInputSchema,
				response: {
					201: McpServerSchema.omit({ credentials: true })
				}
			}
		},
		async (request, reply) => {
			try {
				const orgId = resolveOrgId(request);
				if (!orgId) {
					throw new ValidationError('Organization context required');
				}

				const input = request.body as z.infer<typeof InstallFromCatalogInputSchema>;
				const server = await mcpServerRepository.installFromCatalog(orgId, input);

				log.info(
					{ serverId: server.id, catalogItemId: input.catalogItemId },
					'Installed MCP server from catalog'
				);
				return reply.code(201).send(server);
			} catch (err) {
				log.error({ err }, 'Failed to install MCP server from catalog');
				throw toPortalError(err);
			}
		}
	);

	/**
	 * PUT /api/admin/mcp/servers/:id
	 * Update an existing MCP server.
	 */
	app.put(
		'/api/admin/mcp/servers/:id',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({
					id: z.string().uuid()
				}),
				body: UpdateMcpServerInputSchema,
				response: {
					200: McpServerSchema.omit({ credentials: true }),
					404: z.object({ error: z.string(), statusCode: z.literal(404) })
				}
			}
		},
		async (request, reply) => {
			try {
				const { id } = request.params as { id: string };
				const orgId = resolveOrgId(request);

				// Verify ownership
				const existing = await mcpServerRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}
				if (orgId && existing.orgId !== orgId) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				const input = request.body as z.infer<typeof UpdateMcpServerInputSchema>;
				const updated = await mcpServerRepository.update(id, input);

				log.info({ serverId: id }, 'Updated MCP server');
				return reply.send(updated); // nosemgrep: direct-response-write — Fastify JSON serialization, not DOM HTML
			} catch (err) {
				log.error(
					{ err, serverId: (request.params as { id: string }).id },
					'Failed to update MCP server'
				);
				throw toPortalError(err);
			}
		}
	);

	/**
	 * DELETE /api/admin/mcp/servers/:id
	 * Delete an MCP server (disconnects first if connected).
	 */
	app.delete(
		'/api/admin/mcp/servers/:id',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({
					id: z.string().uuid()
				}),
				response: {
					204: z.undefined(),
					404: z.object({ error: z.string(), statusCode: z.literal(404) })
				}
			}
		},
		async (request, reply) => {
			try {
				const { id } = request.params as { id: string };
				const orgId = resolveOrgId(request);

				// Verify ownership
				const existing = await mcpServerRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}
				if (orgId && existing.orgId !== orgId) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				// Disconnect if connected
				try {
					await mcpConnectionManager.disconnectServer(id);
				} catch (err) {
					log.warn({ err, serverId: id }, 'Error disconnecting server before delete (continuing)');
				}

				// Delete from DB
				const deleted = await mcpServerRepository.delete(id);
				if (!deleted) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				log.info({ serverId: id }, 'Deleted MCP server');
				return reply.code(204).send();
			} catch (err) {
				log.error(
					{ err, serverId: (request.params as { id: string }).id },
					'Failed to delete MCP server'
				);
				throw toPortalError(err);
			}
		}
	);

	// ========================================================================
	// CONNECTION
	// ========================================================================

	/**
	 * POST /api/admin/mcp/servers/:id/connect
	 * Connect to an MCP server.
	 */
	app.post(
		'/api/admin/mcp/servers/:id/connect',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({
					id: z.string().uuid()
				}),
				response: {
					200: ConnectionStatusResponseSchema,
					404: z.object({ error: z.string(), statusCode: z.literal(404) })
				}
			}
		},
		async (request, reply) => {
			try {
				const { id } = request.params as { id: string };
				const orgId = resolveOrgId(request);

				// Verify ownership
				const existing = await mcpServerRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}
				if (orgId && existing.orgId !== orgId) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				await mcpConnectionManager.connectServer(id);

				log.info({ serverId: id }, 'Connected to MCP server');
				return reply.send({ status: 'connected' });
			} catch (err) {
				log.error(
					{ err, serverId: (request.params as { id: string }).id },
					'Failed to connect to MCP server'
				);
				throw toPortalError(err);
			}
		}
	);

	/**
	 * POST /api/admin/mcp/servers/:id/disconnect
	 * Disconnect from an MCP server.
	 */
	app.post(
		'/api/admin/mcp/servers/:id/disconnect',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({
					id: z.string().uuid()
				}),
				response: {
					200: ConnectionStatusResponseSchema,
					404: z.object({ error: z.string(), statusCode: z.literal(404) })
				}
			}
		},
		async (request, reply) => {
			try {
				const { id } = request.params as { id: string };
				const orgId = resolveOrgId(request);

				// Verify ownership
				const existing = await mcpServerRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}
				if (orgId && existing.orgId !== orgId) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				await mcpConnectionManager.disconnectServer(id);

				log.info({ serverId: id }, 'Disconnected from MCP server');
				return reply.send({ status: 'disconnected' });
			} catch (err) {
				log.error(
					{ err, serverId: (request.params as { id: string }).id },
					'Failed to disconnect from MCP server'
				);
				throw toPortalError(err);
			}
		}
	);

	/**
	 * POST /api/admin/mcp/servers/:id/restart
	 * Restart an MCP server (disconnect then reconnect).
	 */
	app.post(
		'/api/admin/mcp/servers/:id/restart',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({
					id: z.string().uuid()
				}),
				response: {
					200: ConnectionStatusResponseSchema,
					404: z.object({ error: z.string(), statusCode: z.literal(404) })
				}
			}
		},
		async (request, reply) => {
			try {
				const { id } = request.params as { id: string };
				const orgId = resolveOrgId(request);

				// Verify ownership
				const existing = await mcpServerRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}
				if (orgId && existing.orgId !== orgId) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				await mcpConnectionManager.restartServer(id);

				log.info({ serverId: id }, 'Restarted MCP server');
				return reply.send({ status: 'connected' });
			} catch (err) {
				log.error(
					{ err, serverId: (request.params as { id: string }).id },
					'Failed to restart MCP server'
				);
				throw toPortalError(err);
			}
		}
	);

	// ========================================================================
	// CREDENTIALS
	// ========================================================================

	/**
	 * PUT /api/admin/mcp/servers/:id/credentials/:key
	 * Set (upsert) a credential for a server.
	 */
	app.put(
		'/api/admin/mcp/servers/:id/credentials/:key',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({
					id: z.string().uuid(),
					key: z.string().min(1)
				}),
				body: SetCredentialInputSchema,
				response: {
					204: z.undefined(),
					404: z.object({ error: z.string(), statusCode: z.literal(404) })
				}
			}
		},
		async (request, reply) => {
			try {
				const { id, key } = request.params as { id: string; key: string };
				const orgId = resolveOrgId(request);

				// Verify ownership
				const existing = await mcpServerRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}
				if (orgId && existing.orgId !== orgId) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				const input = request.body as z.infer<typeof SetCredentialInputSchema>;
				await mcpServerRepository.setCredential(id, key, input);

				log.info({ serverId: id, credentialKey: key }, 'Set MCP server credential');
				return reply.code(204).send();
			} catch (err) {
				log.error(
					{ err, serverId: (request.params as { id: string }).id },
					'Failed to set MCP server credential'
				);
				throw toPortalError(err);
			}
		}
	);

	/**
	 * DELETE /api/admin/mcp/servers/:id/credentials/:key
	 * Delete a credential from a server.
	 */
	app.delete(
		'/api/admin/mcp/servers/:id/credentials/:key',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({
					id: z.string().uuid(),
					key: z.string().min(1)
				}),
				response: {
					204: z.undefined(),
					404: z.object({ error: z.string(), statusCode: z.literal(404) })
				}
			}
		},
		async (request, reply) => {
			try {
				const { id, key } = request.params as { id: string; key: string };
				const orgId = resolveOrgId(request);

				// Verify ownership
				const existing = await mcpServerRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}
				if (orgId && existing.orgId !== orgId) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				await mcpServerRepository.deleteCredential(id, key);

				log.info({ serverId: id, credentialKey: key }, 'Deleted MCP server credential');
				return reply.code(204).send();
			} catch (err) {
				log.error(
					{ err, serverId: (request.params as { id: string }).id },
					'Failed to delete MCP server credential'
				);
				throw toPortalError(err);
			}
		}
	);

	// ========================================================================
	// TOOLS
	// ========================================================================

	/**
	 * GET /api/admin/mcp/servers/:id/tools
	 * List all tools for a server (live or cached).
	 */
	app.get(
		'/api/admin/mcp/servers/:id/tools',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({
					id: z.string().uuid()
				}),
				response: {
					200: ToolListResponseSchema,
					404: z.object({ error: z.string(), statusCode: z.literal(404) })
				}
			}
		},
		async (request, reply) => {
			try {
				const { id } = request.params as { id: string };
				const orgId = resolveOrgId(request);

				// Verify ownership
				const existing = await mcpServerRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}
				if (orgId && existing.orgId !== orgId) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				const tools = await mcpConnectionManager.listServerTools(id);
				return reply.send({ tools });
			} catch (err) {
				log.error(
					{ err, serverId: (request.params as { id: string }).id },
					'Failed to list MCP server tools'
				);
				throw toPortalError(err);
			}
		}
	);

	/**
	 * POST /api/admin/mcp/servers/:id/tools/:toolName/test
	 * Execute a tool on a server (for testing).
	 */
	app.post(
		'/api/admin/mcp/servers/:id/tools/:toolName/test',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({
					id: z.string().uuid(),
					toolName: z.string().min(1)
				}),
				body: TestToolInputSchema,
				response: {
					200: ToolTestResponseSchema,
					404: z.object({ error: z.string(), statusCode: z.literal(404) })
				}
			}
		},
		async (request, reply) => {
			try {
				const { id, toolName } = request.params as { id: string; toolName: string };
				const orgId = resolveOrgId(request);

				// Verify ownership
				const existing = await mcpServerRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}
				if (orgId && existing.orgId !== orgId) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				const input = request.body as z.infer<typeof TestToolInputSchema>;
				const { result, durationMs } = await mcpConnectionManager.executeToolOnServer(
					id,
					toolName,
					input.args
				);

				log.info({ serverId: id, toolName, durationMs }, 'Tested MCP tool');
				return reply.send({ result, durationMs });
			} catch (err) {
				log.error(
					{
						err,
						serverId: (request.params as { id: string }).id,
						toolName: (request.params as { toolName: string }).toolName
					},
					'Failed to test MCP tool'
				);
				throw toPortalError(err);
			}
		}
	);

	// ========================================================================
	// METRICS & HEALTH
	// ========================================================================

	/**
	 * GET /api/admin/mcp/servers/:id/metrics
	 * Get aggregated metrics for a server.
	 */
	app.get(
		'/api/admin/mcp/servers/:id/metrics',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({
					id: z.string().uuid()
				}),
				querystring: z.object({
					since: z.string().datetime().optional()
				}),
				response: {
					200: MetricsSummarySchema,
					404: z.object({ error: z.string(), statusCode: z.literal(404) })
				}
			}
		},
		async (request, reply) => {
			try {
				const { id } = request.params as { id: string };
				const { since } = request.query as { since?: string };
				const orgId = resolveOrgId(request);

				// Verify ownership
				const existing = await mcpServerRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}
				if (orgId && existing.orgId !== orgId) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				const sinceDate = since ? new Date(since) : undefined;
				const metrics: MetricsSummary = await mcpServerRepository.getMetrics(id, sinceDate);

				return reply.send(metrics);
			} catch (err) {
				log.error(
					{ err, serverId: (request.params as { id: string }).id },
					'Failed to fetch MCP server metrics'
				);
				throw toPortalError(err);
			}
		}
	);

	/**
	 * GET /api/admin/mcp/servers/:id/health
	 * Get health status for a server.
	 */
	app.get(
		'/api/admin/mcp/servers/:id/health',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({
					id: z.string().uuid()
				}),
				response: {
					200: HealthStatusResponseSchema,
					404: z.object({ error: z.string(), statusCode: z.literal(404) })
				}
			}
		},
		async (request, reply) => {
			try {
				const { id } = request.params as { id: string };
				const orgId = resolveOrgId(request);

				// Verify ownership
				const existing = await mcpServerRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}
				if (orgId && existing.orgId !== orgId) {
					throw new NotFoundError(`MCP server not found: ${id}`);
				}

				const health = await mcpConnectionManager.getServerHealth(id);
				return reply.send(health);
			} catch (err) {
				log.error(
					{ err, serverId: (request.params as { id: string }).id },
					'Failed to get MCP server health'
				);
				throw toPortalError(err);
			}
		}
	);
}
