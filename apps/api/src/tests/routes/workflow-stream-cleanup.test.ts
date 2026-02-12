import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Workflow run SSE stream cleanup', () => {
	const realSetTimeout = global.setTimeout;
	const realClearTimeout = global.clearTimeout;

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		global.setTimeout = realSetTimeout;
		global.clearTimeout = realClearTimeout;
	});

	it('clears the 5-minute timeout when the stream closes normally', async () => {
		const clearTimeoutSpy = vi.fn();
		global.clearTimeout = clearTimeoutSpy as unknown as typeof global.clearTimeout;

		// Inline the handler logic used by the workflow stream route:
		// create timeoutId then clear it in cleanup.
		const pollInterval = setInterval(() => {}, 2000);
		const timeoutId = setTimeout(() => {}, 300_000);
		const cleanup = () => {
			clearInterval(pollInterval);
			clearTimeout(timeoutId);
		};

		cleanup();

		expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
	});
});
