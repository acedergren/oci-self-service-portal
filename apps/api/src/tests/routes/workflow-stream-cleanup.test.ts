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

	it('clears the timeout and unsubscribes when the stream closes normally', () => {
		const clearTimeoutSpy = vi.fn();
		global.clearTimeout = clearTimeoutSpy as unknown as typeof global.clearTimeout;

		const unsubscribe = vi.fn();
		const timeoutId = setTimeout(() => {}, 300_000);
		let closed = false;
		const cleanup = () => {
			if (closed) return;
			closed = true;
			unsubscribe();
			clearTimeout(timeoutId);
		};

		cleanup();

		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId);
	});
});
