/**
 * MCP Connection Manager — lifecycle management for MCP servers using @mastra/mcp.
 *
 * Orchestrates:
 * - Docker containers for catalog servers
 * - MCPClient lifecycle (connect/disconnect)
 * - Tool discovery and caching
 * - Per-request toolset aggregation for Mastra agents
 * - Health checks and metrics recording
 *
 * Design principles:
 * - One server failing doesn't affect others (graceful degradation)
 * - getToolsets() is hot path (called every chat request) — use cached clients
 * - Metrics are fire-and-forget (don't block on DB writes)
 * - Docker images validated to prevent command injection
 *
 * Integration points:
 * - mcpServerRepository: Read/write server state and credentials
 * - Dockerode: Container orchestration for catalog servers
 * - @mastra/mcp: MCP protocol client implementation
 * - Mastra framework: Provides toolsets to Charlie agent
 */

import { InternalMastraMCPClient } from '@mastra/mcp';
import type { MastraMCPServerDefinition } from '@mastra/mcp';
import type { Tool } from '@mastra/core/tools';
import Dockerode from 'dockerode';
import { mcpServerRepository } from '@portal/server/admin/mcp-repository.js';
import type { McpServer, DecryptedCredential, CachedTool } from '@portal/server/admin/mcp-types.js';
import { createLogger } from '@portal/server/logger.js';

const log = createLogger('mcp-connection-manager');

// ============================================================================
// Types
// ============================================================================

/** Active MCP client wrapper with metadata */
interface ActiveClient {
	client: InternalMastraMCPClient;
	server: McpServer;
	containerId?: string;
	connectedAt: Date;
}

/** Health status response */
interface ServerHealth {
	status: 'connected' | 'disconnected' | 'error' | 'connecting';
	tools: number;
	uptime?: number;
	lastError?: string;
}

/** Tool execution result with timing */
interface ToolExecutionResult {
	result: unknown;
	durationMs: number;
}

// ============================================================================
// MCPConnectionManager
// ============================================================================

export class MCPConnectionManager {
	private clients = new Map<string, ActiveClient>();
	private docker: Dockerode;

	constructor(options?: { dockerHost?: string }) {
		this.docker = new Dockerode(options?.dockerHost ? { host: options.dockerHost } : undefined);
	}

	// ========================================================================
	// LIFECYCLE
	// ========================================================================

	/**
	 * Initialize manager — reconnect all previously connected servers across all orgs.
	 * Paginated to handle large deployments gracefully.
	 * Individual failures don't prevent others from connecting.
	 */
	async initialize(): Promise<void> {
		log.info('Initializing MCP connection manager');

		const pageSize = 100;
		let offset = 0;
		let reconnected = 0;
		let failed = 0;

		// Paginate through all connected servers across all orgs
		while (true) {
			const { servers, invalidServers } = await mcpServerRepository.listAllConnected({
				limit: pageSize,
				offset
			});
			const rowCount = servers.length + invalidServers.length;

			if (invalidServers.length > 0) {
				log.warn(
					{ offset, limit: pageSize, invalidServers },
					'Skipping invalid MCP servers during connection manager initialization'
				);
			}

			if (rowCount === 0) break;

			// Reconnect servers in parallel (per page), errors don't block others
			const results = await Promise.allSettled(
				servers.map((server) => this.connectServer(server.id))
			);

			for (const result of results) {
				if (result.status === 'fulfilled') {
					reconnected++;
				} else {
					failed++;
				}
			}

			if (rowCount < pageSize) break;
			offset += pageSize;
		}

		log.info({ reconnected, failed }, 'MCP connection manager initialized');
	}

	/**
	 * Shutdown manager — disconnect all clients, stop Docker containers.
	 */
	async shutdown(): Promise<void> {
		log.info({ activeClients: this.clients.size }, 'Shutting down MCP connection manager');

		const serverIds = Array.from(this.clients.keys());

		for (const serverId of serverIds) {
			try {
				await this.disconnectServer(serverId);
			} catch (err) {
				log.error({ err, serverId }, 'Failed to disconnect server during shutdown');
			}
		}

		log.info('MCP connection manager shutdown complete');
	}

	// ========================================================================
	// SERVER CONNECTION
	// ========================================================================

	/**
	 * Connect to an MCP server.
	 * Steps:
	 * 1. Load server from DB with decrypted credentials
	 * 2. If catalog server with Docker image → start container
	 * 3. Build MCPClient config from server config + credentials
	 * 4. Create and connect MCPClient
	 * 5. Discover tools → cache in DB
	 * 6. Update server status to 'connected'
	 *
	 * On error: Update status to 'error', log, don't throw
	 */
	async connectServer(serverId: string): Promise<void> {
		try {
			log.info({ serverId }, 'Connecting to MCP server');

			// 1. Load server with credentials
			const server = await mcpServerRepository.getById(serverId);
			if (!server) {
				throw new Error(`Server not found: ${serverId}`);
			}

			// Update status to 'connecting'
			await mcpServerRepository.updateStatus(serverId, 'connecting');

			// 2. Start Docker container if needed
			let containerId: string | undefined;
			if (server.serverType === 'catalog' && server.dockerImage) {
				containerId = await this.startDockerContainer(server, server.credentials ?? []);
			}

			// 3. Build MCP client config
			const clientConfig = this.buildMCPClientConfig(server, server.credentials ?? []);

			// 4. Create and connect client
			const client = new InternalMastraMCPClient({
				name: server.serverName,
				version: '1.0.0',
				server: clientConfig,
				capabilities: {
					roots: {},
					sampling: {}
				},
				timeout: 30000 // 30 second timeout
			});

			await client.connect();

			// 5. Discover tools and cache
			const tools = await client.tools();
			const toolList: Omit<CachedTool, 'id' | 'serverId' | 'discoveredAt'>[] = Object.entries(
				tools
			).map(([name, tool]) => {
				const mastraTool = tool as Tool;
				return {
					toolName: name,
					toolDescription: mastraTool.description ?? '',
					inputSchema: (mastraTool.inputSchema as unknown as Record<string, unknown>) ?? {}
				};
			});

			await mcpServerRepository.cacheTools(serverId, toolList);

			// 6. Update server status and store client
			await mcpServerRepository.updateStatus(serverId, 'connected');
			if (containerId) {
				await mcpServerRepository.updateDockerInfo(serverId, containerId, 'running');
			}

			this.clients.set(serverId, {
				client,
				server,
				containerId,
				connectedAt: new Date()
			});

			log.info(
				{ serverId, serverName: server.serverName, toolCount: toolList.length },
				'MCP server connected'
			);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			log.error({ err: error, serverId }, 'Failed to connect MCP server');

			await mcpServerRepository.updateStatus(serverId, 'error', error.message);
		}
	}

	/**
	 * Disconnect from an MCP server.
	 * Steps:
	 * 1. Get client from map
	 * 2. Disconnect client
	 * 3. Stop and remove Docker container if exists
	 * 4. Update status to 'disconnected'
	 * 5. Remove from map
	 */
	async disconnectServer(serverId: string): Promise<void> {
		try {
			log.info({ serverId }, 'Disconnecting from MCP server');

			const activeClient = this.clients.get(serverId);
			if (!activeClient) {
				log.warn({ serverId }, 'Server not in active clients map');
				return;
			}

			// 1-2. Disconnect client
			try {
				await activeClient.client.disconnect();
			} catch (err) {
				log.warn({ err, serverId }, 'Error disconnecting MCP client (continuing)');
			}

			// 3. Stop Docker container
			if (activeClient.containerId) {
				try {
					await this.stopDockerContainer(activeClient.containerId);
					await mcpServerRepository.updateDockerInfo(serverId, null, 'stopped');
				} catch (err) {
					log.warn({ err, serverId }, 'Error stopping Docker container (continuing)');
				}
			}

			// 4-5. Update status and remove from map
			await mcpServerRepository.updateStatus(serverId, 'disconnected');
			this.clients.delete(serverId);

			log.info({ serverId }, 'MCP server disconnected');
		} catch (err) {
			log.error({ err, serverId }, 'Failed to disconnect MCP server');
			throw err;
		}
	}

	/**
	 * Restart an MCP server (disconnect then connect).
	 */
	async restartServer(serverId: string): Promise<void> {
		log.info({ serverId }, 'Restarting MCP server');
		await this.disconnectServer(serverId);
		await this.connectServer(serverId);
	}

	// ========================================================================
	// TOOL BRIDGE (per-request, hot path)
	// ========================================================================

	/**
	 * Get all toolsets for an organization's connected servers.
	 * Called on every chat request — must be fast.
	 *
	 * Returns merged toolsets from all connected+enabled servers.
	 * Returns empty object if no servers (non-blocking).
	 */
	async getToolsets(orgId: string): Promise<Record<string, Tool>> {
		try {
			// 1. List connected+enabled servers for org
			const { servers, invalidServers } = await mcpServerRepository.listByOrg(orgId);
			if (invalidServers.length > 0) {
				log.warn(
					{ orgId, invalidServers },
					'Skipping invalid MCP servers while assembling toolsets'
				);
			}
			const connectedServers = servers.filter(
				(s) => s.enabled && s.status === 'connected' && this.clients.has(s.id)
			);

			if (connectedServers.length === 0) {
				return {};
			}

			// 2-4. Merge toolsets from all connected servers
			const allTools: Record<string, Tool> = {};

			for (const server of connectedServers) {
				const activeClient = this.clients.get(server.id);
				if (!activeClient) continue;

				try {
					const tools = await activeClient.client.tools();
					// Namespace tools with server name to avoid collisions
					for (const [name, tool] of Object.entries(tools)) {
						const namespacedName = `${server.serverName}__${name}`;
						allTools[namespacedName] = tool as Tool;
					}
				} catch (err) {
					log.warn({ err, serverId: server.id }, 'Failed to get tools from MCP server');
					// Continue with other servers
				}
			}

			return allTools;
		} catch (err) {
			log.error({ err, orgId }, 'Failed to get toolsets for org');
			return {}; // Non-blocking
		}
	}

	// ========================================================================
	// TOOL DISCOVERY & EXECUTION
	// ========================================================================

	/**
	 * List tools for a server.
	 * Tries live discovery first, falls back to DB cache.
	 */
	async listServerTools(serverId: string): Promise<CachedTool[]> {
		const activeClient = this.clients.get(serverId);

		if (activeClient) {
			try {
				const tools = await activeClient.client.tools();
				return Object.entries(tools).map(([name, tool]) => {
					const mastraTool = tool as Tool;
					return {
						id: `live-${name}`,
						serverId,
						toolName: name,
						toolDescription: mastraTool.description ?? '',
						inputSchema: (mastraTool.inputSchema as unknown as Record<string, unknown>) ?? {},
						discoveredAt: new Date()
					};
				});
			} catch (err) {
				log.warn({ err, serverId }, 'Failed to get live tools, falling back to cache');
			}
		}

		// Fall back to DB cache
		return await mcpServerRepository.getCachedTools(serverId);
	}

	/**
	 * Execute a tool on an MCP server.
	 * Records metric (fire-and-forget).
	 * Returns result and timing.
	 *
	 * @param options.timeoutMs - Max ms to wait for tool execution (default: 30000)
	 */
	async executeToolOnServer(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>,
		options: { timeoutMs?: number } = {}
	): Promise<ToolExecutionResult> {
		const { timeoutMs = 30_000 } = options;
		const startTime = Date.now();

		try {
			const activeClient = this.clients.get(serverId);
			if (!activeClient) {
				throw new Error(`Server not connected: ${serverId}`);
			}

			const tools = await activeClient.client.tools();
			const tool = tools[toolName] as Tool | undefined;

			if (!tool || !tool.execute) {
				throw new Error(`Tool not found or not executable: ${toolName}`);
			}

			const result = await Promise.race([
				tool.execute(args, {}),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error(`Tool execution timed out after ${timeoutMs}ms`)),
						timeoutMs
					)
				)
			]);
			const durationMs = Date.now() - startTime;

			// Record metric (fire-and-forget)
			this.recordMetric(activeClient.server.orgId, serverId, toolName, durationMs, true).catch(
				(err) => {
					log.warn({ err, serverId, toolName }, 'Failed to record tool call metric');
				}
			);

			return { result, durationMs };
		} catch (err) {
			const durationMs = Date.now() - startTime;
			const error = err instanceof Error ? err : new Error(String(err));

			// Record failure metric (fire-and-forget)
			const activeClient = this.clients.get(serverId);
			if (activeClient) {
				this.recordMetric(
					activeClient.server.orgId,
					serverId,
					toolName,
					durationMs,
					false,
					error.message
				).catch((err) => {
					log.warn({ err, serverId, toolName }, 'Failed to record tool call metric');
				});
			}

			throw error;
		}
	}

	/**
	 * Get health status for a server.
	 */
	async getServerHealth(serverId: string): Promise<ServerHealth> {
		const activeClient = this.clients.get(serverId);

		if (!activeClient) {
			// Check DB for status
			const server = await mcpServerRepository.getById(serverId);
			return {
				status: server?.status ?? 'disconnected',
				tools: server?.toolCount ?? 0,
				lastError: server?.lastError ?? undefined
			};
		}

		try {
			const tools = await activeClient.client.tools();
			const uptimeMs = Date.now() - activeClient.connectedAt.getTime();

			return {
				status: 'connected',
				tools: Object.keys(tools).length,
				uptime: Math.floor(uptimeMs / 1000) // seconds
			};
		} catch (err) {
			log.warn({ err, serverId }, 'Error getting server health');
			return {
				status: 'error',
				tools: 0,
				lastError: err instanceof Error ? err.message : String(err)
			};
		}
	}

	// ========================================================================
	// DOCKER (private)
	// ========================================================================

	/**
	 * Start Docker container for a catalog server.
	 * Security constraints:
	 * - Image validation (alphanumeric + . / - only)
	 * - Memory limit: 512MB
	 * - CPU limit: 1 core
	 * - CapDrop: ALL
	 * - SecurityOpt: no-new-privileges
	 * - NetworkMode: bridge
	 *
	 * Returns container ID.
	 */
	private async startDockerContainer(
		server: McpServer,
		credentials: DecryptedCredential[]
	): Promise<string> {
		// Validate image to prevent command injection
		const imagePattern = /^[a-z0-9._/-]+$/;
		if (!server.dockerImage || !imagePattern.test(server.dockerImage)) {
			throw new Error(`Invalid Docker image name: ${server.dockerImage}`);
		}

		// Build environment variables from credentials
		const env: string[] = [];
		for (const cred of credentials) {
			// Convention: credential key becomes uppercase env var
			const envKey = cred.key.toUpperCase().replace(/-/g, '_');
			env.push(`${envKey}=${cred.value}`);
		}

		// Add config env vars if any
		if (server.config.env) {
			for (const [key, value] of Object.entries(server.config.env)) {
				env.push(`${key}=${value}`);
			}
		}

		const imageName = `${server.dockerImage}:${server.config.transport ?? 'latest'}`;

		log.info({ serverId: server.id, image: imageName }, 'Starting Docker container');

		try {
			// Pull image if not exists
			await this.docker.pull(imageName);

			// Create container
			const container = await this.docker.createContainer({
				Image: imageName,
				name: `mcp-${server.serverName}-${server.id.slice(0, 8)}`,
				Env: env,
				Labels: {
					'portal.mcp.server-id': server.id,
					'portal.mcp.server-name': server.serverName
				},
				HostConfig: {
					Memory: 512 * 1024 * 1024, // 512MB
					NanoCpus: 1 * 1e9, // 1 CPU
					CapDrop: ['ALL'],
					SecurityOpt: ['no-new-privileges'],
					NetworkMode: 'bridge'
				}
			});

			// Start container
			await container.start();

			const info = await container.inspect();
			log.info(
				{ serverId: server.id, containerId: info.Id },
				'Docker container started successfully'
			);

			return info.Id;
		} catch (err) {
			log.error({ err, serverId: server.id, image: imageName }, 'Failed to start Docker container');
			throw err;
		}
	}

	/**
	 * Stop and remove Docker container.
	 * Handles 'not found' gracefully.
	 */
	private async stopDockerContainer(containerId: string): Promise<void> {
		try {
			const container = this.docker.getContainer(containerId);

			try {
				await container.stop({ t: 10 }); // 10 second grace period
			} catch (err) {
				// Container might already be stopped
				log.warn({ err, containerId }, 'Container stop failed (may already be stopped)');
			}

			await container.remove({ force: true });
			log.info({ containerId }, 'Docker container stopped and removed');
		} catch (err) {
			if (err && typeof err === 'object' && 'statusCode' in err && err.statusCode === 404) {
				log.warn({ containerId }, 'Container not found (already removed)');
				return;
			}
			throw err;
		}
	}

	/**
	 * Build MCP client config from server record and credentials.
	 * Maps our DB types to @mastra/mcp types.
	 */
	private buildMCPClientConfig(
		server: McpServer,
		credentials: DecryptedCredential[]
	): MastraMCPServerDefinition {
		if (server.transportType === 'stdio') {
			// Stdio transport
			const env: Record<string, string> = {};

			// Add credentials as env vars
			for (const cred of credentials) {
				const envKey = cred.key.toUpperCase().replace(/-/g, '_');
				env[envKey] = cred.value;
			}

			// Merge with server config env
			if (server.config.env) {
				Object.assign(env, server.config.env);
			}

			return {
				command: server.config.command ?? 'npx',
				args: server.config.args ?? [],
				env
			};
		} else {
			// HTTP/SSE transport
			if (!server.config.url) {
				throw new Error(`HTTP transport requires URL: ${server.id}`);
			}

			const headers: Record<string, string> = {};

			// Add credentials as headers (common pattern: Authorization, X-API-Key)
			for (const cred of credentials) {
				if (cred.type === 'api_key') {
					headers['X-API-Key'] = cred.value;
				} else if (cred.type === 'token') {
					headers['Authorization'] = `Bearer ${cred.value}`;
				}
			}

			// Merge with server config headers
			if (server.config.headers) {
				Object.assign(headers, server.config.headers);
			}

			return {
				url: new URL(server.config.url),
				requestInit: {
					headers
				}
			};
		}
	}

	/**
	 * Record tool call metric (fire-and-forget).
	 */
	private async recordMetric(
		orgId: string,
		serverId: string,
		toolName: string,
		durationMs: number,
		success: boolean,
		errorMessage?: string
	): Promise<void> {
		await mcpServerRepository.recordToolCall({
			serverId,
			orgId,
			toolName,
			durationMs,
			success,
			errorMessage
		});
	}
}

// ============================================================================
// Singleton
// ============================================================================

export const mcpConnectionManager = new MCPConnectionManager();
