/**
 * Unit tests for env-bootstrap (env vars → Oracle admin tables).
 *
 * Tests:
 * - IDP bootstrap from OCI_IAM_* env vars
 * - AI provider bootstrap from OCI_REGION
 * - Idempotency (no duplicates on re-run)
 * - No-op when env vars are absent
 * - Auto-complete setup when both providers exist
 * - Error resilience (doesn't crash on DB errors)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock setup — forwarding pattern for mockReset: true
// ============================================================================

const mockIdpGetByProviderId = vi.fn();
const mockIdpCreate = vi.fn();
const mockIdpCountActive = vi.fn();
const mockAiGetByProviderId = vi.fn();
const mockAiCreate = vi.fn();
const mockAiCountActive = vi.fn();
const mockIsSetupComplete = vi.fn();
const mockMarkSetupComplete = vi.fn();

vi.mock('@portal/server/admin/idp-repository.js', () => ({
	idpRepository: {
		getByProviderId: (...args: unknown[]) => mockIdpGetByProviderId(...args),
		create: (...args: unknown[]) => mockIdpCreate(...args),
		countActive: (...args: unknown[]) => mockIdpCountActive(...args)
	}
}));

vi.mock('@portal/server/admin/ai-provider-repository.js', () => ({
	aiProviderRepository: {
		getByProviderId: (...args: unknown[]) => mockAiGetByProviderId(...args),
		create: (...args: unknown[]) => mockAiCreate(...args),
		countActive: (...args: unknown[]) => mockAiCountActive(...args)
	}
}));

vi.mock('@portal/server/admin/settings-repository.js', () => ({
	settingsRepository: {
		isSetupComplete: (...args: unknown[]) => mockIsSetupComplete(...args),
		markSetupComplete: (...args: unknown[]) => mockMarkSetupComplete(...args)
	}
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
// Env var management
// ============================================================================

const ENV_KEYS = [
	'OCI_IAM_CLIENT_ID',
	'OCI_IAM_CLIENT_SECRET',
	'OCI_IAM_DISCOVERY_URL',
	'OCI_IAM_SCOPES',
	'OCI_IAM_IDP_NAME',
	'OCI_IAM_ADMIN_GROUPS',
	'OCI_IAM_OPERATOR_GROUPS',
	'OCI_IAM_DEFAULT_ORG_ID',
	'OCI_REGION',
	'OCI_GENAI_MODEL_ID'
] as const;

let savedEnv: Record<string, string | undefined>;

function setEnvVars(overrides: Record<string, string>): void {
	for (const [key, value] of Object.entries(overrides)) {
		process.env[key] = value;
	}
}

function clearEnvVars(): void {
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
}

// ============================================================================
// Test setup
// ============================================================================

beforeEach(() => {
	// Save env vars
	savedEnv = {};
	for (const key of ENV_KEYS) {
		savedEnv[key] = process.env[key];
	}
	clearEnvVars();

	// Default mock implementations
	mockIdpGetByProviderId.mockResolvedValue(undefined);
	mockIdpCreate.mockResolvedValue({ id: 'idp-1', providerId: 'oci-iam' });
	mockIdpCountActive.mockResolvedValue(0);
	mockAiGetByProviderId.mockResolvedValue(undefined);
	mockAiCreate.mockResolvedValue({ id: 'ai-1', providerId: 'oci-genai' });
	mockAiCountActive.mockResolvedValue(0);
	mockIsSetupComplete.mockResolvedValue(false);
	mockMarkSetupComplete.mockResolvedValue(undefined);
});

afterEach(() => {
	// Restore env vars
	for (const key of ENV_KEYS) {
		if (savedEnv[key] !== undefined) {
			process.env[key] = savedEnv[key];
		} else {
			delete process.env[key];
		}
	}
});

// ============================================================================
// Tests
// ============================================================================

describe('bootstrapEnvToDatabase', () => {
	// Dynamic import to pick up fresh env state
	async function loadBootstrap() {
		const mod = await import('@portal/server/admin/env-bootstrap.js');
		return mod.bootstrapEnvToDatabase;
	}

	describe('IDP bootstrap', () => {
		it('creates IDP record from OCI_IAM_* env vars', async () => {
			setEnvVars({
				OCI_IAM_CLIENT_ID: 'test-client-id',
				OCI_IAM_CLIENT_SECRET: 'test-client-secret',
				OCI_IAM_DISCOVERY_URL: 'https://idcs.example.com/.well-known/openid-configuration',
				OCI_IAM_IDP_NAME: 'Oracle SSO',
				OCI_IAM_ADMIN_GROUPS: 'Admins,SuperAdmins',
				OCI_IAM_DEFAULT_ORG_ID: 'org-123'
			});

			const bootstrapEnvToDatabase = await loadBootstrap();
			await bootstrapEnvToDatabase();

			expect(mockIdpGetByProviderId).toHaveBeenCalledWith('oci-iam');
			expect(mockIdpCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					providerId: 'oci-iam',
					displayName: 'OCI Identity',
					providerType: 'idcs',
					clientId: 'test-client-id',
					clientSecret: 'test-client-secret',
					discoveryUrl: 'https://idcs.example.com/.well-known/openid-configuration',
					pkceEnabled: true,
					status: 'active',
					isDefault: true,
					adminGroups: 'Admins,SuperAdmins',
					defaultOrgId: 'org-123',
					extraConfig: expect.objectContaining({
						source: 'env',
						idpName: 'Oracle SSO'
					})
				})
			);
		});

		it('skips IDP bootstrap when oci-iam already exists', async () => {
			setEnvVars({
				OCI_IAM_CLIENT_ID: 'test-client-id',
				OCI_IAM_CLIENT_SECRET: 'test-client-secret'
			});
			mockIdpGetByProviderId.mockResolvedValue({ id: 'existing-idp', providerId: 'oci-iam' });

			const bootstrapEnvToDatabase = await loadBootstrap();
			await bootstrapEnvToDatabase();

			expect(mockIdpCreate).not.toHaveBeenCalled();
		});

		it('skips IDP bootstrap when no OCI_IAM_CLIENT_ID', async () => {
			// No OCI_IAM env vars set
			const bootstrapEnvToDatabase = await loadBootstrap();
			await bootstrapEnvToDatabase();

			expect(mockIdpGetByProviderId).not.toHaveBeenCalled();
			expect(mockIdpCreate).not.toHaveBeenCalled();
		});

		it('uses default scopes when OCI_IAM_SCOPES not set', async () => {
			setEnvVars({
				OCI_IAM_CLIENT_ID: 'test-client-id',
				OCI_IAM_CLIENT_SECRET: 'test-client-secret'
			});

			const bootstrapEnvToDatabase = await loadBootstrap();
			await bootstrapEnvToDatabase();

			expect(mockIdpCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					scopes: 'openid,email,profile,urn:opc:idm:__myscopes__'
				})
			);
		});

		it('uses custom scopes when OCI_IAM_SCOPES is set', async () => {
			setEnvVars({
				OCI_IAM_CLIENT_ID: 'test-client-id',
				OCI_IAM_CLIENT_SECRET: 'test-client-secret',
				OCI_IAM_SCOPES: 'openid,email'
			});

			const bootstrapEnvToDatabase = await loadBootstrap();
			await bootstrapEnvToDatabase();

			expect(mockIdpCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					scopes: 'openid,email'
				})
			);
		});
	});

	describe('AI provider bootstrap', () => {
		it('creates AI provider record from OCI_REGION', async () => {
			setEnvVars({
				OCI_REGION: 'us-chicago-1',
				OCI_GENAI_MODEL_ID: 'cohere.command-r-plus'
			});

			const bootstrapEnvToDatabase = await loadBootstrap();
			await bootstrapEnvToDatabase();

			expect(mockAiGetByProviderId).toHaveBeenCalledWith('oci-genai');
			expect(mockAiCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					providerId: 'oci-genai',
					displayName: 'OCI Generative AI',
					providerType: 'oci',
					region: 'us-chicago-1',
					status: 'active',
					isDefault: true,
					modelAllowlist: ['cohere.command-r-plus'],
					defaultModel: 'cohere.command-r-plus',
					extraConfig: { source: 'env' }
				})
			);
		});

		it('skips AI provider bootstrap when oci-genai already exists', async () => {
			setEnvVars({ OCI_REGION: 'us-chicago-1' });
			mockAiGetByProviderId.mockResolvedValue({
				id: 'existing-ai',
				providerId: 'oci-genai'
			});

			const bootstrapEnvToDatabase = await loadBootstrap();
			await bootstrapEnvToDatabase();

			expect(mockAiCreate).not.toHaveBeenCalled();
		});

		it('skips AI provider bootstrap when no OCI_REGION', async () => {
			const bootstrapEnvToDatabase = await loadBootstrap();
			await bootstrapEnvToDatabase();

			expect(mockAiGetByProviderId).not.toHaveBeenCalled();
			expect(mockAiCreate).not.toHaveBeenCalled();
		});

		it('creates AI provider without model when OCI_GENAI_MODEL_ID not set', async () => {
			setEnvVars({ OCI_REGION: 'us-chicago-1' });

			const bootstrapEnvToDatabase = await loadBootstrap();
			await bootstrapEnvToDatabase();

			expect(mockAiCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					modelAllowlist: undefined,
					defaultModel: undefined
				})
			);
		});
	});

	describe('auto-complete setup', () => {
		it('marks setup complete when both IDP and AI provider exist', async () => {
			setEnvVars({
				OCI_IAM_CLIENT_ID: 'test-client-id',
				OCI_IAM_CLIENT_SECRET: 'test-client-secret',
				OCI_REGION: 'us-chicago-1'
			});

			// After bootstrap, both providers will exist
			mockIdpCountActive.mockResolvedValue(1);
			mockAiCountActive.mockResolvedValue(1);

			const bootstrapEnvToDatabase = await loadBootstrap();
			await bootstrapEnvToDatabase();

			expect(mockMarkSetupComplete).toHaveBeenCalled();
		});

		it('does not mark setup complete when only IDP exists', async () => {
			setEnvVars({
				OCI_IAM_CLIENT_ID: 'test-client-id',
				OCI_IAM_CLIENT_SECRET: 'test-client-secret'
			});
			// No OCI_REGION → no AI provider

			const bootstrapEnvToDatabase = await loadBootstrap();
			await bootstrapEnvToDatabase();

			// autoCompleteSetup only runs when both bootstrap functions return non-null
			expect(mockMarkSetupComplete).not.toHaveBeenCalled();
		});

		it('skips setup completion when already complete', async () => {
			setEnvVars({
				OCI_IAM_CLIENT_ID: 'test-client-id',
				OCI_IAM_CLIENT_SECRET: 'test-client-secret',
				OCI_REGION: 'us-chicago-1'
			});
			mockIsSetupComplete.mockResolvedValue(true);
			mockIdpCountActive.mockResolvedValue(1);
			mockAiCountActive.mockResolvedValue(1);

			const bootstrapEnvToDatabase = await loadBootstrap();
			await bootstrapEnvToDatabase();

			expect(mockMarkSetupComplete).not.toHaveBeenCalled();
		});
	});

	describe('error resilience', () => {
		it('does not crash when IDP create fails', async () => {
			setEnvVars({
				OCI_IAM_CLIENT_ID: 'test-client-id',
				OCI_IAM_CLIENT_SECRET: 'test-client-secret'
			});
			mockIdpCreate.mockRejectedValue(new Error('DB connection failed'));

			const bootstrapEnvToDatabase = await loadBootstrap();
			// Should not throw
			await expect(bootstrapEnvToDatabase()).resolves.toBeUndefined();
		});

		it('does not crash when AI provider create fails', async () => {
			setEnvVars({ OCI_REGION: 'us-chicago-1' });
			mockAiCreate.mockRejectedValue(new Error('DB connection failed'));

			const bootstrapEnvToDatabase = await loadBootstrap();
			await expect(bootstrapEnvToDatabase()).resolves.toBeUndefined();
		});

		it('does not crash when setup completion fails', async () => {
			setEnvVars({
				OCI_IAM_CLIENT_ID: 'test-client-id',
				OCI_IAM_CLIENT_SECRET: 'test-client-secret',
				OCI_REGION: 'us-chicago-1'
			});
			mockIdpCountActive.mockResolvedValue(1);
			mockAiCountActive.mockResolvedValue(1);
			mockMarkSetupComplete.mockRejectedValue(new Error('Settings write failed'));

			const bootstrapEnvToDatabase = await loadBootstrap();
			await expect(bootstrapEnvToDatabase()).resolves.toBeUndefined();
		});
	});
});
