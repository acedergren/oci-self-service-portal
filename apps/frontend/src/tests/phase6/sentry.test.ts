/**
 * Phase 6 TDD: Sentry SDK Integration (Server + Client)
 *
 * Tests graceful degradation, the wrapWithSpan passthrough, captureError
 * no-op behavior, and the SentryConfig interface contract.
 *
 * Module: $lib/server/sentry.ts
 * Exports:
 *   - initSentry(config?): Promise<void>  (async — dynamic import of @sentry/node)
 *   - captureError(error, extra?): void
 *   - captureMessage(message, level?): void
 *   - wrapWithSpan<T>(name, op, fn): Promise<T>
 *   - closeSentry(timeoutMs?): Promise<void>
 *   - isSentryEnabled(): boolean
 *   - SentryConfig interface
 *
 * Note: initSentry dynamically imports @sentry/node, which is an optional
 * dependency not installed in test. We test the no-DSN / no-SDK paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger to avoid Pino output in tests
vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

// Mock errors.ts type import (type-only, but vitest resolves it)
vi.mock('$lib/server/errors.js', () => ({
	PortalError: class PortalError extends Error {
		code = 'TEST';
		statusCode = 500;
		context = {};
		toSentryExtras() {
			return { code: this.code, statusCode: this.statusCode };
		}
	}
}));

// We need a fresh module for each test because initSentry has internal state
// (initialized flag, enabled flag). Use dynamic import + resetModules.
let sentryModule: typeof import('$lib/server/sentry.js');

beforeEach(async () => {
	vi.resetModules();
	sentryModule = await import('$lib/server/sentry.js');
});

describe('Sentry SDK Integration (Phase 6)', () => {
	describe('exports', () => {
		it('exports initSentry as async function', () => {
			expect(typeof sentryModule.initSentry).toBe('function');
		});

		it('exports captureError function', () => {
			expect(typeof sentryModule.captureError).toBe('function');
		});

		it('exports captureMessage function', () => {
			expect(typeof sentryModule.captureMessage).toBe('function');
		});

		it('exports wrapWithSpan function', () => {
			expect(typeof sentryModule.wrapWithSpan).toBe('function');
		});

		it('exports closeSentry function', () => {
			expect(typeof sentryModule.closeSentry).toBe('function');
		});

		it('exports isSentryEnabled function', () => {
			expect(typeof sentryModule.isSentryEnabled).toBe('function');
		});
	});

	describe('isSentryEnabled', () => {
		it('returns false before initialization', () => {
			expect(sentryModule.isSentryEnabled()).toBe(false);
		});

		it('returns false after init with no DSN', async () => {
			await sentryModule.initSentry({});
			expect(sentryModule.isSentryEnabled()).toBe(false);
		});

		it('returns false after init with empty DSN', async () => {
			await sentryModule.initSentry({ dsn: '' });
			expect(sentryModule.isSentryEnabled()).toBe(false);
		});
	});

	describe('initSentry', () => {
		it('handles missing DSN gracefully (no-op mode)', async () => {
			await expect(sentryModule.initSentry({})).resolves.toBeUndefined();
		});

		it('handles no arguments', async () => {
			await expect(sentryModule.initSentry()).resolves.toBeUndefined();
		});

		it('is idempotent — second call is a no-op', async () => {
			await sentryModule.initSentry({});
			await sentryModule.initSentry({ dsn: 'https://example@sentry.io/1' });
			// Second call should not change state (still disabled since first had no DSN)
			expect(sentryModule.isSentryEnabled()).toBe(false);
		});

		it('handles missing @sentry/node gracefully', async () => {
			// In test environment, @sentry/node is not installed.
			// initSentry with a DSN should catch the dynamic import error.
			await expect(
				sentryModule.initSentry({ dsn: 'https://example@sentry.io/1' })
			).resolves.toBeUndefined();
			// Should still be disabled since @sentry/node couldn't be loaded
			expect(sentryModule.isSentryEnabled()).toBe(false);
		});
	});

	describe('captureError', () => {
		it('is a no-op when Sentry is disabled', () => {
			expect(() => sentryModule.captureError(new Error('test'))).not.toThrow();
		});

		it('accepts additional context without throwing', () => {
			expect(() =>
				sentryModule.captureError(new Error('DB connection failed'), {
					userId: 'user-123',
					requestId: 'req-abc'
				})
			).not.toThrow();
		});

		it('handles PortalError-like objects without throwing', () => {
			const portalLike = Object.assign(new Error('Rate limit'), {
				code: 'RATE_LIMIT',
				statusCode: 429,
				context: { clientId: '192.168.1.1' },
				toSentryExtras() {
					return { code: this.code, statusCode: this.statusCode };
				}
			});

			expect(() => sentryModule.captureError(portalLike)).not.toThrow();
		});
	});

	describe('captureMessage', () => {
		it('is a no-op when Sentry is disabled', () => {
			expect(() => sentryModule.captureMessage('test message')).not.toThrow();
		});

		it('accepts level parameter without throwing', () => {
			expect(() => sentryModule.captureMessage('warn message', 'warning')).not.toThrow();
			expect(() => sentryModule.captureMessage('error message', 'error')).not.toThrow();
			expect(() => sentryModule.captureMessage('info message', 'info')).not.toThrow();
		});
	});

	describe('wrapWithSpan', () => {
		it('executes sync function and returns result', async () => {
			const result = await sentryModule.wrapWithSpan('test-span', 'test', () => 42);
			expect(result).toBe(42);
		});

		it('executes async function and returns result', async () => {
			const result = await sentryModule.wrapWithSpan('db-query', 'db', async () => {
				return { rows: [1, 2, 3] };
			});
			expect(result).toEqual({ rows: [1, 2, 3] });
		});

		it('propagates errors from wrapped function', async () => {
			await expect(
				sentryModule.wrapWithSpan('failing', 'test', () => {
					throw new Error('Operation failed');
				})
			).rejects.toThrow('Operation failed');
		});

		it('works as passthrough when Sentry is disabled', async () => {
			const result = await sentryModule.wrapWithSpan('noop-span', 'noop', () => 'hello');
			expect(result).toBe('hello');
		});

		it('does not add overhead for sync operations', async () => {
			const start = performance.now();
			for (let i = 0; i < 100; i++) {
				await sentryModule.wrapWithSpan('bench', 'test', () => i);
			}
			const elapsed = performance.now() - start;
			// 100 no-op spans should complete in under 100ms
			expect(elapsed).toBeLessThan(100);
		});
	});

	describe('closeSentry', () => {
		it('is a no-op when Sentry is disabled', async () => {
			await expect(sentryModule.closeSentry()).resolves.toBeUndefined();
		});

		it('accepts optional timeout parameter', async () => {
			await expect(sentryModule.closeSentry(1000)).resolves.toBeUndefined();
		});
	});

	describe('SentryConfig contract', () => {
		it('supports all expected configuration fields', () => {
			const config: import('$lib/server/sentry.js').SentryConfig = {
				dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0',
				environment: 'production',
				release: '1.0.0',
				sampleRate: 1.0,
				tracesSampleRate: 0.1
			};

			expect(config.dsn).toBeDefined();
			expect(config.environment).toBe('production');
			expect(config.release).toBe('1.0.0');
			expect(config.sampleRate).toBeGreaterThanOrEqual(0);
			expect(config.sampleRate).toBeLessThanOrEqual(1);
			expect(config.tracesSampleRate).toBeGreaterThanOrEqual(0);
			expect(config.tracesSampleRate).toBeLessThanOrEqual(1);
		});

		it('all fields are optional', () => {
			const config: import('$lib/server/sentry.js').SentryConfig = {};
			expect(config).toBeDefined();
		});
	});
});
