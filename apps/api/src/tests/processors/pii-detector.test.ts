/**
 * PII Detector Tests
 *
 * Tests for apps/api/src/mastra/processors/pii-detector.ts covering:
 * - detectPII: identifies each PII type, returns correct types array
 * - redactPII: replaces each PII type with correct placeholder
 * - Edge cases: empty string, multiple PII types, non-PII similar patterns
 */

import { describe, it, expect } from 'vitest';
import { detectPII, redactPII } from '../../mastra/processors/pii-detector.js';
import type { PIIDetectionResult } from '../../mastra/processors/pii-detector.js';

// ── detectPII — clean inputs ──────────────────────────────────────────────────

describe('detectPII — clean inputs', () => {
	it('returns clean result for normal text', () => {
		const result = detectPII('Your OCI instance is running in eu-frankfurt-1');

		expect(result.hasPII).toBe(false);
		expect(result.types).toHaveLength(0);
	});

	it('handles empty string gracefully', () => {
		const result = detectPII('');

		expect(result.hasPII).toBe(false);
		expect(result.types).toHaveLength(0);
	});

	it('handles non-string input gracefully', () => {
		const result = detectPII(null as unknown as string);

		expect(result.hasPII).toBe(false);
		expect(result.types).toHaveLength(0);
	});
});

// ── detectPII — email ─────────────────────────────────────────────────────────

describe('detectPII — email detection', () => {
	it('detects standard email address', () => {
		const result = detectPII('Contact me at jane.doe@example.com for details');

		expect(result.hasPII).toBe(true);
		expect(result.types).toContain('email');
	});

	it('detects email with subdomain', () => {
		const result = detectPII('Send to admin@mail.company.co.uk');

		expect(result.hasPII).toBe(true);
		expect(result.types).toContain('email');
	});

	it('does not flag "user@" without valid domain', () => {
		const result = detectPII('The user@localhost path is not valid');

		// "user@localhost" has no TLD — should not match
		expect(result.types).not.toContain('email');
	});
});

// ── detectPII — SSN ───────────────────────────────────────────────────────────

describe('detectPII — SSN detection', () => {
	it('detects standard SSN format', () => {
		const result = detectPII('SSN on file: 123-45-6789');

		expect(result.hasPII).toBe(true);
		expect(result.types).toContain('ssn');
	});

	it('does not flag invalid SSN area code 000', () => {
		const result = detectPII('Reference: 000-12-3456');

		expect(result.types).not.toContain('ssn');
	});

	it('does not flag invalid SSN area code 666', () => {
		const result = detectPII('Reference: 666-12-3456');

		expect(result.types).not.toContain('ssn');
	});

	it('does not flag SSN with all-zero serial', () => {
		const result = detectPII('Reference: 123-45-0000');

		expect(result.types).not.toContain('ssn');
	});
});

// ── detectPII — credit card ───────────────────────────────────────────────────

describe('detectPII — credit card detection', () => {
	it('detects credit card with dashes', () => {
		const result = detectPII('Card on file: 4111-2222-3333-4444');

		expect(result.hasPII).toBe(true);
		expect(result.types).toContain('credit_card');
	});

	it('detects credit card with spaces', () => {
		const result = detectPII('Payment: 4111 2222 3333 4444 was processed');

		expect(result.hasPII).toBe(true);
		expect(result.types).toContain('credit_card');
	});

	it('detects 16-digit card without separators', () => {
		const result = detectPII('Token: 4111222233334444 found');

		expect(result.hasPII).toBe(true);
		expect(result.types).toContain('credit_card');
	});
});

// ── detectPII — phone ─────────────────────────────────────────────────────────

describe('detectPII — phone detection', () => {
	it('detects US phone with dashes', () => {
		const result = detectPII('Call me at 555-123-4567 anytime');

		expect(result.hasPII).toBe(true);
		expect(result.types).toContain('phone');
	});

	it('detects US phone with parentheses', () => {
		const result = detectPII('Reach me at (555) 123-4567');

		expect(result.hasPII).toBe(true);
		expect(result.types).toContain('phone');
	});

	it('detects international +1 format', () => {
		const result = detectPII('My number is +1-555-123-4567');

		expect(result.hasPII).toBe(true);
		expect(result.types).toContain('phone');
	});
});

// ── detectPII — IP address ────────────────────────────────────────────────────

describe('detectPII — IP address detection', () => {
	it('detects standard IPv4 address', () => {
		const result = detectPII('Server running at 192.168.1.100');

		expect(result.hasPII).toBe(true);
		expect(result.types).toContain('ip_address');
	});

	it('detects public IPv4 address', () => {
		const result = detectPII('External IP: 203.0.113.45 is exposed');

		expect(result.hasPII).toBe(true);
		expect(result.types).toContain('ip_address');
	});

	it('does not flag invalid octet values above 255', () => {
		const result = detectPII('Version: 300.400.500.600');

		expect(result.types).not.toContain('ip_address');
	});
});

// ── detectPII — multiple types ────────────────────────────────────────────────

describe('detectPII — multiple PII types', () => {
	it('detects multiple PII types in one string', () => {
		const result = detectPII('Email: jane@example.com, SSN: 123-45-6789, Phone: 555-123-4567');

		expect(result.hasPII).toBe(true);
		expect(result.types).toContain('email');
		expect(result.types).toContain('ssn');
		expect(result.types).toContain('phone');
	});

	it('deduplicates repeated PII types', () => {
		const result = detectPII('Emails: a@example.com and b@example.com');

		const emailCount = result.types.filter((t) => t === 'email').length;
		expect(emailCount).toBe(1);
	});

	it('returns correct PIIDetectionResult shape', () => {
		const result: PIIDetectionResult = detectPII('hello@example.com');

		expect(result).toHaveProperty('hasPII');
		expect(result).toHaveProperty('types');
		expect(Array.isArray(result.types)).toBe(true);
	});
});

// ── redactPII — email ─────────────────────────────────────────────────────────

describe('redactPII — email redaction', () => {
	it('replaces email with [REDACTED-EMAIL]', () => {
		const result = redactPII('Contact jane.doe@example.com for support');

		expect(result).toContain('[REDACTED-EMAIL]');
		expect(result).not.toContain('jane.doe@example.com');
	});

	it('redacts multiple emails', () => {
		const result = redactPII('From: a@example.com, To: b@example.com');

		expect(result).not.toContain('a@example.com');
		expect(result).not.toContain('b@example.com');
		expect(result.match(/\[REDACTED-EMAIL\]/g)).toHaveLength(2);
	});
});

// ── redactPII — SSN ───────────────────────────────────────────────────────────

describe('redactPII — SSN redaction', () => {
	it('replaces SSN with [REDACTED-SSN]', () => {
		const result = redactPII('SSN: 123-45-6789 on record');

		expect(result).toContain('[REDACTED-SSN]');
		expect(result).not.toContain('123-45-6789');
	});
});

// ── redactPII — credit card ───────────────────────────────────────────────────

describe('redactPII — credit card redaction', () => {
	it('replaces card number with [REDACTED-CARD]', () => {
		const result = redactPII('Card 4111-2222-3333-4444 was charged');

		expect(result).toContain('[REDACTED-CARD]');
		expect(result).not.toContain('4111-2222-3333-4444');
	});
});

// ── redactPII — phone ─────────────────────────────────────────────────────────

describe('redactPII — phone redaction', () => {
	it('replaces phone with [REDACTED-PHONE]', () => {
		const result = redactPII('Call us at 555-123-4567');

		expect(result).toContain('[REDACTED-PHONE]');
		expect(result).not.toContain('555-123-4567');
	});
});

// ── redactPII — IP address ────────────────────────────────────────────────────

describe('redactPII — IP address redaction', () => {
	it('replaces IPv4 with [REDACTED-IP]', () => {
		const result = redactPII('Server is at 192.168.1.100');

		expect(result).toContain('[REDACTED-IP]');
		expect(result).not.toContain('192.168.1.100');
	});
});

// ── redactPII — multiple types ────────────────────────────────────────────────

describe('redactPII — multiple PII types', () => {
	it('redacts all PII types in a single pass', () => {
		const input =
			'Email: user@example.com, SSN: 123-45-6789, Card: 4111-2222-3333-4444, IP: 10.0.0.1';
		const result = redactPII(input);

		expect(result).toContain('[REDACTED-EMAIL]');
		expect(result).toContain('[REDACTED-SSN]');
		expect(result).toContain('[REDACTED-CARD]');
		expect(result).toContain('[REDACTED-IP]');
		expect(result).not.toContain('user@example.com');
		expect(result).not.toContain('123-45-6789');
		expect(result).not.toContain('4111-2222-3333-4444');
		expect(result).not.toContain('10.0.0.1');
	});

	it('preserves surrounding non-PII text', () => {
		const result = redactPII('Hello, my email is user@example.com, have a nice day!');

		expect(result).toContain('Hello, my email is');
		expect(result).toContain('have a nice day!');
		expect(result).toContain('[REDACTED-EMAIL]');
	});

	it('returns input unchanged when no PII present', () => {
		const input = 'List all compute instances in eu-frankfurt-1';
		const result = redactPII(input);

		expect(result).toBe(input);
	});

	it('handles empty string gracefully', () => {
		expect(redactPII('')).toBe('');
	});
});
