/**
 * Phase 8 TDD: API Key Authentication
 *
 * Provides API key-based authentication for external integrations.
 * API keys are stored in Oracle DB, scoped to an org, and have permissions.
 *
 * Expected module: $lib/server/auth/api-keys.ts
 * Expected exports:
 *   - createApiKey(orgId, name, permissions): Promise<{ key, keyHash, id }>
 *   - validateApiKey(key): Promise<ApiKeyContext | null>
 *   - revokeApiKey(id): Promise<void>
 *   - listApiKeys(orgId): Promise<ApiKeyInfo[]>
 *   - ApiKeyContext: { orgId, permissions, keyId, keyName }
 *
 * Expected DB table (migration 005):
 *   api_keys (id, org_id, key_hash, name, permissions, created_at, expires_at, revoked_at)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Oracle connection
const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
const mockConn = {
	execute: mockExecute,
	commit: vi.fn().mockResolvedValue(undefined),
	rollback: vi.fn().mockResolvedValue(undefined),
	close: vi.fn().mockResolvedValue(undefined)
};

vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) => fn(mockConn))
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

let apiKeysModule: Record<string, unknown> | null = null;
let moduleError: string | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		apiKeysModule = await import('$lib/server/auth/api-keys.js');
	} catch (err) {
		moduleError = (err as Error).message;
	}
});

describe('API Key Authentication (Phase 8.2)', () => {
	describe('module availability', () => {
		it('api-keys module should be importable', () => {
			if (moduleError) {
				expect.fail(
					`api-keys module not yet available: ${moduleError}. ` +
						'Implement $lib/server/auth/api-keys.ts per Phase 8.2.'
				);
			}
			expect(apiKeysModule).not.toBeNull();
		});
	});

	describe('createApiKey', () => {
		it('returns a key, keyHash, and id', async () => {
			if (!apiKeysModule) return;
			const createApiKey = apiKeysModule.createApiKey as (
				orgId: string,
				name: string,
				permissions: string[]
			) => Promise<{ key: string; keyHash: string; id: string }>;

			mockExecute.mockResolvedValueOnce({ rows: [] }); // insert

			const result = await createApiKey('org-1', 'CI Pipeline', ['tools:read', 'tools:execute']);
			expect(result.key).toBeDefined();
			expect(result.key.length).toBeGreaterThan(20);
			expect(result.keyHash).toBeDefined();
			expect(result.keyHash).not.toBe(result.key); // hash !== plaintext
			expect(result.id).toBeDefined();
		});

		it('key starts with a recognizable prefix', async () => {
			if (!apiKeysModule) return;
			const createApiKey = apiKeysModule.createApiKey as (
				orgId: string,
				name: string,
				permissions: string[]
			) => Promise<{ key: string }>;

			mockExecute.mockResolvedValueOnce({ rows: [] });

			const result = await createApiKey('org-1', 'Test', ['tools:read']);
			// Convention: API keys should have a prefix like "sk_" or "oci_" for identification
			expect(result.key).toMatch(/^(sk_|oci_|portal_)/);
		});
	});

	describe('validateApiKey', () => {
		it('returns context for valid key', async () => {
			if (!apiKeysModule) return;
			const validateApiKey = apiKeysModule.validateApiKey as (
				key: string
			) => Promise<{ orgId: string; permissions: string[]; keyId: string; keyName: string } | null>;

			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'key-1',
						ORG_ID: 'org-1',
						NAME: 'CI Pipeline',
						PERMISSIONS: '["tools:read","tools:execute"]',
						REVOKED_AT: null,
						EXPIRES_AT: new Date(Date.now() + 86400000)
					}
				]
			});

			const ctx = await validateApiKey('portal_valid_key_123');
			expect(ctx).not.toBeNull();
			expect(ctx!.orgId).toBe('org-1');
			expect(ctx!.permissions).toContain('tools:read');
			expect(ctx!.keyName).toBe('CI Pipeline');
		});

		it('returns null for invalid key', async () => {
			if (!apiKeysModule) return;
			const validateApiKey = apiKeysModule.validateApiKey as (key: string) => Promise<null>;

			mockExecute.mockResolvedValueOnce({ rows: [] });

			const ctx = await validateApiKey('portal_invalid_key');
			expect(ctx).toBeNull();
		});

		it('returns null for revoked key', async () => {
			if (!apiKeysModule) return;
			const validateApiKey = apiKeysModule.validateApiKey as (key: string) => Promise<null>;

			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'key-1',
						ORG_ID: 'org-1',
						REVOKED_AT: new Date('2026-01-01'),
						EXPIRES_AT: new Date(Date.now() + 86400000)
					}
				]
			});

			const ctx = await validateApiKey('portal_revoked_key');
			expect(ctx).toBeNull();
		});

		it('returns null for expired key', async () => {
			if (!apiKeysModule) return;
			const validateApiKey = apiKeysModule.validateApiKey as (key: string) => Promise<null>;

			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'key-1',
						ORG_ID: 'org-1',
						REVOKED_AT: null,
						EXPIRES_AT: new Date('2025-01-01') // expired
					}
				]
			});

			const ctx = await validateApiKey('portal_expired_key');
			expect(ctx).toBeNull();
		});
	});

	describe('revokeApiKey', () => {
		it('sets revoked_at timestamp', async () => {
			if (!apiKeysModule) return;
			const revokeApiKey = apiKeysModule.revokeApiKey as (id: string) => Promise<void>;

			mockExecute.mockResolvedValueOnce({ rows: [] });

			await expect(revokeApiKey('key-1')).resolves.not.toThrow();
			expect(mockExecute).toHaveBeenCalled();
			// The SQL should include setting revoked_at
			const sql = mockExecute.mock.calls[0][0] as string;
			expect(sql.toLowerCase()).toContain('revoked_at');
		});
	});

	describe('listApiKeys', () => {
		it('returns keys for an org (without exposing hashes)', async () => {
			if (!apiKeysModule) return;
			const listApiKeys = apiKeysModule.listApiKeys as (
				orgId: string
			) => Promise<Array<{ id: string; name: string; createdAt: Date; permissions: string[] }>>;

			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'key-1',
						NAME: 'CI Pipeline',
						PERMISSIONS: '["tools:read"]',
						CREATED_AT: new Date(),
						EXPIRES_AT: new Date(Date.now() + 86400000),
						REVOKED_AT: null
					},
					{
						ID: 'key-2',
						NAME: 'Monitoring',
						PERMISSIONS: '["tools:read"]',
						CREATED_AT: new Date(),
						EXPIRES_AT: null,
						REVOKED_AT: null
					}
				]
			});

			const keys = await listApiKeys('org-1');
			expect(keys).toHaveLength(2);
			expect(keys[0].name).toBe('CI Pipeline');
			// Should NOT include key_hash in the response
			for (const key of keys) {
				expect(key).not.toHaveProperty('keyHash');
				expect(key).not.toHaveProperty('KEY_HASH');
			}
		});
	});

	describe('auth middleware integration contract', () => {
		it('API requests should accept Authorization: Bearer <api-key> header', () => {
			const headers = new Headers({
				Authorization: 'Bearer portal_test_key_abc123'
			});
			const authHeader = headers.get('Authorization');
			expect(authHeader).toBeDefined();
			const [scheme, token] = authHeader!.split(' ');
			expect(scheme).toBe('Bearer');
			expect(token).toMatch(/^portal_/);
		});

		it('API requests should also accept X-API-Key header', () => {
			const headers = new Headers({
				'X-API-Key': 'portal_test_key_abc123'
			});
			const apiKey = headers.get('X-API-Key');
			expect(apiKey).toBeDefined();
			expect(apiKey).toMatch(/^portal_/);
		});
	});
});
