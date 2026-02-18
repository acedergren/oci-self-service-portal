/**
 * MCP Server repository — Oracle ADB CRUD for MCP server management.
 *
 * Follows the patterns established in ai-provider-repository.ts:
 * - Oracle UPPERCASE row interfaces
 * - rowToEntity() converters with JSON.parse for CLOB columns
 * - withConnection() wrapper for all operations
 * - Bind variables only (never string interpolation for data)
 * - Encrypted credentials using crypto.ts (AES-256-GCM)
 *
 * Security:
 * - Credentials encrypted at rest in Oracle (3 columns: _enc, _iv, _tag)
 * - Decryption only on explicit getById() or getDecryptedCredentials()
 * - List operations never expose credentials
 * - Fire-and-forget pattern for metrics (separate withConnection)
 */

import { withConnection } from '../oracle/connection.js';
import { encryptSecret, decryptSecret } from '../auth/crypto.js';
import { createLogger } from '../logger.js';
import { ValidationError } from '../errors.js';
import type {
	McpCatalogItem,
	McpServer,
	CreateMcpServerInput,
	UpdateMcpServerInput,
	InstallFromCatalogInput,
	SetCredentialInput,
	DecryptedCredential,
	CachedTool,
	CachedResource,
	ToolCallMetric,
	MetricsSummary,
	McpCatalogRow,
	McpServerRow,
	McpCredentialRow,
	McpToolCacheRow,
	McpResourceCacheRow,
	InvalidMcpServerRecord
} from './mcp-types.js';
import {
	catalogRowToItem,
	serverRowToServer,
	toolCacheRowToTool,
	resourceCacheRowToResource
} from './mcp-types.js';

const log = createLogger('mcp-repository');

type ServerListResult = {
	servers: Omit<McpServer, 'credentials'>[];
	invalidServers: InvalidMcpServerRecord[];
};

function mapServers(
	rows: McpServerRow[],
	context: { source: string; orgId?: string }
): ServerListResult {
	const servers: Omit<McpServer, 'credentials'>[] = [];
	const invalidServers: InvalidMcpServerRecord[] = [];

	for (const row of rows) {
		const parsed = serverRowToServer(row, log);
		if (parsed.server) {
			servers.push(parsed.server);
			continue;
		}

		if (parsed.invalid) {
			invalidServers.push(parsed.invalid);
			log.warn(
				{ invalid: parsed.invalid, source: context.source, orgId: context.orgId },
				'Skipping MCP server due to invalid JSON'
			);
		}
	}

	return { servers, invalidServers };
}

// ============================================================================
// MCP Server Repository
// ============================================================================

export const mcpServerRepository = {
	// ========================================================================
	// Catalog Operations
	// ========================================================================

	/**
	 * Get all active catalog items ordered by sort_order.
	 * Use for catalog browsing UI.
	 */
	async getCatalog(): Promise<McpCatalogItem[]> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<McpCatalogRow>(
				`SELECT * FROM mcp_catalog
				 WHERE status = 'active'
				 ORDER BY sort_order, display_name`,
				[],
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		return rows.map((row) => catalogRowToItem(row));
	},

	/**
	 * Get single catalog item by catalog_id (not PK).
	 * Returns undefined if not found.
	 */
	async getCatalogItem(catalogId: string): Promise<McpCatalogItem | undefined> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<McpCatalogRow>(
				`SELECT * FROM mcp_catalog WHERE catalog_id = :catalogId`,
				{ catalogId },
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		if (rows.length === 0) return undefined;
		return catalogRowToItem(rows[0]);
	},

	// ========================================================================
	// Server Operations (org-scoped)
	// ========================================================================

	/**
	 * List all enabled MCP servers that were connected (or connecting) at last shutdown.
	 * Used by MCPConnectionManager.initialize() to reconnect servers on startup.
	 *
	 * Paginated to handle large deployments gracefully.
	 * Returns servers ordered by org_id, sort_order for deterministic reconnect order.
	 *
	 * @param options.limit  Max rows per page (default 100, max 500)
	 * @param options.offset Row offset for pagination (default 0)
	 */
	async listAllConnected(options?: { limit?: number; offset?: number }): Promise<ServerListResult> {
		const limit = Math.min(options?.limit ?? 100, 500);
		const offset = options?.offset ?? 0;

		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<McpServerRow>(
				`SELECT
					s.*,
					COALESCE(COUNT(t.id), 0) as TOOL_COUNT
				 FROM mcp_servers s
				 LEFT JOIN mcp_tool_cache t ON t.server_id = s.id
				 WHERE s.status IN ('connected', 'connecting')
				   AND s.enabled = 1
				 GROUP BY s.id, s.org_id, s.server_name, s.display_name, s.description,
				          s.server_type, s.transport_type, s.catalog_item_id, s.config,
				          s.docker_image, s.docker_container_id, s.docker_status,
				          s.status, s.enabled, s.last_connected_at, s.last_error,
				          s.health_status, s.tags, s.sort_order, s.created_at, s.updated_at
				 ORDER BY s.org_id, s.sort_order, s.display_name
				 OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
				{ offset, limit },
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		return mapServers(rows ?? [], { source: 'listAllConnected' });
	},

	/**
	 * List all MCP servers for an organization — NO decrypted credentials.
	 * Includes tool_count via LEFT JOIN to mcp_tool_cache.
	 */
	async listByOrg(orgId: string): Promise<ServerListResult> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<McpServerRow>(
				`SELECT
					s.*,
					COALESCE(COUNT(t.id), 0) as TOOL_COUNT
				 FROM mcp_servers s
				 LEFT JOIN mcp_tool_cache t ON t.server_id = s.id
				 WHERE s.org_id = :orgId
				 GROUP BY s.id, s.org_id, s.server_name, s.display_name, s.description,
				          s.server_type, s.transport_type, s.catalog_item_id, s.config,
				          s.docker_image, s.docker_container_id, s.docker_status,
				          s.status, s.enabled, s.last_connected_at, s.last_error,
				          s.health_status, s.tags, s.sort_order, s.created_at, s.updated_at
				 ORDER BY s.sort_order, s.display_name`,
				{ orgId },
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		return mapServers(rows ?? [], { source: 'listByOrg', orgId });
	},

	/**
	 * Get single MCP server by ID — includes decrypted credentials.
	 * Returns undefined if not found.
	 */
	async getById(id: string): Promise<McpServer | undefined> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<McpServerRow>(
				`SELECT
					s.*,
					COALESCE(COUNT(t.id), 0) as TOOL_COUNT
				 FROM mcp_servers s
				 LEFT JOIN mcp_tool_cache t ON t.server_id = s.id
				 WHERE s.id = :id
				 GROUP BY s.id, s.org_id, s.server_name, s.display_name, s.description,
				          s.server_type, s.transport_type, s.catalog_item_id, s.config,
				          s.docker_image, s.docker_container_id, s.docker_status,
				          s.status, s.enabled, s.last_connected_at, s.last_error,
				          s.health_status, s.tags, s.sort_order, s.created_at, s.updated_at`,
				{ id },
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		if (rows.length === 0) return undefined;

		const parsed = serverRowToServer(rows[0], log);
		if (!parsed.server) {
			const detail = parsed.invalid;
			log.warn({ invalid: detail, id }, 'Failed to load MCP server due to invalid JSON');
			throw new ValidationError('Invalid MCP server record', {
				id,
				field: detail.field,
				reason: detail.reason
			});
		}

		// Build base server without credentials
		const server = parsed.server;

		// Fetch and decrypt credentials
		const credentials = await this.getDecryptedCredentials(id);

		return {
			...server,
			credentials
		};
	},

	/**
	 * Create new MCP server.
	 * Returns created entity WITHOUT credentials.
	 */
	async create(
		orgId: string,
		input: CreateMcpServerInput
	): Promise<Omit<McpServer, 'credentials'>> {
		const id = crypto.randomUUID();

		await withConnection(async (conn) => {
			await conn.execute(
				`INSERT INTO mcp_servers
					(id, org_id, server_name, display_name, description,
					 server_type, transport_type, config,
					 docker_image, tags, sort_order, status)
				 VALUES
					(:id, :orgId, :serverName, :displayName, :description,
					 :serverType, :transportType, :config,
					 :dockerImage, :tags, :sortOrder, 'disconnected')`,
				{
					id,
					orgId,
					serverName: input.serverName,
					displayName: input.displayName,
					description: input.description ?? null,
					serverType: input.serverType,
					transportType: input.transportType,
					config: JSON.stringify(input.config),
					dockerImage: input.dockerImage ?? null,
					tags: input.tags ? JSON.stringify(input.tags) : null,
					sortOrder: input.sortOrder ?? 0
				},
				{ autoCommit: true }
			);
		});

		// Fetch and return
		const created = await this.getById(id);
		if (!created) throw new Error(`Failed to retrieve created MCP server ${id}`);

		// Return without credentials
		const { credentials: _credentials, ...serverWithoutCreds } = created;
		return serverWithoutCreds;
	},

	/**
	 * Install MCP server from catalog.
	 * Fetches catalog item, creates server, encrypts and stores credentials.
	 * Returns created server WITHOUT credentials.
	 */
	async installFromCatalog(
		orgId: string,
		input: InstallFromCatalogInput
	): Promise<Omit<McpServer, 'credentials'>> {
		// Fetch catalog item
		const catalogItem = await withConnection(async (conn) => {
			const result = await conn.execute<McpCatalogRow>(
				`SELECT * FROM mcp_catalog WHERE id = :id`,
				{ id: input.catalogItemId },
				{ outFormat: conn.OBJECT }
			);
			return result.rows?.[0];
		});

		if (!catalogItem) {
			throw new Error(`Catalog item not found: ${input.catalogItemId}`);
		}

		const item = catalogRowToItem(catalogItem);

		// Create server from catalog defaults
		const server = await this.create(orgId, {
			serverName: input.serverName,
			displayName: input.displayName ?? item.displayName,
			serverType: 'catalog',
			transportType: item.defaultConfig.transport ?? 'stdio',
			config: item.defaultConfig,
			dockerImage: item.dockerImage ?? undefined,
			tags: item.tags,
			sortOrder: 0
		});

		// Encrypt and store credentials
		if (input.credentials) {
			for (const [key, value] of Object.entries(input.credentials)) {
				// Find credential metadata from catalog item
				const credReq = item.requiredCredentials.find((r) => r.key === key);
				if (!credReq) {
					log.warn({ serverId: server.id, key }, 'Unknown credential key for catalog item');
					continue;
				}

				await this.setCredential(server.id, key, {
					value,
					displayName: credReq.displayName,
					credentialType: credReq.type
				});
			}
		}

		// Return without credentials (already excluded by create() method)
		return server;
	},

	/**
	 * Update existing MCP server — only updates provided fields.
	 * Returns updated entity WITHOUT credentials.
	 */
	async update(id: string, input: UpdateMcpServerInput): Promise<Omit<McpServer, 'credentials'>> {
		// Fetch existing to verify it exists
		const existing = await this.getById(id);
		if (!existing) {
			throw new Error(`MCP server not found: ${id}`);
		}

		// Build SET clause dynamically based on provided fields
		const setClauses: string[] = [];
		const binds: Record<string, unknown> = { id };

		// Always update timestamp
		setClauses.push('updated_at = SYSTIMESTAMP');

		// Simple fields
		if (input.displayName !== undefined) {
			setClauses.push('display_name = :displayName');
			binds.displayName = input.displayName;
		}
		if (input.description !== undefined) {
			setClauses.push('description = :description');
			binds.description = input.description ?? null;
		}
		if (input.serverType !== undefined) {
			setClauses.push('server_type = :serverType');
			binds.serverType = input.serverType;
		}
		if (input.transportType !== undefined) {
			setClauses.push('transport_type = :transportType');
			binds.transportType = input.transportType;
		}
		if (input.config !== undefined) {
			setClauses.push('config = :config');
			binds.config = JSON.stringify(input.config);
		}
		if (input.dockerImage !== undefined) {
			setClauses.push('docker_image = :dockerImage');
			binds.dockerImage = input.dockerImage ?? null;
		}
		if (input.tags !== undefined) {
			setClauses.push('tags = :tags');
			binds.tags = input.tags ? JSON.stringify(input.tags) : null;
		}
		if (input.sortOrder !== undefined) {
			setClauses.push('sort_order = :sortOrder');
			binds.sortOrder = input.sortOrder;
		}

		if (setClauses.length === 1) {
			// Only timestamp update — no-op
			const { credentials: _credentials, ...serverWithoutCreds } = existing;
			return serverWithoutCreds;
		}

		await withConnection(async (conn) => {
			await conn.execute(`UPDATE mcp_servers SET ${setClauses.join(', ')} WHERE id = :id`, binds, {
				autoCommit: true
			});
		});

		// Fetch and return updated
		const updated = await this.getById(id);
		if (!updated) throw new Error(`Failed to retrieve updated MCP server ${id}`);

		const { credentials: _credentials, ...serverWithoutCreds } = updated;
		return serverWithoutCreds;
	},

	/**
	 * Delete MCP server by ID.
	 * CASCADE handles deletion of credentials, tools, resources, metrics.
	 * Returns true if deleted, false if not found.
	 */
	async delete(id: string): Promise<boolean> {
		const result = await withConnection(async (conn) => {
			const res = await conn.execute(
				`DELETE FROM mcp_servers WHERE id = :id`,
				{ id },
				{ autoCommit: true }
			);
			return res.rowsAffected ?? 0;
		});

		return result > 0;
	},

	/**
	 * Update server status and error message.
	 * Fire-and-forget style (does not return updated entity).
	 */
	async updateStatus(id: string, status: string, error?: string): Promise<void> {
		await withConnection(async (conn) => {
			await conn.execute(
				`UPDATE mcp_servers
				 SET status = :status,
				     last_error = :lastError,
				     last_connected_at = CASE WHEN :status = 'connected' THEN SYSTIMESTAMP ELSE last_connected_at END,
				     updated_at = SYSTIMESTAMP
				 WHERE id = :id`,
				{
					id,
					status,
					lastError: error ?? null
				},
				{ autoCommit: true }
			);
		});
	},

	/**
	 * Update Docker container information.
	 * Fire-and-forget style.
	 */
	async updateDockerInfo(
		id: string,
		containerId: string | null,
		dockerStatus: string
	): Promise<void> {
		await withConnection(async (conn) => {
			await conn.execute(
				`UPDATE mcp_servers
				 SET docker_container_id = :containerId,
				     docker_status = :dockerStatus,
				     updated_at = SYSTIMESTAMP
				 WHERE id = :id`,
				{
					id,
					containerId,
					dockerStatus
				},
				{ autoCommit: true }
			);
		});
	},

	// ========================================================================
	// Credential Operations (encrypted)
	// ========================================================================

	/**
	 * Set (upsert) a single credential for a server.
	 * Encrypts value before storing using AES-256-GCM.
	 */
	async setCredential(serverId: string, key: string, input: SetCredentialInput): Promise<void> {
		const id = crypto.randomUUID();
		const { encrypted, iv, tag } = await encryptSecret(input.value);

		await withConnection(async (conn) => {
			// MERGE INTO for upsert
			await conn.execute(
				`MERGE INTO mcp_server_credentials dst
				 USING (SELECT :serverId as SERVER_ID, :key as CREDENTIAL_KEY FROM dual) src
				 ON (dst.server_id = src.SERVER_ID AND dst.credential_key = src.CREDENTIAL_KEY)
				 WHEN MATCHED THEN
				   UPDATE SET
				     value_enc = :valueEnc,
				     value_iv = :valueIv,
				     value_tag = :valueTag,
				     display_name = :displayName,
				     credential_type = :credentialType,
				     updated_at = SYSTIMESTAMP
				 WHEN NOT MATCHED THEN
				   INSERT (id, server_id, credential_key, display_name, value_enc, value_iv, value_tag, credential_type)
				   VALUES (:id, :serverId, :key, :displayName, :valueEnc, :valueIv, :valueTag, :credentialType)`,
				{
					id,
					serverId,
					key,
					displayName: input.displayName ?? key,
					valueEnc: encrypted,
					valueIv: iv,
					valueTag: tag,
					credentialType: input.credentialType
				},
				{ autoCommit: true }
			);
		});
	},

	/**
	 * Delete a single credential by key.
	 */
	async deleteCredential(serverId: string, key: string): Promise<void> {
		await withConnection(async (conn) => {
			await conn.execute(
				`DELETE FROM mcp_server_credentials
				 WHERE server_id = :serverId AND credential_key = :key`,
				{ serverId, key },
				{ autoCommit: true }
			);
		});
	},

	/**
	 * Get all decrypted credentials for a server.
	 * Handles decrypt failures gracefully (logs warning, skips credential).
	 */
	async getDecryptedCredentials(serverId: string): Promise<DecryptedCredential[]> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<McpCredentialRow>(
				`SELECT * FROM mcp_server_credentials WHERE server_id = :serverId`,
				{ serverId },
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		const credentials: DecryptedCredential[] = [];

		for (const row of rows) {
			try {
				const value = await decryptSecret(row.VALUE_ENC, row.VALUE_IV, row.VALUE_TAG);
				credentials.push({
					key: row.CREDENTIAL_KEY,
					displayName: row.DISPLAY_NAME,
					value,
					type: row.CREDENTIAL_TYPE
				});
			} catch (err) {
				log.warn(
					{
						serverId,
						credentialKey: row.CREDENTIAL_KEY,
						error: err instanceof Error ? err.message : 'Unknown error'
					},
					'Failed to decrypt credential — skipping'
				);
				// Skip this credential, continue with others
			}
		}

		return credentials;
	},

	// ========================================================================
	// Tool/Resource Cache Operations
	// ========================================================================

	/**
	 * Replace all tools for a server (DELETE + INSERT in same transaction).
	 */
	async cacheTools(
		serverId: string,
		tools: Omit<CachedTool, 'id' | 'serverId' | 'discoveredAt'>[]
	): Promise<void> {
		await withConnection(async (conn) => {
			// Delete existing tools
			await conn.execute(
				`DELETE FROM mcp_tool_cache WHERE server_id = :serverId`,
				{ serverId },
				{ autoCommit: false }
			);

			// Insert new tools
			for (const tool of tools) {
				const id = crypto.randomUUID();
				await conn.execute(
					`INSERT INTO mcp_tool_cache
						(id, server_id, tool_name, tool_description, input_schema)
					 VALUES
						(:id, :serverId, :toolName, :toolDescription, :inputSchema)`,
					{
						id,
						serverId,
						toolName: tool.toolName,
						toolDescription: tool.toolDescription,
						inputSchema: JSON.stringify(tool.inputSchema)
					},
					{ autoCommit: false }
				);
			}

			await conn.commit();
		});
	},

	/**
	 * Get all cached tools for a server, ordered by tool_name.
	 */
	async getCachedTools(serverId: string): Promise<CachedTool[]> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<McpToolCacheRow>(
				`SELECT * FROM mcp_tool_cache
				 WHERE server_id = :serverId
				 ORDER BY tool_name`,
				{ serverId },
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		return rows.map((row) => toolCacheRowToTool(row));
	},

	/**
	 * Replace all resources for a server (DELETE + INSERT in same transaction).
	 */
	async cacheResources(
		serverId: string,
		resources: Omit<CachedResource, 'id' | 'serverId' | 'discoveredAt'>[]
	): Promise<void> {
		await withConnection(async (conn) => {
			// Delete existing resources
			await conn.execute(
				`DELETE FROM mcp_resource_cache WHERE server_id = :serverId`,
				{ serverId },
				{ autoCommit: false }
			);

			// Insert new resources
			for (const resource of resources) {
				const id = crypto.randomUUID();
				await conn.execute(
					`INSERT INTO mcp_resource_cache
						(id, server_id, resource_uri, resource_name, description, mime_type)
					 VALUES
						(:id, :serverId, :resourceUri, :resourceName, :description, :mimeType)`,
					{
						id,
						serverId,
						resourceUri: resource.resourceUri,
						resourceName: resource.resourceName,
						description: resource.description ?? null,
						mimeType: resource.mimeType ?? null
					},
					{ autoCommit: false }
				);
			}

			await conn.commit();
		});
	},

	/**
	 * Get all cached resources for a server, ordered by resource_name.
	 */
	async getCachedResources(serverId: string): Promise<CachedResource[]> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<McpResourceCacheRow>(
				`SELECT * FROM mcp_resource_cache
				 WHERE server_id = :serverId
				 ORDER BY resource_name`,
				{ serverId },
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		return rows.map((row) => resourceCacheRowToResource(row));
	},

	// ========================================================================
	// Metrics Operations
	// ========================================================================

	/**
	 * Record a tool call metric.
	 * Fire-and-forget style — uses separate withConnection, logs errors but doesn't throw.
	 */
	async recordToolCall(params: ToolCallMetric): Promise<void> {
		try {
			await withConnection(async (conn) => {
				const id = crypto.randomUUID();
				await conn.execute(
					`INSERT INTO mcp_server_metrics
						(id, server_id, org_id, tool_name, duration_ms, success, error_message)
					 VALUES
						(:id, :serverId, :orgId, :toolName, :durationMs, :success, :errorMessage)`,
					{
						id,
						serverId: params.serverId,
						orgId: params.orgId,
						toolName: params.toolName,
						durationMs: params.durationMs,
						success: params.success ? 1 : 0,
						errorMessage: params.errorMessage ?? null
					},
					{ autoCommit: true }
				);
			});
		} catch (err) {
			log.error(
				{
					err,
					serverId: params.serverId,
					toolName: params.toolName
				},
				'Failed to record tool call metric'
			);
			// Don't throw — fire-and-forget
		}
	},

	/**
	 * Get aggregated metrics for a server, optionally filtered by time.
	 * Returns per-tool breakdown with success rate.
	 */
	async getMetrics(serverId: string, since?: Date): Promise<MetricsSummary> {
		const rows = await withConnection(async (conn) => {
			const whereClause = since
				? `WHERE server_id = :serverId AND recorded_at >= :since`
				: `WHERE server_id = :serverId`;

			const binds: Record<string, unknown> = { serverId };
			if (since) {
				binds.since = since;
			}

			// Overall summary
			const summaryResult = await conn.execute<{
				TOTAL_CALLS: number;
				SUCCESS_COUNT: number;
				FAILURE_COUNT: number;
				AVG_DURATION_MS: number;
			}>(
				`SELECT
					COUNT(*) as TOTAL_CALLS,
					SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as SUCCESS_COUNT,
					SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as FAILURE_COUNT,
					AVG(duration_ms) as AVG_DURATION_MS
				 FROM mcp_server_metrics
				 ${whereClause}`,
				binds,
				{ outFormat: conn.OBJECT }
			);

			const summary = summaryResult.rows?.[0];

			// Per-tool breakdown
			const breakdownResult = await conn.execute<{
				TOOL_NAME: string;
				CALLS: number;
				AVG_MS: number;
				SUCCESS_RATE: number;
			}>(
				`SELECT
					tool_name as TOOL_NAME,
					COUNT(*) as CALLS,
					AVG(duration_ms) as AVG_MS,
					AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as SUCCESS_RATE
				 FROM mcp_server_metrics
				 ${whereClause}
				 GROUP BY tool_name
				 ORDER BY CALLS DESC`,
				binds,
				{ outFormat: conn.OBJECT }
			);

			return {
				summary,
				breakdown: breakdownResult.rows ?? []
			};
		});

		return {
			totalCalls: rows.summary?.TOTAL_CALLS ?? 0,
			successCount: rows.summary?.SUCCESS_COUNT ?? 0,
			failureCount: rows.summary?.FAILURE_COUNT ?? 0,
			avgDurationMs: rows.summary?.AVG_DURATION_MS ?? 0,
			toolBreakdown: rows.breakdown.map((row) => ({
				toolName: row.TOOL_NAME,
				calls: row.CALLS,
				avgMs: row.AVG_MS,
				successRate: row.SUCCESS_RATE
			}))
		};
	}
};
