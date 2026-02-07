import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const WEBHOOK_ENCRYPTION_KEY_BYTES = 32;
const WEBHOOK_ENCRYPTION_IV_BYTES = 12;
const WEBHOOK_ENCRYPTION_TAG_BYTES = 16;
const WEBHOOK_ENCRYPTION_ALGORITHM = 'aes-256-gcm';

let cachedEnvValue: string | undefined;
let cachedKey: Buffer | null | undefined;

function decodeWebhookEncryptionKey(raw: string): Buffer {
	const trimmed = raw.trim();

	if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
		return Buffer.from(trimmed, 'hex');
	}

	try {
		const key = Buffer.from(trimmed, 'base64url');
		if (key.length === WEBHOOK_ENCRYPTION_KEY_BYTES) return key;
	} catch {
		// Continue to legacy base64 fallback.
	}

	const legacyBase64 = Buffer.from(trimmed, 'base64');
	if (legacyBase64.length === WEBHOOK_ENCRYPTION_KEY_BYTES) {
		return legacyBase64;
	}

	throw new Error(
		'WEBHOOK_ENCRYPTION_KEY must be 32 bytes (64-char hex, base64url, or base64).'
	);
}

/**
 * Returns the configured webhook encryption key, or null if not set.
 * The parsed key is cached and auto-invalidated when the env value changes.
 */
export function getWebhookEncryptionKey(): Buffer | null {
	const raw = process.env.WEBHOOK_ENCRYPTION_KEY?.trim();
	if (!raw) return null;

	if (cachedKey !== undefined && cachedEnvValue === raw) {
		return cachedKey;
	}

	cachedEnvValue = raw;
	cachedKey = decodeWebhookEncryptionKey(raw);
	return cachedKey;
}

export function isWebhookEncryptionEnabled(): boolean {
	return getWebhookEncryptionKey() !== null;
}

function requireWebhookEncryptionKey(): Buffer {
	const key = getWebhookEncryptionKey();
	if (!key) {
		throw new Error(
			'WEBHOOK_ENCRYPTION_KEY is required for webhook secret encryption at rest.'
		);
	}
	return key;
}

export interface EncryptedWebhookSecret {
	ciphertext: string;
	iv: string;
}

/**
 * Encrypt a webhook signing secret using AES-256-GCM.
 * Returns base64url-encoded ciphertext (with auth tag appended) and IV.
 */
export function encryptWebhookSecret(secret: string): EncryptedWebhookSecret {
	const key = requireWebhookEncryptionKey();
	const iv = randomBytes(WEBHOOK_ENCRYPTION_IV_BYTES);

	const cipher = createCipheriv(WEBHOOK_ENCRYPTION_ALGORITHM, key, iv);
	const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
	// nosemgrep: gcm-no-tag-length — default 16-byte (128-bit) tag is the maximum GCM strength
	const authTag = cipher.getAuthTag();
	const payload = Buffer.concat([encrypted, authTag]).toString('base64url');

	return {
		ciphertext: payload,
		iv: iv.toString('base64url')
	};
}

/**
 * Decrypt a webhook signing secret encrypted by encryptWebhookSecret().
 */
export function decryptWebhookSecret(ciphertext: string, iv: string): string {
	const key = requireWebhookEncryptionKey();
	const ivBytes = Buffer.from(iv, 'base64url');

	if (ivBytes.length !== WEBHOOK_ENCRYPTION_IV_BYTES) {
		throw new Error('Invalid webhook secret IV length.');
	}

	const payload = Buffer.from(ciphertext, 'base64url');
	if (payload.length <= WEBHOOK_ENCRYPTION_TAG_BYTES) {
		throw new Error('Invalid webhook secret ciphertext payload.');
	}

	const encrypted = payload.subarray(0, payload.length - WEBHOOK_ENCRYPTION_TAG_BYTES);
	const authTag = payload.subarray(payload.length - WEBHOOK_ENCRYPTION_TAG_BYTES);

	const decipher = createDecipheriv(WEBHOOK_ENCRYPTION_ALGORITHM, key, ivBytes);
	// nosemgrep: gcm-no-tag-length — authTag is exactly WEBHOOK_ENCRYPTION_TAG_BYTES (16) bytes, sliced at line above
	decipher.setAuthTag(authTag);

	const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
	return decrypted.toString('utf8');
}
