/**
 * Phase 4 TDD: DB-backed Rate Limiting
 *
 * Replaces the in-memory Map rate limiter in hooks.server.ts with
 * Oracle-backed persistence so limits survive server restarts.
 *
 * Expected module: $lib/server/rate-limiter.ts
 * Expected exports:
 *   - checkRateLimit(clientId, endpoint): Promise<RateLimitResult | null>
 *   - RateLimitResult: { remaining: number; resetAt: number }
 *   - RateLimitConfig: { windowMs: number; maxRequests: Record<string, number> }
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Oracle connection
const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
const mockConn = {
	execute: mockExecute,
	commit: vi.fn().mockResolvedValue(undefined),
	rollback: vi.fn().mockResolvedValue(undefined),
	close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) => fn(mockConn)),
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
	}),
}));

let rateLimiterModule: Record<string, unknown> | null = null;
let moduleError: string | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		rateLimiterModule = await import('$lib/server/rate-limiter.js');
	} catch (err) {
		moduleError = (err as Error).message;
	}
});

describe('DB-backed Rate Limiter (Phase 4.2)', () => {
	describe('module availability', () => {
		it('rate-limiter module should be importable', () => {
			if (moduleError) {
				expect.fail(
					`rate-limiter module not yet available: ${moduleError}. ` +
					'Implement $lib/server/rate-limiter.ts per Phase 4.2.'
				);
			}
			expect(rateLimiterModule).not.toBeNull();
		});
	});

	describe('checkRateLimit', () => {
		it('returns remaining count for first request in window', async () => {
			if (!rateLimiterModule) return;
			const checkRateLimit = rateLimiterModule.checkRateLimit as (
				clientId: string, endpoint: string
			) => Promise<{ remaining: number; resetAt: number } | null>;

			// After H4/H5 fix: atomic MERGE (call 1) then SELECT (call 2)
			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 }); // MERGE INTO
			mockExecute.mockResolvedValueOnce({
				rows: [{ CNT: 1, RESET_AT: new Date(Date.now() + 60000) }],
			}); // SELECT back

			const result = await checkRateLimit('192.168.1.1', 'chat');
			expect(result).not.toBeNull();
			expect(result!.remaining).toBeGreaterThan(0);
			expect(result!.resetAt).toBeGreaterThan(Date.now());
		});

		it('returns null when rate limit exceeded', async () => {
			if (!rateLimiterModule) return;
			const checkRateLimit = rateLimiterModule.checkRateLimit as (
				clientId: string, endpoint: string
			) => Promise<{ remaining: number; resetAt: number } | null>;

			// After H4/H5 fix: MERGE increments, then SELECT shows over limit
			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 }); // MERGE
			mockExecute.mockResolvedValueOnce({
				rows: [{ CNT: 21, RESET_AT: new Date(Date.now() + 60000) }],
			}); // SELECT: count exceeds max (chat=20)

			const result = await checkRateLimit('192.168.1.1', 'chat');
			expect(result).toBeNull();
		});

		it('uses atomic MERGE to prevent TOCTOU race (H4/H5 fix)', async () => {
			if (!rateLimiterModule) return;
			const checkRateLimit = rateLimiterModule.checkRateLimit as (
				clientId: string, endpoint: string
			) => Promise<{ remaining: number; resetAt: number } | null>;

			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 }); // MERGE
			mockExecute.mockResolvedValueOnce({
				rows: [{ CNT: 5, RESET_AT: new Date(Date.now() + 60000) }],
			});

			await checkRateLimit('192.168.1.1', 'api');

			// First call should be the atomic MERGE INTO statement
			const firstCallSql = mockExecute.mock.calls[0]?.[0] as string;
			expect(firstCallSql).toMatch(/MERGE\s+INTO\s+rate_limits/i);
		});

		it('uses different limits for chat vs api endpoints', async () => {
			if (!rateLimiterModule) return;
			const config = rateLimiterModule.RATE_LIMIT_CONFIG as {
				maxRequests: Record<string, number>;
			};

			expect(config).toBeDefined();
			expect(config.maxRequests.chat).toBeDefined();
			expect(config.maxRequests.api).toBeDefined();
			expect(config.maxRequests.chat).toBeLessThan(config.maxRequests.api);
		});

		it('handles database errors gracefully (fail-open)', async () => {
			if (!rateLimiterModule) return;
			const checkRateLimit = rateLimiterModule.checkRateLimit as (
				clientId: string, endpoint: string
			) => Promise<{ remaining: number; resetAt: number } | null>;

			mockExecute.mockRejectedValueOnce(new Error('DB down'));

			// Should fail-open: allow the request rather than block
			const result = await checkRateLimit('192.168.1.1', 'api');
			expect(result).not.toBeNull();
		});
	});
});
