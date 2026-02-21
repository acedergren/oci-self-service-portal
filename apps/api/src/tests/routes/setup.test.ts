import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { buildTestApp } from './test-helpers.js';
import { setupRoutes } from '../../routes/setup.js';

const {
	mockIsSetupComplete,
	mockBulkSet,
	mockMarkSetupComplete,
	mockListActiveIdps,
	mockCreateIdp,
	mockListActiveProviders,
	mockCreateProvider,
	mockInvalidateSetupToken,
	mockValidateSetupToken,
	mockStripIdpSecrets,
	mockStripAiProviderSecrets
} = vi.hoisted(() => ({
	mockIsSetupComplete: vi.fn(),
	mockBulkSet: vi.fn(),
	mockMarkSetupComplete: vi.fn(),
	mockListActiveIdps: vi.fn(),
	mockCreateIdp: vi.fn(),
	mockListActiveProviders: vi.fn(),
	mockCreateProvider: vi.fn(),
	mockInvalidateSetupToken: vi.fn(),
	mockValidateSetupToken: vi.fn(),
	mockStripIdpSecrets: vi.fn((v) => v),
	mockStripAiProviderSecrets: vi.fn((v) => v)
}));

vi.mock('@portal/server/admin', () => ({
	settingsRepository: {
		isSetupComplete: (...args: unknown[]) => mockIsSetupComplete(...args),
		bulkSet: (...args: unknown[]) => mockBulkSet(...args),
		markSetupComplete: (...args: unknown[]) => mockMarkSetupComplete(...args)
	},
	idpRepository: {
		listActive: (...args: unknown[]) => mockListActiveIdps(...args),
		create: (...args: unknown[]) => mockCreateIdp(...args)
	},
	aiProviderRepository: {
		listActive: (...args: unknown[]) => mockListActiveProviders(...args),
		create: (...args: unknown[]) => mockCreateProvider(...args)
	},
	validateSetupToken: (...args: unknown[]) => mockValidateSetupToken(...args),
	invalidateSetupToken: (...args: unknown[]) => mockInvalidateSetupToken(...args),
	stripIdpSecrets: (value: unknown) => mockStripIdpSecrets(value),
	stripAiProviderSecrets: (value: unknown) => mockStripAiProviderSecrets(value),
	CreateIdpInputSchema: z.object({
		providerId: z.string(),
		providerType: z.enum(['oidc', 'saml']),
		displayName: z.string()
	}),
	CreateAiProviderInputSchema: z.object({
		providerId: z.string(),
		providerType: z.enum(['oci', 'openai', 'anthropic', 'google', 'azure-openai']),
		displayName: z.string(),
		modelAllowlist: z.array(z.string()).min(1)
	}),
	BulkSetSettingsInputSchema: z.object({
		settings: z.array(z.object({ key: z.string(), value: z.string() }))
	}),
	AiProviderTypeSchema: z.enum(['oci', 'openai', 'anthropic', 'google', 'azure-openai'])
}));

vi.mock('@portal/server/url-validation', () => ({
	isValidExternalUrl: vi.fn(() => true)
}));

describe('Setup routes', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		mockIsSetupComplete.mockReset();
		mockBulkSet.mockReset();
		mockMarkSetupComplete.mockReset();
		mockListActiveIdps.mockReset();
		mockCreateIdp.mockReset();
		mockListActiveProviders.mockReset();
		mockCreateProvider.mockReset();
		mockInvalidateSetupToken.mockReset();
		mockValidateSetupToken.mockReset();

		mockValidateSetupToken.mockImplementation(async (request: Request) => {
			const auth = request.headers.get('authorization');
			if (auth !== 'Bearer setup-token') {
				return new Response(JSON.stringify({ error: 'Setup token required' }), { status: 401 });
			}
			return null;
		});

		mockIsSetupComplete.mockResolvedValue(false);
		mockListActiveIdps.mockResolvedValue([]);
		mockListActiveProviders.mockResolvedValue([]);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('returns 401 for setup status without token', async () => {
		const app = await buildTestApp({ withRbac: false });
		await app.register(setupRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/setup/status' });
		expect(res.statusCode).toBe(401);
	});

	it('returns setup status with token', async () => {
		mockListActiveIdps.mockResolvedValue([{ id: 'idp-1', isDefault: true }]);
		mockListActiveProviders.mockResolvedValue([{ id: 'ai-1', isDefault: true }]);

		const app = await buildTestApp({ withRbac: false });
		await app.register(setupRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/setup/status',
			headers: { authorization: 'Bearer setup-token' }
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.steps.idp).toBe(true);
		expect(body.steps.aiProvider).toBe(true);
	});

	it('creates IDP provider when token is valid', async () => {
		mockCreateIdp.mockResolvedValue({ id: 'idp-1', providerId: 'oci-idcs' });

		const app = await buildTestApp({ withRbac: false });
		await app.register(setupRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/setup/idp',
			headers: { authorization: 'Bearer setup-token' },
			payload: {
				providerId: 'oci-idcs',
				providerType: 'oidc',
				displayName: 'OCI IDCS'
			}
		});

		expect(res.statusCode).toBe(201);
		expect(mockCreateIdp).toHaveBeenCalledOnce();
	});

	it('tests IDP discovery URL with mocked fetch', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					authorization_endpoint: 'https://idp.example.com/auth',
					token_endpoint: 'https://idp.example.com/token',
					userinfo_endpoint: 'https://idp.example.com/userinfo',
					jwks_uri: 'https://idp.example.com/jwks'
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		) as typeof fetch;

		const app = await buildTestApp({ withRbac: false });
		await app.register(setupRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/setup/idp/test',
			headers: { authorization: 'Bearer setup-token' },
			payload: { discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration' }
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().success).toBe(true);
	});

	it('returns 401 for ai-provider/test without setup token (W5 fix)', async () => {
		const app = await buildTestApp({ withRbac: false });
		await app.register(setupRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/setup/ai-provider/test',
			payload: { providerType: 'oci' }
		});

		expect(res.statusCode).toBe(401);
	});

	it('returns success for oci ai-provider/test with valid setup token', async () => {
		const app = await buildTestApp({ withRbac: false });
		await app.register(setupRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/setup/ai-provider/test',
			headers: { authorization: 'Bearer setup-token' },
			payload: { providerType: 'oci', region: 'eu-frankfurt-1' }
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().success).toBe(true);
	});

	it('rejects setup completion when providers are missing', async () => {
		mockListActiveIdps.mockResolvedValue([]);
		mockListActiveProviders.mockResolvedValue([{ id: 'ai-1' }]);

		const app = await buildTestApp({ withRbac: false });
		await app.register(setupRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/setup/complete',
			headers: { authorization: 'Bearer setup-token' }
		});

		expect(res.statusCode).toBe(400);
	});

	it('completes setup and invalidates token', async () => {
		mockListActiveIdps.mockResolvedValue([{ id: 'idp-1' }]);
		mockListActiveProviders.mockResolvedValue([{ id: 'ai-1' }]);

		const app = await buildTestApp({ withRbac: false });
		await app.register(setupRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/setup/complete',
			headers: { authorization: 'Bearer setup-token' }
		});

		expect(res.statusCode).toBe(200);
		expect(mockMarkSetupComplete).toHaveBeenCalledOnce();
		expect(mockInvalidateSetupToken).toHaveBeenCalledOnce();
	});
});
