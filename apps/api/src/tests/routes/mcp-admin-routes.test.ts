/**
 * Unit tests for admin MCP API routes
 *
 * Tests all 17 endpoints across catalog, servers, connection, credentials, and tools.
 * Uses fastify.inject() with mocked repository and connection manager.
 * mockReset: true config requires forwarding mock pattern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, simulateSession } from './test-helpers.js';
import { mcpAdminRoutes } from '../../routes/admin/mcp.js';
import { NotFoundError } from '@portal/server/errors.js';
import type {
	McpCatalogItem,
	McpServer,
	CachedTool,
	MetricsSummary
} from '@portal/server/admin/mcp-types.js';

// ============================================================================
// Mock setup — forwarding pattern for mockReset: true
// ============================================================================

const mockGetCatalog = vi.fn();
const mockGetCatalogItem = vi.fn();
const mockListByOrg = vi.fn();
const mockGetById = vi.fn();
const mockCreate = vi.fn();
const mockInstallFromCatalog = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockSetCredential = vi.fn();
const mockDeleteCredential = vi.fn();
const mockGetMetrics = vi.fn();

const mockConnectServer = vi.fn();
const mockDisconnectServer = vi.fn();
const mockRestartServer = vi.fn();
const mockListServerTools = vi.fn();
const mockExecuteToolOnServer = vi.fn();
const mockGetServerHealth = vi.fn();

vi.mock('@portal/server/admin/mcp-repository', () => ({
	mcpServerRepository: {
		get getCatalog() {
			return mockGetCatalog;
		},
		get getCatalogItem() {
			return mockGetCatalogItem;
		},
		get listByOrg() {
			return mockListByOrg;
		},
		get getById() {
			return mockGetById;
		},
		get create() {
			return mockCreate;
		},
		get installFromCatalog() {
			return mockInstallFromCatalog;
		},
		get update() {
			return mockUpdate;
		},
		get delete() {
			return mockDelete;
		},
		get setCredential() {
			return mockSetCredential;
		},
		get deleteCredential() {
			return mockDeleteCredential;
		},
		get getMetrics() {
			return mockGetMetrics;
		}
	}
}));

vi.mock('../../services/mcp-connection-manager.js', () => ({
	mcpConnectionManager: {
		get connectServer() {
			return mockConnectServer;
		},
		get disconnectServer() {
			return mockDisconnectServer;
		},
		get restartServer() {
			return mockRestartServer;
		},
		get listServerTools() {
			return mockListServerTools;
		},
		get executeToolOnServer() {
			return mockExecuteToolOnServer;
		},
		get getServerHealth() {
			return mockGetServerHealth;
		}
	}
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

// ============================================================================
// Test data factories
// ============================================================================

function createMockCatalogItem(overrides?: Partial<McpCatalogItem>): McpCatalogItem {
	return {
		id: '550e8400-e29b-41d4-a716-446655440000',
		catalogId: 'github',
		displayName: 'GitHub',
		description: 'GitHub MCP server',
		category: 'Code',
		iconUrl: 'https://example.com/github.png',
		documentationUrl: 'https://docs.example.com/github',
		dockerImage: 'mcp/github:latest',
		dockerTag: 'latest',
		defaultConfig: { transport: 'stdio' },
		requiredCredentials: [
			{
				key: 'token',
				displayName: 'GitHub Token',
				description: 'Personal access token',
				type: 'token'
			}
		],
		supportsTools: true,
		supportsResources: false,
		isFeatured: true,
		sortOrder: 1,
		tags: ['git', 'code'],
		status: 'active',
		createdAt: new Date('2026-01-01'),
		updatedAt: new Date('2026-01-01'),
		...overrides
	};
}

function createMockServer(overrides?: Partial<McpServer>): McpServer {
	return {
		id: '660e8400-e29b-41d4-a716-446655440001',
		orgId: 'org-123',
		serverName: 'my-github-server',
		displayName: 'My GitHub Server',
		description: 'Custom GitHub integration',
		serverType: 'catalog',
		transportType: 'stdio',
		catalogItemId: '550e8400-e29b-41d4-a716-446655440000',
		config: { transport: 'stdio', command: 'node', args: ['server.js'] },
		dockerImage: 'mcp/github:latest',
		dockerContainerId: 'container-123',
		dockerStatus: 'running',
		status: 'connected',
		enabled: true,
		lastConnectedAt: new Date('2026-01-15'),
		lastError: null,
		healthStatus: { healthy: true },
		tags: ['production'],
		sortOrder: 1,
		toolCount: 15,
		credentials: [
			{
				key: 'token',
				displayName: 'GitHub Token',
				value: 'ghp_secret...',
				type: 'token'
			}
		],
		createdAt: new Date('2026-01-01'),
		updatedAt: new Date('2026-01-15'),
		...overrides
	};
}

function createMockTool(overrides?: Partial<CachedTool>): CachedTool {
	return {
		id: '770e8400-e29b-41d4-a716-446655440002',
		serverId: '660e8400-e29b-41d4-a716-446655440001',
		toolName: 'github_create_issue',
		toolDescription: 'Create an issue on GitHub',
		inputSchema: {
			type: 'object',
			properties: {
				owner: { type: 'string' },
				repo: { type: 'string' },
				title: { type: 'string' }
			}
		},
		discoveredAt: new Date('2026-01-15'),
		...overrides
	};
}

// ============================================================================
// Test setup
// ============================================================================

beforeEach(() => {
	vi.clearAllMocks();
});

// ============================================================================
// Catalog Endpoints
// ============================================================================

describe('GET /api/admin/mcp/catalog', () => {
	it('returns all catalog items', async () => {
		const items = [createMockCatalogItem(), createMockCatalogItem({ catalogId: 'postgres' })];
		mockGetCatalog.mockResolvedValue(items);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/mcp/catalog' });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.items).toHaveLength(2);
		expect(body.items[0].catalogId).toBe('github');
	});

	it('returns empty array when no items', async () => {
		mockGetCatalog.mockResolvedValue([]);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/mcp/catalog' });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.items).toHaveLength(0);
	});

	it('returns 401 without auth', async () => {
		const app = await buildTestApp();
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/mcp/catalog' });
		expect(res.statusCode).toBe(401);
	});

	it('returns 403 without admin:all permission', async () => {
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['workflows:read']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/mcp/catalog' });
		expect(res.statusCode).toBe(403);
	});
});

describe('GET /api/admin/mcp/catalog/:catalogId', () => {
	it('returns catalog item detail', async () => {
		const item = createMockCatalogItem();
		mockGetCatalogItem.mockResolvedValue(item);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/mcp/catalog/550e8400-e29b-41d4-a716-446655440000'
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.catalogId).toBe('github');
		expect(body.displayName).toBe('GitHub');
	});

	it('returns 404 for unknown catalogId', async () => {
		mockGetCatalogItem.mockResolvedValue(null);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/mcp/catalog/unknown-id'
		});
		expect(res.statusCode).toBe(404);
	});
});

// ============================================================================
// Server List Endpoints
// ============================================================================

describe('GET /api/admin/mcp/servers', () => {
	it('returns org servers without credentials', async () => {
		const servers = [
			{ ...createMockServer(), credentials: undefined },
			{ ...createMockServer({ serverName: 'another-server' }), credentials: undefined }
		];
		mockListByOrg.mockResolvedValue(servers);

		const app = await buildTestApp();
		app.addHook('onRequest', async (request) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).user = { id: 'user-1' };
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).permissions = ['admin:all'];
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).session = { activeOrganizationId: 'org-123' };
		});
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/mcp/servers' });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.servers).toHaveLength(2);
		expect(body.servers[0]).not.toHaveProperty('credentials');
		expect(mockListByOrg).toHaveBeenCalledWith('org-123');
	});

	it('returns empty array for org with no servers', async () => {
		mockListByOrg.mockResolvedValue([]);

		const app = await buildTestApp();
		app.addHook('onRequest', async (request) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).user = { id: 'user-1' };
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).permissions = ['admin:all'];
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).session = { activeOrganizationId: 'org-456' };
		});
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/mcp/servers' });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.servers).toHaveLength(0);
	});
});

describe('GET /api/admin/mcp/servers/:id', () => {
	it('returns server with credentials', async () => {
		const server = createMockServer();
		mockGetById.mockResolvedValue(server);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001'
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.serverName).toBe('my-github-server');
		expect(body.credentials).toHaveLength(1);
		expect(body.credentials[0].key).toBe('token');
	});

	it('returns 404 for unknown id', async () => {
		mockGetById.mockResolvedValue(null);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/mcp/servers/770e8400-e29b-41d4-a716-446655440099'
		});
		expect(res.statusCode).toBe(404);
	});

	it('prevents IDOR by verifying org ownership', async () => {
		const server = createMockServer({ orgId: 'org-456' });
		mockGetById.mockResolvedValue(server);

		const app = await buildTestApp();
		app.addHook('onRequest', async (request) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).user = { id: 'user-1' };
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).permissions = ['admin:all'];
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).session = { activeOrganizationId: 'org-123' }; // Different org!
		});
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001'
		});
		expect(res.statusCode).toBe(404);
	});
});

// ============================================================================
// Server Creation
// ============================================================================

describe('POST /api/admin/mcp/servers', () => {
	it('creates custom server with valid input', async () => {
		const created = createMockServer({ serverType: 'custom' });
		mockCreate.mockResolvedValue(created);

		const app = await buildTestApp();
		app.addHook('onRequest', async (request) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).user = { id: 'user-1' };
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).permissions = ['admin:all'];
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).session = { activeOrganizationId: 'org-123' };
		});
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/admin/mcp/servers',
			payload: {
				serverName: 'my-custom-server',
				displayName: 'My Custom Server',
				serverType: 'custom',
				transportType: 'sse',
				config: { url: 'https://example.com/mcp' }
			}
		});
		expect(res.statusCode).toBe(201);
		const body = res.json();
		expect(body.serverName).toBe('my-github-server');
	});

	it('rejects invalid serverName format', async () => {
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/admin/mcp/servers',
			payload: {
				serverName: 'Invalid_Name', // uppercase not allowed
				displayName: 'My Server',
				serverType: 'custom',
				transportType: 'sse',
				config: {}
			}
		});
		expect(res.statusCode).toBe(400);
	});

	it('returns 400 for missing required fields', async () => {
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/admin/mcp/servers',
			payload: {
				serverName: 'my-server'
				// missing displayName, serverType, transportType, config
			}
		});
		expect(res.statusCode).toBe(400);
	});
});

describe('POST /api/admin/mcp/servers/install', () => {
	it('installs from catalog with credentials', async () => {
		const installed = createMockServer();
		mockInstallFromCatalog.mockResolvedValue(installed);

		const app = await buildTestApp();
		app.addHook('onRequest', async (request) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).user = { id: 'user-1' };
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).permissions = ['admin:all'];
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).session = { activeOrganizationId: 'org-123' };
		});
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/admin/mcp/servers/install',
			payload: {
				catalogItemId: '550e8400-e29b-41d4-a716-446655440000',
				serverName: 'my-github-server',
				displayName: 'My GitHub Server',
				credentials: { token: 'ghp_secret...' }
			}
		});
		expect(res.statusCode).toBe(201);
		const body = res.json();
		expect(body.serverName).toBe('my-github-server');
	});

	it('returns 404 for unknown catalog item', async () => {
		mockInstallFromCatalog.mockRejectedValue(
			new NotFoundError('Catalog item not found: unknown-id')
		);

		const app = await buildTestApp();
		app.addHook('onRequest', async (request) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).user = { id: 'user-1' };
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).permissions = ['admin:all'];
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).session = { activeOrganizationId: 'org-123' };
		});
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/admin/mcp/servers/install',
			payload: {
				catalogItemId: '770e8400-e29b-41d4-a716-446655440099',
				serverName: 'my-server'
			}
		});
		expect(res.statusCode).toBe(404);
	});
});

describe('PUT /api/admin/mcp/servers/:id', () => {
	it('updates server with partial input', async () => {
		const original = createMockServer();
		const updated = { ...original, displayName: 'Updated Name' };
		mockGetById.mockResolvedValue(original);
		mockUpdate.mockResolvedValue(updated);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'PUT',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001',
			payload: {
				displayName: 'Updated Name'
			}
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.displayName).toBe('Updated Name');
	});
});

describe('DELETE /api/admin/mcp/servers/:id', () => {
	it('disconnects and deletes server', async () => {
		const server = createMockServer();
		mockGetById.mockResolvedValue(server);
		mockDisconnectServer.mockResolvedValue(undefined);
		mockDelete.mockResolvedValue(true);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'DELETE',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001'
		});
		expect(res.statusCode).toBe(204);
		expect(mockDisconnectServer).toHaveBeenCalledWith('660e8400-e29b-41d4-a716-446655440001');
		expect(mockDelete).toHaveBeenCalledWith('660e8400-e29b-41d4-a716-446655440001');
	});

	it('returns 204 on success', async () => {
		const server = createMockServer();
		mockGetById.mockResolvedValue(server);
		mockDisconnectServer.mockResolvedValue(undefined);
		mockDelete.mockResolvedValue(true);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'DELETE',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001'
		});
		expect(res.statusCode).toBe(204);
		expect(res.body).toBe('');
	});
});

// ============================================================================
// Connection Control
// ============================================================================

describe('POST /api/admin/mcp/servers/:id/connect', () => {
	it('connects server successfully', async () => {
		const server = createMockServer();
		mockGetById.mockResolvedValue(server);
		mockConnectServer.mockResolvedValue(undefined);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001/connect'
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.status).toBe('connected');
		expect(mockConnectServer).toHaveBeenCalledWith('660e8400-e29b-41d4-a716-446655440001');
	});

	it('returns error when connection fails', async () => {
		const server = createMockServer();
		mockGetById.mockResolvedValue(server);
		mockConnectServer.mockRejectedValue(new Error('Connection timeout'));

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001/connect'
		});
		expect(res.statusCode).toBe(500);
	});
});

describe('POST /api/admin/mcp/servers/:id/disconnect', () => {
	it('disconnects server', async () => {
		const server = createMockServer();
		mockGetById.mockResolvedValue(server);
		mockDisconnectServer.mockResolvedValue(undefined);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001/disconnect'
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.status).toBe('disconnected');
	});
});

describe('POST /api/admin/mcp/servers/:id/restart', () => {
	it('restarts server', async () => {
		const server = createMockServer();
		mockGetById.mockResolvedValue(server);
		mockRestartServer.mockResolvedValue(undefined);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001/restart'
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.status).toBe('connected');
	});
});

// ============================================================================
// Credentials
// ============================================================================

describe('PUT /api/admin/mcp/servers/:id/credentials/:key', () => {
	it('sets credential with valid input', async () => {
		const server = createMockServer();
		mockGetById.mockResolvedValue(server);
		mockSetCredential.mockResolvedValue(undefined);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'PUT',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001/credentials/token',
			payload: {
				value: 'new-secret-token',
				displayName: 'GitHub Token',
				credentialType: 'token'
			}
		});
		expect(res.statusCode).toBe(204);
		expect(mockSetCredential).toHaveBeenCalledWith(
			'660e8400-e29b-41d4-a716-446655440001',
			'token',
			expect.objectContaining({ value: 'new-secret-token' })
		);
	});

	it('rejects empty value', async () => {
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'PUT',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001/credentials/token',
			payload: {
				value: '', // empty
				credentialType: 'token'
			}
		});
		expect(res.statusCode).toBe(400);
	});
});

describe('DELETE /api/admin/mcp/servers/:id/credentials/:key', () => {
	it('deletes credential', async () => {
		const server = createMockServer();
		mockGetById.mockResolvedValue(server);
		mockDeleteCredential.mockResolvedValue(undefined);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'DELETE',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001/credentials/token'
		});
		expect(res.statusCode).toBe(204);
		expect(mockDeleteCredential).toHaveBeenCalledWith(
			'660e8400-e29b-41d4-a716-446655440001',
			'token'
		);
	});
});

// ============================================================================
// Tools & Metrics
// ============================================================================

describe('GET /api/admin/mcp/servers/:id/tools', () => {
	it('returns tool list', async () => {
		const server = createMockServer();
		const tools = [createMockTool(), createMockTool({ toolName: 'github_list_issues' })];
		mockGetById.mockResolvedValue(server);
		mockListServerTools.mockResolvedValue(tools);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001/tools'
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.tools).toHaveLength(2);
		expect(body.tools[0].toolName).toBe('github_create_issue');
	});
});

describe('POST /api/admin/mcp/servers/:id/tools/:toolName/test', () => {
	it('executes tool and returns result with duration', async () => {
		const server = createMockServer();
		mockGetById.mockResolvedValue(server);
		mockExecuteToolOnServer.mockResolvedValue({
			result: { issue_id: 123, url: 'https://github.com/...' },
			durationMs: 450
		});

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001/tools/github_create_issue/test',
			payload: {
				args: { owner: 'owner', repo: 'repo', title: 'Test issue' }
			}
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.result).toEqual({ issue_id: 123, url: 'https://github.com/...' });
		expect(body.durationMs).toBe(450);
	});
});

describe('GET /api/admin/mcp/servers/:id/metrics', () => {
	it('returns metrics summary', async () => {
		const server = createMockServer();
		const metrics: MetricsSummary = {
			totalCalls: 150,
			successCount: 140,
			failureCount: 10,
			avgDurationMs: 320,
			toolBreakdown: [
				{
					toolName: 'github_create_issue',
					calls: 50,
					avgMs: 400,
					successRate: 0.96
				},
				{
					toolName: 'github_list_issues',
					calls: 100,
					avgMs: 280,
					successRate: 0.99
				}
			]
		};
		mockGetById.mockResolvedValue(server);
		mockGetMetrics.mockResolvedValue(metrics);

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001/metrics'
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.totalCalls).toBe(150);
		expect(body.toolBreakdown).toHaveLength(2);
	});

	it('supports optional since parameter', async () => {
		const server = createMockServer();
		mockGetById.mockResolvedValue(server);
		mockGetMetrics.mockResolvedValue({
			totalCalls: 10,
			successCount: 9,
			failureCount: 1,
			avgDurationMs: 250,
			toolBreakdown: []
		});

		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1', activeOrganizationId: 'org-123' }, ['admin:all']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const since = '2026-01-01T00:00:00Z';
		const res = await app.inject({
			method: 'GET',
			url: `/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001/metrics?since=${encodeURIComponent(since)}`
		});
		expect(res.statusCode).toBe(200);
		expect(mockGetMetrics).toHaveBeenCalledWith(
			'660e8400-e29b-41d4-a716-446655440001',
			expect.any(Date)
		);
	});
});

describe('GET /api/admin/mcp/servers/:id/health', () => {
	it('returns health status', async () => {
		const server = createMockServer();
		mockGetById.mockResolvedValue(server);
		mockGetServerHealth.mockResolvedValue({
			status: 'connected',
			tools: 15,
			uptime: 3600
		});

		const app = await buildTestApp();
		app.addHook('onRequest', async (request) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).user = { id: 'user-1' };
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).permissions = ['admin:all'];
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(request as any).session = { activeOrganizationId: 'org-123' };
		});
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001/health'
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.status).toBe('connected');
		expect(body.tools).toBe(15);
		expect(body.uptime).toBe(3600);
	});
});

// ============================================================================
// Auth Tests
// ============================================================================

describe('Auth checks', () => {
	it('returns 401 without auth on any endpoint', async () => {
		const app = await buildTestApp();
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/mcp/catalog' });
		expect(res.statusCode).toBe(401);
	});

	it('returns 403 without admin:all role on any endpoint', async () => {
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read', 'workflows:read']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/mcp/servers' });
		expect(res.statusCode).toBe(403);
	});

	it('requires admin:all permission on connection operations', async () => {
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['workflows:execute']);
		await app.register(mcpAdminRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/admin/mcp/servers/660e8400-e29b-41d4-a716-446655440001/connect'
		});
		expect(res.statusCode).toBe(403);
	});
});
