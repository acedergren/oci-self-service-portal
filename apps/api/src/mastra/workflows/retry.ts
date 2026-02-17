/**
 * Retry Policy — Exponential Backoff for Workflow Steps
 *
 * Provides a standalone, testable retry utility for workflow node execution.
 * Implements standard exponential backoff: delay = base * 2^attempt
 *
 * Features:
 * - Pure function API (no side effects beyond sleeping)
 * - Configurable maxRetries, baseDelay, maxDelay
 * - Jitter support to prevent thundering-herd issues
 * - Preset policy factories for common use cases
 * - Compatible with the executor's callback system
 */

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Retry policy configuration for workflow steps.
 * Controls how many times to retry and how long to wait between attempts.
 */
export interface RetryPolicy {
	/** Maximum number of retry attempts. 0 means no retries (try once). */
	maxRetries: number;
	/** Initial delay in milliseconds before the first retry. */
	backoffMs: number;
	/** Multiplier applied to the delay after each failure. Use 2 for doubling. */
	backoffMultiplier: number;
	/**
	 * Maximum delay cap in milliseconds.
	 * Prevents exponential delay from growing unboundedly.
	 * Defaults to 30,000ms (30 seconds).
	 */
	maxBackoffMs?: number;
	/**
	 * Add random jitter (±25%) to the delay to prevent thundering herd.
	 * Defaults to false.
	 */
	jitter?: boolean;
}

/**
 * Options for a single retry execution.
 */
export interface RetryOptions<T> {
	/** The async operation to retry on failure */
	fn: () => Promise<T>;
	/** Retry policy configuration */
	policy: RetryPolicy;
	/**
	 * Optional callback fired on each failed attempt.
	 * Receives the error message, attempt number (0-based), and whether a retry will follow.
	 */
	onError?: (error: string, attempt: number, willRetry: boolean) => void;
}

// ── Preset Policies ──────────────────────────────────────────────────────

/**
 * No retries — execute once and fail immediately on error.
 * Use for idempotency-sensitive operations.
 */
export const NO_RETRY: RetryPolicy = {
	maxRetries: 0,
	backoffMs: 0,
	backoffMultiplier: 1
};

/**
 * Standard retry policy for workflow steps.
 * 3 retries with exponential backoff starting at 1s, capped at 30s.
 */
export const STANDARD_RETRY: RetryPolicy = {
	maxRetries: 3,
	backoffMs: 1000,
	backoffMultiplier: 2,
	maxBackoffMs: 30_000
};

/**
 * Fast retry policy for transient failures (rate limits, timeouts).
 * 5 retries with aggressive backoff starting at 200ms.
 */
export const FAST_RETRY: RetryPolicy = {
	maxRetries: 5,
	backoffMs: 200,
	backoffMultiplier: 2,
	maxBackoffMs: 10_000,
	jitter: true
};

/**
 * Conservative retry for expensive operations (AI calls, OCI SDK calls).
 * 2 retries with longer initial delay and jitter.
 */
export const CONSERVATIVE_RETRY: RetryPolicy = {
	maxRetries: 2,
	backoffMs: 2000,
	backoffMultiplier: 2,
	maxBackoffMs: 30_000,
	jitter: true
};

// ── Core Implementation ──────────────────────────────────────────────────

/**
 * Calculate the delay for a given attempt using exponential backoff.
 *
 * Formula: delay = min(backoffMs * backoffMultiplier^attempt, maxBackoffMs)
 * With jitter: delay *= (0.75 + Math.random() * 0.5)  — ranges ±25%
 *
 * @param policy - The retry policy configuration
 * @param attempt - Zero-based attempt number (0 = first retry after initial failure)
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(policy: RetryPolicy, attempt: number): number {
	const base = policy.backoffMs * Math.pow(policy.backoffMultiplier, attempt);
	const capped = Math.min(base, policy.maxBackoffMs ?? 30_000);

	if (policy.jitter) {
		// Apply ±25% jitter to avoid thundering herd
		const jitterFactor = 0.75 + Math.random() * 0.5;
		return Math.round(capped * jitterFactor);
	}

	return capped;
}

/**
 * Execute an async operation with retries and exponential backoff.
 *
 * Attempts to call `fn()` up to `maxRetries + 1` times total.
 * On each failure (except the last), waits for the calculated backoff delay.
 * Fires `onError` callback on each failure to support progress reporting.
 *
 * @throws The last error if all attempts fail.
 *
 * @example
 * const result = await withRetry({
 *   fn: () => callOCIApi(params),
 *   policy: STANDARD_RETRY,
 *   onError: (msg, attempt, willRetry) => {
 *     log.warn({ msg, attempt, willRetry }, 'API call failed');
 *   }
 * });
 */
export async function withRetry<T>({ fn, policy, onError }: RetryOptions<T>): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			const willRetry = attempt < policy.maxRetries;

			onError?.(lastError.message, attempt, willRetry);

			if (!willRetry) break;

			const delay = calculateBackoffDelay(policy, attempt);
			await sleep(delay);
		}
	}

	throw lastError!;
}

/**
 * Check if a retry policy allows any retries.
 */
export function isRetryEnabled(policy: RetryPolicy): boolean {
	return policy.maxRetries > 0;
}

/**
 * Merge a partial retry policy override with a base policy.
 * Useful for node-level overrides on top of a default policy.
 *
 * @example
 * const policy = mergeRetryPolicy(STANDARD_RETRY, { maxRetries: 5 });
 */
export function mergeRetryPolicy(base: RetryPolicy, override: Partial<RetryPolicy>): RetryPolicy {
	return { ...base, ...override };
}

// ── Internal ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
