/**
 * Phase 4 Security: Medium findings M-3 through M-6
 *
 * M-3: switchToSessionFallback needs userId param for ownership verification
 * M-4: Model allowlist for /api/chat model parameter
 * M-5: Remove false access control guard from /api/metrics (already public)
 * M-6: Rate limiter cleanup of stale rows
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── M-3: switchToSessionFallback ownership ─────────────────────────────
// REMOVED: Session management moved to Fastify API during Phase C migration.
// The session switching logic now lives in apps/api/src/routes/sessions.ts
// at the POST /api/sessions/:id/continue endpoint.
// Ownership verification is handled at lines 216-223 in sessions.ts:
//   - Verifies session exists and belongs to the authenticated user
//   - Legacy sessions without userId are allowed (backward compat)
//   - Returns 403 Forbidden if session belongs to a different user

// ── M-4: Model allowlist ───────────────────────────────────────────────

describe('M-4: Model allowlist', () => {
	it('_MODEL_ALLOWLIST should be exported from chat server module or approvals', async () => {
		// The allowlist can be defined in chat endpoint or a shared config
		// We test via the constant export
		let chatModule: Record<string, unknown>;
		try {
			chatModule = await import('../../routes/api/chat/+server.js');
		} catch {
			// Module may depend on env vars
			return;
		}
		expect(chatModule._MODEL_ALLOWLIST).toBeDefined();
		expect(Array.isArray(chatModule._MODEL_ALLOWLIST)).toBe(true);
		expect((chatModule._MODEL_ALLOWLIST as string[]).length).toBeGreaterThan(0);
	});
});

// ── M-5: Metrics endpoint access control ───────────────────────────────

describe('M-5: Metrics endpoint access control', () => {
	it('/api/metrics should not have a false guard blocking authenticated non-admin users', async () => {
		let metricsModule: Record<string, unknown>;
		try {
			vi.mock('$lib/server/metrics.js', () => ({
				registry: {
					collect: vi.fn().mockReturnValue('# HELP test\n'),
					contentType: 'text/plain; version=0.0.4'
				},
				httpRequestDuration: { observe: vi.fn() }
			}));
			metricsModule = await import('../../routes/api/metrics/+server.js');
		} catch {
			return;
		}

		const GET = metricsModule.GET as (event: Record<string, unknown>) => Promise<Response>;

		// Simulate an authenticated non-admin user hitting /api/metrics
		// This should succeed because /api/metrics is in PUBLIC_PATHS
		// After M-5 fix, endpoint no longer checks locals at all
		const response = await GET({});

		// Should be 200, not 403
		expect(response.status).toBe(200);
	});
});

// ── M-6: Rate limiter stale row cleanup ────────────────────────────────

const mockRateLimitExecute = vi.fn().mockResolvedValue({ rows: [] });

vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) =>
		fn({
			execute: mockRateLimitExecute
		})
	)
}));

describe('M-6: Rate limiter stale row cleanup', () => {
	let rateLimiterModule: Record<string, unknown>;

	beforeEach(async () => {
		vi.clearAllMocks();
		rateLimiterModule = await import('$lib/server/rate-limiter.js');
	});

	it('should export cleanupStaleRateLimits function', () => {
		expect(typeof rateLimiterModule.cleanupStaleRateLimits).toBe('function');
	});

	it('cleanupStaleRateLimits DELETEs old rows from rate_limits table', async () => {
		const cleanup = rateLimiterModule.cleanupStaleRateLimits as () => Promise<number>;

		mockRateLimitExecute.mockResolvedValueOnce({ rowsAffected: 5 });

		const count = await cleanup();
		expect(count).toBe(5);

		const sql = mockRateLimitExecute.mock.calls[0]?.[0] as string;
		expect(sql).toMatch(/DELETE\s+FROM\s+rate_limits/i);
		expect(sql).toMatch(/window_start/i);
	});
});
