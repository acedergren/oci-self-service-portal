/**
 * Unit tests for mcpServerRepository (Phase 10 task 10)
 *
 * Tests all CRUD operations, encryption/decryption, catalog items, caching, and metrics.
 * Uses forwarding mock pattern to survive mockReset: true.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mcpServerRepository } from '@portal/server/admin/mcp-repository.js';
import { ValidationError } from '@portal/server/errors.js';
import type {
	McpCatalogRow,
	McpServerRow,
	McpCredentialRow,
	McpToolCacheRow,
	McpResourceCacheRow
} from '@portal/server/admin/mcp-types.js';

// ============================================================================
// Mock setup — forwarding pattern for mockReset: true
// ============================================================================

const mockExecute = vi.fn();
const mockCommit = vi.fn();
const mockGetConnection = vi.fn();
const mockEncrypt = vi.fn();
const mockDecrypt = vi.fn();

vi.mock('@portal/server/oracle/connection', () => ({
	withConnection: (...args: unknown[]) => mockGetConnection(...args)
}));

vi.mock('@portal/server/auth/crypto', () => ({
	encryptSecret: (...args: unknown[]) => mockEncrypt(...args),
	decryptSecret: (...args: unknown[]) => mockDecrypt(...args)
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: vi.fn(() => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	}))
}));

// ============================================================================
// Test setup
// ============================================================================

beforeEach(() => {
	// Clear all mocks to reset between tests
	vi.clearAllMocks();

	// Setup mock connection — this object is passed to callback in withConnection
	const mockConn = {
		execute: mockExecute,
		commit: mockCommit,
		OBJECT: 4003 // oracledb.OUT_FORMAT_OBJECT
	};

	// withConnection implementation: receives callback, passes connection to it
	mockGetConnection.mockImplementation((fn: (conn: unknown) => unknown) => fn(mockConn));

	// Encryption/decryption defaults
	mockEncrypt.mockResolvedValue({
		encrypted: Buffer.from('enc-data'),
		iv: Buffer.from('iv-data'),
		tag: Buffer.from('tag-data')
	});

	mockDecrypt.mockResolvedValue('decrypted-secret-value');
});

// ============================================================================
// Catalog Operations
// ============================================================================

describe('getCatalog', () => {
	it('returns all active catalog items ordered by sort_order', async () => {
		const mockRows: McpCatalogRow[] = [
			{
				ID: 'cat-1',
				CATALOG_ID: 'github',
				DISPLAY_NAME: 'GitHub',
				DESCRIPTION: 'GitHub MCP server',
				CATEGORY: 'Code',
				ICON_URL: 'https://example.com/github.png',
				DOCUMENTATION_URL: 'https://docs.example.com/github',
				DOCKER_IMAGE: 'mcp/github:latest',
				DOCKER_TAG: 'latest',
				DEFAULT_CONFIG: JSON.stringify({ transport: 'stdio' }),
				REQUIRED_CREDENTIALS: JSON.stringify([
					{ key: 'token', displayName: 'Token', type: 'token' }
				]),
				SUPPORTS_TOOLS: 1,
				SUPPORTS_RESOURCES: 0,
				IS_FEATURED: 1,
				SORT_ORDER: 1,
				TAGS: JSON.stringify(['git', 'code']),
				STATUS: 'active',
				CREATED_AT: new Date('2026-01-01'),
				UPDATED_AT: new Date('2026-01-01')
			}
		];

		mockExecute.mockResolvedValueOnce({ rows: mockRows });

		const result = await mcpServerRepository.getCatalog();

		expect(result).toHaveLength(1);
		expect(result[0].catalogId).toBe('github');
		expect(result[0].displayName).toBe('GitHub');
		expect(result[0].isFeatured).toBe(true);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('SELECT * FROM mcp_catalog'),
			[],
			{ outFormat: 4003 }
		);
	});

	it('returns empty array when no catalog items', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const result = await mcpServerRepository.getCatalog();

		expect(result).toEqual([]);
	});

	it('handles null rows gracefully', async () => {
		mockExecute.mockResolvedValueOnce({ rows: null });

		const result = await mcpServerRepository.getCatalog();

		expect(result).toEqual([]);
	});
});

describe('getCatalogItem', () => {
	it('returns item by catalog_id', async () => {
		const mockRow: McpCatalogRow = {
			ID: 'cat-1',
			CATALOG_ID: 'postgres',
			DISPLAY_NAME: 'PostgreSQL',
			DESCRIPTION: 'PostgreSQL MCP server',
			CATEGORY: 'Data',
			ICON_URL: null,
			DOCUMENTATION_URL: null,
			DOCKER_IMAGE: null,
			DOCKER_TAG: 'latest',
			DEFAULT_CONFIG: JSON.stringify({ transport: 'http', url: 'http://localhost:3000' }),
			REQUIRED_CREDENTIALS: null,
			SUPPORTS_TOOLS: 1,
			SUPPORTS_RESOURCES: 0,
			IS_FEATURED: 0,
			SORT_ORDER: 0,
			TAGS: null,
			STATUS: 'active',
			CREATED_AT: new Date('2026-01-01'),
			UPDATED_AT: new Date('2026-01-01')
		};

		mockExecute.mockResolvedValueOnce({ rows: [mockRow] });

		const result = await mcpServerRepository.getCatalogItem('postgres');

		expect(result).toBeDefined();
		expect(result?.catalogId).toBe('postgres');
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('WHERE catalog_id = :catalogId'),
			{ catalogId: 'postgres' },
			{ outFormat: 4003 }
		);
	});

	it('returns undefined for non-existent catalog_id', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const result = await mcpServerRepository.getCatalogItem('nonexistent');

		expect(result).toBeUndefined();
	});
});

// ============================================================================
// Server Operations
// ============================================================================

describe('listByOrg', () => {
	const createServerRow = (overrides: Partial<McpServerRow> = {}): McpServerRow => ({
		ID: 'server-1',
		ORG_ID: 'org-1',
		SERVER_NAME: 'my-github',
		DISPLAY_NAME: 'My GitHub',
		DESCRIPTION: 'GitHub connection',
		SERVER_TYPE: 'catalog',
		TRANSPORT_TYPE: 'stdio',
		CATALOG_ITEM_ID: 'cat-1',
		CONFIG: JSON.stringify({ transport: 'stdio' }),
		DOCKER_IMAGE: null,
		DOCKER_CONTAINER_ID: null,
		DOCKER_STATUS: null,
		STATUS: 'connected',
		ENABLED: 1,
		LAST_CONNECTED_AT: new Date('2026-01-15'),
		LAST_ERROR: null,
		HEALTH_STATUS: null,
		TAGS: JSON.stringify(['production']),
		SORT_ORDER: 1,
		TOOL_COUNT: 5,
		CREATED_AT: new Date('2026-01-01'),
		UPDATED_AT: new Date('2026-01-15'),
		...overrides
	});

	it('returns servers for given org without credentials', async () => {
		const mockRows: McpServerRow[] = [createServerRow()];

		mockExecute.mockResolvedValueOnce({ rows: mockRows });

		const result = await mcpServerRepository.listByOrg('org-1');

		expect(result.servers).toHaveLength(1);
		expect(result.servers[0].id).toBe('server-1');
		expect(result.servers[0].serverName).toBe('my-github');
		expect(result.servers[0].toolCount).toBe(5);
		expect(result.servers[0].status).toBe('connected');
		expect(result.invalidServers).toEqual([]);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('WHERE s.org_id = :orgId'),
			{ orgId: 'org-1' },
			{ outFormat: 4003 }
		);
	});

	it('returns empty array for org with no servers', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const result = await mcpServerRepository.listByOrg('org-empty');

		expect(result.servers).toEqual([]);
		expect(result.invalidServers).toEqual([]);
	});

	it('includes tool count from cache', async () => {
		const mockRows: McpServerRow[] = [
			createServerRow({
				SERVER_NAME: 'test',
				DISPLAY_NAME: 'Test',
				DESCRIPTION: null,
				SERVER_TYPE: 'custom',
				TRANSPORT_TYPE: 'sse',
				CATALOG_ITEM_ID: null,
				CONFIG: JSON.stringify({}),
				STATUS: 'disconnected',
				LAST_CONNECTED_AT: null,
				TAGS: null,
				SORT_ORDER: 0,
				TOOL_COUNT: 12
			})
		];

		mockExecute.mockResolvedValueOnce({ rows: mockRows });

		const result = await mcpServerRepository.listByOrg('org-1');

		expect(result.servers[0].toolCount).toBe(12);
	});

	it('skips invalid rows and returns invalidServers metadata', async () => {
		const validRow = createServerRow();
		const invalidRow = {
			...createServerRow({ ID: 'bad', SERVER_NAME: 'poisoned-server' }),
			CONFIG: 'not json'
		};

		mockExecute.mockResolvedValueOnce({ rows: [validRow, invalidRow] });

		const result = await mcpServerRepository.listByOrg('org-1');

		expect(result.servers).toHaveLength(1);
		expect(result.servers[0].id).toBe('server-1');
		expect(result.invalidServers).toEqual([
			expect.objectContaining({
				id: 'bad',
				serverName: 'poisoned-server',
				field: 'config',
				reason: 'Invalid JSON payload'
			})
		]);
	});
});

describe('getById', () => {
	it('returns server with decrypted credentials', async () => {
		const mockServerRow: McpServerRow = {
			ID: 'server-1',
			ORG_ID: 'org-1',
			SERVER_NAME: 'my-github',
			DISPLAY_NAME: 'My GitHub',
			DESCRIPTION: null,
			SERVER_TYPE: 'catalog',
			TRANSPORT_TYPE: 'stdio',
			CATALOG_ITEM_ID: 'cat-1',
			CONFIG: JSON.stringify({ transport: 'stdio' }),
			DOCKER_IMAGE: null,
			DOCKER_CONTAINER_ID: null,
			DOCKER_STATUS: null,
			STATUS: 'connected',
			ENABLED: 1,
			LAST_CONNECTED_AT: new Date('2026-01-15'),
			LAST_ERROR: null,
			HEALTH_STATUS: null,
			TAGS: null,
			SORT_ORDER: 0,
			TOOL_COUNT: 3,
			CREATED_AT: new Date('2026-01-01'),
			UPDATED_AT: new Date('2026-01-01')
		};

		const mockCredRows: McpCredentialRow[] = [
			{
				ID: 'cred-1',
				SERVER_ID: 'server-1',
				CREDENTIAL_KEY: 'github_token',
				DISPLAY_NAME: 'GitHub Token',
				CREDENTIAL_TYPE: 'token',
				VALUE_ENC: Buffer.from('enc-token'),
				VALUE_IV: Buffer.from('iv-token'),
				VALUE_TAG: Buffer.from('tag-token'),
				CREATED_AT: new Date('2026-01-01'),
				UPDATED_AT: new Date('2026-01-01')
			}
		];

		mockExecute
			.mockResolvedValueOnce({ rows: [mockServerRow] }) // getById server query
			.mockResolvedValueOnce({ rows: mockCredRows }); // getDecryptedCredentials query

		const result = await mcpServerRepository.getById('server-1');

		expect(result).toBeDefined();
		expect(result?.serverName).toBe('my-github');
		expect(result?.credentials).toHaveLength(1);
		expect(result?.credentials?.[0].key).toBe('github_token');
		expect(result?.credentials?.[0].value).toBe('decrypted-secret-value');
	});

	it('returns undefined for non-existent id', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const result = await mcpServerRepository.getById('nonexistent');

		expect(result).toBeUndefined();
	});

	it('handles decryption failure gracefully', async () => {
		const mockServerRow: McpServerRow = {
			ID: 'server-1',
			ORG_ID: 'org-1',
			SERVER_NAME: 'test',
			DISPLAY_NAME: 'Test',
			DESCRIPTION: null,
			SERVER_TYPE: 'custom',
			TRANSPORT_TYPE: 'sse',
			CATALOG_ITEM_ID: null,
			CONFIG: JSON.stringify({}),
			DOCKER_IMAGE: null,
			DOCKER_CONTAINER_ID: null,
			DOCKER_STATUS: null,
			STATUS: 'disconnected',
			ENABLED: 1,
			LAST_CONNECTED_AT: null,
			LAST_ERROR: null,
			HEALTH_STATUS: null,
			TAGS: null,
			SORT_ORDER: 0,
			TOOL_COUNT: 0,
			CREATED_AT: new Date('2026-01-01'),
			UPDATED_AT: new Date('2026-01-01')
		};

		const mockCredRows: McpCredentialRow[] = [
			{
				ID: 'cred-1',
				SERVER_ID: 'server-1',
				CREDENTIAL_KEY: 'bad_cred',
				DISPLAY_NAME: 'Bad Credential',
				CREDENTIAL_TYPE: 'token',
				VALUE_ENC: Buffer.from('bad-enc'),
				VALUE_IV: Buffer.from('bad-iv'),
				VALUE_TAG: Buffer.from('bad-tag'),
				CREATED_AT: new Date('2026-01-01'),
				UPDATED_AT: new Date('2026-01-01')
			}
		];

		mockExecute
			.mockResolvedValueOnce({ rows: [mockServerRow] })
			.mockResolvedValueOnce({ rows: mockCredRows });

		// Mock decryption failure
		mockDecrypt.mockRejectedValueOnce(new Error('Decryption failed'));

		const result = await mcpServerRepository.getById('server-1');

		expect(result).toBeDefined();
		expect(result?.credentials).toEqual([]); // Failed cred is skipped
	});

	it('throws ValidationError when server row contains invalid JSON config', async () => {
		const invalidServerRow: McpServerRow = {
			ID: 'server-invalid',
			ORG_ID: 'org-1',
			SERVER_NAME: 'broken',
			DISPLAY_NAME: 'Broken Server',
			DESCRIPTION: null,
			SERVER_TYPE: 'custom',
			TRANSPORT_TYPE: 'stdio',
			CATALOG_ITEM_ID: null,
			CONFIG: 'not json',
			DOCKER_IMAGE: null,
			DOCKER_CONTAINER_ID: null,
			DOCKER_STATUS: null,
			STATUS: 'connected',
			ENABLED: 1,
			LAST_CONNECTED_AT: null,
			LAST_ERROR: null,
			HEALTH_STATUS: null,
			TAGS: null,
			SORT_ORDER: 0,
			TOOL_COUNT: 0,
			CREATED_AT: new Date('2026-01-01'),
			UPDATED_AT: new Date('2026-01-01')
		};

		mockExecute
			.mockResolvedValueOnce({ rows: [invalidServerRow] })
			.mockResolvedValueOnce({ rows: [] });

		await expect(mcpServerRepository.getById('server-invalid')).rejects.toThrow(ValidationError);
	});
});

describe('create', () => {
	it('inserts new server with correct defaults', async () => {
		let callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				// INSERT
				return undefined;
			} else if (callCount === 2) {
				// getById server
				return {
					rows: [
						{
							ID: 'server-uuid',
							ORG_ID: 'org-1',
							SERVER_NAME: 'new-server',
							DISPLAY_NAME: 'New Server',
							DESCRIPTION: null,
							SERVER_TYPE: 'custom',
							TRANSPORT_TYPE: 'stdio',
							CATALOG_ITEM_ID: null,
							CONFIG: JSON.stringify({ command: 'npx' }),
							DOCKER_IMAGE: null,
							DOCKER_CONTAINER_ID: null,
							DOCKER_STATUS: null,
							STATUS: 'disconnected',
							ENABLED: 1,
							LAST_CONNECTED_AT: null,
							LAST_ERROR: null,
							HEALTH_STATUS: null,
							TAGS: null,
							SORT_ORDER: 0,
							TOOL_COUNT: 0,
							CREATED_AT: new Date('2026-01-01'),
							UPDATED_AT: new Date('2026-01-01')
						}
					]
				};
			} else {
				// getDecryptedCredentials
				return { rows: [] };
			}
		});

		const result = await mcpServerRepository.create('org-1', {
			serverName: 'new-server',
			displayName: 'New Server',
			serverType: 'custom',
			transportType: 'stdio',
			config: { command: 'npx' }
		});

		expect(result.serverName).toBe('new-server');
		expect(result.status).toBe('disconnected');
	});
});

describe('installFromCatalog', () => {
	it('creates server from catalog item with encrypted credentials', async () => {
		let callCount = 0;
		mockExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				// getCatalogItem
				return {
					rows: [
						{
							ID: 'cat-1',
							CATALOG_ID: 'github',
							DISPLAY_NAME: 'GitHub',
							DESCRIPTION: 'GitHub MCP',
							CATEGORY: 'Code',
							ICON_URL: null,
							DOCUMENTATION_URL: null,
							DOCKER_IMAGE: 'mcp/github',
							DOCKER_TAG: 'latest',
							DEFAULT_CONFIG: JSON.stringify({
								transport: 'stdio',
								command: 'npx',
								args: ['@github/mcp']
							}),
							REQUIRED_CREDENTIALS: JSON.stringify([
								{
									key: 'github_token',
									displayName: 'GitHub Token',
									description: 'Your personal access token',
									type: 'token'
								}
							]),
							SUPPORTS_TOOLS: 1,
							SUPPORTS_RESOURCES: 0,
							IS_FEATURED: 1,
							SORT_ORDER: 0,
							TAGS: JSON.stringify(['github']),
							STATUS: 'active',
							CREATED_AT: new Date('2026-01-01'),
							UPDATED_AT: new Date('2026-01-01')
						}
					]
				};
			} else if (callCount === 2) {
				// INSERT server
				return undefined;
			} else if ([3, 6].includes(callCount)) {
				// getById server
				return {
					rows: [
						{
							ID: 'server-123',
							ORG_ID: 'org-1',
							SERVER_NAME: 'my-github-install',
							DISPLAY_NAME: 'GitHub',
							DESCRIPTION: null,
							SERVER_TYPE: 'catalog',
							TRANSPORT_TYPE: 'stdio',
							CATALOG_ITEM_ID: 'cat-1',
							CONFIG: JSON.stringify({ transport: 'stdio', command: 'npx', args: ['@github/mcp'] }),
							DOCKER_IMAGE: 'mcp/github',
							DOCKER_CONTAINER_ID: null,
							DOCKER_STATUS: null,
							STATUS: 'disconnected',
							ENABLED: 1,
							LAST_CONNECTED_AT: null,
							LAST_ERROR: null,
							HEALTH_STATUS: null,
							TAGS: JSON.stringify(['github']),
							SORT_ORDER: 0,
							TOOL_COUNT: 0,
							CREATED_AT: new Date('2026-01-01'),
							UPDATED_AT: new Date('2026-01-01')
						}
					]
				};
			} else if ([4, 7].includes(callCount)) {
				// getDecryptedCredentials
				return { rows: [] };
			} else if (callCount === 5) {
				// MERGE credential
				return undefined;
			}
		});

		const result = await mcpServerRepository.installFromCatalog('org-1', {
			catalogItemId: 'cat-1',
			serverName: 'my-github-install',
			displayName: 'GitHub',
			credentials: {
				github_token: 'ghp_abc123'
			}
		});

		expect(result.serverType).toBe('catalog');
		expect(result.catalogItemId).toBe('cat-1');
		expect(mockEncrypt).toHaveBeenCalledWith('ghp_abc123');
	});

	it('throws when catalog item not found', async () => {
		mockExecute.mockImplementationOnce(async () => ({ rows: [] }));

		await expect(
			mcpServerRepository.installFromCatalog('org-1', {
				catalogItemId: 'nonexistent',
				serverName: 'test',
				displayName: 'Test'
			})
		).rejects.toThrow('Catalog item not found');
	});
});

describe('update', () => {
	it('only updates provided fields', async () => {
		const mockServerRow: McpServerRow = {
			ID: 'server-1',
			ORG_ID: 'org-1',
			SERVER_NAME: 'test',
			DISPLAY_NAME: 'Updated Display Name',
			DESCRIPTION: 'New description',
			SERVER_TYPE: 'custom',
			TRANSPORT_TYPE: 'sse',
			CATALOG_ITEM_ID: null,
			CONFIG: JSON.stringify({}),
			DOCKER_IMAGE: null,
			DOCKER_CONTAINER_ID: null,
			DOCKER_STATUS: null,
			STATUS: 'connected',
			ENABLED: 1,
			LAST_CONNECTED_AT: new Date('2026-01-15'),
			LAST_ERROR: null,
			HEALTH_STATUS: null,
			TAGS: null,
			SORT_ORDER: 0,
			TOOL_COUNT: 0,
			CREATED_AT: new Date('2026-01-01'),
			UPDATED_AT: new Date('2026-01-20')
		};

		mockExecute
			.mockResolvedValueOnce({ rows: [mockServerRow] }) // getById existing
			.mockResolvedValueOnce({ rows: [] }) // getDecryptedCredentials
			.mockResolvedValueOnce(undefined) // UPDATE
			.mockResolvedValueOnce({ rows: [mockServerRow] }) // getById updated
			.mockResolvedValueOnce({ rows: [] }); // getDecryptedCredentials

		const result = await mcpServerRepository.update('server-1', {
			displayName: 'Updated Display Name',
			description: 'New description'
		});

		expect(result.displayName).toBe('Updated Display Name');
		expect(result.description).toBe('New description');
	});

	it('always updates updated_at', async () => {
		const mockServerRow: McpServerRow = {
			ID: 'server-1',
			ORG_ID: 'org-1',
			SERVER_NAME: 'test',
			DISPLAY_NAME: 'Test',
			DESCRIPTION: null,
			SERVER_TYPE: 'custom',
			TRANSPORT_TYPE: 'stdio',
			CATALOG_ITEM_ID: null,
			CONFIG: JSON.stringify({}),
			DOCKER_IMAGE: null,
			DOCKER_CONTAINER_ID: null,
			DOCKER_STATUS: null,
			STATUS: 'disconnected',
			ENABLED: 1,
			LAST_CONNECTED_AT: null,
			LAST_ERROR: null,
			HEALTH_STATUS: null,
			TAGS: null,
			SORT_ORDER: 0,
			TOOL_COUNT: 0,
			CREATED_AT: new Date('2026-01-01'),
			UPDATED_AT: new Date('2026-01-01')
		};

		mockExecute
			.mockResolvedValueOnce({ rows: [mockServerRow] }) // getById existing
			.mockResolvedValueOnce({ rows: [] }) // getDecryptedCredentials
			.mockResolvedValueOnce(undefined) // UPDATE
			.mockResolvedValueOnce({ rows: [mockServerRow] }) // getById updated
			.mockResolvedValueOnce({ rows: [] }); // getDecryptedCredentials

		await mcpServerRepository.update('server-1', {
			displayName: 'New Name'
		});

		// Find the UPDATE call in mock calls
		const updateCalls = mockExecute.mock.calls.filter((call) => call[0]?.includes('UPDATE'));
		expect(updateCalls[0][0]).toContain('updated_at = SYSTIMESTAMP');
	});
});

describe('delete', () => {
	it('deletes server and returns true', async () => {
		mockExecute.mockImplementationOnce(async () => ({ rowsAffected: 1 }));

		const result = await mcpServerRepository.delete('server-1');

		expect(result).toBe(true);
	});

	it('returns false when server not found', async () => {
		mockExecute.mockImplementationOnce(async () => ({ rowsAffected: 0 }));

		const result = await mcpServerRepository.delete('nonexistent');

		expect(result).toBe(false);
	});
});

// ============================================================================
// Credential Operations
// ============================================================================

describe('setCredential', () => {
	it('encrypts and stores new credential', async () => {
		mockExecute.mockResolvedValueOnce(undefined); // MERGE

		await mcpServerRepository.setCredential('server-1', 'api_key', {
			value: 'secret-api-key',
			displayName: 'API Key',
			credentialType: 'api_key'
		});

		expect(mockEncrypt).toHaveBeenCalledWith('secret-api-key');
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('MERGE INTO mcp_server_credentials'),
			expect.objectContaining({
				serverId: 'server-1',
				key: 'api_key',
				displayName: 'API Key',
				credentialType: 'api_key'
			}),
			{ autoCommit: true }
		);
	});

	it('upserts existing credential', async () => {
		mockExecute.mockResolvedValueOnce(undefined); // MERGE

		await mcpServerRepository.setCredential('server-1', 'api_key', {
			value: 'new-secret-value',
			displayName: 'Updated API Key',
			credentialType: 'api_key'
		});

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('WHEN MATCHED THEN'),
			expect.any(Object),
			{ autoCommit: true }
		);
	});
});

describe('getDecryptedCredentials', () => {
	it('returns all credentials decrypted', async () => {
		const mockCredRows: McpCredentialRow[] = [
			{
				ID: 'cred-1',
				SERVER_ID: 'server-1',
				CREDENTIAL_KEY: 'token_1',
				DISPLAY_NAME: 'Token 1',
				CREDENTIAL_TYPE: 'token',
				VALUE_ENC: Buffer.from('enc1'),
				VALUE_IV: Buffer.from('iv1'),
				VALUE_TAG: Buffer.from('tag1'),
				CREATED_AT: new Date('2026-01-01'),
				UPDATED_AT: new Date('2026-01-01')
			},
			{
				ID: 'cred-2',
				SERVER_ID: 'server-1',
				CREDENTIAL_KEY: 'token_2',
				DISPLAY_NAME: 'Token 2',
				CREDENTIAL_TYPE: 'token',
				VALUE_ENC: Buffer.from('enc2'),
				VALUE_IV: Buffer.from('iv2'),
				VALUE_TAG: Buffer.from('tag2'),
				CREATED_AT: new Date('2026-01-01'),
				UPDATED_AT: new Date('2026-01-01')
			}
		];

		mockExecute.mockResolvedValueOnce({ rows: mockCredRows });
		mockDecrypt.mockResolvedValueOnce('decrypted-1').mockResolvedValueOnce('decrypted-2');

		const result = await mcpServerRepository.getDecryptedCredentials('server-1');

		expect(result).toHaveLength(2);
		expect(result[0].key).toBe('token_1');
		expect(result[0].value).toBe('decrypted-1');
		expect(result[1].key).toBe('token_2');
		expect(result[1].value).toBe('decrypted-2');
	});

	it('skips credentials that fail to decrypt', async () => {
		const mockCredRows: McpCredentialRow[] = [
			{
				ID: 'cred-1',
				SERVER_ID: 'server-1',
				CREDENTIAL_KEY: 'good_cred',
				DISPLAY_NAME: 'Good',
				CREDENTIAL_TYPE: 'token',
				VALUE_ENC: Buffer.from('enc-good'),
				VALUE_IV: Buffer.from('iv-good'),
				VALUE_TAG: Buffer.from('tag-good'),
				CREATED_AT: new Date('2026-01-01'),
				UPDATED_AT: new Date('2026-01-01')
			},
			{
				ID: 'cred-2',
				SERVER_ID: 'server-1',
				CREDENTIAL_KEY: 'bad_cred',
				DISPLAY_NAME: 'Bad',
				CREDENTIAL_TYPE: 'token',
				VALUE_ENC: Buffer.from('enc-bad'),
				VALUE_IV: Buffer.from('iv-bad'),
				VALUE_TAG: Buffer.from('tag-bad'),
				CREATED_AT: new Date('2026-01-01'),
				UPDATED_AT: new Date('2026-01-01')
			}
		];

		mockExecute.mockResolvedValueOnce({ rows: mockCredRows });

		// First call succeeds, second fails
		mockDecrypt.mockResolvedValueOnce('good-value').mockRejectedValueOnce(new Error('Corrupted'));

		const result = await mcpServerRepository.getDecryptedCredentials('server-1');

		expect(result).toHaveLength(1);
		expect(result[0].key).toBe('good_cred');
		expect(result[0].value).toBe('good-value');
	});
});

// ============================================================================
// Tool/Resource Cache Operations
// ============================================================================

describe('cacheTools', () => {
	it('replaces existing tools with new ones', async () => {
		mockExecute.mockResolvedValueOnce(undefined); // DELETE
		mockExecute.mockResolvedValueOnce(undefined); // INSERT 1
		mockExecute.mockResolvedValueOnce(undefined); // INSERT 2
		mockCommit.mockResolvedValueOnce(undefined); // COMMIT

		await mcpServerRepository.cacheTools('server-1', [
			{
				toolName: 'create_issue',
				toolDescription: 'Create a GitHub issue',
				inputSchema: { type: 'object', properties: { title: { type: 'string' } } }
			},
			{
				toolName: 'list_repos',
				toolDescription: 'List repositories',
				inputSchema: { type: 'object', properties: { org: { type: 'string' } } }
			}
		]);

		// Should call: DELETE, INSERT, INSERT, COMMIT
		expect(mockExecute).toHaveBeenCalledTimes(3);
		expect(mockCommit).toHaveBeenCalledTimes(1);
		expect(mockExecute.mock.calls[0][0]).toContain('DELETE FROM mcp_tool_cache');
		expect(mockExecute.mock.calls[1][0]).toContain('INSERT INTO mcp_tool_cache');
	});
});

describe('getCachedTools', () => {
	it('returns tools ordered by name', async () => {
		const mockRows: McpToolCacheRow[] = [
			{
				ID: 'tool-1',
				SERVER_ID: 'server-1',
				TOOL_NAME: 'create_issue',
				TOOL_DESCRIPTION: 'Create issue',
				INPUT_SCHEMA: JSON.stringify({ type: 'object' }),
				DISCOVERED_AT: new Date('2026-01-15')
			},
			{
				ID: 'tool-2',
				SERVER_ID: 'server-1',
				TOOL_NAME: 'list_repos',
				TOOL_DESCRIPTION: 'List repos',
				INPUT_SCHEMA: JSON.stringify({ type: 'object' }),
				DISCOVERED_AT: new Date('2026-01-15')
			}
		];

		mockExecute.mockResolvedValueOnce({ rows: mockRows });

		const result = await mcpServerRepository.getCachedTools('server-1');

		expect(result).toHaveLength(2);
		expect(result[0].toolName).toBe('create_issue');
		expect(mockExecute.mock.calls[0][0]).toContain('ORDER BY tool_name');
	});

	it('returns empty array when no cache', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const result = await mcpServerRepository.getCachedTools('server-1');

		expect(result).toEqual([]);
	});
});

describe('cacheResources', () => {
	it('replaces existing resources with new ones', async () => {
		mockExecute.mockResolvedValueOnce(undefined); // DELETE
		mockExecute.mockResolvedValueOnce(undefined); // INSERT 1
		mockCommit.mockResolvedValueOnce(undefined); // COMMIT

		await mcpServerRepository.cacheResources('server-1', [
			{
				resourceUri: 'file:///etc/config',
				resourceName: 'Config File',
				description: 'System config',
				mimeType: 'text/plain'
			}
		]);

		expect(mockExecute).toHaveBeenCalledTimes(2);
		expect(mockCommit).toHaveBeenCalledTimes(1);
	});
});

describe('getCachedResources', () => {
	it('returns resources ordered by name', async () => {
		const mockRows: McpResourceCacheRow[] = [
			{
				ID: 'res-1',
				SERVER_ID: 'server-1',
				RESOURCE_URI: 'file:///path/to/file',
				RESOURCE_NAME: 'File A',
				DESCRIPTION: 'First file',
				MIME_TYPE: 'text/plain',
				DISCOVERED_AT: new Date('2026-01-15')
			}
		];

		mockExecute.mockResolvedValueOnce({ rows: mockRows });

		const result = await mcpServerRepository.getCachedResources('server-1');

		expect(result).toHaveLength(1);
		expect(result[0].resourceName).toBe('File A');
		expect(mockExecute.mock.calls[0][0]).toContain('ORDER BY resource_name');
	});
});

// ============================================================================
// Metrics Operations
// ============================================================================

describe('recordToolCall', () => {
	it('inserts metric record', async () => {
		mockExecute.mockResolvedValueOnce(undefined);

		await mcpServerRepository.recordToolCall({
			serverId: 'server-1',
			orgId: 'org-1',
			toolName: 'create_issue',
			durationMs: 250,
			success: true
		});

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO mcp_server_metrics'),
			expect.objectContaining({
				serverId: 'server-1',
				toolName: 'create_issue',
				durationMs: 250,
				success: 1
			}),
			{ autoCommit: true }
		);
	});

	it('does not throw on failure', async () => {
		mockExecute.mockRejectedValueOnce(new Error('Database error'));

		// Should not throw
		await expect(
			mcpServerRepository.recordToolCall({
				serverId: 'server-1',
				orgId: 'org-1',
				toolName: 'test',
				durationMs: 100,
				success: false,
				errorMessage: 'Test error'
			})
		).resolves.toBeUndefined();
	});
});

describe('getMetrics', () => {
	it('returns correct aggregation', async () => {
		mockExecute
			.mockResolvedValueOnce({
				rows: [
					{
						TOTAL_CALLS: 100,
						SUCCESS_COUNT: 85,
						FAILURE_COUNT: 15,
						AVG_DURATION_MS: 320
					}
				]
			})
			.mockResolvedValueOnce({
				rows: [
					{
						TOOL_NAME: 'create_issue',
						CALLS: 50,
						AVG_MS: 250,
						SUCCESS_RATE: 0.96
					},
					{
						TOOL_NAME: 'list_repos',
						CALLS: 50,
						AVG_MS: 390,
						SUCCESS_RATE: 0.74
					}
				]
			});

		const result = await mcpServerRepository.getMetrics('server-1');

		expect(result.totalCalls).toBe(100);
		expect(result.successCount).toBe(85);
		expect(result.failureCount).toBe(15);
		expect(result.avgDurationMs).toBe(320);
		expect(result.toolBreakdown).toHaveLength(2);
		expect(result.toolBreakdown[0].toolName).toBe('create_issue');
		expect(result.toolBreakdown[0].successRate).toBe(0.96);
	});

	it('filters by since date when provided', async () => {
		const sinceDate = new Date('2026-01-15');

		mockExecute
			.mockResolvedValueOnce({
				rows: [{ TOTAL_CALLS: 10, SUCCESS_COUNT: 8, FAILURE_COUNT: 2, AVG_DURATION_MS: 150 }]
			})
			.mockResolvedValueOnce({ rows: [] });

		await mcpServerRepository.getMetrics('server-1', sinceDate);

		// Check that 'since' binding was included
		const summaryCall = mockExecute.mock.calls[0];
		expect(summaryCall[1]).toEqual(expect.objectContaining({ since: sinceDate }));
		expect(summaryCall[0]).toContain('recorded_at >= :since');
	});

	it('returns zero metrics when no data', async () => {
		mockExecute
			.mockResolvedValueOnce({
				rows: [{ TOTAL_CALLS: 0, SUCCESS_COUNT: 0, FAILURE_COUNT: 0, AVG_DURATION_MS: 0 }]
			})
			.mockResolvedValueOnce({ rows: [] });

		const result = await mcpServerRepository.getMetrics('server-1');

		expect(result.totalCalls).toBe(0);
		expect(result.toolBreakdown).toEqual([]);
	});
});

// ============================================================================
// Additional Edge Cases
// ============================================================================

describe('Status Updates', () => {
	it('updateStatus sets status and error message', async () => {
		mockExecute.mockResolvedValueOnce(undefined);

		await mcpServerRepository.updateStatus('server-1', 'error', 'Connection timeout');

		expect(mockExecute.mock.calls[0][0]).toContain('UPDATE mcp_servers');
		expect(mockExecute.mock.calls[0][1]).toEqual(
			expect.objectContaining({
				id: 'server-1',
				status: 'error',
				lastError: 'Connection timeout'
			})
		);
	});

	it('updateDockerInfo updates container details', async () => {
		mockExecute.mockResolvedValueOnce(undefined);

		await mcpServerRepository.updateDockerInfo('server-1', 'container-abc123', 'running');

		expect(mockExecute.mock.calls[0][0]).toContain('docker_container_id');
		expect(mockExecute.mock.calls[0][1]).toEqual(
			expect.objectContaining({
				id: 'server-1',
				containerId: 'container-abc123',
				dockerStatus: 'running'
			})
		);
	});
});
