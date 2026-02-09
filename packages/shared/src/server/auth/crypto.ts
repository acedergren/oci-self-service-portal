/**
 * AES-256-GCM encryption utilities for sensitive data (API keys, client secrets)
 *
 * Uses HKDF to derive encryption key from BETTER_AUTH_SECRET, avoiding the need
 * for additional secret management. Follows cryptographic best practices:
 * - AES-256-GCM for authenticated encryption (confidentiality + integrity)
 * - 12-byte IV (optimal for GCM mode)
 * - 16-byte authentication tag
 * - Separate storage of ciphertext, IV, and tag in Oracle
 *
 * Security notes:
 * - IVs must be unique per encryption (random generation ensures this)
 * - Authentication tag verification prevents tampering
 * - Key derivation uses HKDF-SHA256 with domain-specific salt
 *
 * @module crypto
 */

import { createCipheriv, createDecipheriv, randomBytes, hkdf } from 'node:crypto';
import { promisify } from 'node:util';

const hkdfAsync = promisify(hkdf);

// AES-256-GCM configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits (optimal for GCM)
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

// HKDF parameters for key derivation
const HKDF_SALT = 'portal-admin-encryption';
const HKDF_INFO = 'aes-256-gcm-key';
const HKDF_DIGEST = 'sha256';

// Cached encryption key (derived once per process)
let cachedKey: Buffer | null = null;

/**
 * Derives AES-256 encryption key from BETTER_AUTH_SECRET using HKDF.
 *
 * The key is cached in memory after first derivation to avoid repeated
 * HKDF computations. Cache is cleared only in tests via _clearKeyCache().
 *
 * @returns 32-byte encryption key
 * @throws {Error} If BETTER_AUTH_SECRET is not set
 */
async function getEncryptionKey(): Promise<Buffer> {
	if (cachedKey) {
		return cachedKey;
	}

	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) {
		throw new Error(
			'BETTER_AUTH_SECRET environment variable is required for encryption. ' +
				'This is used to derive encryption keys for sensitive data (API keys, client secrets).'
		);
	}

	// Derive key using HKDF-SHA256
	cachedKey = Buffer.from(await hkdfAsync(HKDF_DIGEST, secret, HKDF_SALT, HKDF_INFO, KEY_LENGTH));

	return cachedKey;
}

/**
 * Encrypted data structure returned by encryptSecret().
 * All three components (encrypted, iv, tag) must be stored separately
 * in the database for later decryption.
 */
export interface EncryptedSecret {
	/** Ciphertext (encrypted data) */
	encrypted: Buffer;
	/** Initialization vector (12 bytes, random per encryption) */
	iv: Buffer;
	/** Authentication tag (16 bytes, ensures integrity) */
	tag: Buffer;
}

/**
 * Encrypts a plaintext secret using AES-256-GCM.
 *
 * Returns three components that MUST be stored separately:
 * - encrypted: Store in BLOB column (e.g., client_secret_enc)
 * - iv: Store in RAW(16) column (e.g., client_secret_iv)
 * - tag: Store in RAW(16) column (e.g., client_secret_tag)
 *
 * Each encryption uses a fresh random IV, ensuring semantic security
 * (encrypting the same plaintext twice produces different ciphertext).
 *
 * @param plaintext - Secret to encrypt (e.g., API key, client secret)
 * @returns Object containing encrypted data, IV, and authentication tag
 * @throws {Error} If BETTER_AUTH_SECRET is not configured
 *
 * @example
 * const { encrypted, iv, tag } = await encryptSecret('my-api-key');
 * // Store all three in Oracle:
 * // - api_key_enc = encrypted
 * // - api_key_iv = iv
 * // - api_key_tag = tag
 */
export async function encryptSecret(plaintext: string): Promise<EncryptedSecret> {
	if (!plaintext) {
		throw new Error('Cannot encrypt empty plaintext');
	}

	const key = await getEncryptionKey();
	const iv = randomBytes(IV_LENGTH);

	const cipher = createCipheriv(ALGORITHM, key, iv, {
		authTagLength: TAG_LENGTH
	});

	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

	const tag = cipher.getAuthTag();

	return { encrypted, iv, tag };
}

/**
 * Decrypts data encrypted with encryptSecret().
 *
 * Requires all three components retrieved from database:
 * - encrypted: From BLOB column
 * - iv: From RAW(16) column
 * - tag: From RAW(16) column
 *
 * Authentication tag is verified during decryption. If the ciphertext
 * or tag has been tampered with, decryption will fail with an error.
 *
 * @param encrypted - Ciphertext from database
 * @param iv - Initialization vector from database
 * @param tag - Authentication tag from database
 * @returns Original plaintext secret
 * @throws {Error} If BETTER_AUTH_SECRET is not configured
 * @throws {Error} If authentication tag verification fails (tampered data)
 *
 * @example
 * // Retrieve from Oracle
 * const encrypted = row.API_KEY_ENC;
 * const iv = row.API_KEY_IV;
 * const tag = row.API_KEY_TAG;
 *
 * const apiKey = await decryptSecret(encrypted, iv, tag);
 */
export async function decryptSecret(encrypted: Buffer, iv: Buffer, tag: Buffer): Promise<string> {
	if (!encrypted || !iv || !tag) {
		throw new Error('Missing required decryption components (encrypted, iv, or tag)');
	}

	if (iv.length !== IV_LENGTH) {
		throw new Error(`Invalid IV length: expected ${IV_LENGTH} bytes, got ${iv.length}`);
	}

	if (tag.length !== TAG_LENGTH) {
		throw new Error(`Invalid tag length: expected ${TAG_LENGTH} bytes, got ${tag.length}`);
	}

	const key = await getEncryptionKey();

	const decipher = createDecipheriv(ALGORITHM, key, iv, {
		authTagLength: TAG_LENGTH
	});

	decipher.setAuthTag(tag);

	try {
		const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
		return decrypted.toString('utf8');
	} catch (err) {
		// Authentication failure or corrupted data
		throw new Error(
			`Decryption failed: ${err instanceof Error ? err.message : 'Invalid ciphertext or authentication tag'}`
		);
	}
}

/**
 * Clears cached encryption key.
 *
 * FOR TESTING ONLY. This forces key re-derivation on next encrypt/decrypt call.
 * Allows tests to verify behavior with different BETTER_AUTH_SECRET values.
 *
 * @internal
 */
export function _clearKeyCache(): void {
	cachedKey = null;
}
