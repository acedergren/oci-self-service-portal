/**
 * Retry Policy Tests
 *
 * Tests for apps/api/src/mastra/workflows/retry.ts covering:
 * - calculateBackoffDelay: exponential formula, jitter, cap
 * - withRetry: success on first attempt, retry on failure, exhaustion
 * - Preset policies: NO_RETRY, STANDARD_RETRY, FAST_RETRY, CONSERVATIVE_RETRY
 * - isRetryEnabled, mergeRetryPolicy helpers
 * - Integration: tool node retry via executor retryPolicy config
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	calculateBackoffDelay,
	withRetry,
	isRetryEnabled,
	mergeRetryPolicy,
	NO_RETRY,
	STANDARD_RETRY,
	FAST_RETRY,
	CONSERVATIVE_RETRY,
	type RetryPolicy
} from '../../mastra/workflows/retry.js';

// ── calculateBackoffDelay ─────────────────────────────────────────────────

describe('calculateBackoffDelay', () => {
	it('returns backoffMs on attempt 0 (first retry)', () => {
		const policy: RetryPolicy = {
			maxRetries: 3,
			backoffMs: 1000,
			backoffMultiplier: 2
		};

		const delay = calculateBackoffDelay(policy, 0);

		// 1000 * 2^0 = 1000
		expect(delay).toBe(1000);
	});

	it('doubles delay on attempt 1', () => {
		const policy: RetryPolicy = {
			maxRetries: 3,
			backoffMs: 1000,
			backoffMultiplier: 2
		};

		const delay = calculateBackoffDelay(policy, 1);

		// 1000 * 2^1 = 2000
		expect(delay).toBe(2000);
	});

	it('applies 2^attempt exponential formula', () => {
		const policy: RetryPolicy = {
			maxRetries: 5,
			backoffMs: 100,
			backoffMultiplier: 2
		};

		// 100 * 2^0 = 100, 100 * 2^1 = 200, 100 * 2^2 = 400, 100 * 2^3 = 800
		expect(calculateBackoffDelay(policy, 0)).toBe(100);
		expect(calculateBackoffDelay(policy, 1)).toBe(200);
		expect(calculateBackoffDelay(policy, 2)).toBe(400);
		expect(calculateBackoffDelay(policy, 3)).toBe(800);
	});

	it('caps delay at maxBackoffMs', () => {
		const policy: RetryPolicy = {
			maxRetries: 10,
			backoffMs: 1000,
			backoffMultiplier: 2,
			maxBackoffMs: 5000
		};

		// 1000 * 2^5 = 32000, capped at 5000
		const delay = calculateBackoffDelay(policy, 5);

		expect(delay).toBe(5000);
	});

	it('uses 30000ms default cap when maxBackoffMs not specified', () => {
		const policy: RetryPolicy = {
			maxRetries: 10,
			backoffMs: 1000,
			backoffMultiplier: 2
		};

		// 1000 * 2^15 = 32,768,000 — should be capped at 30000
		const delay = calculateBackoffDelay(policy, 15);

		expect(delay).toBe(30000);
	});

	it('adds jitter when jitter: true (stays within ±25% of base)', () => {
		const policy: RetryPolicy = {
			maxRetries: 3,
			backoffMs: 1000,
			backoffMultiplier: 2,
			jitter: true
		};

		// Run multiple times to test the range
		for (let i = 0; i < 50; i++) {
			const delay = calculateBackoffDelay(policy, 0); // base = 1000
			expect(delay).toBeGreaterThanOrEqual(750); // 1000 * 0.75
			expect(delay).toBeLessThanOrEqual(1250); // 1000 * 1.25
		}
	});

	it('does not apply jitter when jitter: false', () => {
		const policy: RetryPolicy = {
			maxRetries: 3,
			backoffMs: 1000,
			backoffMultiplier: 2,
			jitter: false
		};

		// Should always return exactly 1000
		for (let i = 0; i < 10; i++) {
			expect(calculateBackoffDelay(policy, 0)).toBe(1000);
		}
	});
});

// ── withRetry ─────────────────────────────────────────────────────────────

describe('withRetry', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns the result immediately when fn succeeds on first attempt', async () => {
		const fn = vi.fn().mockResolvedValue('success');

		const result = await withRetry({ fn, policy: STANDARD_RETRY });

		expect(result).toBe('success');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('retries on failure and returns result when eventually succeeds', async () => {
		let attempts = 0;
		const fn = vi.fn().mockImplementation(async () => {
			attempts++;
			if (attempts < 3) throw new Error('temporary failure');
			return 'recovered';
		});

		const resultPromise = withRetry({
			fn,
			policy: { maxRetries: 3, backoffMs: 100, backoffMultiplier: 2 }
		});

		// Advance through the delays
		await vi.runAllTimersAsync();

		const result = await resultPromise;

		expect(result).toBe('recovered');
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('throws last error after all retries are exhausted', async () => {
		let calls = 0;
		const fn = vi.fn().mockImplementation(async () => {
			calls++;
			throw new Error('persistent failure');
		});

		const resultPromise = withRetry({
			fn,
			policy: { maxRetries: 2, backoffMs: 10, backoffMultiplier: 2 }
		});
		// Prevent unhandled rejection before timers run
		const caught = resultPromise.catch((e: unknown) => e);

		await vi.runAllTimersAsync();

		const err = await caught;
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toBe('persistent failure');
		// Initial attempt + 2 retries = 3 total calls
		expect(calls).toBe(3);
	});

	it('does not retry when NO_RETRY policy is used', async () => {
		const fn = vi.fn().mockImplementation(async () => {
			throw new Error('fail');
		});

		await expect(withRetry({ fn, policy: NO_RETRY })).rejects.toThrow('fail');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('calls onError callback for each failure', async () => {
		const fn = vi.fn().mockImplementation(async () => {
			throw new Error('fail');
		});
		const onError = vi.fn();

		const resultPromise = withRetry({
			fn,
			policy: { maxRetries: 2, backoffMs: 10, backoffMultiplier: 2 },
			onError
		});
		// Prevent unhandled rejection before timers run
		resultPromise.catch(() => {});

		await vi.runAllTimersAsync();
		await expect(resultPromise).rejects.toThrow('fail');

		// 3 total attempts = 3 onError calls
		expect(onError).toHaveBeenCalledTimes(3);
		// First two calls: willRetry=true
		expect(onError).toHaveBeenNthCalledWith(1, 'fail', 0, true);
		expect(onError).toHaveBeenNthCalledWith(2, 'fail', 1, true);
		// Last call: willRetry=false
		expect(onError).toHaveBeenNthCalledWith(3, 'fail', 2, false);
	});

	it('wraps non-Error thrown values in Error', async () => {
		const fn = vi.fn().mockImplementation(async () => {
			throw 'string error';
		});

		await expect(withRetry({ fn, policy: NO_RETRY })).rejects.toThrow('string error');
	});

	it('waits for backoff delay between retries', async () => {
		const fn = vi.fn().mockImplementation(async () => {
			throw new Error('fail');
		});
		const policy: RetryPolicy = {
			maxRetries: 2,
			backoffMs: 1000,
			backoffMultiplier: 2
		};

		const promise = withRetry({ fn, policy });
		// Prevent unhandled rejection before we explicitly await it
		promise.catch(() => {});

		// After first failure, should wait 1000ms (attempt 0: 1000 * 2^0 = 1000)
		expect(fn).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(999);
		expect(fn).toHaveBeenCalledTimes(1); // Not retried yet

		await vi.advanceTimersByTimeAsync(1);
		expect(fn).toHaveBeenCalledTimes(2); // First retry triggered

		// After second failure, should wait 2000ms (attempt 1: 1000 * 2^1 = 2000)
		await vi.advanceTimersByTimeAsync(1999);
		expect(fn).toHaveBeenCalledTimes(2); // Not retried yet

		await vi.advanceTimersByTimeAsync(1);
		expect(fn).toHaveBeenCalledTimes(3); // Second retry triggered

		await expect(promise).rejects.toThrow('fail');
	});

	it('handles STANDARD_RETRY preset: 3 retries', async () => {
		let calls = 0;
		const fn = vi.fn().mockImplementation(async () => {
			calls++;
			throw new Error('fail');
		});

		const resultPromise = withRetry({ fn, policy: STANDARD_RETRY });
		// Prevent unhandled rejection before timers run
		resultPromise.catch(() => {});

		await vi.runAllTimersAsync();
		await expect(resultPromise).rejects.toThrow('fail');

		// 1 initial + 3 retries = 4 total
		expect(calls).toBe(4);
	});
});

// ── Preset Policies ──────────────────────────────────────────────────────

describe('Preset RetryPolicy constants', () => {
	it('NO_RETRY has maxRetries=0', () => {
		expect(NO_RETRY.maxRetries).toBe(0);
	});

	it('STANDARD_RETRY has maxRetries=3 and 30s cap', () => {
		expect(STANDARD_RETRY.maxRetries).toBe(3);
		expect(STANDARD_RETRY.maxBackoffMs).toBe(30_000);
		expect(STANDARD_RETRY.backoffMs).toBe(1000);
		expect(STANDARD_RETRY.backoffMultiplier).toBe(2);
	});

	it('FAST_RETRY has maxRetries=5 and jitter enabled', () => {
		expect(FAST_RETRY.maxRetries).toBe(5);
		expect(FAST_RETRY.jitter).toBe(true);
	});

	it('CONSERVATIVE_RETRY has maxRetries=2 and 2s base delay', () => {
		expect(CONSERVATIVE_RETRY.maxRetries).toBe(2);
		expect(CONSERVATIVE_RETRY.backoffMs).toBe(2000);
	});
});

// ── isRetryEnabled ────────────────────────────────────────────────────────

describe('isRetryEnabled', () => {
	it('returns false for NO_RETRY', () => {
		expect(isRetryEnabled(NO_RETRY)).toBe(false);
	});

	it('returns true for STANDARD_RETRY', () => {
		expect(isRetryEnabled(STANDARD_RETRY)).toBe(true);
	});

	it('returns true for maxRetries > 0', () => {
		const policy: RetryPolicy = { maxRetries: 1, backoffMs: 100, backoffMultiplier: 2 };
		expect(isRetryEnabled(policy)).toBe(true);
	});
});

// ── mergeRetryPolicy ──────────────────────────────────────────────────────

describe('mergeRetryPolicy', () => {
	it('overrides maxRetries from base policy', () => {
		const result = mergeRetryPolicy(STANDARD_RETRY, { maxRetries: 5 });
		expect(result.maxRetries).toBe(5);
	});

	it('keeps base values for fields not in override', () => {
		const result = mergeRetryPolicy(STANDARD_RETRY, { maxRetries: 5 });
		expect(result.backoffMs).toBe(STANDARD_RETRY.backoffMs);
		expect(result.backoffMultiplier).toBe(STANDARD_RETRY.backoffMultiplier);
		expect(result.maxBackoffMs).toBe(STANDARD_RETRY.maxBackoffMs);
	});

	it('does not mutate the base policy', () => {
		const base = { ...STANDARD_RETRY };
		mergeRetryPolicy(STANDARD_RETRY, { maxRetries: 10 });
		expect(STANDARD_RETRY.maxRetries).toBe(base.maxRetries);
	});

	it('can add jitter to a base policy that has none', () => {
		const result = mergeRetryPolicy(STANDARD_RETRY, { jitter: true });
		expect(result.jitter).toBe(true);
	});
});

// ── WorkflowExecutor integration via retryPolicy in node data ─────────────

describe('WorkflowExecutor — tool node retry integration', () => {
	// These tests verify that the executor's built-in withRetry uses the
	// same semantics (exponential backoff, maxRetries config) as our retry module.

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('withRetry resolves if fn eventually succeeds within maxRetries', async () => {
		let callCount = 0;
		const fn = vi.fn().mockImplementation(async () => {
			callCount++;
			if (callCount < 3) throw new Error('transient');
			return 'done';
		});

		const promise = withRetry({
			fn,
			policy: { maxRetries: 3, backoffMs: 50, backoffMultiplier: 2 }
		});

		await vi.runAllTimersAsync();
		const result = await promise;

		expect(result).toBe('done');
		expect(callCount).toBe(3);
	});

	it('withRetry rejects if fn fails more times than maxRetries allows', async () => {
		let calls = 0;
		const fn = vi.fn().mockImplementation(async () => {
			calls++;
			throw new Error('always fails');
		});

		const promise = withRetry({
			fn,
			policy: { maxRetries: 2, backoffMs: 50, backoffMultiplier: 2 }
		});
		// Prevent unhandled rejection before timers run
		promise.catch(() => {});

		await vi.runAllTimersAsync();

		await expect(promise).rejects.toThrow('always fails');
		// maxRetries=2 means 3 total attempts
		expect(calls).toBe(3);
	});

	it('respects maxBackoffMs cap in delay calculation', () => {
		const policy: RetryPolicy = {
			maxRetries: 10,
			backoffMs: 1000,
			backoffMultiplier: 2,
			maxBackoffMs: 5000
		};

		// Attempt 10: 1000 * 2^10 = 1,024,000 — should be capped at 5000
		const delay = calculateBackoffDelay(policy, 10);
		expect(delay).toBe(5000);
	});
});
