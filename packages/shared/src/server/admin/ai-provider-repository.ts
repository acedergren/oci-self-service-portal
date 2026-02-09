/**
 * AI Provider repository — Oracle ADB CRUD for AI model provider configuration.
 *
 * Follows the patterns established in idp-repository.ts:
 * - Oracle UPPERCASE row interfaces
 * - rowToEntity() converters with JSON.parse for CLOB columns
 * - withConnection() wrapper for all operations
 * - Bind variables only (never string interpolation for data)
 * - Encrypted API keys using crypto.ts (AES-256-GCM)
 *
 * Security:
 * - API keys encrypted at rest in Oracle
 * - Decryption only on explicit getById() (not list operations)
 * - OCI providers have null API key (use instance principal auth)
 */

import { withConnection } from '../oracle/connection.js';
import { encryptSecret, decryptSecret } from '../auth/crypto.js';
import type {
	AiProvider,
	CreateAiProviderInput,
	UpdateAiProviderInput,
	AiProviderStatus,
	ModelAllowlist
} from './types.js';

// ============================================================================
// Oracle Row Interfaces (UPPERCASE keys from OUT_FORMAT_OBJECT)
// ============================================================================

interface AiProviderRow {
	ID: string;
	PROVIDER_ID: string;
	DISPLAY_NAME: string;
	PROVIDER_TYPE: string;
	API_KEY_ENC: Buffer | null;
	API_KEY_IV: Buffer | null;
	API_KEY_TAG: Buffer | null;
	API_BASE_URL: string | null;
	REGION: string | null;
	STATUS: string;
	IS_DEFAULT: number;
	SORT_ORDER: number;
	MODEL_ALLOWLIST: string | null;
	DEFAULT_MODEL: string | null;
	EXTRA_CONFIG: string | null;
	CREATED_AT: Date;
	UPDATED_AT: Date;
}

// ============================================================================
// Row-to-Entity Converters
// ============================================================================

/**
 * Converts Oracle row to AiProvider entity (with decrypted API key).
 * Use for admin views where full config is needed.
 */
async function rowToProvider(row: AiProviderRow): Promise<AiProvider> {
	let apiKey: string | undefined;

	// Decrypt API key if all components present (OCI providers have null key)
	if (row.API_KEY_ENC && row.API_KEY_IV && row.API_KEY_TAG) {
		try {
			apiKey = await decryptSecret(row.API_KEY_ENC, row.API_KEY_IV, row.API_KEY_TAG);
		} catch (err) {
			console.error('Failed to decrypt API key for provider:', {
				providerId: row.ID,
				error: err instanceof Error ? err.message : 'Unknown error'
			});
			// Continue without key — admin can re-enter
			apiKey = undefined;
		}
	}

	return {
		id: row.ID,
		providerId: row.PROVIDER_ID,
		displayName: row.DISPLAY_NAME,
		providerType: row.PROVIDER_TYPE as AiProvider['providerType'],
		apiBaseUrl: row.API_BASE_URL ?? undefined,
		apiKey,
		region: row.REGION ?? undefined,
		status: row.STATUS as AiProviderStatus,
		isDefault: row.IS_DEFAULT === 1,
		sortOrder: row.SORT_ORDER,
		modelAllowlist: row.MODEL_ALLOWLIST ? JSON.parse(row.MODEL_ALLOWLIST) : undefined,
		defaultModel: row.DEFAULT_MODEL ?? undefined,
		extraConfig: row.EXTRA_CONFIG ? JSON.parse(row.EXTRA_CONFIG) : undefined,
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT
	};
}

/**
 * Converts Oracle row to AiProvider WITHOUT decrypting API key.
 * Use for list operations where secrets should not be exposed.
 */
function rowToProviderWithoutKey(row: AiProviderRow): Omit<AiProvider, 'apiKey'> {
	return {
		id: row.ID,
		providerId: row.PROVIDER_ID,
		displayName: row.DISPLAY_NAME,
		providerType: row.PROVIDER_TYPE as AiProvider['providerType'],
		apiBaseUrl: row.API_BASE_URL ?? undefined,
		region: row.REGION ?? undefined,
		status: row.STATUS as AiProviderStatus,
		isDefault: row.IS_DEFAULT === 1,
		sortOrder: row.SORT_ORDER,
		modelAllowlist: row.MODEL_ALLOWLIST ? JSON.parse(row.MODEL_ALLOWLIST) : undefined,
		defaultModel: row.DEFAULT_MODEL ?? undefined,
		extraConfig: row.EXTRA_CONFIG ? JSON.parse(row.EXTRA_CONFIG) : undefined,
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT
	};
}

// ============================================================================
// AI Provider Repository
// ============================================================================

export const aiProviderRepository = {
	/**
	 * List all AI providers (admin view) — NO decrypted keys.
	 * Ordered by sort_order, then display_name.
	 */
	async list(): Promise<Omit<AiProvider, 'apiKey'>[]> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<AiProviderRow>(
				`SELECT * FROM ai_providers
				 ORDER BY sort_order, display_name`,
				[],
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		return rows.map((row) => rowToProviderWithoutKey(row));
	},

	/**
	 * List active AI providers — status='active', ordered by sort_order.
	 * NO decrypted keys. Use for provider selection UI.
	 */
	async listActive(): Promise<Omit<AiProvider, 'apiKey'>[]> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<AiProviderRow>(
				`SELECT * FROM ai_providers
				 WHERE status = 'active'
				 ORDER BY sort_order, display_name`,
				[],
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		return rows.map((row) => rowToProviderWithoutKey(row));
	},

	/**
	 * Get single AI provider by ID — includes decrypted API key.
	 * Returns undefined if not found.
	 */
	async getById(id: string): Promise<AiProvider | undefined> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<AiProviderRow>(
				`SELECT * FROM ai_providers WHERE id = :id`,
				{ id },
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		if (rows.length === 0) return undefined;
		return rowToProvider(rows[0]);
	},

	/**
	 * Get single AI provider by provider_id (unique) — includes decrypted key.
	 * Returns undefined if not found.
	 */
	async getByProviderId(providerId: string): Promise<AiProvider | undefined> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<AiProviderRow>(
				`SELECT * FROM ai_providers WHERE provider_id = :providerId`,
				{ providerId },
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		if (rows.length === 0) return undefined;
		return rowToProvider(rows[0]);
	},

	/**
	 * Get default AI provider (is_default = 1).
	 * Returns undefined if no default configured.
	 */
	async getDefault(): Promise<AiProvider | undefined> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<AiProviderRow>(
				`SELECT * FROM ai_providers
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
	 * Create new AI provider — encrypts API key before storing (if provided).
	 * OCI providers may have null API key (use instance principal).
	 * Returns created entity with decrypted key.
	 */
	async create(input: CreateAiProviderInput): Promise<AiProvider> {
		const id = crypto.randomUUID();

		// Encrypt API key if provided (OCI providers may not have one)
		let apiKeyEnc: Buffer | null = null;
		let apiKeyIv: Buffer | null = null;
		let apiKeyTag: Buffer | null = null;

		if (input.apiKey) {
			const encrypted = await encryptSecret(input.apiKey);
			apiKeyEnc = encrypted.encrypted;
			apiKeyIv = encrypted.iv;
			apiKeyTag = encrypted.tag;
		}

		await withConnection(async (conn) => {
			await conn.execute(
				`INSERT INTO ai_providers
					(id, provider_id, display_name, provider_type,
					 api_key_enc, api_key_iv, api_key_tag,
					 api_base_url, region,
					 status, is_default, sort_order,
					 model_allowlist, default_model, extra_config)
				 VALUES
					(:id, :providerId, :displayName, :providerType,
					 :apiKeyEnc, :apiKeyIv, :apiKeyTag,
					 :apiBaseUrl, :region,
					 :status, :isDefault, :sortOrder,
					 :modelAllowlist, :defaultModel, :extraConfig)`,
				{
					id,
					providerId: input.providerId,
					displayName: input.displayName,
					providerType: input.providerType,
					apiKeyEnc,
					apiKeyIv,
					apiKeyTag,
					apiBaseUrl: input.apiBaseUrl ?? null,
					region: input.region ?? null,
					status: input.status ?? 'active',
					isDefault: input.isDefault ? 1 : 0,
					sortOrder: input.sortOrder ?? 0,
					modelAllowlist: input.modelAllowlist ? JSON.stringify(input.modelAllowlist) : null,
					defaultModel: input.defaultModel ?? null,
					extraConfig: input.extraConfig ? JSON.stringify(input.extraConfig) : null
				},
				{ autoCommit: true }
			);
		});

		// Fetch and return
		const created = await this.getById(id);
		if (!created) throw new Error(`Failed to retrieve created AI provider ${id}`);
		return created;
	},

	/**
	 * Update existing AI provider — re-encrypts API key if changed.
	 * Only updates provided fields (partial update).
	 * Returns updated entity.
	 */
	async update(id: string, input: UpdateAiProviderInput): Promise<AiProvider> {
		// Fetch existing to verify it exists
		const existing = await this.getById(id);
		if (!existing) {
			throw new Error(`AI provider not found: ${id}`);
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
		if (input.apiBaseUrl !== undefined) {
			setClauses.push('api_base_url = :apiBaseUrl');
			binds.apiBaseUrl = input.apiBaseUrl ?? null;
		}
		if (input.region !== undefined) {
			setClauses.push('region = :region');
			binds.region = input.region ?? null;
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
		if (input.modelAllowlist !== undefined) {
			setClauses.push('model_allowlist = :modelAllowlist');
			binds.modelAllowlist = input.modelAllowlist ? JSON.stringify(input.modelAllowlist) : null;
		}
		if (input.defaultModel !== undefined) {
			setClauses.push('default_model = :defaultModel');
			binds.defaultModel = input.defaultModel ?? null;
		}
		if (input.extraConfig !== undefined) {
			setClauses.push('extra_config = :extraConfig');
			binds.extraConfig = input.extraConfig ? JSON.stringify(input.extraConfig) : null;
		}

		// Encrypted API key — re-encrypt if provided
		if (input.apiKey !== undefined) {
			const { encrypted, iv, tag } = await encryptSecret(input.apiKey);
			setClauses.push('api_key_enc = :apiKeyEnc');
			setClauses.push('api_key_iv = :apiKeyIv');
			setClauses.push('api_key_tag = :apiKeyTag');
			binds.apiKeyEnc = encrypted;
			binds.apiKeyIv = iv;
			binds.apiKeyTag = tag;
		}

		if (setClauses.length === 1) {
			// Only timestamp update — no-op
			return existing;
		}

		await withConnection(async (conn) => {
			await conn.execute(`UPDATE ai_providers SET ${setClauses.join(', ')} WHERE id = :id`, binds, {
				autoCommit: true
			});
		});

		// Fetch and return updated
		const updated = await this.getById(id);
		if (!updated) throw new Error(`Failed to retrieve updated AI provider ${id}`);
		return updated;
	},

	/**
	 * Delete AI provider by ID.
	 * Returns true if deleted, false if not found.
	 */
	async delete(id: string): Promise<boolean> {
		const result = await withConnection(async (conn) => {
			const res = await conn.execute(
				`DELETE FROM ai_providers WHERE id = :id`,
				{ id },
				{ autoCommit: true }
			);
			return res.rowsAffected ?? 0;
		});

		return result > 0;
	},

	/**
	 * Count total AI providers (for setup detection).
	 * Returns 0 if none configured.
	 */
	async count(): Promise<number> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<{ COUNT: number }>(
				`SELECT COUNT(*) as COUNT FROM ai_providers`,
				[],
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		return rows[0]?.COUNT ?? 0;
	},

	/**
	 * Count active AI providers (status='active').
	 * Returns 0 if none active.
	 */
	async countActive(): Promise<number> {
		const rows = await withConnection(async (conn) => {
			const result = await conn.execute<{ COUNT: number }>(
				`SELECT COUNT(*) as COUNT FROM ai_providers WHERE status = 'active'`,
				[],
				{ outFormat: conn.OBJECT }
			);
			return result.rows ?? [];
		});

		return rows[0]?.COUNT ?? 0;
	},

	/**
	 * Get enabled models from all active providers.
	 * Aggregates model_allowlist JSON from all active providers into a flat ModelAllowlist.
	 * Returns a map of providerId → array of model IDs.
	 */
	async getEnabledModels(): Promise<ModelAllowlist> {
		const providers = await this.listActive();
		const allowlist: ModelAllowlist = {};

		for (const provider of providers) {
			if (provider.modelAllowlist && provider.modelAllowlist.length > 0) {
				allowlist[provider.providerId] = provider.modelAllowlist;
			}
		}

		return allowlist;
	}
};
