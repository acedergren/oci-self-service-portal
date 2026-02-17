/**
 * PII Detector — Pure String Processor
 *
 * Standalone, dependency-free detection and redaction of personally
 * identifiable information (PII) in text strings.
 *
 * Operates on raw strings (not Mastra message objects) for use in:
 * - Workflow step output sanitisation
 * - API response scrubbing
 * - Unit testing without Mastra context
 *
 * The Mastra output processor wiring lives in agents/guardrails.ts;
 * this module provides the underlying detection and redaction logic.
 *
 * Design philosophy: conservative patterns targeting high-precision signals.
 * Low false-positive rate is more important than exhaustive coverage.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type PIIType = 'email' | 'phone' | 'ssn' | 'credit_card' | 'ip_address';

export interface PIIDetectionResult {
	/** Whether the text contains any recognised PII */
	hasPII: boolean;
	/** The PII categories detected (deduplicated) */
	types: PIIType[];
}

// ── Pattern Definitions ───────────────────────────────────────────────────────

/**
 * PII patterns with detection regex, redaction label, and category.
 *
 * Ordering matters for redaction: more-specific patterns run first
 * to avoid partial matches interfering with adjacent patterns.
 */
const PII_PATTERNS: Array<{ regex: RegExp; label: string; type: PIIType }> = [
	// Email addresses — RFC 5322 simplified, high precision
	{
		regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
		label: '[REDACTED-EMAIL]',
		type: 'email'
	},
	// US SSN: 000-00-0000 format (not all-zeros, not 666/900+ area)
	{
		regex: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0{4})\d{4}\b/g,
		label: '[REDACTED-SSN]',
		type: 'ssn'
	},
	// Credit card numbers: 4 groups of 4 digits (with space, dash, or none)
	// Matches Visa, MC, Amex patterns; requires separator consistency
	{
		regex: /\b(?:\d{4}[-\s]){3}\d{4}\b|\b\d{16}\b/g,
		label: '[REDACTED-CARD]',
		type: 'credit_card'
	},
	// US phone numbers: (555) 555-5555, 555-555-5555, +1-555-555-5555, 5555555555
	{
		regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b(?!\d)/g,
		label: '[REDACTED-PHONE]',
		type: 'phone'
	},
	// IPv4 addresses (conservative: requires valid octet ranges)
	{
		regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
		label: '[REDACTED-IP]',
		type: 'ip_address'
	}
];

// ── Core Functions ────────────────────────────────────────────────────────────

/**
 * Detect PII categories present in a text string.
 *
 * Returns which PII types were found without modifying the text.
 * Useful for logging/alerting without the overhead of redaction.
 *
 * @example
 * const result = detectPII('Contact me at jane@example.com or 555-123-4567');
 * // { hasPII: true, types: ['email', 'phone'] }
 */
export function detectPII(text: string): PIIDetectionResult {
	if (!text || typeof text !== 'string') {
		return { hasPII: false, types: [] };
	}

	const foundTypes = new Set<PIIType>();

	for (const { regex, type } of PII_PATTERNS) {
		regex.lastIndex = 0;
		if (regex.test(text)) {
			foundTypes.add(type);
		}
	}

	const types = [...foundTypes];
	return { hasPII: types.length > 0, types };
}

/**
 * Redact all recognised PII from a text string.
 *
 * Replaces each detected PII value with a type-labelled placeholder,
 * e.g. `[REDACTED-EMAIL]`, `[REDACTED-SSN]`, `[REDACTED-CARD]`.
 *
 * Does not throw on empty or non-string input — returns input as-is.
 *
 * @example
 * redactPII('My email is jane@example.com and SSN 123-45-6789');
 * // 'My email is [REDACTED-EMAIL] and SSN [REDACTED-SSN]'
 */
export function redactPII(text: string): string {
	if (!text || typeof text !== 'string') return text;

	let result = text;
	for (const { regex, label } of PII_PATTERNS) {
		regex.lastIndex = 0;
		result = result.replace(regex, label);
	}
	return result;
}
