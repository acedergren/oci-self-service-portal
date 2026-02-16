/**
 * AI guardrail processors for the CloudAdvisor agent.
 *
 * Implements three safety layers using Mastra's Processor interface:
 * - PromptInjectionDetector: blocks common injection patterns in user input
 * - PIIDetector: redacts PII patterns (SSN, credit cards, etc.) from output
 * - TokenLimiter: caps input token budget to prevent cost runaway
 */
import type {
	InputProcessor,
	OutputProcessor,
	ProcessInputArgs,
	ProcessOutputResultArgs
} from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/agent';
import { createLogger } from '@portal/server/logger';

const log = createLogger('guardrails');

// ============================================================================
// Prompt Injection Detector
// ============================================================================

/**
 * Common prompt injection patterns.
 * Each pattern is case-insensitive and matches against user message content.
 */
const INJECTION_PATTERNS = [
	/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts|rules)/i,
	/you\s+are\s+now\s+(a|an)\s+/i,
	/forget\s+(all\s+)?(your|previous)\s+(instructions|rules|constraints)/i,
	/disregard\s+(all\s+)?(previous|prior|your)\s+(instructions|rules)/i,
	/new\s+instructions?:\s*/i,
	/system\s*:\s*/i,
	/\[INST\]/i,
	/<<SYS>>/i,
	/<\|im_start\|>/i,
	/act\s+as\s+if\s+you\s+(have\s+)?no\s+(restrictions|rules|guidelines)/i
];

export const promptInjectionDetector: InputProcessor = {
	id: 'prompt-injection-detector',
	name: 'Prompt Injection Detector',
	description: 'Blocks common prompt injection patterns in user messages',

	async processInput({ messages, abort }: ProcessInputArgs) {
		// Only check the most recent user message
		const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
		if (!lastUserMsg) return messages;

		const content = extractTextContent(lastUserMsg);
		if (!content) return messages;

		for (const pattern of INJECTION_PATTERNS) {
			if (pattern.test(content)) {
				log.warn({ pattern: pattern.source }, 'Prompt injection attempt detected');
				abort('Your message was blocked by our safety filter. Please rephrase your request.');
			}
		}

		return messages;
	}
};

// ============================================================================
// PII Detector
// ============================================================================

/**
 * PII patterns with replacement labels.
 * Applied to agent output to prevent leaking sensitive data.
 */
const PII_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	// US Social Security Number
	{ pattern: /\b\d{3}-\d{2}-\d{4}\b/g, label: '[SSN REDACTED]' },
	// Credit card numbers (basic Luhn-like patterns)
	{ pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, label: '[CARD REDACTED]' },
	// AWS access keys
	{ pattern: /\bAKIA[0-9A-Z]{16}\b/g, label: '[AWS_KEY REDACTED]' },
	// OCI API keys (OCID format)
	{ pattern: /\bocid1\.key\.[a-z0-9.]+\b/gi, label: '[OCI_KEY REDACTED]' },
	// Bearer tokens
	{ pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/g, label: '[TOKEN REDACTED]' },
	// Private key blocks
	{
		pattern:
			/-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
		label: '[PRIVATE_KEY REDACTED]'
	}
];

export const piiDetector: OutputProcessor = {
	id: 'pii-detector',
	name: 'PII Detector',
	description: 'Redacts PII patterns from agent output',

	async processOutputResult({ messages }: ProcessOutputResultArgs) {
		return messages.map((msg) => {
			if (msg.role !== 'assistant') return msg;

			const content = extractTextContent(msg);
			if (!content) return msg;

			let redacted = content;
			let redactionCount = 0;

			for (const { pattern, label } of PII_PATTERNS) {
				pattern.lastIndex = 0;
				const matches = redacted.match(pattern);
				if (matches) {
					redactionCount += matches.length;
					redacted = redacted.replace(pattern, label);
				}
			}

			if (redactionCount > 0) {
				log.info({ redactionCount }, 'PII redacted from agent output');
				// Replace text parts in the V2 content structure
				return {
					...msg,
					content: {
						...msg.content,
						parts: msg.content.parts.map((part) =>
							'type' in part && part.type === 'text'
								? { ...part, text: redactText((part as { text: string }).text) }
								: part
						)
					}
				} as MastraDBMessage;
			}

			return msg;
		});
	}
};

function redactText(text: string): string {
	let result = text;
	for (const { pattern, label } of PII_PATTERNS) {
		pattern.lastIndex = 0;
		result = result.replace(pattern, label);
	}
	return result;
}

// ============================================================================
// Token Limiter
// ============================================================================

const DEFAULT_MAX_INPUT_CHARS = 50_000; // ~12,500 tokens at 4 chars/token

export function createTokenLimiter(
	maxInputChars: number = DEFAULT_MAX_INPUT_CHARS
): InputProcessor {
	return {
		id: 'token-limiter',
		name: 'Token Limiter',
		description: `Limits input to ~${Math.round(maxInputChars / 4)} tokens`,

		async processInput({ messages, abort }: ProcessInputArgs) {
			let totalChars = 0;
			for (const msg of messages) {
				totalChars += extractTextContent(msg)?.length ?? 0;
			}

			if (totalChars > maxInputChars) {
				log.warn({ totalChars, maxInputChars }, 'Input token limit exceeded');
				abort(
					`Your conversation is too long (${Math.round(totalChars / 4)} estimated tokens). ` +
						'Please start a new conversation or shorten your messages.'
				);
			}

			return messages;
		}
	};
}

// ============================================================================
// Helpers
// ============================================================================

function extractTextContent(msg: MastraDBMessage): string | null {
	// V2 format: content.parts array
	if (msg.content?.parts) {
		return msg.content.parts
			.filter(
				(part): part is { type: 'text'; text: string } => 'type' in part && part.type === 'text'
			)
			.map((part) => part.text)
			.join('\n');
	}
	return null;
}
