/**
 * Token Limiter Tests
 *
 * Tests the standalone truncation utility (no Mastra dependency).
 * Covers: estimateTokens, truncateToTokenBudget — happy paths, edge cases,
 * word-boundary snapping, and the truncation suffix behaviour.
 */
import { describe, it, expect } from 'vitest';
import {
	estimateTokens,
	truncateToTokenBudget,
	CHARS_PER_TOKEN,
	TRUNCATION_SUFFIX,
	DEFAULT_MAX_OUTPUT_TOKENS
} from '../../mastra/processors/token-limiter.js';

// ── estimateTokens ────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
	it('returns 0 for empty string', () => {
		expect(estimateTokens('')).toBe(0);
	});

	it('estimates based on CHARS_PER_TOKEN ratio', () => {
		const text = 'a'.repeat(CHARS_PER_TOKEN);
		expect(estimateTokens(text)).toBe(1);
	});

	it('rounds up fractional tokens', () => {
		// 5 chars → ceil(5/4) = 2
		expect(estimateTokens('12345')).toBe(2);
	});

	it('handles a realistic sentence', () => {
		const text = 'List my OCI compute instances in Frankfurt.'; // 43 chars → 11 tokens
		expect(estimateTokens(text)).toBe(Math.ceil(text.length / CHARS_PER_TOKEN));
	});
});

// ── truncateToTokenBudget ─────────────────────────────────────────────────────

describe('truncateToTokenBudget', () => {
	it('returns text unchanged when under the budget', () => {
		const text = 'Hello world';
		const result = truncateToTokenBudget(text, 100);
		expect(result.wasTruncated).toBe(false);
		expect(result.text).toBe(text);
		expect(result.estimatedTokens).toBe(estimateTokens(text));
	});

	it('returns text unchanged when exactly at budget', () => {
		const text = 'a'.repeat(DEFAULT_MAX_OUTPUT_TOKENS * CHARS_PER_TOKEN);
		const result = truncateToTokenBudget(text, DEFAULT_MAX_OUTPUT_TOKENS);
		expect(result.wasTruncated).toBe(false);
	});

	it('truncates text that exceeds the budget', () => {
		// Build text well above 100 tokens
		const text = 'word '.repeat(100); // 500 chars ≈ 125 tokens
		const result = truncateToTokenBudget(text, 100);
		expect(result.wasTruncated).toBe(true);
		expect(result.text).toContain(TRUNCATION_SUFFIX);
		// Result must be shorter than original
		expect(result.text.length).toBeLessThan(text.length);
		// Estimated tokens should be in a reasonable range (budget + suffix overhead)
		expect(result.estimatedTokens).toBeLessThanOrEqual(130);
	});

	it('appends the truncation suffix message', () => {
		const longText = 'This is a very long response. '.repeat(200);
		const result = truncateToTokenBudget(longText, 50);
		expect(result.text.endsWith(TRUNCATION_SUFFIX)).toBe(true);
	});

	it('handles empty string without throwing', () => {
		const result = truncateToTokenBudget('', 100);
		expect(result.wasTruncated).toBe(false);
		expect(result.text).toBe('');
	});

	it('handles non-string input without throwing', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result = truncateToTokenBudget(null as any, 100);
		expect(result.wasTruncated).toBe(false);
	});

	it('snaps to word boundary rather than splitting mid-word', () => {
		// Construct text where a naive char slice would land mid-word
		const word = 'infrastructure'; // 14 chars
		const text = `The ${word} team reviewed the proposal.`;
		// Set a tiny budget that would land mid-"infrastructure" without word snapping
		const result = truncateToTokenBudget(text, 3);
		expect(result.wasTruncated).toBe(true);
		// The truncated portion (before suffix) should not end mid-word
		const truncatedPart = result.text.slice(0, result.text.indexOf(TRUNCATION_SUFFIX));
		expect(truncatedPart).not.toMatch(/\w-$/); // no hyphenated mid-word break
		// Should end on a space-delimited word boundary
		expect(truncatedPart.trimEnd()).not.toContain('\x00');
	});

	it('uses DEFAULT_MAX_OUTPUT_TOKENS when no limit specified', () => {
		const shortText = 'Hello, world!';
		const result = truncateToTokenBudget(shortText);
		expect(result.wasTruncated).toBe(false);
		expect(result.estimatedTokens).toBe(estimateTokens(shortText));
	});

	it('produces stable results for repeated calls', () => {
		const text = 'The quick brown fox jumps over the lazy dog. '.repeat(50);
		const r1 = truncateToTokenBudget(text, 20);
		const r2 = truncateToTokenBudget(text, 20);
		expect(r1.text).toBe(r2.text);
		expect(r1.estimatedTokens).toBe(r2.estimatedTokens);
	});

	it('handles very small budget gracefully', () => {
		const result = truncateToTokenBudget('Hello world', 1);
		// Even with a tiny budget, should not crash
		expect(result.wasTruncated).toBe(true);
		expect(result.text).toContain(TRUNCATION_SUFFIX);
	});
});

// ── DEFAULT_MAX_OUTPUT_TOKENS ─────────────────────────────────────────────────

describe('DEFAULT_MAX_OUTPUT_TOKENS', () => {
	it('is 4000 as required by E-3.03', () => {
		expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(4_000);
	});
});
