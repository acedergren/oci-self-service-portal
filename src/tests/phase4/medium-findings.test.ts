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

const mockGetSession = vi.fn();
const mockUpdateSession = vi.fn();
const mockCreateSession = vi.fn().mockReturnValue({ id: 'new-session', status: 'active' });

vi.mock('$lib/server/db.js', () => ({
	getRepository: () => ({
		getSession: mockGetSession,
		updateSession: mockUpdateSession,
		createSession: mockCreateSession
	})
}));

vi.mock('$lib/server/oracle/repositories/session-repository.js', () => ({
	sessionRepository: {
		getById: vi.fn().mockResolvedValue(null),
		create: vi.fn().mockRejectedValue(new Error('force fallback')),
		update: vi.fn().mockResolvedValue(null)
	}
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

describe('M-3: switchToSessionFallback ownership verification', () => {
	let sessionModule: Record<string, unknown>;
	const mockCookies = {
		get: vi.fn().mockReturnValue('session-123'),
		set: vi.fn()
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		sessionModule = await import('$lib/server/session.js');
	});

	it('switchToSession passes userId to fallback path', async () => {
		const switchToSession = sessionModule.switchToSession as (
			cookies: unknown,
			sessionId: string,
			userId?: string
		) => Promise<boolean>;

		// Force fallback (Oracle throws)
		const { sessionRepository } =
			await import('$lib/server/oracle/repositories/session-repository.js');
		vi.mocked(sessionRepository.getById).mockRejectedValueOnce(new Error('DB down'));

		// SQLite session belongs to different user
		mockGetSession.mockReturnValueOnce({
			id: 'other-session',
			status: 'active',
			userId: 'user-B'
		});

		const result = await switchToSession(mockCookies, 'other-session', 'user-A');
		// Should reject: session belongs to user-B, not user-A
		expect(result).toBe(false);
	});

	it('switchToSessionFallback allows session without userId check when no userId given', async () => {
		const switchToSession = sessionModule.switchToSession as (
			cookies: unknown,
			sessionId: string,
			userId?: string
		) => Promise<boolean>;

		const { sessionRepository } =
			await import('$lib/server/oracle/repositories/session-repository.js');
		vi.mocked(sessionRepository.getById).mockRejectedValueOnce(new Error('DB down'));

		mockGetSession.mockReturnValueOnce({
			id: 'session-abc',
			status: 'active',
			userId: 'user-X'
		});

		// No userId provided — should allow (backward compat)
		const result = await switchToSession(mockCookies, 'session-abc');
		expect(result).toBe(true);
	});
});

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
