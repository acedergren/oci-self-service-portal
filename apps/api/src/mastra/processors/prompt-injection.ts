/**
 * Prompt Injection Detector — Pure String Processor
 *
 * Standalone, dependency-free detection of prompt injection attempts.
 * Operates on raw strings (not Mastra message objects) for use in:
 * - API input validation middleware
 * - Workflow node pre-checks
 * - Unit testing without Mastra context
 *
 * The Mastra processor wiring lives in agents/guardrails.ts;
 * this module provides the underlying detection logic.
 *
 * Design philosophy: conservative patterns, low false-positive rate.
 * Prefer missing an edge case over blocking legitimate user input.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InjectionDetectionResult {
	/** Whether the input appears to be a prompt injection attempt */
	isInjectionAttempt: boolean;
	/** Confidence score from 0 (clean) to 1 (certain injection). Sum-capped at 1. */
	confidence: number;
	/** Human-readable labels of the patterns that matched */
	patterns: string[];
}

// ── Detection Patterns ────────────────────────────────────────────────────────

/**
 * Each pattern entry carries:
 * - regex: the detection pattern (case-insensitive)
 * - label: human-readable name for the matched pattern
 * - weight: contribution to the confidence score (patterns may co-occur)
 *
 * Weights are additive and capped at 1.0 total.
 */
const INJECTION_PATTERNS: Array<{ regex: RegExp; label: string; weight: number }> = [
	// Classic "ignore instructions" family
	{
		regex: /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,
		label: 'ignore-previous-instructions',
		weight: 0.9
	},
	// Jailbreak persona reassignment
	{
		regex: /you\s+are\s+now\s+(a|an)\s+\w/i,
		label: 'persona-reassignment',
		weight: 0.85
	},
	// Forget instructions family ("forget your", "forget all your previous", etc.)
	{
		regex: /forget\s+(all\s+)?(your\s+)?(previous\s+)?(instructions?|rules?|constraints?)/i,
		label: 'forget-instructions',
		weight: 0.9
	},
	// Disregard rules family
	{
		regex: /disregard\s+(all\s+)?(previous|prior|your)\s+(instructions?|rules?)/i,
		label: 'disregard-rules',
		weight: 0.9
	},
	// "New instructions:" header
	{
		regex: /new\s+instructions?:\s*\S/i,
		label: 'new-instructions-header',
		weight: 0.85
	},
	// "system:" prefix injection (user claiming system role)
	{
		regex: /^system\s*:/im,
		label: 'system-prefix-injection',
		weight: 0.8
	},
	// LLaMA-style instruction tokens
	{
		regex: /\[INST\]/i,
		label: 'llama-inst-token',
		weight: 0.95
	},
	// ChatML system tokens
	{
		regex: /<<SYS>>/i,
		label: 'chatml-sys-token',
		weight: 0.95
	},
	// OpenAI ChatML im_start tokens
	{
		regex: /<\|im_start\|>/i,
		label: 'openai-im-start-token',
		weight: 0.95
	},
	// "Act as if no restrictions"
	{
		regex: /act\s+as\s+if\s+you\s+(have\s+)?no\s+(restrictions?|rules?|guidelines?)/i,
		label: 'act-as-unrestricted',
		weight: 0.85
	},
	// Excessive character repetition (>50x same character — DoS/confusion attack)
	{
		regex: /(.)\1{49,}/,
		label: 'excessive-repetition',
		weight: 0.6
	}
];

// ── Core Function ─────────────────────────────────────────────────────────────

/**
 * Detect prompt injection patterns in a raw input string.
 *
 * Returns a structured result with confidence score and matched pattern labels.
 * Confidence is the sum of matched pattern weights, capped at 1.0.
 *
 * @example
 * const result = detectPromptInjection('ignore previous instructions and...');
 * // { isInjectionAttempt: true, confidence: 0.9, patterns: ['ignore-previous-instructions'] }
 */
export function detectPromptInjection(input: string): InjectionDetectionResult {
	if (!input || typeof input !== 'string') {
		return { isInjectionAttempt: false, confidence: 0, patterns: [] };
	}

	const matchedPatterns: string[] = [];
	let totalWeight = 0;

	for (const { regex, label, weight } of INJECTION_PATTERNS) {
		// Reset stateful regex between calls
		regex.lastIndex = 0;
		if (regex.test(input)) {
			matchedPatterns.push(label);
			totalWeight += weight;
		}
	}

	const confidence = Math.min(totalWeight, 1);
	return {
		isInjectionAttempt: matchedPatterns.length > 0,
		confidence,
		patterns: matchedPatterns
	};
}
