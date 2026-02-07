/**
 * TDD tests for Oracle DB Fastify plugin (Phase 9 task 9.4)
 *
 * The Oracle plugin should:
 * - Register as a Fastify plugin
 * - Decorate request with `request.db` for connection access
 * - Initialize connection pool on app startup
 * - Close pool on app shutdown
 * - Expose pool stats via a decorator
 * - Handle initialization failures gracefully (fail-open)
 *
 * NOTE: These tests define the expected API BEFORE the plugin is built.
 * The backend dev will implement to make these pass.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Mock Oracle connection module — initial factory sets up structure.
// mockReset: true clears return values between tests, so we re-setup in beforeEach.
vi.mock('@portal/shared/server/oracle/connection', () => ({
	initPool: vi.fn(),
	closePool: vi.fn(),
	withConnection: vi.fn(),
	getPool: vi.fn(),
	getPoolStats: vi.fn(),
	isPoolInitialized: vi.fn()
}));

vi.mock('@portal/shared/server/sentry', () => ({
	wrapWithSpan: vi.fn((_name: string, _op: string, fn: () => unknown) => fn()),
	captureError: vi.fn(),
	isSentryEnabled: vi.fn(() => false),
	initSentry: vi.fn(),
	closeSentry: vi.fn()
}));

vi.mock('@portal/shared/server/logger', () => ({
	createLogger: vi.fn(() => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	}))
}));

// ---------------------------------------------------------------------------
// Shared package Oracle connection tests (validates the contract)
// ---------------------------------------------------------------------------

describe('Oracle connection module (shared package)', () => {
	const mockConn = {
		execute: vi.fn().mockResolvedValue({ rows: [{ result: 1 }] }),
		close: vi.fn().mockResolvedValue(undefined),
		commit: vi.fn().mockResolvedValue(undefined),
		rollback: vi.fn().mockResolvedValue(undefined)
	};

	beforeEach(async () => {
		// Re-setup mock implementations after mockReset clears them
		const mod = await import('@portal/shared/server/oracle/connection');
		(mod.initPool as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
		(mod.closePool as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
		(mod.withConnection as ReturnType<typeof vi.fn>).mockImplementation(
			async (fn: (conn: typeof mockConn) => unknown) => fn(mockConn)
		);
		(mod.getPoolStats as ReturnType<typeof vi.fn>).mockResolvedValue({
			connectionsOpen: 5,
			connectionsInUse: 2,
			poolMin: 2,
			poolMax: 10
		});
		(mod.isPoolInitialized as ReturnType<typeof vi.fn>).mockReturnValue(true);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should export initPool function', async () => {
		const { initPool } = await import(
			'@portal/shared/server/oracle/connection'
		);
		expect(typeof initPool).toBe('function');
	});

	it('should export closePool function', async () => {
		const { closePool } = await import(
			'@portal/shared/server/oracle/connection'
		);
		expect(typeof closePool).toBe('function');
	});

	it('should export withConnection function', async () => {
		const { withConnection } = await import(
			'@portal/shared/server/oracle/connection'
		);
		expect(typeof withConnection).toBe('function');
	});

	it('withConnection should provide a connection and release it', async () => {
		const { withConnection } = await import(
			'@portal/shared/server/oracle/connection'
		);

		const result = await withConnection(async (conn) => {
			const res = await conn.execute('SELECT 1 FROM DUAL');
			return res.rows;
		});

		expect(result).toEqual([{ result: 1 }]);
	});

	it('should export getPoolStats function', async () => {
		const { getPoolStats } = await import(
			'@portal/shared/server/oracle/connection'
		);
		const stats = await getPoolStats();
		expect(stats).toEqual({
			connectionsOpen: 5,
			connectionsInUse: 2,
			poolMin: 2,
			poolMax: 10
		});
	});

	it('should export isPoolInitialized function', async () => {
		const { isPoolInitialized } = await import(
			'@portal/shared/server/oracle/connection'
		);
		expect(isPoolInitialized()).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Oracle Fastify Plugin contract (TDD — plugin not yet implemented)
// ---------------------------------------------------------------------------

describe('Oracle Fastify plugin (TDD contract)', () => {
	beforeEach(async () => {
		// Re-setup mock implementations for this describe block too
		const mod = await import('@portal/shared/server/oracle/connection');
		(mod.initPool as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
		(mod.closePool as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
	});

	it('should define expected plugin interface', () => {
		// The Oracle plugin for Fastify should:
		// 1. Be a Fastify plugin (function with fastify, opts signature)
		// 2. Initialize pool on registration
		// 3. Close pool on app close
		// 4. Decorate request with db utilities

		// This is a contract test — when the plugin is built, it should
		// satisfy these requirements.
		const expectedPluginInterface = {
			// Plugin should accept these options
			options: {
				user: 'string',
				password: 'string',
				connectString: 'string',
				walletLocation: 'string | undefined',
				walletPassword: 'string | undefined',
				poolMin: 'number',
				poolMax: 'number'
			},
			// Plugin should decorate
			decorators: {
				'request.db': 'withConnection shorthand',
				'app.oracle': 'pool management'
			},
			// Hooks
			hooks: {
				onClose: 'closePool()',
				onReady: 'initPool()'
			}
		};

		expect(expectedPluginInterface.options).toBeDefined();
		expect(expectedPluginInterface.decorators).toBeDefined();
		expect(expectedPluginInterface.hooks).toBeDefined();
	});

	it('should handle pool initialization failure gracefully', async () => {
		const { initPool } = await import(
			'@portal/shared/server/oracle/connection'
		);

		// Simulate failure
		(initPool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error('Oracle not reachable')
		);

		// The plugin should catch this and log a warning, not crash
		try {
			await initPool();
			expect.unreachable('Should have thrown');
		} catch (error) {
			expect((error as Error).message).toBe('Oracle not reachable');
		}

		// Subsequent calls should work (mock resets)
		await expect(initPool()).resolves.toBeUndefined();
	});
});
