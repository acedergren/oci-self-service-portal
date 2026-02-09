/**
 * IDP Provider repository — Oracle ADB CRUD for identity provider configuration.
 *
 * Follows the patterns established in workflow-repository.ts:
 * - Oracle UPPERCASE row interfaces
 * - rowToEntity() converters with JSON.parse for CLOB columns
 * - withConnection() wrapper for all operations
 * - Bind variables only (never string interpolation for data)
 * - Encrypted secrets using crypto.ts (AES-256-GCM)
 *
 * Security:
 * - Client secrets encrypted at rest in Oracle
 * - Decryption only on explicit getById() or list() for admin
 * - Public API (listActive) never returns secrets
 */

import { withConnection } from '../oracle/connection.js';
import { encryptSecret, decryptSecret } from '../auth/crypto.js';
import {
	IdpProviderTypeSchema,
	IdpStatusSchema,
	type IdpProvider,
	type IdpProviderPublic,
	type CreateIdpInput,
	type UpdateIdpInput
} from './types.js';

// ============================================================================
// Oracle Row Interfaces (UPPERCASE keys from OUT_FORMAT_OBJECT)
// ============================================================================

interface IdpProviderRow {
	ID: string;
	PROVIDER_ID: string;
	DISPLAY_NAME: string;
	PROVIDER_TYPE: string;
	DISCOVERY_URL: string | null;
	AUTHORIZATION_URL: string | null;
	TOKEN_URL: string | null;
	USERINFO_URL: string | null;
	JWKS_URL: string | null;
	CLIENT_ID: string;
	CLIENT_SECRET_ENC: Buffer | null;
	CLIENT_SECRET_IV: Buffer | null;
	CLIENT_SECRET_TAG: Buffer | null;
	SCOPES: string;
	PKCE_ENABLED: number;
	STATUS: string;
	IS_DEFAULT: number;
	SORT_ORDER: number;
	ICON_URL: string | null;
	BUTTON_LABEL: string | null;
	ADMIN_GROUPS: string | null;
	OPERATOR_GROUPS: string | null;
	TENANT_ORG_MAP: string | null;
	DEFAULT_ORG_ID: string | null;
	EXTRA_CONFIG: string | null;
	CREATED_AT: Date;
	UPDATED_AT: Date;
}

// ============================================================================
// Row-to-Entity Converters
// ============================================================================

/**
 * Converts Oracle row to IdpProvider entity (with decrypted secret).
 * Use for admin views where full config is needed.
 */
async function rowToProvider(row: IdpProviderRow): Promise<IdpProvider> {
	let clientSecret: string | undefined;

	// Decrypt client secret if all components present
	if (row.CLIENT_SECRET_ENC && row.CLIENT_SECRET_IV && row.CLIENT_SECRET_TAG) {
		try {
			clientSecret = await decryptSecret(
				row.CLIENT_SECRET_ENC,
				row.CLIENT_SECRET_IV,
				row.CLIENT_SECRET_TAG
			);
		} catch (err) {
			console.error('Failed to decrypt client secret for IDP:', {
				idpId: row.ID,
				error: err instanceof Error ? err.message : 'Unknown error'
			});
			// Continue without secret — admin can re-enter
			clientSecret = undefined;
		}
	}

	return {
		id: row.ID,
		providerId: row.PROVIDER_ID,
		displayName: row.DISPLAY_NAME,
		providerType: IdpProviderTypeSchema.parse(row.PROVIDER_TYPE),
		discoveryUrl: row.DISCOVERY_URL ?? undefined,
		authorizationUrl: row.AUTHORIZATION_URL ?? undefined,
		tokenUrl: row.TOKEN_URL ?? undefined,
		userinfoUrl: row.USERINFO_URL ?? undefined,
		jwksUrl: row.JWKS_URL ?? undefined,
		clientId: row.CLIENT_ID,
		clientSecret,
		scopes: row.SCOPES,
		pkceEnabled: row.PKCE_ENABLED === 1,
		status: IdpStatusSchema.parse(row.STATUS),
		isDefault: row.IS_DEFAULT === 1,
		sortOrder: row.SORT_ORDER,
		iconUrl: row.ICON_URL ?? undefined,
		buttonLabel: row.BUTTON_LABEL ?? undefined,
		adminGroups: row.ADMIN_GROUPS ?? undefined,
		operatorGroups: row.OPERATOR_GROUPS ?? undefined,
		tenantOrgMap: row.TENANT_ORG_MAP ? JSON.parse(row.TENANT_ORG_MAP) : undefined,
		defaultOrgId: row.DEFAULT_ORG_ID ?? undefined,
		extraConfig: row.EXTRA_CONFIG ? JSON.parse(row.EXTRA_CONFIG) : undefined,
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT
	};
}

/**
 * Converts Oracle row to public provider info (NO secrets).
 * Use for login page and other public APIs.
 */
function rowToPublicProvider(row: IdpProviderRow): IdpProviderPublic {
	return {
		id: row.ID,
		providerId: row.PROVIDER_ID,
		displayName: row.DISPLAY_NAME,
		providerType: IdpProviderTypeSchema.parse(row.PROVIDER_TYPE),
		status: IdpStatusSchema.parse(row.STATUS),
		isDefault: row.IS_DEFAULT === 1,
		sortOrder: row.SORT_ORDER,
		iconUrl: row.ICON_URL ?? undefined,
		buttonLabel: row.BUTTON_LABEL ?? undefined
	};
}

// ============================================================================
// IDP Provider Repository
// ============================================================================

export const idpRepository = {
	/**
	 * List all IDPs (admin view) — includes all fields, decrypts secrets.
	 * Ordered by sort_order, then display_name.
	 */
	async list(): Promise<IdpProvider[]> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<IdpProviderRow>(
				`SELECT * FROM idp_providers
				 ORDER BY sort_order, display_name`,
				[],
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		// Decrypt secrets in parallel
		return Promise.all(rows.map((row) => rowToProvider(row)));
	},

	/**
	 * List active IDPs (public view) — status='active', ordered by sort_order.
	 * Returns public info ONLY (no secrets, no admin fields).
	 * Use for login page IDP selector.
	 */
	async listActive(): Promise<IdpProviderPublic[]> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<IdpProviderRow>(
				`SELECT * FROM idp_providers
				 WHERE status = 'active'
				 ORDER BY sort_order, display_name`,
				[],
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		return rows.map((row) => rowToPublicProvider(row));
	},

	/**
	 * Get single IDP by ID — includes decrypted client secret.
	 * Returns undefined if not found.
	 */
	async getById(id: string): Promise<IdpProvider | undefined> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<IdpProviderRow>(
				`SELECT * FROM idp_providers WHERE id = :id`,
				{ id },
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		if (rows.length === 0) return undefined;
		return rowToProvider(rows[0]);
	},

	/**
	 * Get single IDP by provider_id (unique) — includes decrypted secret.
	 * Returns undefined if not found.
	 */
	async getByProviderId(providerId: string): Promise<IdpProvider | undefined> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<IdpProviderRow>(
				`SELECT * FROM idp_providers WHERE provider_id = :providerId`,
				{ providerId },
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		if (rows.length === 0) return undefined;
		return rowToProvider(rows[0]);
	},

	/**
	 * Get default IDP (is_default = 1).
	 * Returns undefined if no default configured.
	 */
	async getDefault(): Promise<IdpProvider | undefined> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<IdpProviderRow>(
				`SELECT * FROM idp_providers
				 WHERE is_default = 1
				 ORDER BY sort_order
				 FETCH FIRST 1 ROW ONLY`,
				[],
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		if (rows.length === 0) return undefined;
		return rowToProvider(rows[0]);
	},

	/**
	 * Create new IDP — encrypts client secret before storing.
	 * Returns created entity with decrypted secret.
	 */
	async create(input: CreateIdpInput): Promise<IdpProvider> {
		const id = crypto.randomUUID();

		// Encrypt client secret
		const { encrypted, iv, tag } = await encryptSecret(input.clientSecret);

		await withConnection(async (conn) => {
			await conn.execute(
				`INSERT INTO idp_providers
					(id, provider_id, display_name, provider_type,
					 discovery_url, authorization_url, token_url, userinfo_url, jwks_url,
					 client_id, client_secret_enc, client_secret_iv, client_secret_tag,
					 scopes, pkce_enabled, status, is_default, sort_order,
					 icon_url, button_label,
					 admin_groups, operator_groups, tenant_org_map, default_org_id,
					 extra_config)
				 VALUES
					(:id, :providerId, :displayName, :providerType,
					 :discoveryUrl, :authorizationUrl, :tokenUrl, :userinfoUrl, :jwksUrl,
					 :clientId, :clientSecretEnc, :clientSecretIv, :clientSecretTag,
					 :scopes, :pkceEnabled, :status, :isDefault, :sortOrder,
					 :iconUrl, :buttonLabel,
					 :adminGroups, :operatorGroups, :tenantOrgMap, :defaultOrgId,
					 :extraConfig)`,
				{
					id,
					providerId: input.providerId,
					displayName: input.displayName,
					providerType: input.providerType,
					discoveryUrl: input.discoveryUrl ?? null,
					authorizationUrl: input.authorizationUrl ?? null,
					tokenUrl: input.tokenUrl ?? null,
					userinfoUrl: input.userinfoUrl ?? null,
					jwksUrl: input.jwksUrl ?? null,
					clientId: input.clientId,
					clientSecretEnc: encrypted,
					clientSecretIv: iv,
					clientSecretTag: tag,
					scopes: input.scopes ?? 'openid,email,profile',
					pkceEnabled: input.pkceEnabled === false ? 0 : 1,
					status: input.status ?? 'active',
					isDefault: input.isDefault ? 1 : 0,
					sortOrder: input.sortOrder ?? 0,
					iconUrl: input.iconUrl ?? null,
					buttonLabel: input.buttonLabel ?? null,
					adminGroups: input.adminGroups ?? null,
					operatorGroups: input.operatorGroups ?? null,
					tenantOrgMap: input.tenantOrgMap ? JSON.stringify(input.tenantOrgMap) : null,
					defaultOrgId: input.defaultOrgId ?? null,
					extraConfig: input.extraConfig ? JSON.stringify(input.extraConfig) : null
				},
				{ autoCommit: true }
			);
		});

		// Fetch and return
		const created = await this.getById(id);
		if (!created) throw new Error(`Failed to retrieve created IDP ${id}`);
		return created;
	},

	/**
	 * Update existing IDP — re-encrypts client secret if changed.
	 * Only updates provided fields (partial update).
	 * Returns updated entity.
	 */
	async update(id: string, input: UpdateIdpInput): Promise<IdpProvider> {
		// Fetch existing to verify it exists
		const existing = await this.getById(id);
		if (!existing) {
			throw new Error(`IDP not found: ${id}`);
		}

		// Build SET clause dynamically based on provided fields
		const setClauses: string[] = [];
		const binds: Record<string, unknown> = { id };

		// Always update timestamp
		setClauses.push('updated_at = SYSTIMESTAMP');

		// Simple fields
		if (input.displayName !== undefined) {
			setClauses.push('display_name = :displayName');
			binds.displayName = input.displayName;
		}
		if (input.providerType !== undefined) {
			setClauses.push('provider_type = :providerType');
			binds.providerType = input.providerType;
		}
		if (input.discoveryUrl !== undefined) {
			setClauses.push('discovery_url = :discoveryUrl');
			binds.discoveryUrl = input.discoveryUrl ?? null;
		}
		if (input.authorizationUrl !== undefined) {
			setClauses.push('authorization_url = :authorizationUrl');
			binds.authorizationUrl = input.authorizationUrl ?? null;
		}
		if (input.tokenUrl !== undefined) {
			setClauses.push('token_url = :tokenUrl');
			binds.tokenUrl = input.tokenUrl ?? null;
		}
		if (input.userinfoUrl !== undefined) {
			setClauses.push('userinfo_url = :userinfoUrl');
			binds.userinfoUrl = input.userinfoUrl ?? null;
		}
		if (input.jwksUrl !== undefined) {
			setClauses.push('jwks_url = :jwksUrl');
			binds.jwksUrl = input.jwksUrl ?? null;
		}
		if (input.clientId !== undefined) {
			setClauses.push('client_id = :clientId');
			binds.clientId = input.clientId;
		}
		if (input.scopes !== undefined) {
			setClauses.push('scopes = :scopes');
			binds.scopes = input.scopes;
		}
		if (input.pkceEnabled !== undefined) {
			setClauses.push('pkce_enabled = :pkceEnabled');
			binds.pkceEnabled = input.pkceEnabled ? 1 : 0;
		}
		if (input.status !== undefined) {
			setClauses.push('status = :status');
			binds.status = input.status;
		}
		if (input.isDefault !== undefined) {
			setClauses.push('is_default = :isDefault');
			binds.isDefault = input.isDefault ? 1 : 0;
		}
		if (input.sortOrder !== undefined) {
			setClauses.push('sort_order = :sortOrder');
			binds.sortOrder = input.sortOrder;
		}
		if (input.iconUrl !== undefined) {
			setClauses.push('icon_url = :iconUrl');
			binds.iconUrl = input.iconUrl ?? null;
		}
		if (input.buttonLabel !== undefined) {
			setClauses.push('button_label = :buttonLabel');
			binds.buttonLabel = input.buttonLabel ?? null;
		}
		if (input.adminGroups !== undefined) {
			setClauses.push('admin_groups = :adminGroups');
			binds.adminGroups = input.adminGroups ?? null;
		}
		if (input.operatorGroups !== undefined) {
			setClauses.push('operator_groups = :operatorGroups');
			binds.operatorGroups = input.operatorGroups ?? null;
		}
		if (input.tenantOrgMap !== undefined) {
			setClauses.push('tenant_org_map = :tenantOrgMap');
			binds.tenantOrgMap = input.tenantOrgMap ? JSON.stringify(input.tenantOrgMap) : null;
		}
		if (input.defaultOrgId !== undefined) {
			setClauses.push('default_org_id = :defaultOrgId');
			binds.defaultOrgId = input.defaultOrgId ?? null;
		}
		if (input.extraConfig !== undefined) {
			setClauses.push('extra_config = :extraConfig');
			binds.extraConfig = input.extraConfig ? JSON.stringify(input.extraConfig) : null;
		}

		// Encrypted client secret — re-encrypt if provided
		if (input.clientSecret !== undefined) {
			const { encrypted, iv, tag } = await encryptSecret(input.clientSecret);
			setClauses.push('client_secret_enc = :clientSecretEnc');
			setClauses.push('client_secret_iv = :clientSecretIv');
			setClauses.push('client_secret_tag = :clientSecretTag');
			binds.clientSecretEnc = encrypted;
			binds.clientSecretIv = iv;
			binds.clientSecretTag = tag;
		}

		if (setClauses.length === 1) {
			// Only timestamp update — no-op
			return existing;
		}

		await withConnection(async (conn) => {
			await conn.execute(
				`UPDATE idp_providers SET ${setClauses.join(', ')} WHERE id = :id`,
				binds,
				{ autoCommit: true }
			);
		});

		// Fetch and return updated
		const updated = await this.getById(id);
		if (!updated) throw new Error(`Failed to retrieve updated IDP ${id}`);
		return updated;
	},

	/**
	 * Delete IDP by ID.
	 * Returns true if deleted, false if not found.
	 */
	async delete(id: string): Promise<boolean> {
		const result = await withConnection(async (conn) => {
			const res = await conn.execute(
				`DELETE FROM idp_providers WHERE id = :id`,
				{ id },
				{ autoCommit: true }
			);
			return res.rowsAffected ?? 0;
		});

		return result > 0;
	},

	/**
	 * Count total IDPs (for setup detection).
	 * Returns 0 if none configured.
	 */
	async count(): Promise<number> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<{ COUNT: number }>(
				`SELECT COUNT(*) as COUNT FROM idp_providers`,
				[],
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		return rows[0]?.COUNT ?? 0;
	},

	/**
	 * Count active IDPs (status='active').
	 * Returns 0 if none active.
	 */
	async countActive(): Promise<number> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<{ COUNT: number }>(
				`SELECT COUNT(*) as COUNT FROM idp_providers WHERE status = 'active'`,
				[],
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		return rows[0]?.COUNT ?? 0;
	}
};
