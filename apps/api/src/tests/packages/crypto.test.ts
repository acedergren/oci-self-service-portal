/**
 * Unit tests for the AES-256-GCM webhook secret encryption module.
 *
 * Pure crypto utility — no mocks needed, but requires managing
 * process.env.WEBHOOK_ENCRYPTION_KEY between tests.
 *
 * Source: packages/server/src/crypto.ts (110 lines, 0 prior tests)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	encryptWebhookSecret,
	decryptWebhookSecret,
	isWebhookEncryptionEnabled,
	getWebhookEncryptionKey
} from '@portal/server/crypto.js';

// ── Env management ──────────────────────────────────────────────────────

const VALID_HEX_KEY = 'aa'.repeat(32); // 64-char hex = 32 bytes
const VALID_BASE64URL_KEY = Buffer.alloc(32, 0xbb).toString('base64url');
const VALID_BASE64_KEY = Buffer.alloc(32, 0xcc).toString('base64');
const INVALID_KEY = 'too-short-not-32-bytes';

let originalKey: string | undefined;

beforeEach(() => {
	originalKey = process.env.WEBHOOK_ENCRYPTION_KEY;
});

afterEach(() => {
	if (originalKey !== undefined) {
		process.env.WEBHOOK_ENCRYPTION_KEY = originalKey;
	} else {
		delete process.env.WEBHOOK_ENCRYPTION_KEY;
	}
});

// ── Smoke test ──────────────────────────────────────────────────────────

describe('crypto (smoke)', () => {
	it('encrypts and decrypts a round-trip', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = VALID_HEX_KEY;
		const { ciphertext, iv } = encryptWebhookSecret('my-secret');
		const decrypted = decryptWebhookSecret(ciphertext, iv);
		expect(decrypted).toBe('my-secret');
	});
});

// ── isWebhookEncryptionEnabled ──────────────────────────────────────────

describe('isWebhookEncryptionEnabled()', () => {
	it('returns true when key is set', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = VALID_HEX_KEY;
		expect(isWebhookEncryptionEnabled()).toBe(true);
	});

	it('returns false when key is missing', () => {
		delete process.env.WEBHOOK_ENCRYPTION_KEY;
		expect(isWebhookEncryptionEnabled()).toBe(false);
	});

	it('returns false when key is empty string', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = '';
		expect(isWebhookEncryptionEnabled()).toBe(false);
	});
});

// ── Key format support ──────────────────────────────────────────────────

describe('key format support', () => {
	it('accepts 64-char hex key', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = VALID_HEX_KEY;
		const { ciphertext, iv } = encryptWebhookSecret('test');
		expect(decryptWebhookSecret(ciphertext, iv)).toBe('test');
	});

	it('accepts base64url key', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = VALID_BASE64URL_KEY;
		const { ciphertext, iv } = encryptWebhookSecret('test');
		expect(decryptWebhookSecret(ciphertext, iv)).toBe('test');
	});

	it('accepts standard base64 key', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = VALID_BASE64_KEY;
		const { ciphertext, iv } = encryptWebhookSecret('test');
		expect(decryptWebhookSecret(ciphertext, iv)).toBe('test');
	});

	it('throws on invalid key format', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = INVALID_KEY;
		expect(() => encryptWebhookSecret('test')).toThrow('32 bytes');
	});
});

// ── Error cases ─────────────────────────────────────────────────────────

describe('error handling', () => {
	it('throws when encrypting without key', () => {
		delete process.env.WEBHOOK_ENCRYPTION_KEY;
		expect(() => encryptWebhookSecret('test')).toThrow('WEBHOOK_ENCRYPTION_KEY is required');
	});

	it('throws when decrypting without key', () => {
		delete process.env.WEBHOOK_ENCRYPTION_KEY;
		expect(() => decryptWebhookSecret('data', 'iv')).toThrow('WEBHOOK_ENCRYPTION_KEY is required');
	});

	it('throws on tampered ciphertext (auth tag validation)', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = VALID_HEX_KEY;
		const { ciphertext, iv } = encryptWebhookSecret('secret');

		// Decode, flip a byte in the auth tag region, re-encode
		const buf = Buffer.from(ciphertext, 'base64url');
		buf[buf.length - 1] ^= 0xff; // flip all bits in last byte of auth tag
		const tampered = buf.toString('base64url');
		expect(() => decryptWebhookSecret(tampered, iv)).toThrow();
	});

	it('throws on invalid IV length', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = VALID_HEX_KEY;
		const { ciphertext } = encryptWebhookSecret('secret');
		const shortIv = Buffer.alloc(6).toString('base64url'); // 6 bytes instead of 12
		expect(() => decryptWebhookSecret(ciphertext, shortIv)).toThrow(
			'Invalid webhook secret IV length'
		);
	});

	it('throws on payload too short (less than auth tag)', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = VALID_HEX_KEY;
		const tinyPayload = Buffer.alloc(10).toString('base64url'); // < 16-byte tag
		const validIv = Buffer.alloc(12).toString('base64url');
		expect(() => decryptWebhookSecret(tinyPayload, validIv)).toThrow(
			'Invalid webhook secret ciphertext payload'
		);
	});
});

// ── Key caching ─────────────────────────────────────────────────────────

describe('key caching', () => {
	it('returns the same key object for the same env value', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = VALID_HEX_KEY;
		const key1 = getWebhookEncryptionKey();
		const key2 = getWebhookEncryptionKey();
		expect(key1).toBe(key2); // Same reference (cached)
	});

	it('invalidates cache when env value changes', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = VALID_HEX_KEY;
		const key1 = getWebhookEncryptionKey();

		process.env.WEBHOOK_ENCRYPTION_KEY = VALID_BASE64URL_KEY;
		const key2 = getWebhookEncryptionKey();

		expect(key1).not.toBe(key2);
	});
});

// ── Encryption properties ───────────────────────────────────────────────

describe('encryption properties', () => {
	it('produces different ciphertext for same input (random IV)', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = VALID_HEX_KEY;
		const a = encryptWebhookSecret('same-secret');
		const b = encryptWebhookSecret('same-secret');
		expect(a.ciphertext).not.toBe(b.ciphertext);
		expect(a.iv).not.toBe(b.iv);
	});

	it('returns base64url-encoded output (no padding chars)', () => {
		process.env.WEBHOOK_ENCRYPTION_KEY = VALID_HEX_KEY;
		const { ciphertext, iv } = encryptWebhookSecret('hello world');
		expect(ciphertext).not.toContain('+');
		expect(ciphertext).not.toContain('/');
		expect(ciphertext).not.toContain('=');
		expect(iv).not.toContain('+');
		expect(iv).not.toContain('/');
	});
});
