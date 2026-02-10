/**
 * Tests for IDP Provider repository
 *
 * @module tests/admin/idp-repository
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Oracle connection — must be before any imports that use it
const mockExecute = vi.fn();
const mockCommit = vi.fn();
const mockConn = {
	execute: mockExecute,
	commit: mockCommit,
	rollback: vi.fn(),
	close: vi.fn()
};

vi.mock('@portal/shared/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: typeof mockConn) => Promise<unknown>) => fn(mockConn))
}));

// Mock crypto functions
const mockEncryptSecret = vi.fn();
const mockDecryptSecret = vi.fn();

vi.mock('@portal/shared/server/auth/crypto.js', () => ({
	encryptSecret: (...args: unknown[]) => mockEncryptSecret(...args),
	decryptSecret: (...args: unknown[]) => mockDecryptSecret(...args)
}));

// Mock logger
vi.mock('@portal/shared/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

// Static import after mocks are set up (vitest hoists vi.mock calls)
import { idpRepository } from '@portal/server/admin/idp-repository.js';

describe('idp-repository.ts', () => {
	function createMockIdpRow(overrides: Partial<Record<string, unknown>> = {}) {
		return {
			ID: '123e4567-e89b-12d3-a456-426614174000',
			PROVIDER_ID: 'oidc-1',
			DISPLAY_NAME: 'Test OIDC',
			PROVIDER_TYPE: 'oidc',
			DISCOVERY_URL: 'https://idp.example.com/.well-known/openid-configuration',
			AUTHORIZATION_URL: null,
			TOKEN_URL: null,
			USERINFO_URL: null,
			JWKS_URL: null,
			CLIENT_ID: 'test-client',
			CLIENT_SECRET_ENC: Buffer.from('encrypted'),
			CLIENT_SECRET_IV: Buffer.from('iv-data'),
			CLIENT_SECRET_TAG: Buffer.from('tag-data'),
			SCOPES: 'openid,email,profile',
			PKCE_ENABLED: 1,
			STATUS: 'active',
			IS_DEFAULT: 1,
			SORT_ORDER: 0,
			ICON_URL: null,
			BUTTON_LABEL: null,
			ADMIN_GROUPS: null,
			OPERATOR_GROUPS: null,
			TENANT_ORG_MAP: null,
			DEFAULT_ORG_ID: null,
			EXTRA_CONFIG: null,
			CREATED_AT: new Date('2026-01-01'),
			UPDATED_AT: new Date('2026-01-01'),
			...overrides
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();

		mockEncryptSecret.mockResolvedValue({
			encrypted: Buffer.from('encrypted-data'),
			iv: Buffer.from('000000000000'),
			tag: Buffer.from('0000000000000000')
		});
		mockDecryptSecret.mockResolvedValue('decrypted-secret');
	});

	describe('list', () => {
		it('returns all IDPs with decrypted secrets', async () => {
			const mockRow = createMockIdpRow();
			mockExecute.mockResolvedValue({ rows: [mockRow] });
			mockDecryptSecret.mockResolvedValue('test-client-secret-value');

			const result = await idpRepository.list();

			expect(result).toHaveLength(1);
			expect(result[0].providerId).toBe('oidc-1');
			expect(result[0].clientSecret).toBe('test-client-secret-value');
			expect(mockDecryptSecret).toHaveBeenCalledWith(
				mockRow.CLIENT_SECRET_ENC,
				mockRow.CLIENT_SECRET_IV,
				mockRow.CLIENT_SECRET_TAG
			);
		});

		it('orders by sort_order then display_name', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			await idpRepository.list();

			const sql = mockExecute.mock.calls[0][0] as string;
			expect(sql).toMatch(/ORDER BY/i);
		});

		it('handles missing encrypted secret gracefully', async () => {
			const mockRow = createMockIdpRow({
				CLIENT_SECRET_ENC: null,
				CLIENT_SECRET_IV: null,
				CLIENT_SECRET_TAG: null
			});
			mockExecute.mockResolvedValue({ rows: [mockRow] });

			const result = await idpRepository.list();

			expect(result[0].clientSecret).toBeUndefined();
			expect(mockDecryptSecret).not.toHaveBeenCalled();
		});

		it('continues with undefined secret on decryption error', async () => {
			mockExecute.mockResolvedValue({ rows: [createMockIdpRow()] });
			mockDecryptSecret.mockRejectedValue(new Error('Decryption failed'));

			const result = await idpRepository.list();

			expect(result[0].clientSecret).toBeUndefined();
		});

		it('converts Oracle UPPERCASE keys to camelCase', async () => {
			const mockRow = createMockIdpRow({
				ID: 'test-id',
				PROVIDER_ID: 'test-provider',
				DISPLAY_NAME: 'Test Name',
				DISCOVERY_URL: 'https://test.com',
				CLIENT_SECRET_ENC: null,
				CLIENT_SECRET_IV: null,
				CLIENT_SECRET_TAG: null
			});

			mockExecute.mockResolvedValue({ rows: [mockRow] });
			const result = await idpRepository.list();

			expect(result[0]).toMatchObject({
				id: 'test-id',
				providerId: 'test-provider',
				displayName: 'Test Name'
			});
		});

		it('parses JSON fields (tenant_org_map, extra_config)', async () => {
			const mockRow = createMockIdpRow({
				CLIENT_SECRET_ENC: null,
				CLIENT_SECRET_IV: null,
				CLIENT_SECRET_TAG: null,
				TENANT_ORG_MAP: '{"tenant1":"org1","tenant2":"org2"}',
				EXTRA_CONFIG: '{"custom":"setting","number":42}'
			});

			mockExecute.mockResolvedValue({ rows: [mockRow] });
			const result = await idpRepository.list();

			expect(result[0].tenantOrgMap).toEqual({ tenant1: 'org1', tenant2: 'org2' });
			expect(result[0].extraConfig).toEqual({ custom: 'setting', number: 42 });
		});
	});

	describe('listActive', () => {
		it('returns only active IDPs', async () => {
			const mockRow = createMockIdpRow({
				ID: '1',
				PROVIDER_ID: 'active-1',
				DISPLAY_NAME: 'Active IDP',
				ICON_URL: 'https://test.com/icon.png',
				BUTTON_LABEL: 'Sign In'
			});

			mockExecute.mockResolvedValue({ rows: [mockRow] });
			const result = await idpRepository.listActive();

			expect(result).toHaveLength(1);
			expect(result[0].providerId).toBe('active-1');
		});

		it('filters by status=active in SQL', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			await idpRepository.listActive();

			const sql = mockExecute.mock.calls[0][0] as string;
			expect(sql.toLowerCase()).toContain('active');
		});
	});

	describe('getById', () => {
		it('returns IDP by ID with decrypted secret', async () => {
			const mockRow = createMockIdpRow({ ID: 'target-id', PROVIDER_ID: 'test-idp' });
			mockExecute.mockResolvedValue({ rows: [mockRow] });
			mockDecryptSecret.mockResolvedValue('decrypted-value');

			const result = await idpRepository.getById('target-id');

			expect(result).toBeDefined();
			expect(result!.id).toBe('target-id');
			expect(result!.clientSecret).toBe('decrypted-value');
		});

		it('returns undefined when IDP not found', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			const result = await idpRepository.getById('nonexistent');

			expect(result).toBeUndefined();
		});

		it('uses bind variable for ID', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			await idpRepository.getById('test-id');

			const bindVars = mockExecute.mock.calls[0][1];
			expect(bindVars).toMatchObject({ id: 'test-id' });
		});
	});

	describe('create', () => {
		it('encrypts client secret and inserts new IDP', async () => {
			const createdRow = createMockIdpRow({
				ID: 'new-id',
				PROVIDER_ID: 'new-idp',
				DISPLAY_NAME: 'New IDP',
				CLIENT_ID: 'client-123'
			});

			mockExecute
				.mockResolvedValueOnce({ rowsAffected: 1 })
				.mockResolvedValueOnce({ rows: [createdRow] });

			mockEncryptSecret.mockResolvedValue({
				encrypted: Buffer.from('encrypted-data'),
				iv: Buffer.from('iv-bytes-12ch'),
				tag: Buffer.from('tag-bytes-16chr')
			});
			mockDecryptSecret.mockResolvedValue('plaintext-secret');

			const input = {
				providerId: 'new-idp',
				displayName: 'New IDP',
				providerType: 'oidc' as const,
				discoveryUrl: 'https://idp.example.com/.well-known',
				clientId: 'client-123',
				clientSecret: 'plaintext-secret',
				scopes: 'openid,email',
				pkceEnabled: true,
				status: 'active' as const,
				isDefault: false,
				sortOrder: 0
			};

			const result = await idpRepository.create(input);

			expect(result.providerId).toBe('new-idp');
			expect(mockEncryptSecret).toHaveBeenCalledWith('plaintext-secret');

			const sql = mockExecute.mock.calls[0][0] as string;
			expect(sql).toMatch(/INSERT INTO idp_providers/i);
		});

		it('passes encrypted components as bind variables', async () => {
			const encryptedData = {
				encrypted: Buffer.from('enc'),
				iv: Buffer.from('123456789012'),
				tag: Buffer.from('1234567890123456')
			};

			const createdRow = createMockIdpRow();

			mockExecute
				.mockResolvedValueOnce({ rowsAffected: 1 })
				.mockResolvedValueOnce({ rows: [createdRow] });
			mockEncryptSecret.mockResolvedValue(encryptedData);
			mockDecryptSecret.mockResolvedValue('secret');

			const input = {
				providerId: 'test',
				displayName: 'Test',
				providerType: 'oidc' as const,
				discoveryUrl: 'https://test.com',
				clientId: 'client',
				clientSecret: 'secret',
				scopes: 'openid',
				pkceEnabled: true,
				status: 'active' as const,
				isDefault: false,
				sortOrder: 0
			};

			await idpRepository.create(input);

			const bindVars = mockExecute.mock.calls[0][1] as Record<string, unknown>;
			expect(bindVars).toHaveProperty('clientSecretEnc');
			expect(bindVars).toHaveProperty('clientSecretIv');
			expect(bindVars).toHaveProperty('clientSecretTag');
		});
	});

	describe('update', () => {
		it('updates IDP fields by ID', async () => {
			const existingRow = createMockIdpRow({
				ID: 'idp-id',
				CLIENT_SECRET_ENC: null,
				CLIENT_SECRET_IV: null,
				CLIENT_SECRET_TAG: null
			});
			const updatedRow = { ...existingRow, DISPLAY_NAME: 'Updated Name', STATUS: 'disabled' };

			// update() calls: 1) getById (existence check), 2) UPDATE, 3) getById (fetch result)
			mockExecute
				.mockResolvedValueOnce({ rows: [existingRow] }) // getById existence check
				.mockResolvedValueOnce({ rowsAffected: 1 }) // UPDATE
				.mockResolvedValueOnce({ rows: [updatedRow] }); // getById fetch result

			const result = await idpRepository.update('idp-id', {
				displayName: 'Updated Name',
				status: 'disabled' as const
			});

			expect(result).toBeDefined();
			// First call is getById SELECT, second is UPDATE
			const sql = mockExecute.mock.calls[1][0] as string;
			expect(sql).toMatch(/UPDATE idp_providers/i);
		});

		it('encrypts new client secret if provided', async () => {
			const existingRow = createMockIdpRow({ ID: 'idp-id' });
			const updatedRow = { ...existingRow };

			mockExecute
				.mockResolvedValueOnce({ rows: [existingRow] }) // getById existence check
				.mockResolvedValueOnce({ rowsAffected: 1 }) // UPDATE
				.mockResolvedValueOnce({ rows: [updatedRow] }); // getById fetch result
			mockEncryptSecret.mockResolvedValue({
				encrypted: Buffer.from('new-enc'),
				iv: Buffer.from('new-iv-12byt'),
				tag: Buffer.from('new-tag-16bytes1')
			});
			mockDecryptSecret.mockResolvedValue('new-plaintext-secret');

			await idpRepository.update('idp-id', { clientSecret: 'new-plaintext-secret' });

			expect(mockEncryptSecret).toHaveBeenCalledWith('new-plaintext-secret');
		});

		it('does not encrypt if clientSecret is not provided', async () => {
			const existingRow = createMockIdpRow({
				ID: 'idp-id',
				CLIENT_SECRET_ENC: null,
				CLIENT_SECRET_IV: null,
				CLIENT_SECRET_TAG: null
			});
			const updatedRow = { ...existingRow, DISPLAY_NAME: 'Updated' };

			mockExecute
				.mockResolvedValueOnce({ rows: [existingRow] }) // getById existence check
				.mockResolvedValueOnce({ rowsAffected: 1 }) // UPDATE
				.mockResolvedValueOnce({ rows: [updatedRow] }); // getById fetch result

			await idpRepository.update('idp-id', { displayName: 'Updated' });

			expect(mockEncryptSecret).not.toHaveBeenCalled();
		});
	});

	describe('delete', () => {
		it('deletes IDP by ID and returns true on success', async () => {
			mockExecute.mockResolvedValue({ rowsAffected: 1 });

			const result = await idpRepository.delete('idp-to-delete');

			expect(result).toBe(true);
			const bindVars = mockExecute.mock.calls[0][1];
			expect(bindVars).toMatchObject({ id: 'idp-to-delete' });
		});

		it('returns false when IDP not found', async () => {
			mockExecute.mockResolvedValue({ rowsAffected: 0 });

			const result = await idpRepository.delete('nonexistent');

			expect(result).toBe(false);
		});
	});

	describe('count', () => {
		it('returns total number of IDPs', async () => {
			mockExecute.mockResolvedValue({
				rows: [{ COUNT: 5 }]
			});

			const result = await idpRepository.count();

			expect(result).toBe(5);
		});

		it('returns 0 when no IDPs exist', async () => {
			mockExecute.mockResolvedValue({
				rows: [{ COUNT: 0 }]
			});

			const result = await idpRepository.count();

			expect(result).toBe(0);
		});
	});
});
