/**
 * Token Limiter — Output Truncation Utility
 *
 * Standalone, dependency-free utility for capping LLM output length.
 * Operates on raw strings for easy unit testing and reuse outside Mastra.
 *
 * Token estimation: 1 token ≈ 4 chars (conservative estimate for English text).
 * Truncation is word-boundary-aware: never splits mid-word.
 *
 * The Mastra outputProcessor wiring lives in agents/guardrails.ts;
 * this module provides the underlying truncation and estimation logic.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default output cap matching the task plan requirement (E-3.03). */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_000;

/** Conservative chars-per-token ratio for English prose. */
export const CHARS_PER_TOKEN = 4;

/** Appended when output is truncated — informs user and ends cleanly. */
export const TRUNCATION_SUFFIX =
	'\n\n---\n*Response truncated to stay within output limits. Ask a follow-up question to continue.*';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TruncationResult {
	/** The (possibly truncated) text. */
	text: string;
	/** Whether the text was actually truncated. */
	wasTruncated: boolean;
	/** Estimated token count of the returned text. */
	estimatedTokens: number;
}

// ── Core Functions ────────────────────────────────────────────────────────────

/**
 * Estimate the token count for a string using the 4-chars-per-token heuristic.
 *
 * @example
 * estimateTokens('Hello world') // → 3 (11 chars / 4 ≈ 3)
 */
export function estimateTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncate text to fit within a token budget.
 *
 * Truncation is word-boundary-aware: the result ends on a complete word,
 * followed by the truncation suffix message.
 *
 * Returns the original text unchanged if it fits within the budget.
 *
 * @param text - The text to potentially truncate
 * @param maxTokens - Maximum allowed tokens (default: 4000)
 *
 * @example
 * const { text, wasTruncated } = truncateToTokenBudget(longResponse, 4000);
 * if (wasTruncated) console.warn('Output was truncated');
 */
export function truncateToTokenBudget(
	text: string,
	maxTokens: number = DEFAULT_MAX_OUTPUT_TOKENS
): TruncationResult {
	if (!text || typeof text !== 'string') {
		return { text: text ?? '', wasTruncated: false, estimatedTokens: 0 };
	}

	const estimatedTokens = estimateTokens(text);

	if (estimatedTokens <= maxTokens) {
		return { text, wasTruncated: false, estimatedTokens };
	}

	// Reserve chars for the truncation suffix
	const suffixTokens = estimateTokens(TRUNCATION_SUFFIX);
	const targetTokens = Math.max(0, maxTokens - suffixTokens);
	const targetChars = targetTokens * CHARS_PER_TOKEN;

	// Slice at char boundary, then walk back to word boundary
	let truncated = text.slice(0, targetChars);
	const lastSpace = truncated.lastIndexOf(' ');
	if (lastSpace > targetChars * 0.8) {
		// Only snap to word boundary if not too far back (>20% of budget)
		truncated = truncated.slice(0, lastSpace);
	}

	const resultText = truncated + TRUNCATION_SUFFIX;
	return {
		text: resultText,
		wasTruncated: true,
		estimatedTokens: estimateTokens(resultText)
	};
}
