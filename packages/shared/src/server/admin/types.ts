/**
 * Zod schemas and TypeScript types for admin system entities.
 *
 * Naming convention (matches oracle types.ts pattern):
 * - FooSchema  : Zod schema object  (runtime validation)
 * - Foo        : Inferred TS type   (compile-time checking)
 */
import { z } from 'zod';

// ============================================================================
// Enum Schemas
// ============================================================================

export const IdpProviderTypeSchema = z.enum(['idcs', 'oidc', 'saml']);
export type IdpProviderType = z.infer<typeof IdpProviderTypeSchema>;

export const IdpStatusSchema = z.enum(['active', 'disabled', 'testing']);
export type IdpStatus = z.infer<typeof IdpStatusSchema>;

export const AiProviderTypeSchema = z.enum([
	'oci',
	'openai',
	'anthropic',
	'google',
	'azure-openai',
	'aws-bedrock',
	'groq',
	'together',
	'fireworks',
	'mistral',
	'custom'
]);
export type AiProviderType = z.infer<typeof AiProviderTypeSchema>;

export const AiProviderStatusSchema = z.enum(['active', 'disabled']);
export type AiProviderStatus = z.infer<typeof AiProviderStatusSchema>;

export const SettingTypeSchema = z.enum(['string', 'number', 'boolean', 'json']);
export type SettingType = z.infer<typeof SettingTypeSchema>;

// ============================================================================
// IDP Provider Schemas — match idp_providers table
// ============================================================================

export const IdpProviderSchema = z.object({
	id: z.string().uuid(),
	providerId: z.string().min(1).max(100),
	displayName: z.string().min(1).max(255),
	providerType: IdpProviderTypeSchema,
	discoveryUrl: z.string().url().max(2000).nullable().optional(),
	authorizationUrl: z.string().url().max(2000).nullable().optional(),
	tokenUrl: z.string().url().max(2000).nullable().optional(),
	userinfoUrl: z.string().url().max(2000).nullable().optional(),
	jwksUrl: z.string().url().max(2000).nullable().optional(),
	clientId: z.string().min(1).max(500),
	// client_secret is decrypted on read, so it's a string here
	clientSecret: z.string().optional(),
	scopes: z.string().default('openid,email,profile'),
	pkceEnabled: z.boolean().default(true),
	status: IdpStatusSchema.default('active'),
	isDefault: z.boolean().default(false),
	sortOrder: z.number().int().default(0),
	iconUrl: z.string().url().max(1024).nullable().optional(),
	buttonLabel: z.string().max(255).nullable().optional(),
	adminGroups: z.string().max(2000).nullable().optional(),
	operatorGroups: z.string().max(2000).nullable().optional(),
	// JSON fields — parsed as objects
	tenantOrgMap: z.record(z.string()).nullable().optional(),
	defaultOrgId: z.string().max(36).nullable().optional(),
	extraConfig: z.record(z.unknown()).nullable().optional(),
	createdAt: z.date(),
	updatedAt: z.date()
});
export type IdpProvider = z.infer<typeof IdpProviderSchema>;

// Public version for login page — no secrets
export const IdpProviderPublicSchema = IdpProviderSchema.pick({
	id: true,
	providerId: true,
	displayName: true,
	providerType: true,
	status: true,
	isDefault: true,
	sortOrder: true,
	iconUrl: true,
	buttonLabel: true
});
export type IdpProviderPublic = z.infer<typeof IdpProviderPublicSchema>;

// Create input — plaintext clientSecret, no id/timestamps
export const CreateIdpInputSchema = z
	.object({
		providerId: z
			.string()
			.min(1)
			.max(100)
			.regex(/^[a-z0-9-]+$/, 'Provider ID must be lowercase alphanumeric with hyphens'),
		displayName: z.string().min(1).max(255),
		providerType: IdpProviderTypeSchema,
		discoveryUrl: z.string().url().max(2000).nullable().optional(),
		authorizationUrl: z.string().url().max(2000).nullable().optional(),
		tokenUrl: z.string().url().max(2000).nullable().optional(),
		userinfoUrl: z.string().url().max(2000).nullable().optional(),
		jwksUrl: z.string().url().max(2000).nullable().optional(),
		clientId: z.string().min(1).max(500),
		clientSecret: z.string().min(1), // Plaintext, will be encrypted
		scopes: z.string().default('openid,email,profile'),
		pkceEnabled: z.boolean().default(true),
		status: IdpStatusSchema.default('active'),
		isDefault: z.boolean().default(false),
		sortOrder: z.number().int().default(0),
		iconUrl: z.string().url().max(1024).nullable().optional(),
		buttonLabel: z.string().max(255).nullable().optional(),
		adminGroups: z.string().max(2000).nullable().optional(),
		operatorGroups: z.string().max(2000).nullable().optional(),
		tenantOrgMap: z.record(z.string()).nullable().optional(),
		defaultOrgId: z.string().max(36).nullable().optional(),
		extraConfig: z.record(z.unknown()).nullable().optional()
	})
	.refine((data) => data.discoveryUrl || (data.authorizationUrl && data.tokenUrl), {
		message: 'Either discoveryUrl or both authorizationUrl and tokenUrl are required'
	});
export type CreateIdpInput = z.infer<typeof CreateIdpInputSchema>;

// Update input — partial of create fields, cannot change providerId
// NOTE: Cannot use .partial() on schema with .refine(), so we rebuild manually
export const UpdateIdpInputSchema = z
	.object({
		displayName: z.string().min(1).max(255).optional(),
		providerType: IdpProviderTypeSchema.optional(),
		discoveryUrl: z.string().url().max(2000).nullable().optional(),
		authorizationUrl: z.string().url().max(2000).nullable().optional(),
		tokenUrl: z.string().url().max(2000).nullable().optional(),
		userinfoUrl: z.string().url().max(2000).nullable().optional(),
		jwksUrl: z.string().url().max(2000).nullable().optional(),
		clientId: z.string().min(1).max(500).optional(),
		clientSecret: z.string().min(1).optional(),
		scopes: z.string().optional(),
		pkceEnabled: z.boolean().optional(),
		status: IdpStatusSchema.optional(),
		isDefault: z.boolean().optional(),
		sortOrder: z.number().int().optional(),
		iconUrl: z.string().url().max(1024).nullable().optional(),
		buttonLabel: z.string().max(255).nullable().optional(),
		adminGroups: z.string().max(2000).nullable().optional(),
		operatorGroups: z.string().max(2000).nullable().optional(),
		tenantOrgMap: z.record(z.string()).nullable().optional(),
		defaultOrgId: z.string().max(36).nullable().optional(),
		extraConfig: z.record(z.unknown()).nullable().optional()
	})
	.refine(
		(data) => {
			// If no URL fields are being updated, skip validation (existing record should be valid)
			const updatingUrls =
				data.discoveryUrl !== undefined ||
				data.authorizationUrl !== undefined ||
				data.tokenUrl !== undefined;
			if (!updatingUrls) return true;
			// Otherwise, enforce the constraint
			return !!data.discoveryUrl || (!!data.authorizationUrl && !!data.tokenUrl);
		},
		{
			message: 'Either discoveryUrl or both authorizationUrl and tokenUrl are required'
		}
	);
export type UpdateIdpInput = z.infer<typeof UpdateIdpInputSchema>;

// ============================================================================
// AI Provider Schemas — match ai_providers table
// ============================================================================

export const AiProviderSchema = z.object({
	id: z.string().uuid(),
	providerId: z.string().min(1).max(100),
	displayName: z.string().min(1).max(255),
	providerType: AiProviderTypeSchema,
	apiBaseUrl: z.string().url().max(2000).nullable().optional(),
	// api_key is decrypted on read
	apiKey: z.string().optional(),
	region: z.string().max(100).nullable().optional(),
	status: AiProviderStatusSchema.default('active'),
	isDefault: z.boolean().default(false),
	sortOrder: z.number().int().default(0),
	// JSON fields
	modelAllowlist: z.array(z.string()).nullable().optional(),
	defaultModel: z.string().max(255).nullable().optional(),
	extraConfig: z.record(z.unknown()).nullable().optional(),
	createdAt: z.date(),
	updatedAt: z.date()
});
export type AiProvider = z.infer<typeof AiProviderSchema>;

// Create input — plaintext apiKey
export const CreateAiProviderInputSchema = z.object({
	providerId: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[a-z0-9-]+$/, 'Provider ID must be lowercase alphanumeric with hyphens'),
	displayName: z.string().min(1).max(255),
	providerType: AiProviderTypeSchema,
	apiBaseUrl: z.string().url().max(2000).nullable().optional(),
	apiKey: z.string().min(1).optional(), // Plaintext, will be encrypted
	region: z.string().max(100).nullable().optional(),
	status: AiProviderStatusSchema.default('active'),
	isDefault: z.boolean().default(false),
	sortOrder: z.number().int().default(0),
	modelAllowlist: z.array(z.string()).nullable().optional(),
	defaultModel: z.string().max(255).nullable().optional(),
	extraConfig: z.record(z.unknown()).nullable().optional()
});
export type CreateAiProviderInput = z.infer<typeof CreateAiProviderInputSchema>;

// Update input — partial, cannot change providerId
export const UpdateAiProviderInputSchema = CreateAiProviderInputSchema.partial().omit({
	providerId: true
});
export type UpdateAiProviderInput = z.infer<typeof UpdateAiProviderInputSchema>;

// ============================================================================
// Portal Settings Schemas — match portal_settings table
// ============================================================================

export const PortalSettingSchema = z.object({
	id: z.string().uuid(),
	key: z.string().min(1).max(255),
	value: z.string(), // JSON string or raw value
	valueType: SettingTypeSchema,
	description: z.string().max(2000).nullable().optional(),
	category: z.string().max(100).nullable().optional(),
	isPublic: z.boolean().default(false),
	sortOrder: z.number().int().default(0),
	createdAt: z.date(),
	updatedAt: z.date()
});
export type PortalSetting = z.infer<typeof PortalSettingSchema>;

// Input for setting a single setting
export const SetSettingInputSchema = z.object({
	key: z
		.string()
		.min(1)
		.max(255)
		.regex(/^[a-z0-9._-]+$/, 'Setting key must be lowercase alphanumeric with ._- separators'),
	value: z.union([z.string(), z.number(), z.boolean(), z.record(z.unknown())]),
	valueType: SettingTypeSchema.optional(), // Auto-detect if not provided
	description: z.string().max(2000).nullable().optional(),
	category: z.string().max(100).nullable().optional(),
	isPublic: z.boolean().default(false),
	sortOrder: z.number().int().default(0)
});
export type SetSettingInput = z.infer<typeof SetSettingInputSchema>;

// Bulk set settings input
export const BulkSetSettingsInputSchema = z.object({
	settings: z.array(SetSettingInputSchema)
});
export type BulkSetSettingsInput = z.infer<typeof BulkSetSettingsInputSchema>;

// ============================================================================
// Setup Status Schema — for GET /api/v1/admin/setup
// ============================================================================

export const SetupStatusSchema = z.object({
	isSetupComplete: z.boolean(),
	idpConfigured: z.boolean(),
	aiProviderConfigured: z.boolean(),
	databaseHealthy: z.boolean(),
	activeIdpCount: z.number().int().nonnegative(),
	activeAiProviderCount: z.number().int().nonnegative(),
	defaultIdpId: z.string().uuid().nullable().optional(),
	defaultAiProviderId: z.string().uuid().nullable().optional()
});
export type SetupStatus = z.infer<typeof SetupStatusSchema>;

// ============================================================================
// Test Connection Result Schema
// ============================================================================

export const TestConnectionResultSchema = z.object({
	success: z.boolean(),
	message: z.string(),
	details: z.record(z.unknown()).optional()
});
export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;

// ============================================================================
// Model Allowlist Schema — for AI provider model restrictions
// ============================================================================

// Map of providerId to array of allowed model IDs
export const ModelAllowlistSchema = z.record(z.string(), z.array(z.string()));
export type ModelAllowlist = z.infer<typeof ModelAllowlistSchema>;
