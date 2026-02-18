/**
 * Unit tests for MCPConnectionManager (mcp-connection-manager.ts)
 *
 * Tests cover:
 * - Lifecycle (initialize, shutdown)
 * - Server connection/disconnection
 * - Tool discovery and caching
 * - Toolset aggregation for Mastra agents
 * - Tool execution with metrics
 * - Docker container management and security
 * - Error handling and graceful degradation
 *
 * Key patterns:
 * - mockReset: true in vitest.config.ts → use forwarding mocks + beforeEach re-setup
 * - Mocks are created in vi.mock factories to avoid temporal dead zone issues
 * - Tests access mocks via their factory return values
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// VI.MOCK Registrations - factories populate a globalThis registry
// ============================================================================

vi.mock('@portal/server/admin/mcp-repository', () => {
	// Initialize registry if needed (only happens once during hoisting)
	if (!(globalThis as any).__testMocks) {
		(globalThis as any).__testMocks = {
			repository: null,
			mcpClient: null,
			container: null,
			docker: null,
			logger: null
		};
	}

	// Create mocks here, inside the factory
	const mocks = {
		listByOrg: vi.fn(),
		listAllConnected: vi.fn(),
		getById: vi.fn(),
		updateStatus: vi.fn(),
		updateDockerInfo: vi.fn(),
		cacheTools: vi.fn(),
		getCachedTools: vi.fn(),
		getDecryptedCredentials: vi.fn(),
		recordToolCall: vi.fn()
	};

	// Store in registry for test access
	(globalThis as any).__testMocks.repository = mocks;

	return {
		mcpServerRepository: new Proxy(
			{},
			{
				get: (_target, prop) => {
					const key = prop as keyof typeof mocks;
					return (...args: unknown[]) => mocks[key](...args);
				}
			}
		)
	};
});

vi.mock('@mastra/mcp', () => {
	// Initialize registry if needed
	if (!(globalThis as any).__testMocks) {
		(globalThis as any).__testMocks = {
			repository: null,
			mcpClient: null,
			container: null,
			docker: null
		};
	}

	const mocks = {
		connect: vi.fn(),
		disconnect: vi.fn(),
		tools: vi.fn()
	};

	(globalThis as any).__testMocks.mcpClient = mocks;

	return {
		InternalMastraMCPClient: vi.fn(function () {
			return mocks;
		})
	};
});

vi.mock('dockerode', () => {
	// Initialize registry if needed
	if (!(globalThis as any).__testMocks) {
		(globalThis as any).__testMocks = {
			repository: null,
			mcpClient: null,
			container: null,
			docker: null
		};
	}

	const containerMocks = {
		start: vi.fn(),
		stop: vi.fn(),
		remove: vi.fn(),
		inspect: vi.fn()
	};

	const dockerMocks = {
		pull: vi.fn(),
		createContainer: vi.fn(),
		getContainer: vi.fn()
	};

	(globalThis as any).__testMocks.container = containerMocks;
	(globalThis as any).__testMocks.docker = dockerMocks;

	return {
		default: vi.fn(function () {
			return dockerMocks;
		})
	};
});

vi.mock('@portal/server/logger', () => {
	if (!(globalThis as any).__testMocks) {
		(globalThis as any).__testMocks = {
			repository: null,
			mcpClient: null,
			container: null,
			docker: null,
			logger: null
		};
	}

	const loggerMocks = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	};
	(globalThis as any).__testMocks.logger = loggerMocks;

	return {
		createLogger: vi.fn(() => loggerMocks)
	};
});

// ============================================================================
// Type imports and regular imports (after mocks are registered)
// ============================================================================

import type {
	McpServer,
	DecryptedCredential,
	CachedTool,
	InvalidMcpServerRecord
} from '@portal/server/admin/mcp-types.js';
import { MCPConnectionManager } from '../services/mcp-connection-manager.js';

// ============================================================================
// Test Data
// ============================================================================

const testOrgId = 'org-123';
const testServerId = 'server-abc-def-ghi-jkl';

const testServer: McpServer = {
	id: testServerId,
	orgId: testOrgId,
	serverName: 'github-server',
	displayName: 'GitHub MCP Server',
	description: 'GitHub integration for MCP',
	serverType: 'catalog',
	transportType: 'sse',
	catalogItemId: 'catalog-github',
	config: {
		url: 'http://localhost:3001/mcp/sse'
	},
	dockerImage: undefined,
	status: 'disconnected',
	enabled: true,
	tags: ['github', 'integration'],
	toolCount: 5,
	createdAt: new Date(),
	updatedAt: new Date()
};

const testServerWithDocker: McpServer = {
	...testServer,
	id: 'server-docker-xyz',
	serverName: 'catalog-server',
	displayName: 'Catalog Catalog Server',
	serverType: 'catalog',
	transportType: 'stdio',
	dockerImage: 'mcp/catalog-server',
	config: {
		command: 'node',
		args: ['/usr/local/bin/catalog-server'],
		env: { DEBUG: 'true' }
	}
};

const makeServerList = (
	servers: McpServer[] = [],
	invalidServers: InvalidMcpServerRecord[] = []
) => ({ servers, invalidServers });
const emptyServerList = makeServerList();

const testCredentials: DecryptedCredential[] = [
	{
		key: 'github-token',
		displayName: 'GitHub Token',
		value: 'ghp_test_token',
		type: 'token'
	}
];

const testTools = {
	github_create_issue: {
		description: 'Create a GitHub issue',
		inputSchema: {
			type: 'object',
			properties: {
				title: { type: 'string' },
				body: { type: 'string' }
			}
		},
		execute: vi.fn()
	},
	github_list_issues: {
		description: 'List GitHub issues',
		inputSchema: { type: 'object' },
		execute: vi.fn()
	}
};

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
	// Get mocks from registry
	const mocks = (globalThis as any).__testMocks;

	// Reset all mocks and re-configure them
	vi.clearAllMocks();

	// Repository mocks
	mocks.repository.listByOrg.mockResolvedValue(emptyServerList);
	mocks.repository.listAllConnected.mockResolvedValue(emptyServerList);
	mocks.repository.getById.mockResolvedValue(undefined);
	mocks.repository.updateStatus.mockResolvedValue(undefined);
	mocks.repository.updateDockerInfo.mockResolvedValue(undefined);
	mocks.repository.cacheTools.mockResolvedValue(undefined);
	mocks.repository.getCachedTools.mockResolvedValue([]);
	mocks.repository.getDecryptedCredentials.mockResolvedValue([]);
	mocks.repository.recordToolCall.mockResolvedValue(undefined);

	// MCPClient mocks
	mocks.mcpClient.connect.mockResolvedValue(undefined);
	mocks.mcpClient.disconnect.mockResolvedValue(undefined);
	mocks.mcpClient.tools.mockResolvedValue({});

	// Docker mocks
	mocks.container.start.mockResolvedValue(undefined);
	mocks.container.stop.mockResolvedValue(undefined);
	mocks.container.remove.mockResolvedValue(undefined);
	mocks.container.inspect.mockResolvedValue({
		Id: 'container-id-123'
	});

	mocks.docker.pull.mockResolvedValue(undefined);
	mocks.docker.createContainer.mockResolvedValue(mocks.container);
	mocks.docker.getContainer.mockReturnValue(mocks.container);
});

afterEach(() => {
	vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('MCPConnectionManager', () => {
	// ========================================================================
	// LIFECYCLE TESTS
	// ========================================================================

	describe('initialize', () => {
		it('completes when no previously connected servers exist', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			mocks.repository.listAllConnected.mockResolvedValue(emptyServerList);

			await expect(manager.initialize()).resolves.not.toThrow();
			expect(mocks.repository.listAllConnected).toHaveBeenCalledWith({ limit: 100, offset: 0 });
		});

		it('reconnects all previously connected servers on startup', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			const server2: McpServer = { ...testServer, id: 'server-org2', orgId: 'org-456' };

			// 2 servers on first page (< 100 page size → only one page fetch needed)
			mocks.repository.listAllConnected.mockResolvedValueOnce(
				makeServerList([testServer, server2])
			);

			mocks.repository.getById.mockResolvedValueOnce(testServer).mockResolvedValueOnce(server2);
			mocks.mcpClient.tools.mockResolvedValue(testTools);

			await manager.initialize();

			// Partial page (2 < 100) → only one fetch needed, no second page
			expect(mocks.repository.listAllConnected).toHaveBeenCalledTimes(1);
			expect(mocks.repository.listAllConnected).toHaveBeenCalledWith({ limit: 100, offset: 0 });
			expect(mocks.repository.updateStatus).toHaveBeenCalledWith(testServerId, 'connected');
			expect(mocks.repository.updateStatus).toHaveBeenCalledWith('server-org2', 'connected');
		});

		it('continues reconnecting other servers when one fails', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			const server2: McpServer = { ...testServer, id: 'server-good' };

			mocks.repository.listAllConnected
				.mockResolvedValueOnce(makeServerList([testServer, server2]))
				.mockResolvedValueOnce(emptyServerList);

			// First server fails to connect (getById returns undefined)
			// Second server succeeds
			mocks.repository.getById.mockResolvedValueOnce(undefined).mockResolvedValueOnce(server2);
			mocks.mcpClient.tools.mockResolvedValue({});

			// Should not throw even though one server fails
			await expect(manager.initialize()).resolves.not.toThrow();
			// Second server should still be attempted
			expect(mocks.repository.getById).toHaveBeenCalledTimes(2);
		});

		it('handles pagination correctly for large deployments', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			// Simulate exactly 100 servers on page 1 (full page → continues), then 50 on page 2 (partial → stops)
			const page1 = Array.from({ length: 100 }, (_, i) => ({
				...testServer,
				id: `server-p1-${i}`
			}));
			const page2 = Array.from({ length: 50 }, (_, i) => ({
				...testServer,
				id: `server-p2-${i}`
			}));

			mocks.repository.listAllConnected
				.mockResolvedValueOnce(makeServerList(page1))
				.mockResolvedValueOnce(makeServerList(page2));

			// getById returns server for all (connectServer uses getById internally)
			mocks.repository.getById.mockImplementation(async (id: string) => ({
				...testServer,
				id
			}));
			mocks.mcpClient.tools.mockResolvedValue({});

			await manager.initialize();

			// Full page (100) → fetch page 2; partial page (50) → stop
			expect(mocks.repository.listAllConnected).toHaveBeenCalledTimes(2);
			expect(mocks.repository.listAllConnected).toHaveBeenNthCalledWith(1, {
				limit: 100,
				offset: 0
			});
			expect(mocks.repository.listAllConnected).toHaveBeenNthCalledWith(2, {
				limit: 100,
				offset: 100
			});
		});

		it('logs warning when invalid servers are returned during initialize', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			const invalid: InvalidMcpServerRecord = {
				id: 'bad-server',
				serverName: 'broken',
				field: 'config',
				reason: 'Invalid JSON payload'
			};

			mocks.repository.listAllConnected.mockResolvedValueOnce(
				makeServerList([testServer], [invalid])
			);
			mocks.repository.getById.mockResolvedValue(testServer);
			mocks.mcpClient.tools.mockResolvedValue(testTools);

			await manager.initialize();

			expect(mocks.logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({
					offset: 0,
					limit: 100,
					invalidServers: expect.arrayContaining([
						expect.objectContaining({ id: 'bad-server', field: 'config' })
					])
				}),
				expect.stringMatching(/Skipping invalid MCP servers/)
			);
		});
	});

	describe('shutdown', () => {
		it('disconnects all active clients gracefully', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			// Set up multiple active connections
			mocks.repository.getById.mockResolvedValueOnce(testServer);
			mocks.mcpClient.tools.mockResolvedValueOnce(testTools);

			await manager.connectServer(testServerId);
			expect(mocks.repository.updateStatus).toHaveBeenCalledWith(testServerId, 'connected');

			// Reset mocks for shutdown
			vi.clearAllMocks();
			mocks.repository.updateStatus.mockResolvedValue(undefined);
			mocks.mcpClient.disconnect.mockResolvedValue(undefined);

			await manager.shutdown();

			expect(mocks.mcpClient.disconnect).toHaveBeenCalled();
			expect(mocks.repository.updateStatus).toHaveBeenCalledWith(testServerId, 'disconnected');
		});
	});

	// ========================================================================
	// CONNECTION TESTS
	// ========================================================================

	describe('connectServer', () => {
		it('connects to SSE server and caches tools', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			mocks.repository.getById.mockResolvedValue(testServer);
			mocks.repository.getDecryptedCredentials.mockResolvedValue(testCredentials);
			mocks.mcpClient.tools.mockResolvedValue(testTools);

			await manager.connectServer(testServerId);

			// Verify connection flow
			expect(mocks.repository.getById).toHaveBeenCalledWith(testServerId);
			expect(mocks.repository.updateStatus).toHaveBeenCalledWith(testServerId, 'connecting');
			expect(mocks.mcpClient.connect).toHaveBeenCalled();
			expect(mocks.mcpClient.tools).toHaveBeenCalled();
			expect(mocks.repository.cacheTools).toHaveBeenCalledWith(testServerId, expect.any(Array));
			expect(mocks.repository.updateStatus).toHaveBeenCalledWith(testServerId, 'connected');
		});

		it('starts Docker container for catalog server', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			mocks.repository.getById.mockResolvedValue(testServerWithDocker);
			mocks.repository.getDecryptedCredentials.mockResolvedValue(testCredentials);
			mocks.mcpClient.tools.mockResolvedValue(testTools);

			await manager.connectServer(testServerWithDocker.id);

			// Verify Docker operations were called in sequence
			expect(mocks.docker.pull).toHaveBeenCalledWith('mcp/catalog-server:latest');
			expect(mocks.docker.createContainer).toHaveBeenCalled();

			const createContainerCall = mocks.docker.createContainer.mock.calls[0][0];
			expect(createContainerCall.Image).toBe('mcp/catalog-server:latest');
			expect(Array.isArray(createContainerCall.Env)).toBe(true);

			expect(mocks.container.start).toHaveBeenCalled();
			expect(mocks.repository.updateDockerInfo).toHaveBeenCalledWith(
				testServerWithDocker.id,
				'container-id-123',
				'running'
			);
		});

		it('updates status to error on connection failure', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			mocks.repository.getById.mockResolvedValue(testServer);
			const error = new Error('Connection timeout');
			mocks.mcpClient.connect.mockRejectedValue(error);

			await manager.connectServer(testServerId);

			expect(mocks.repository.updateStatus).toHaveBeenCalledWith(
				testServerId,
				'error',
				error.message
			);
		});
	});

	describe('disconnectServer', () => {
		it('disconnects MCPClient and removes from map', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			// First connect
			mocks.repository.getById.mockResolvedValue(testServer);
			mocks.mcpClient.tools.mockResolvedValue(testTools);
			await manager.connectServer(testServerId);

			// Reset mocks for disconnect
			vi.clearAllMocks();
			mocks.repository.updateStatus.mockResolvedValue(undefined);
			mocks.mcpClient.disconnect.mockResolvedValue(undefined);

			// Now disconnect
			await manager.disconnectServer(testServerId);

			expect(mocks.mcpClient.disconnect).toHaveBeenCalled();
			expect(mocks.repository.updateStatus).toHaveBeenCalledWith(testServerId, 'disconnected');
		});

		it('handles already-disconnected server gracefully', async () => {
			const manager = new MCPConnectionManager();

			// Try to disconnect server that was never connected
			await expect(manager.disconnectServer('unknown-server')).resolves.not.toThrow();
		});
	});

	describe('restartServer', () => {
		it('calls disconnect then connect', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			// Setup for both connect and disconnect
			mocks.repository.getById.mockResolvedValue(testServer);
			mocks.mcpClient.tools.mockResolvedValue(testTools);
			mocks.repository.updateStatus.mockResolvedValue(undefined);
			mocks.mcpClient.disconnect.mockResolvedValue(undefined);
			mocks.mcpClient.connect.mockResolvedValue(undefined);

			await manager.restartServer(testServerId);

			// Verify getById was called to load server config
			expect(mocks.repository.getById).toHaveBeenCalledWith(testServerId);
			// Verify updateStatus was called with connecting status
			expect(mocks.repository.updateStatus).toHaveBeenCalledWith(testServerId, 'connecting');
		});
	});

	// ========================================================================
	// TOOLSET TESTS
	// ========================================================================

	describe('getToolsets', () => {
		it('returns merged toolsets from all connected org servers', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			// Connect first server
			mocks.repository.getById.mockResolvedValueOnce(testServer);
			mocks.mcpClient.tools.mockResolvedValueOnce(testTools);
			await manager.connectServer(testServerId);

			// Connect second server
			const testServer2: McpServer = {
				...testServer,
				id: 'server-2',
				serverName: 'filesystem'
			};
			mocks.repository.getById.mockResolvedValueOnce(testServer2);
			mocks.mcpClient.tools.mockResolvedValueOnce({
				fs_read_file: {
					description: 'Read a file',
					inputSchema: { type: 'object' }
				}
			});
			await manager.connectServer('server-2');

			// Reset mocks and setup listByOrg
			vi.clearAllMocks();
			mocks.repository.listByOrg.mockResolvedValue(
				makeServerList([
					{ ...testServer, status: 'connected', enabled: true },
					{ ...testServer2, status: 'connected', enabled: true }
				])
			);
			mocks.mcpClient.tools.mockResolvedValueOnce(testTools).mockResolvedValueOnce({
				fs_read_file: {
					description: 'Read a file',
					inputSchema: { type: 'object' }
				}
			});

			const toolsets = await manager.getToolsets(testOrgId);

			// Verify tools are namespaced with server name
			expect(toolsets).toEqual(
				expect.objectContaining({
					'github-server__github_create_issue': expect.any(Object),
					filesystem__fs_read_file: expect.any(Object)
				})
			);
		});

		it('returns empty object when no connected servers', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			mocks.repository.listByOrg.mockResolvedValue(emptyServerList);

			const toolsets = await manager.getToolsets(testOrgId);

			expect(toolsets).toEqual({});
		});

		it('returns empty object on overall error (non-blocking)', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			mocks.repository.listByOrg.mockRejectedValue(new Error('DB error'));

			const toolsets = await manager.getToolsets(testOrgId);

			// Should return empty object instead of throwing
			expect(toolsets).toEqual({});
		});

		it('logs warning when invalid servers are returned for toolsets', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			const invalid: InvalidMcpServerRecord = {
				id: 'poisoned',
				serverName: 'bad-server',
				field: 'config',
				reason: 'Invalid JSON payload'
			};

			mocks.repository.listByOrg.mockResolvedValueOnce(
				makeServerList([{ ...testServer, status: 'connected', enabled: true }], [invalid])
			);

			const toolsets = await manager.getToolsets(testOrgId);
			expect(toolsets).toEqual({});
			expect(mocks.logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({
					orgId: testOrgId,
					invalidServers: expect.arrayContaining([expect.objectContaining({ id: 'poisoned' })])
				}),
				expect.stringMatching(/Skipping invalid MCP servers while assembling toolsets/)
			);
		});
	});

	// ========================================================================
	// TOOL EXECUTION TESTS
	// ========================================================================

	describe('executeToolOnServer', () => {
		it('executes tool and returns result with duration', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			// Connect server
			mocks.repository.getById.mockResolvedValue(testServer);
			mocks.mcpClient.tools.mockResolvedValue(testTools);
			await manager.connectServer(testServerId);

			// Reset mocks for execution
			vi.clearAllMocks();
			mocks.mcpClient.tools.mockResolvedValue(testTools);
			const toolResult = { id: 'issue-123' };
			testTools['github_create_issue'].execute.mockResolvedValue(toolResult);
			mocks.repository.recordToolCall.mockResolvedValue(undefined);

			const result = await manager.executeToolOnServer(testServerId, 'github_create_issue', {
				title: 'Test issue'
			});

			expect(result.result).toEqual(toolResult);
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
			expect(mocks.repository.recordToolCall).toHaveBeenCalledWith(
				expect.objectContaining({
					serverId: testServerId,
					orgId: testOrgId,
					toolName: 'github_create_issue',
					durationMs: expect.any(Number),
					success: true
				})
			);
		});

		it('throws when server not connected', async () => {
			const manager = new MCPConnectionManager();

			await expect(
				manager.executeToolOnServer(testServerId, 'github_create_issue', {})
			).rejects.toThrow('Server not connected');
		});

		it('rejects with timeout error when tool execution exceeds timeoutMs', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			// Connect server first
			mocks.repository.getById.mockResolvedValue(testServer);
			mocks.mcpClient.tools.mockResolvedValue(testTools);
			await manager.connectServer(testServerId);

			// Replace the tool execute with a hanging implementation
			const hangingTools = {
				...testTools,
				'slow-tool': {
					execute: vi.fn().mockImplementation(() => new Promise<never>(() => {}))
				}
			};
			mocks.mcpClient.tools.mockResolvedValue(hangingTools);

			// Act + Assert: should reject before 200ms with timeout message
			await expect(
				manager.executeToolOnServer(testServerId, 'slow-tool', {}, { timeoutMs: 100 })
			).rejects.toThrow('Tool execution timed out after 100ms');
		}, 2000);
	});

	// ========================================================================
	// DOCKER SECURITY TESTS
	// ========================================================================

	describe('Docker security', () => {
		it('validates image name against allowlist pattern', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			const validImageServer: McpServer = {
				...testServerWithDocker,
				dockerImage: 'my.registry/mcp-server-v1.0'
			};

			mocks.repository.getById.mockResolvedValue(validImageServer);
			mocks.repository.getDecryptedCredentials.mockResolvedValue([]);
			mocks.mcpClient.tools.mockResolvedValue({});

			await manager.connectServer(validImageServer.id);

			// Should succeed with valid image name
			expect(mocks.docker.pull).toHaveBeenCalledWith(
				expect.stringContaining('my.registry/mcp-server-v1.0')
			);
		});

		it('rejects invalid image names', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			const invalidImageServer: McpServer = {
				...testServerWithDocker,
				dockerImage: 'mcp/server:tag; rm -rf /'
			};

			mocks.repository.getById.mockResolvedValue(invalidImageServer);

			await manager.connectServer(invalidImageServer.id);

			// Should reject due to invalid characters
			expect(mocks.repository.updateStatus).toHaveBeenCalledWith(
				invalidImageServer.id,
				'error',
				expect.stringContaining('Invalid Docker image name')
			);
			expect(mocks.docker.pull).not.toHaveBeenCalled();
		});

		it('applies memory constraints (512MB)', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			mocks.repository.getById.mockResolvedValue(testServerWithDocker);
			mocks.repository.getDecryptedCredentials.mockResolvedValue([]);
			mocks.mcpClient.tools.mockResolvedValue({});

			await manager.connectServer(testServerWithDocker.id);

			expect(mocks.docker.createContainer).toHaveBeenCalledWith(
				expect.objectContaining({
					HostConfig: expect.objectContaining({
						Memory: 512 * 1024 * 1024 // 512MB in bytes
					})
				})
			);
		});

		it('applies CPU constraints (1 core)', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			mocks.repository.getById.mockResolvedValue(testServerWithDocker);
			mocks.repository.getDecryptedCredentials.mockResolvedValue([]);
			mocks.mcpClient.tools.mockResolvedValue({});

			await manager.connectServer(testServerWithDocker.id);

			expect(mocks.docker.createContainer).toHaveBeenCalledWith(
				expect.objectContaining({
					HostConfig: expect.objectContaining({
						NanoCpus: 1 * 1e9 // 1 CPU in nanos
					})
				})
			);
		});

		it('drops all capabilities', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			mocks.repository.getById.mockResolvedValue(testServerWithDocker);
			mocks.repository.getDecryptedCredentials.mockResolvedValue([]);
			mocks.mcpClient.tools.mockResolvedValue({});

			await manager.connectServer(testServerWithDocker.id);

			expect(mocks.docker.createContainer).toHaveBeenCalledWith(
				expect.objectContaining({
					HostConfig: expect.objectContaining({
						CapDrop: ['ALL']
					})
				})
			);
		});

		it('enables no-new-privileges security option', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			mocks.repository.getById.mockResolvedValue(testServerWithDocker);
			mocks.repository.getDecryptedCredentials.mockResolvedValue([]);
			mocks.mcpClient.tools.mockResolvedValue({});

			await manager.connectServer(testServerWithDocker.id);

			expect(mocks.docker.createContainer).toHaveBeenCalledWith(
				expect.objectContaining({
					HostConfig: expect.objectContaining({
						SecurityOpt: ['no-new-privileges']
					})
				})
			);
		});

		it('uses bridge network mode', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			mocks.repository.getById.mockResolvedValue(testServerWithDocker);
			mocks.repository.getDecryptedCredentials.mockResolvedValue([]);
			mocks.mcpClient.tools.mockResolvedValue({});

			await manager.connectServer(testServerWithDocker.id);

			expect(mocks.docker.createContainer).toHaveBeenCalledWith(
				expect.objectContaining({
					HostConfig: expect.objectContaining({
						NetworkMode: 'bridge'
					})
				})
			);
		});
	});

	// ========================================================================
	// HEALTH CHECK TESTS
	// ========================================================================

	describe('getServerHealth', () => {
		it('returns connected status with tool count and uptime for active client', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			mocks.repository.getById.mockResolvedValue(testServer);
			mocks.mcpClient.tools.mockResolvedValue(testTools);
			await manager.connectServer(testServerId);

			// Reset mocks
			vi.clearAllMocks();
			mocks.mcpClient.tools.mockResolvedValue(testTools);

			const health = await manager.getServerHealth(testServerId);

			expect(health.status).toBe('connected');
			expect(health.tools).toBe(2); // Two tools in testTools
			expect(health.uptime).toBeGreaterThanOrEqual(0);
			expect(health.lastError).toBeUndefined();
		});
	});

	// ========================================================================
	// TOOL LISTING TESTS
	// ========================================================================

	describe('listServerTools', () => {
		it('returns live tools when server is connected', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			mocks.repository.getById.mockResolvedValue(testServer);
			mocks.mcpClient.tools.mockResolvedValue(testTools);
			await manager.connectServer(testServerId);

			// Reset mocks
			vi.clearAllMocks();
			mocks.mcpClient.tools.mockResolvedValue(testTools);

			const tools = await manager.listServerTools(testServerId);

			expect(tools).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						toolName: 'github_create_issue',
						toolDescription: 'Create a GitHub issue'
					}),
					expect.objectContaining({
						toolName: 'github_list_issues',
						toolDescription: 'List GitHub issues'
					})
				])
			);
		});

		it('falls back to cached tools on live fetch failure', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();

			mocks.repository.getById.mockResolvedValue(testServer);
			mocks.mcpClient.tools.mockResolvedValue(testTools);
			await manager.connectServer(testServerId);

			// Reset and make live fetch fail
			vi.clearAllMocks();
			mocks.mcpClient.tools.mockRejectedValue(new Error('Connection lost'));
			const cachedTools: CachedTool[] = [
				{
					id: 'tool-1',
					serverId: testServerId,
					toolName: 'cached_tool',
					toolDescription: 'Cached tool from DB',
					inputSchema: {},
					discoveredAt: new Date()
				}
			];
			mocks.repository.getCachedTools.mockResolvedValue(cachedTools);

			const tools = await manager.listServerTools(testServerId);

			expect(tools).toEqual(cachedTools);
		});
	});
});
