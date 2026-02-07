/**
 * Shared test helpers for Fastify API test suite.
 *
 * Provides reusable mock factories and fixtures to eliminate
 * boilerplate across test files. All mocks are designed for use
 * with vitest's `mockReset: true` configuration.
 */

import { vi, type Mock } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mock fixtures — canonical data shapes used across tests
// ---------------------------------------------------------------------------

export function createMockConnection(): Record<string, Mock> {
	return {
		execute: vi.fn().mockResolvedValue({ rows: [{ VAL: 1 }] }),
		close: vi.fn().mockResolvedValue(undefined),
		commit: vi.fn().mockResolvedValue(undefined),
		rollback: vi.fn().mockResolvedValue(undefined)
	};
}

export function createPoolStats(overrides: Partial<PoolStats> = {}): PoolStats {
	return {
		connectionsOpen: 5,
		connectionsInUse: 1,
		poolMin: 2,
		poolMax: 10,
		...overrides
	};
}

export interface PoolStats {
	connectionsOpen: number;
	connectionsInUse: number;
	poolMin: number;
	poolMax: number;
}

export function createHealthResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		status: 'ok',
		checks: {
			database: { status: 'ok', latencyMs: 1 },
			connection_pool: { status: 'ok', latencyMs: 1 },
			oci_cli: { status: 'ok', latencyMs: 1 },
			sentry: { status: 'ok', latencyMs: 1 },
			metrics: { status: 'ok', latencyMs: 1 }
		},
		timestamp: new Date().toISOString(),
		uptime: 1,
		version: '0.1.0',
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Mock module factories — used in vi.mock() calls
// ---------------------------------------------------------------------------

export function createOracleConnectionMock(): Record<string, Mock> {
	const conn = createMockConnection();
	return {
		initPool: vi.fn().mockResolvedValue(undefined),
		closePool: vi.fn().mockResolvedValue(undefined),
		withConnection: vi.fn(async (fn: (c: unknown) => unknown) => fn(conn)),
		getPoolStats: vi.fn().mockResolvedValue(createPoolStats()),
		isPoolInitialized: vi.fn(() => true),
		getPool: vi.fn()
	};
}

export function createSentryMock(): Record<string, Mock> {
	return {
		wrapWithSpan: vi.fn((_n: string, _o: string, fn: () => unknown) => fn()),
		captureError: vi.fn(),
		isSentryEnabled: vi.fn(() => false),
		initSentry: vi.fn(),
		closeSentry: vi.fn()
	};
}

export function createLoggerMock(): { createLogger: () => Record<string, Mock> } {
	return {
		createLogger: () => ({
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			fatal: vi.fn(),
			debug: vi.fn(),
			child: vi.fn().mockReturnThis()
		})
	};
}

// ---------------------------------------------------------------------------
// Mock re-setup helpers — needed because mockReset: true clears return values
// ---------------------------------------------------------------------------

/**
 * Cast a mock function for re-setup after mockReset clears it.
 * Avoids verbose `(fn as ReturnType<typeof vi.fn>)` everywhere.
 */
export function asMock(fn: unknown): Mock {
	return fn as Mock;
}

/**
 * Re-setup the Oracle connection mock with default happy-path behavior.
 * Call this in beforeEach when vitest's mockReset: true has cleared implementations.
 */
export async function resetOracleMocks(): Promise<void> {
	const mod = await import('@portal/shared/server/oracle/connection');
	const conn = createMockConnection();

	asMock(mod.initPool).mockResolvedValue(undefined);
	asMock(mod.closePool).mockResolvedValue(undefined);
	asMock(mod.withConnection).mockImplementation(
		async (fn: (c: unknown) => unknown) => fn(conn)
	);
	asMock(mod.getPoolStats).mockResolvedValue(createPoolStats());
	asMock(mod.isPoolInitialized).mockReturnValue(true);
}

/**
 * Re-setup the health check mock with default ok response.
 */
export async function resetHealthMocks(): Promise<void> {
	const mod = await import('@portal/shared/server/health');
	asMock(mod.runHealthChecks).mockResolvedValue(createHealthResponse());
}

/**
 * Re-setup the migration and webhook mocks with default no-op behavior.
 */
export async function resetMigrationMocks(): Promise<void> {
	const migrationMod = await import('@portal/shared/server/oracle/migrations');
	asMock(migrationMod.runMigrations).mockResolvedValue(undefined);

	const webhookMod = await import(
		'@portal/shared/server/oracle/repositories/webhook-repository'
	);
	asMock(webhookMod.webhookRepository.migratePlaintextSecrets).mockResolvedValue({
		migrated: 0,
		remaining: 0
	});
}

// ---------------------------------------------------------------------------
// App lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Safely close a Fastify app, ignoring errors if already closed.
 */
export async function closeApp(app: FastifyInstance | null | undefined): Promise<void> {
	if (!app) return;
	try {
		await app.close();
	} catch {
		// Already closed — ignore
	}
}
