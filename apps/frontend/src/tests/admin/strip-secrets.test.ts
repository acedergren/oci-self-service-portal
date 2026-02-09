/**
 * Tests for secret stripping utilities.
 *
 * Validates:
 * - IDP clientSecret removal and hasClientSecret flag
 * - AI provider apiKey removal and hasApiKey flag
 * - Array variants
 * - Edge cases (missing secrets, undefined, null)
 */
import { describe, it, expect } from 'vitest';
import {
	stripIdpSecrets,
	stripIdpSecretsArray,
	stripAiProviderSecrets,
	stripAiProviderSecretsArray
} from '@portal/shared/server/admin/strip-secrets.js';

describe('stripIdpSecrets', () => {
	it('removes clientSecret and sets hasClientSecret: true', () => {
		const provider = {
			id: '123',
			providerId: 'oci-idcs',
			clientId: 'client-123',
			clientSecret: 'super-secret-value',
			displayName: 'OCI IDCS'
		};

		const result = stripIdpSecrets(provider);

		expect(result).not.toHaveProperty('clientSecret');
		expect(result.hasClientSecret).toBe(true);
		expect(result.id).toBe('123');
		expect(result.providerId).toBe('oci-idcs');
		expect(result.clientId).toBe('client-123');
		expect(result.displayName).toBe('OCI IDCS');
	});

	it('sets hasClientSecret: false when no secret', () => {
		const provider = {
			id: '123',
			providerId: 'oci-idcs',
			clientId: 'client-123',
			displayName: 'OCI IDCS'
		};

		const result = stripIdpSecrets(provider);

		expect(result).not.toHaveProperty('clientSecret');
		expect(result.hasClientSecret).toBe(false);
	});

	it('sets hasClientSecret: false for empty string', () => {
		const provider = {
			id: '123',
			clientSecret: ''
		};

		const result = stripIdpSecrets(provider);

		expect(result).not.toHaveProperty('clientSecret');
		expect(result.hasClientSecret).toBe(false);
	});

	it('sets hasClientSecret: false for undefined', () => {
		const provider = {
			id: '123',
			clientSecret: undefined
		};

		const result = stripIdpSecrets(provider);

		expect(result).not.toHaveProperty('clientSecret');
		expect(result.hasClientSecret).toBe(false);
	});

	it('preserves all other fields', () => {
		const provider = {
			id: '123',
			providerId: 'test',
			displayName: 'Test',
			providerType: 'oidc' as const,
			discoveryUrl: 'https://example.com/.well-known/openid-configuration',
			clientId: 'client-id',
			clientSecret: 'secret',
			scopes: 'openid,email',
			pkceEnabled: true,
			status: 'active' as const,
			isDefault: true,
			sortOrder: 0,
			createdAt: new Date('2026-01-01'),
			updatedAt: new Date('2026-01-02')
		};

		const result = stripIdpSecrets(provider);

		expect(result.discoveryUrl).toBe(provider.discoveryUrl);
		expect(result.scopes).toBe(provider.scopes);
		expect(result.pkceEnabled).toBe(true);
		expect(result.isDefault).toBe(true);
		expect(result.createdAt).toEqual(new Date('2026-01-01'));
	});
});

describe('stripIdpSecretsArray', () => {
	it('strips secrets from all providers', () => {
		const providers = [
			{ id: '1', clientSecret: 'secret1', providerId: 'a' },
			{ id: '2', clientSecret: 'secret2', providerId: 'b' },
			{ id: '3', providerId: 'c' } // no secret
		];

		const result = stripIdpSecretsArray(providers);

		expect(result).toHaveLength(3);
		expect(result[0].hasClientSecret).toBe(true);
		expect(result[1].hasClientSecret).toBe(true);
		expect(result[2].hasClientSecret).toBe(false);

		for (const p of result) {
			expect(p).not.toHaveProperty('clientSecret');
		}
	});

	it('handles empty array', () => {
		const result = stripIdpSecretsArray([]);
		expect(result).toEqual([]);
	});
});

describe('stripAiProviderSecrets', () => {
	it('removes apiKey and sets hasApiKey: true', () => {
		const provider = {
			id: '456',
			providerId: 'openai',
			apiKey: 'sk-super-secret',
			displayName: 'OpenAI'
		};

		const result = stripAiProviderSecrets(provider);

		expect(result).not.toHaveProperty('apiKey');
		expect(result.hasApiKey).toBe(true);
		expect(result.id).toBe('456');
		expect(result.providerId).toBe('openai');
		expect(result.displayName).toBe('OpenAI');
	});

	it('sets hasApiKey: false when no key', () => {
		const provider = {
			id: '456',
			providerId: 'oci',
			displayName: 'OCI GenAI'
		};

		const result = stripAiProviderSecrets(provider);

		expect(result).not.toHaveProperty('apiKey');
		expect(result.hasApiKey).toBe(false);
	});

	it('preserves all other fields', () => {
		const provider = {
			id: '456',
			providerId: 'openai',
			displayName: 'OpenAI',
			providerType: 'openai' as const,
			apiBaseUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-secret',
			region: null,
			status: 'active' as const,
			isDefault: true,
			sortOrder: 0,
			modelAllowlist: ['gpt-4'],
			defaultModel: 'gpt-4',
			createdAt: new Date(),
			updatedAt: new Date()
		};

		const result = stripAiProviderSecrets(provider);

		expect(result.apiBaseUrl).toBe('https://api.openai.com/v1');
		expect(result.modelAllowlist).toEqual(['gpt-4']);
		expect(result.defaultModel).toBe('gpt-4');
	});
});

describe('stripAiProviderSecretsArray', () => {
	it('strips secrets from all providers', () => {
		const providers = [
			{ id: '1', apiKey: 'key1', providerId: 'openai' },
			{ id: '2', providerId: 'oci' } // no key (OCI uses instance principal)
		];

		const result = stripAiProviderSecretsArray(providers);

		expect(result).toHaveLength(2);
		expect(result[0].hasApiKey).toBe(true);
		expect(result[1].hasApiKey).toBe(false);

		for (const p of result) {
			expect(p).not.toHaveProperty('apiKey');
		}
	});
});
