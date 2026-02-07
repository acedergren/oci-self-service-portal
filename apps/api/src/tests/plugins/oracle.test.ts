/**
 * TDD tests for Oracle DB Fastify plugin (Phase 9 task 9.4)
 *
 * Tests the oracle plugin at apps/api/src/plugins/oracle.ts which wraps
 * @portal/shared's Oracle connection pool as a Fastify plugin.
 *
 * Plugin contract:
 * - Decorates `fastify.oracle` with { withConnection, getPoolStats, isAvailable }
 * - Decorates every request with `request.dbAvailable` boolean
 * - Initialises pool on plugin registration, runs migrations by default
 * - Closes pool on server shutdown (`onClose` hook)
 * - Handles init failure gracefully (fallback mode: isAvailable = false)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mocks — all heavy dependencies are mocked for unit-test speed
// ---------------------------------------------------------------------------

const mockConnection = {
	execute: vi.fn().mockResolvedValue({ rows: [{ VAL: 1 }] }),
	close: vi.fn().mockResolvedValue(undefined),
	commit: vi.fn().mockResolvedValue(undefined),
	rollback: vi.fn().mockResolvedValue(undefined)
};

const DEFAULT_POOL_STATS = {
	connectionsOpen: 5,
	connectionsInUse: 1,
	poolMin: 2,
	poolMax: 10
};

const mocks = {
	initPool: vi.fn().mockResolvedValue(undefined),
	closePool: vi.fn().mockResolvedValue(undefined),
	withConnection: vi.fn(async <T>(fn: (conn: typeof mockConnection) => Promise<T>) => fn(mockConnection)),
	getPoolStats: vi.fn().mockResolvedValue(DEFAULT_POOL_STATS),
	isPoolInitialized: vi.fn(() => true),
	runMigrations: vi.fn().mockResolvedValue(undefined),
	migratePlaintextSecrets: vi.fn().mockResolvedValue({ migrated: 0, remaining: 0 })
};

vi.mock('@portal/shared/server/oracle/connection', () => ({
	initPool: (...args: unknown[]) => mocks.initPool(...args),
	closePool: (...args: unknown[]) => mocks.closePool(...args),
	withConnection: (...args: unknown[]) => mocks.withConnection(...args),
	getPoolStats: (...args: unknown[]) => mocks.getPoolStats(...args),
	isPoolInitialized: (...args: unknown[]) => mocks.isPoolInitialized(...args)
}));

vi.mock('@portal/shared/server/oracle/migrations', () => ({
	runMigrations: (...args: unknown[]) => mocks.runMigrations(...args)
}));

vi.mock('@portal/shared/server/oracle/repositories/webhook-repository', () => ({
	webhookRepository: {
		migratePlaintextSecrets: (...args: unknown[]) => mocks.migratePlaintextSecrets(...args)
	}
}));

vi.mock('@portal/shared/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

vi.mock('@portal/shared/server/sentry', () => ({
	wrapWithSpan: vi.fn((_n: string, _o: string, fn: () => unknown) => fn()),
	captureError: vi.fn(),
	isSentryEnabled: vi.fn(() => false),
	initSentry: vi.fn(),
	closeSentry: vi.fn()
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resets all mocks to their default happy-path behaviour. */
function resetMocksToDefaults(): void {
	mocks.initPool.mockResolvedValue(undefined);
	mocks.closePool.mockResolvedValue(undefined);
	mocks.withConnection.mockImplementation(
		async <T>(fn: (conn: typeof mockConnection) => Promise<T>) => fn(mockConnection)
	);
	mocks.getPoolStats.mockResolvedValue(DEFAULT_POOL_STATS);
	mocks.isPoolInitialized.mockReturnValue(true);
	mocks.runMigrations.mockResolvedValue(undefined);
	mocks.migratePlaintextSecrets.mockResolvedValue({ migrated: 0, remaining: 0 });
	mockConnection.execute.mockResolvedValue({ rows: [{ VAL: 1 }] });
}

/** Builds a minimal Fastify app with just the Oracle plugin. */
async function buildApp(pluginOpts: Record<string, unknown> = {}): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });

	const oraclePlugin = (await import('../../plugins/oracle.js')).default;
	await app.register(oraclePlugin, pluginOpts);

	app.get('/test-db', async (request) => ({
		dbAvailable: request.dbAvailable,
		poolAvailable: app.oracle.isAvailable()
	}));

	await app.ready();
	return app;
}

/** Safely closes a Fastify app, ignoring errors from already-closed instances. */
async function closeApp(app: FastifyInstance | null): Promise<void> {
	if (!app) return;
	try {
		await app.close();
	} catch {
		// Already closed or failed — safe to ignore in teardown
	}
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Oracle Fastify plugin – registration & decoration', () => {
	let app: FastifyInstance;

	beforeEach(resetMocksToDefaults);
	afterEach(async () => { await closeApp(app); });

	it('decorates fastify.oracle', async () => {
		app = await buildApp();
		expect(app.oracle).toBeDefined();
		expect(typeof app.oracle).toBe('object');
	});

	it('fastify.oracle has withConnection function', async () => {
		app = await buildApp();
		expect(typeof app.oracle.withConnection).toBe('function');
	});

	it('fastify.oracle has getPoolStats function', async () => {
		app = await buildApp();
		expect(typeof app.oracle.getPoolStats).toBe('function');
	});

	it('fastify.oracle has isAvailable function', async () => {
		app = await buildApp();
		expect(typeof app.oracle.isAvailable).toBe('function');
	});

	it('isAvailable() returns true after successful initialization', async () => {
		app = await buildApp();
		expect(app.oracle.isAvailable()).toBe(true);
	});
});

describe('Oracle Fastify plugin – pool lifecycle', () => {
	let app: FastifyInstance;

	beforeEach(resetMocksToDefaults);
	afterEach(async () => { await closeApp(app); });

	it('calls initPool during registration', async () => {
		app = await buildApp();
		expect(mocks.initPool).toHaveBeenCalledTimes(1);
	});

	it('passes config option to initPool', async () => {
		const customConfig = { user: 'TEST', password: 'pw', connectString: 'mydb' };
		app = await buildApp({ config: customConfig });
		expect(mocks.initPool).toHaveBeenCalledWith(customConfig);
	});

	it('runs migrations by default after pool init', async () => {
		app = await buildApp();
		expect(mocks.runMigrations).toHaveBeenCalledTimes(1);
	});

	it('skips migrations when migrate=false', async () => {
		app = await buildApp({ migrate: false });
		expect(mocks.runMigrations).not.toHaveBeenCalled();
	});

	it('runs webhook secret migration after DB migrations', async () => {
		app = await buildApp();
		expect(mocks.migratePlaintextSecrets).toHaveBeenCalledTimes(1);
	});

	it('calls closePool on server shutdown', async () => {
		app = await buildApp();
		await app.close();
		expect(mocks.closePool).toHaveBeenCalledTimes(1);
		// Prevent double-close in afterEach
		app = null!;
	});
});

describe('Oracle Fastify plugin – withConnection', () => {
	let app: FastifyInstance;

	beforeEach(resetMocksToDefaults);
	afterEach(async () => { await closeApp(app); });

	it('executes queries through the borrowed connection', async () => {
		app = await buildApp();

		const result = await app.oracle.withConnection(async (conn) => {
			return conn.execute('SELECT 1 AS VAL FROM DUAL');
		});

		expect(result).toEqual({ rows: [{ VAL: 1 }] });
		expect(mockConnection.execute).toHaveBeenCalledWith('SELECT 1 AS VAL FROM DUAL');
	});

	it('returns the value from the callback', async () => {
		app = await buildApp();

		const rows = await app.oracle.withConnection(async (conn) => {
			const res = await conn.execute('SELECT 1 FROM DUAL');
			return res.rows;
		});

		expect(rows).toEqual([{ VAL: 1 }]);
	});

	it('propagates errors from the callback', async () => {
		app = await buildApp();

		await expect(
			app.oracle.withConnection(async () => {
				throw new Error('query failed');
			})
		).rejects.toThrow('query failed');
	});

	it('propagates errors from conn.execute()', async () => {
		mockConnection.execute.mockRejectedValueOnce(new Error('ORA-00942: table does not exist'));

		app = await buildApp();

		await expect(
			app.oracle.withConnection(async (conn) => {
				return conn.execute('SELECT * FROM nonexistent');
			})
		).rejects.toThrow('ORA-00942');
	});
});

describe('Oracle Fastify plugin – request decorator', () => {
	let app: FastifyInstance;

	beforeEach(resetMocksToDefaults);
	afterEach(async () => { await closeApp(app); });

	it('sets request.dbAvailable=true when pool is initialized', async () => {
		app = await buildApp();

		const response = await app.inject({ method: 'GET', url: '/test-db' });
		const body = JSON.parse(response.body);

		expect(body.dbAvailable).toBe(true);
		expect(body.poolAvailable).toBe(true);
	});

	it('sets request.dbAvailable=false when pool init failed', async () => {
		mocks.initPool.mockRejectedValueOnce(new Error('pool init failed'));
		mocks.isPoolInitialized.mockReturnValue(false);

		app = await buildApp();

		const response = await app.inject({ method: 'GET', url: '/test-db' });
		const body = JSON.parse(response.body);

		expect(body.dbAvailable).toBe(false);
		expect(body.poolAvailable).toBe(false);
	});
});

describe('Oracle Fastify plugin – pool statistics', () => {
	let app: FastifyInstance;

	beforeEach(resetMocksToDefaults);
	afterEach(async () => { await closeApp(app); });

	it('returns pool statistics', async () => {
		app = await buildApp();

		const stats = await app.oracle.getPoolStats();

		expect(stats).toEqual(DEFAULT_POOL_STATS);
	});

	it('returns null when pool is not initialized', async () => {
		mocks.getPoolStats.mockResolvedValueOnce(null);

		app = await buildApp();
		const stats = await app.oracle.getPoolStats();

		expect(stats).toBeNull();
	});
});

describe('Oracle Fastify plugin – fallback mode', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		resetMocksToDefaults();
		mocks.isPoolInitialized.mockReturnValue(false);
	});

	afterEach(async () => { await closeApp(app); });

	it('survives pool initialization failure', async () => {
		mocks.initPool.mockRejectedValueOnce(new Error('Oracle unreachable'));

		app = await buildApp();

		expect(app.oracle).toBeDefined();
		expect(app.oracle.isAvailable()).toBe(false);
	});

	it('does not run migrations when pool init fails', async () => {
		mocks.initPool.mockRejectedValueOnce(new Error('Oracle unreachable'));

		app = await buildApp();

		expect(mocks.runMigrations).not.toHaveBeenCalled();
	});

	it('does not run webhook migration when pool init fails', async () => {
		mocks.initPool.mockRejectedValueOnce(new Error('Oracle unreachable'));

		app = await buildApp();

		expect(mocks.migratePlaintextSecrets).not.toHaveBeenCalled();
	});

	it('still closes pool on shutdown even in fallback mode', async () => {
		mocks.initPool.mockRejectedValueOnce(new Error('Oracle unreachable'));

		app = await buildApp();
		await app.close();

		expect(mocks.closePool).toHaveBeenCalled();
		app = null!;
	});
});

describe('Oracle Fastify plugin – concurrent requests', () => {
	let app: FastifyInstance;

	beforeEach(resetMocksToDefaults);
	afterEach(async () => { await closeApp(app); });

	it('handles 10 concurrent requests without errors', async () => {
		app = await buildApp();

		const requests = Array.from({ length: 10 }, () =>
			app.inject({ method: 'GET', url: '/test-db' })
		);

		const responses = await Promise.all(requests);

		for (const response of responses) {
			expect(response.statusCode).toBe(200);
			const body = JSON.parse(response.body);
			expect(body.dbAvailable).toBe(true);
		}
	});

	it('handles concurrent withConnection calls', async () => {
		app = await buildApp();

		let counter = 0;
		mockConnection.execute.mockImplementation(async () => {
			counter++;
			return { rows: [{ COUNT: counter }] };
		});

		const queries = Array.from({ length: 5 }, (_, i) =>
			app.oracle.withConnection(async (conn) => {
				return conn.execute(`SELECT ${i} FROM DUAL`);
			})
		);

		const results = await Promise.all(queries);
		expect(results).toHaveLength(5);

		for (const result of results) {
			expect(result.rows).toHaveLength(1);
		}
	});
});
