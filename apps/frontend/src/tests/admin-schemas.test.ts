/**
 * Unit tests for admin form schemas — Zod validation for IDP, AI provider,
 * portal settings, and MCP server forms.
 *
 * Pure utility — no mocks needed. Tests validate both successful parsing
 * (with defaults) and rejection of invalid inputs.
 *
 * Source: apps/frontend/src/lib/schemas/admin.ts (82 lines, 0 tests)
 */

import { describe, it, expect } from 'vitest';
import {
	idpFormSchema,
	aiProviderFormSchema,
	portalSettingsFormSchema,
	mcpServerFormSchema
} from '$lib/schemas/admin';

// ── IDP Form Schema ──────────────────────────────────────────────────────

describe('idpFormSchema', () => {
	const VALID_IDP = {
		displayName: 'Okta OIDC',
		providerId: 'okta-oidc',
		providerType: 'oidc' as const,
		clientId: 'abc123',
		issuerUrl: 'https://dev.okta.com/oauth2/default'
	};

	it('validates minimal IDP config with defaults', () => {
		const result = idpFormSchema.parse(VALID_IDP);
		expect(result.displayName).toBe('Okta OIDC');
		expect(result.pkce).toBe(true); // default
		expect(result.scopes).toBe('openid profile email'); // default
		expect(result.clientSecret).toBe(''); // default
	});

	it('rejects empty display name', () => {
		expect(() => idpFormSchema.parse({ ...VALID_IDP, displayName: '' })).toThrow();
	});

	it('rejects invalid provider ID format', () => {
		expect(() => idpFormSchema.parse({ ...VALID_IDP, providerId: 'Has Spaces!' })).toThrow();
	});

	it('accepts idcs provider type', () => {
		const result = idpFormSchema.parse({ ...VALID_IDP, providerType: 'idcs' });
		expect(result.providerType).toBe('idcs');
	});

	it('rejects invalid issuer URL', () => {
		expect(() => idpFormSchema.parse({ ...VALID_IDP, issuerUrl: 'not-a-url' })).toThrow();
	});
});

// ── AI Provider Form Schema ──────────────────────────────────────────────

describe('aiProviderFormSchema', () => {
	const VALID_AI = {
		displayName: 'OCI GenAI',
		providerType: 'oci' as const,
		modelId: 'cohere.command-r-plus',
		apiEndpoint: 'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com'
	};

	it('validates minimal AI provider with defaults', () => {
		const result = aiProviderFormSchema.parse(VALID_AI);
		expect(result.enabled).toBe(true); // default
		expect(result.apiKey).toBe(''); // default
	});

	it('accepts all provider types', () => {
		for (const type of ['oci', 'openai', 'anthropic'] as const) {
			const result = aiProviderFormSchema.parse({ ...VALID_AI, providerType: type });
			expect(result.providerType).toBe(type);
		}
	});

	it('rejects unknown provider type', () => {
		expect(() => aiProviderFormSchema.parse({ ...VALID_AI, providerType: 'unknown' })).toThrow();
	});

	it('rejects missing model ID', () => {
		expect(() => aiProviderFormSchema.parse({ ...VALID_AI, modelId: '' })).toThrow();
	});
});

// ── Portal Settings Form Schema ──────────────────────────────────────────

describe('portalSettingsFormSchema', () => {
	const VALID_SETTINGS = {
		portalName: 'CloudNow'
	};

	it('validates minimal settings with all defaults', () => {
		const result = portalSettingsFormSchema.parse(VALID_SETTINGS);
		expect(result.primaryColor).toBe('#000000');
		expect(result.signupEnabled).toBe(false);
		expect(result.requireEmailVerification).toBe(true);
		expect(result.sessionTimeout).toBe(60);
		expect(result.maxUploadSize).toBe(10);
		expect(result.maintenanceMode).toBe(false);
	});

	it('rejects invalid hex color', () => {
		expect(() =>
			portalSettingsFormSchema.parse({ ...VALID_SETTINGS, primaryColor: 'red' })
		).toThrow();
	});

	it('rejects session timeout below minimum', () => {
		expect(() =>
			portalSettingsFormSchema.parse({ ...VALID_SETTINGS, sessionTimeout: 1 })
		).toThrow();
	});

	it('rejects session timeout above maximum', () => {
		expect(() =>
			portalSettingsFormSchema.parse({ ...VALID_SETTINGS, sessionTimeout: 2000 })
		).toThrow();
	});

	it('coerces string numbers for session timeout', () => {
		const result = portalSettingsFormSchema.parse({ ...VALID_SETTINGS, sessionTimeout: '120' });
		expect(result.sessionTimeout).toBe(120);
	});

	it('accepts nullable URLs', () => {
		const result = portalSettingsFormSchema.parse({
			...VALID_SETTINGS,
			logoUrl: null,
			termsOfServiceUrl: null,
			privacyPolicyUrl: null
		});
		expect(result.logoUrl).toBeNull();
	});
});

// ── MCP Server Form Schema ───────────────────────────────────────────────

describe('mcpServerFormSchema', () => {
	const VALID_MCP = {
		serverName: 'my-server',
		displayName: 'My MCP Server'
	};

	it('validates minimal MCP server config with defaults', () => {
		const result = mcpServerFormSchema.parse(VALID_MCP);
		expect(result.transportType).toBe('stdio'); // default
		expect(result.url).toBe('');
		expect(result.command).toBe('');
	});

	it('accepts all transport types', () => {
		for (const type of ['stdio', 'sse', 'http'] as const) {
			const result = mcpServerFormSchema.parse({ ...VALID_MCP, transportType: type });
			expect(result.transportType).toBe(type);
		}
	});

	it('rejects invalid server name format', () => {
		expect(() => mcpServerFormSchema.parse({ ...VALID_MCP, serverName: 'Has Spaces!' })).toThrow();
	});

	it('rejects empty server name', () => {
		expect(() => mcpServerFormSchema.parse({ ...VALID_MCP, serverName: '' })).toThrow();
	});
});
