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

vi.mock('@portal/shared/server/admin/mcp-repository', () => {
	// Initialize registry if needed (only happens once during hoisting)
	if (!(globalThis as any).__testMocks) {
		(globalThis as any).__testMocks = {
			repository: null,
			mcpClient: null,
			container: null,
			docker: null
		};
	}

	// Create mocks here, inside the factory
	const mocks = {
		listByOrg: vi.fn(),
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

vi.mock('@portal/shared/server/logger', () => ({
	createLogger: vi.fn(() => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	}))
}));

// ============================================================================
// Type imports and regular imports (after mocks are registered)
// ============================================================================

import type {
	McpServer,
	DecryptedCredential,
	CachedTool
} from '@portal/shared/server/admin/mcp-types.js';
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
	mocks.repository.listByOrg.mockResolvedValue([]);
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
		it('completes when no servers exist', async () => {
			const mocks = (globalThis as any).__testMocks;
			const manager = new MCPConnectionManager();
			mocks.repository.listByOrg.mockResolvedValue([]);

			// Should not throw
			await expect(manager.initialize()).resolves.not.toThrow();
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
			mocks.repository.listByOrg.mockResolvedValue([
				{ ...testServer, status: 'connected', enabled: true },
				{ ...testServer2, status: 'connected', enabled: true }
			]);
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
			mocks.repository.listByOrg.mockResolvedValue([]);

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
