/**
 * TDD tests for stale session cleanup logic in the schedule plugin.
 *
 * Tests the cleanupStaleSessions() function exported from schedule.ts which:
 * - Deletes expired auth_sessions (Better Auth) where expires_at < SYSTIMESTAMP
 * - Deletes old completed/error chat_sessions where updated_at is beyond TTL
 * - Processes in batches to avoid lock contention
 * - Logs the number of sessions deleted
 * - Catches errors and logs them without rethrowing (cleanup is best-effort)
 *
 * The Oracle dependency is mocked via fastify.oracle.withConnection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockLogInfo = vi.fn();
const mockLogWarn = vi.fn();
const mockLogError = vi.fn();
const mockLogDebug = vi.fn();

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: (...args: unknown[]) => mockLogInfo(...args),
		warn: (...args: unknown[]) => mockLogWarn(...args),
		error: (...args: unknown[]) => mockLogError(...args),
		fatal: vi.fn(),
		debug: (...args: unknown[]) => mockLogDebug(...args),
		child: vi.fn().mockReturnThis()
	})
}));

// ── Helpers ───────────────────────────────────────────────────────────────

interface MockOracleOptions {
	available?: boolean;
	authSessionRowsAffected?: number;
	chatSessionRowsAffected?: number;
	throwOnExecute?: Error;
}

function createAppWithOracle(opts: MockOracleOptions = {}): FastifyInstance {
	const {
		available = true,
		authSessionRowsAffected = 0,
		chatSessionRowsAffected = 0,
		throwOnExecute
	} = opts;

	const instance = Fastify({ logger: false });

	const mockConn = {
		execute: vi.fn().mockImplementation(async (sql: string) => {
			if (throwOnExecute) throw throwOnExecute;
			// Distinguish auth_sessions vs chat_sessions by SQL content
			if (sql.includes('auth_sessions')) {
				return { rowsAffected: authSessionRowsAffected };
			}
			return { rowsAffected: chatSessionRowsAffected };
		})
	};

	const mockOraclePlugin = fp(
		async (fastify) => {
			fastify.decorate('oracle', {
				isAvailable: vi.fn().mockReturnValue(available),
				withConnection: vi.fn().mockImplementation(async (fn: (conn: unknown) => unknown) => {
					return fn(mockConn);
				})
			});
		},
		{ name: 'oracle', fastify: '5.x' }
	);

	instance.register(mockOraclePlugin);
	return instance;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('cleanupStaleSessions', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		mockLogInfo.mockReset();
		mockLogWarn.mockReset();
		mockLogError.mockReset();
		mockLogDebug.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	describe('when Oracle is unavailable', () => {
		it('skips cleanup and logs debug message', async () => {
			app = createAppWithOracle({ available: false });
			const { cleanupStaleSessions } = await import('../../plugins/schedule.js');
			await app.ready();

			await cleanupStaleSessions(app);

			expect(mockLogDebug).toHaveBeenCalledWith(expect.stringContaining('Oracle not available'));
			// withConnection should not have been called
			expect(app.oracle.withConnection).not.toHaveBeenCalled();
		});
	});

	describe('when Oracle is available', () => {
		it('deletes expired auth_sessions and logs count', async () => {
			app = createAppWithOracle({ available: true, authSessionRowsAffected: 5 });
			const { cleanupStaleSessions } = await import('../../plugins/schedule.js');
			await app.ready();

			await cleanupStaleSessions(app);

			// Should have called withConnection at least once for auth_sessions
			expect(app.oracle.withConnection).toHaveBeenCalled();
			// Should log the cleanup result
			expect(mockLogInfo).toHaveBeenCalledWith(
				expect.objectContaining({ authSessionsDeleted: expect.any(Number) }),
				expect.stringContaining('stale session cleanup')
			);
		});

		it('deletes stale completed chat_sessions and logs count', async () => {
			app = createAppWithOracle({ available: true, chatSessionRowsAffected: 12 });
			const { cleanupStaleSessions } = await import('../../plugins/schedule.js');
			await app.ready();

			await cleanupStaleSessions(app);

			expect(mockLogInfo).toHaveBeenCalledWith(
				expect.objectContaining({ chatSessionsDeleted: expect.any(Number) }),
				expect.stringContaining('stale session cleanup')
			);
		});

		it('uses DELETE with expires_at < SYSTIMESTAMP for auth_sessions', async () => {
			let capturedSql = '';
			const instance = Fastify({ logger: false });
			const mockOraclePlugin = fp(
				async (fastify) => {
					fastify.decorate('oracle', {
						isAvailable: vi.fn().mockReturnValue(true),
						withConnection: vi.fn().mockImplementation(async (fn: (conn: unknown) => unknown) => {
							const conn = {
								execute: vi.fn().mockImplementation(async (sql: string) => {
									if (sql.includes('auth_sessions')) capturedSql = sql;
									return { rowsAffected: 0 };
								})
							};
							return fn(conn);
						})
					});
				},
				{ name: 'oracle', fastify: '5.x' }
			);
			instance.register(mockOraclePlugin);
			app = instance;

			const { cleanupStaleSessions } = await import('../../plugins/schedule.js');
			await app.ready();

			await cleanupStaleSessions(app);

			expect(capturedSql).toContain('auth_sessions');
			expect(capturedSql.toLowerCase()).toMatch(/expires_at|systimestamp/i);
		});

		it('uses DELETE with updated_at threshold for old chat_sessions', async () => {
			let capturedChatSql = '';
			const instance = Fastify({ logger: false });
			const mockOraclePlugin = fp(
				async (fastify) => {
					fastify.decorate('oracle', {
						isAvailable: vi.fn().mockReturnValue(true),
						withConnection: vi.fn().mockImplementation(async (fn: (conn: unknown) => unknown) => {
							const conn = {
								execute: vi.fn().mockImplementation(async (sql: string) => {
									if (sql.includes('chat_sessions')) capturedChatSql = sql;
									return { rowsAffected: 0 };
								})
							};
							return fn(conn);
						})
					});
				},
				{ name: 'oracle', fastify: '5.x' }
			);
			instance.register(mockOraclePlugin);
			app = instance;

			const { cleanupStaleSessions } = await import('../../plugins/schedule.js');
			await app.ready();

			await cleanupStaleSessions(app);

			expect(capturedChatSql).toContain('chat_sessions');
			expect(capturedChatSql.toLowerCase()).toMatch(/updated_at|interval|day/i);
		});

		it('does not rethrow on Oracle error — cleanup is best-effort', async () => {
			app = createAppWithOracle({
				available: true,
				throwOnExecute: new Error('ORA-12345: connection lost')
			});
			const { cleanupStaleSessions } = await import('../../plugins/schedule.js');
			await app.ready();

			// Should NOT throw
			await expect(cleanupStaleSessions(app)).resolves.toBeUndefined();

			// Should log the error
			expect(mockLogError).toHaveBeenCalledWith(
				expect.objectContaining({ err: expect.any(Error) }),
				expect.stringContaining('stale session cleanup')
			);
		});

		it('returns zero counts when nothing to clean', async () => {
			app = createAppWithOracle({
				available: true,
				authSessionRowsAffected: 0,
				chatSessionRowsAffected: 0
			});
			const { cleanupStaleSessions } = await import('../../plugins/schedule.js');
			await app.ready();

			await cleanupStaleSessions(app);

			expect(mockLogInfo).toHaveBeenCalledWith(
				expect.objectContaining({ authSessionsDeleted: 0, chatSessionsDeleted: 0 }),
				expect.stringContaining('stale session cleanup')
			);
		});
	});
});
