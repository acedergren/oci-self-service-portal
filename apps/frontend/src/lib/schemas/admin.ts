import { z } from 'zod';

// IDP form schema
export const idpFormSchema = z.object({
	displayName: z.string().min(1, 'Display name is required').max(100),
	providerId: z
		.string()
		.min(1, 'Provider ID is required')
		.max(50)
		.regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
	providerType: z.enum(['oidc', 'idcs']),
	clientId: z.string().min(1, 'Client ID is required'),
	clientSecret: z.string().optional().default(''),
	issuerUrl: z.string().url('Must be a valid URL'),
	authorizationUrl: z.string().optional().default(''),
	tokenUrl: z.string().optional().default(''),
	userinfoUrl: z.string().optional().default(''),
	scopes: z.string().default('openid profile email'),
	pkce: z.boolean().default(true),
	adminGroups: z.string().optional().default(''),
	operatorGroups: z.string().optional().default('')
});

export type IdpFormData = z.infer<typeof idpFormSchema>;

// AI Provider form schema
export const aiProviderFormSchema = z.object({
	displayName: z.string().min(1, 'Display name is required').max(100),
	providerType: z.enum(['oci', 'openai', 'anthropic']),
	modelId: z.string().min(1, 'Model ID is required'),
	apiEndpoint: z.string().url('Must be a valid URL'),
	apiKey: z.string().optional().default(''),
	compartmentId: z.string().optional().default(''),
	enabled: z.boolean().default(true)
});

export type AiProviderFormData = z.infer<typeof aiProviderFormSchema>;

// Portal Settings form schema
export const portalSettingsFormSchema = z.object({
	portalName: z.string().min(1, 'Portal name is required').max(200),
	primaryColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color')
		.default('#000000'),
	accentColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color')
		.default('#000000'),
	logoUrl: z.string().url('Must be a valid URL').nullable().optional(),
	signupEnabled: z.boolean().default(false),
	requireEmailVerification: z.boolean().default(true),
	sessionTimeout: z.coerce.number().min(5, 'Min 5 minutes').max(1440, 'Max 24 hours').default(60),
	maxUploadSize: z.coerce.number().min(1, 'Min 1 MB').max(100, 'Max 100 MB').default(10),
	allowedDomains: z.string().nullable().optional(),
	maintenanceMode: z.boolean().default(false),
	maintenanceMessage: z.string().nullable().optional(),
	termsOfServiceUrl: z.string().url('Must be a valid URL').nullable().optional(),
	privacyPolicyUrl: z.string().url('Must be a valid URL').nullable().optional()
});

export type PortalSettingsFormData = z.infer<typeof portalSettingsFormSchema>;

// MCP Server form schema
export const mcpServerFormSchema = z.object({
	catalogItemId: z.string().optional().default(''),
	serverName: z
		.string()
		.min(1, 'Server name is required')
		.regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
	displayName: z.string().min(1, 'Display name is required').max(100),
	description: z.string().optional().default(''),
	transportType: z.enum(['stdio', 'sse', 'http']).default('stdio'),
	url: z.string().optional().default(''),
	command: z.string().optional().default(''),
	argsText: z.string().optional().default(''),
	envText: z.string().optional().default(''),
	headersText: z.string().optional().default('')
});

export type McpServerFormData = z.infer<typeof mcpServerFormSchema>;

// Setup wizard — Identity Provider step schema
// Distinct from idpFormSchema: uses tenantUrl (discovery endpoint) instead of
// separate issuerUrl/authorizationUrl/tokenUrl fields (simpler first-time setup UX)
export const setupIdpSchema = z.object({
	type: z.enum(['idcs', 'oidc']).default('idcs'),
	tenantUrl: z.string().url('Must be a valid URL').min(1, 'Tenant URL is required'),
	clientId: z.string().min(1, 'Client ID is required'),
	clientSecret: z.string().min(1, 'Client Secret is required'),
	scopes: z.string().default('openid profile email urn:opc:idm:__myscopes__'),
	pkce: z.boolean().default(true),
	adminGroups: z.string().optional().default(''),
	operatorGroups: z.string().optional().default('')
});

export type SetupIdpFormData = z.infer<typeof setupIdpSchema>;
