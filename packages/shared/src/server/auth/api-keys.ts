/**
 * API Key Authentication for external integrations.
 *
 * API keys provide programmatic access to the portal REST API (CI/CD pipelines,
 * monitoring scripts, external dashboards). Keys are scoped to an organization
 * and carry a set of permissions that mirror the RBAC system.
 *
 * Security model:
 * - Keys are prefixed with `portal_` for easy identification in logs and headers.
 * - Only the SHA-256 hash is stored; the plaintext key is shown once at creation.
 * - A `key_prefix` (first 8 chars after `portal_`) is stored for quick identification
 *   in the admin UI without exposing the full hash.
 * - Revocation is soft-delete (revoked_at timestamp) — hashes are never removed so
 *   that a compromised key cannot be re-registered.
 * - `last_used_at` is updated on each successful validation for audit visibility.
 */
import crypto from 'crypto';
import { withConnection } from '$lib/server/oracle/connection.js';
import { createLogger } from '$lib/server/logger.js';
import { ValidationError, DatabaseError } from '$lib/server/errors.js';
import type {
	ApiKeyContext,
	ApiKeyInfo,
	CreateApiKeyResult,
	ApiKeyRow
} from '$lib/server/api/types.js';
import { apiKeyRowToInfo, apiKeyRowToContext } from '$lib/server/api/types.js';

const log = createLogger('api-keys');

// ============================================================================
// Key generation helpers
// ============================================================================

const KEY_PREFIX = 'portal_';

/** Generate a cryptographically random API key with the `portal_` prefix. */
function generateKey(): string {
	return KEY_PREFIX + crypto.randomBytes(32).toString('hex');
}

/** SHA-256 hash of a key (for storage and lookup). */
function hashKey(key: string): string {
	return crypto.createHash('sha256').update(key).digest('hex');
}

/** Extract the key prefix (first 8 chars after `portal_`) for UI display. */
function extractPrefix(key: string): string {
	return key.slice(KEY_PREFIX.length, KEY_PREFIX.length + 8);
}

// ============================================================================
// CRUD operations
// ============================================================================

/**
 * Create a new API key for an organization.
 *
 * Returns the plaintext key (shown once), its hash, and the generated row ID.
 * The caller is responsible for displaying the plaintext key to the admin user
 * and informing them it will not be shown again.
 */
export async function createApiKey(
	orgId: string,
	name: string,
	permissions: string[],
	expiresAt?: Date | null
): Promise<CreateApiKeyResult> {
	if (!orgId) throw new ValidationError('orgId is required', { field: 'orgId' });
	if (!name || name.trim().length === 0)
		throw new ValidationError('name is required', { field: 'name' });
	if (!permissions || permissions.length === 0) {
		throw new ValidationError('At least one permission is required', { field: 'permissions' });
	}

	const key = generateKey();
	const keyHash = hashKey(key);
	const keyPrefix = extractPrefix(key);
	const id = crypto.randomUUID();

	await withConnection(async (conn) => {
		await conn.execute(
			`INSERT INTO api_keys
			   (id, org_id, key_hash, key_prefix, name, permissions, status, expires_at)
			 VALUES
			   (:id, :orgId, :keyHash, :keyPrefix, :name, :permissions, 'active', :expiresAt)`,
			{
				id,
				orgId,
				keyHash,
				keyPrefix,
				name: name.trim(),
				permissions: JSON.stringify(permissions),
				expiresAt: expiresAt ?? null
			}
		);
	});

	log.info({ keyId: id, orgId, keyPrefix, name }, 'API key created');

	return { key, keyHash, id };
}

/**
 * Validate an API key and return the associated context.
 *
 * Returns null if the key is invalid, revoked, or expired.
 * On success, updates `last_used_at` for audit visibility.
 */
export async function validateApiKey(key: string): Promise<ApiKeyContext | null> {
	// Quick check: reject keys that don't match the expected prefix
	if (!key || !key.startsWith(KEY_PREFIX)) {
		return null;
	}

	const keyHash = hashKey(key);

	try {
		return await withConnection(async (conn) => {
			const result = await conn.execute<ApiKeyRow>(
				`SELECT id, org_id, key_hash, key_prefix, name, permissions,
				        status, last_used_at, expires_at, revoked_at, created_at, updated_at
				 FROM api_keys
				 WHERE key_hash = :keyHash`,
				{ keyHash }
			);

			if (!result.rows || result.rows.length === 0) {
				log.debug(
					{ keyPrefix: key.slice(KEY_PREFIX.length, KEY_PREFIX.length + 8) },
					'API key not found'
				);
				return null;
			}

			const row = result.rows[0];

			// Check revocation
			if (row.REVOKED_AT !== null) {
				log.warn({ keyId: row.ID, orgId: row.ORG_ID }, 'revoked API key used');
				return null;
			}

			// Check expiration
			if (row.EXPIRES_AT !== null && new Date(row.EXPIRES_AT) < new Date()) {
				log.warn({ keyId: row.ID, orgId: row.ORG_ID }, 'expired API key used');
				return null;
			}

			// Check status (if present — STATUS column may be absent in older rows)
			if (row.STATUS && row.STATUS !== 'active') {
				log.warn({ keyId: row.ID, orgId: row.ORG_ID, status: row.STATUS }, 'inactive API key used');
				return null;
			}

			// Update last_used_at in a separate connection to avoid racing with conn.close()
			withConnection(async (c) => {
				await c.execute('UPDATE api_keys SET last_used_at = SYSTIMESTAMP WHERE id = :id', {
					id: row.ID
				});
			}).catch((err) => {
				log.error({ err, keyId: row.ID }, 'failed to update last_used_at');
			});

			return apiKeyRowToContext(row);
		});
	} catch (err) {
		log.error({ err }, 'API key validation failed');
		return null;
	}
}

/**
 * Revoke an API key by setting its revoked_at timestamp and status.
 *
 * Scoped to an organization to prevent cross-org revocation.
 */
export async function revokeApiKey(id: string, orgId?: string): Promise<void> {
	await withConnection(async (conn) => {
		const sql = orgId
			? `UPDATE api_keys SET revoked_at = SYSTIMESTAMP, status = 'revoked', updated_at = SYSTIMESTAMP
			   WHERE id = :id AND org_id = :orgId`
			: `UPDATE api_keys SET revoked_at = SYSTIMESTAMP, status = 'revoked', updated_at = SYSTIMESTAMP
			   WHERE id = :id`;
		const binds = orgId ? { id, orgId } : { id };

		const result = await conn.execute(sql, binds);
		const affected = (result as unknown as { rowsAffected?: number }).rowsAffected ?? 0;

		if (affected === 0) {
			log.warn({ keyId: id, orgId }, 'API key revocation: no matching key found');
		} else {
			log.info({ keyId: id, orgId }, 'API key revoked');
		}
	});
}

/**
 * List all API keys for an organization.
 *
 * Returns ApiKeyInfo objects (no key_hash exposed).
 */
export async function listApiKeys(orgId: string): Promise<ApiKeyInfo[]> {
	return withConnection(async (conn) => {
		const result = await conn.execute<ApiKeyRow>(
			`SELECT id, org_id, key_prefix, name, permissions, status,
			        last_used_at, expires_at, revoked_at, created_at, updated_at,
			        '' AS key_hash
			 FROM api_keys
			 WHERE org_id = :orgId
			 ORDER BY created_at DESC`,
			{ orgId }
		);

		if (!result.rows) return [];
		return result.rows.map(apiKeyRowToInfo);
	});
}
