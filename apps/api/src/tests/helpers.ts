/**
 * Shared test helpers for Fastify API test suite.
 *
 * Provides reusable mock reset functions and utilities to eliminate
 * boilerplate across test files. All reset helpers are designed for use
 * with vitest's `mockReset: true` configuration.
 *
 * NOTE: vi.mock() factory functions are hoisted before imports, so they
 * cannot call imported helpers. Only use these helpers in beforeEach/
 * afterEach hooks and test bodies -- never inside vi.mock() factories.
 */

import { vi, type Mock } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Type cast helper
// ---------------------------------------------------------------------------

/**
 * Cast a mock function for re-setup after mockReset clears it.
 * Avoids verbose `(fn as ReturnType<typeof vi.fn>)` everywhere.
 */
export function asMock(fn: unknown): Mock {
	return fn as Mock;
}

// ---------------------------------------------------------------------------
// Mock re-setup helpers
// ---------------------------------------------------------------------------

/**
 * Re-setup the Oracle connection mock with default happy-path behavior.
 * Call in beforeEach when vitest's mockReset: true has cleared implementations.
 */
export async function resetOracleMocks(): Promise<void> {
	const mod = await import('@portal/server/oracle/connection');

	asMock(mod.initPool).mockResolvedValue(undefined);
	asMock(mod.closePool).mockResolvedValue(undefined);
	asMock(mod.withConnection).mockImplementation(async (fn: (conn: unknown) => unknown) =>
		fn({
			execute: vi.fn().mockResolvedValue({ rows: [{ VAL: 1 }] }),
			close: vi.fn().mockResolvedValue(undefined),
			commit: vi.fn(),
			rollback: vi.fn()
		})
	);
	asMock(mod.getPoolStats).mockResolvedValue({
		connectionsOpen: 5,
		connectionsInUse: 1,
		poolMin: 2,
		poolMax: 10
	});
	asMock(mod.isPoolInitialized).mockReturnValue(true);
}

/**
 * Re-setup the health check mock with default ok response.
 */
export async function resetHealthMocks(): Promise<void> {
	const mod = await import('@portal/server/health');
	asMock(mod.runHealthChecks).mockResolvedValue({
		status: 'ok',
		checks: {
			database: { status: 'ok', latencyMs: 1 },
			connection_pool: { status: 'ok', latencyMs: 1 },
			oci_cli: { status: 'ok', latencyMs: 1 },
			sentry: { status: 'ok', latencyMs: 1 },
			metrics: { status: 'ok', latencyMs: 1 }
		},
		timestamp: '2026-01-01T00:00:00.000Z',
		uptime: 1,
		version: '0.1.0'
	});
}

/**
 * Re-setup the migration and webhook mocks with default no-op behavior.
 */
export async function resetMigrationMocks(): Promise<void> {
	const migrationMod = await import('@portal/server/oracle/migrations');
	asMock(migrationMod.runMigrations).mockResolvedValue(undefined);

	const webhookMod = await import('@portal/server/oracle/repositories/webhook-repository');
	asMock(webhookMod.webhookRepository.migratePlaintextSecrets).mockResolvedValue({
		migrated: 0,
		remaining: 0
	});
}

// ---------------------------------------------------------------------------
// App lifecycle helper
// ---------------------------------------------------------------------------

/**
 * Safely close a Fastify app, ignoring errors if already closed.
 */
export async function closeApp(app: FastifyInstance | null | undefined): Promise<void> {
	if (!app) return;
	try {
		await app.close();
	} catch {
		// Already closed
	}
}
