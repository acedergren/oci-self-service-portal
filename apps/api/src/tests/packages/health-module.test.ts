/**
 * Unit tests for the health check module — deep health checker that
 * probes database, connection pool, OCI CLI, Sentry, and metrics.
 *
 * Mock strategy: Mock all external dependencies (oracle connection,
 * sentry, metrics, logger, child_process) and verify composite status
 * logic (critical vs non-critical checks).
 *
 * Source: packages/server/src/health.ts (190 lines, 0 tests)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockWithConnection = vi.fn();
const mockGetPoolStats = vi.fn();
const mockIsPoolInitialized = vi.fn();
const mockIsSentryEnabled = vi.fn();
const mockRegistryCollect = vi.fn();
const mockExecFile = vi.fn();

vi.mock('@portal/server/oracle/connection', () => ({
	withConnection: (...args: unknown[]) => mockWithConnection(...args),
	getPoolStats: (...args: unknown[]) => mockGetPoolStats(...args),
	isPoolInitialized: (...args: unknown[]) => mockIsPoolInitialized(...args)
}));

vi.mock('@portal/server/sentry', () => ({
	isSentryEnabled: (...args: unknown[]) => mockIsSentryEnabled(...args)
}));

vi.mock('@portal/server/metrics', () => ({
	registry: { collect: (...args: unknown[]) => mockRegistryCollect(...args) }
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

vi.mock('node:child_process', () => ({
	execFile: (...args: unknown[]) => mockExecFile(...args)
}));

// ── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();

	// Default: pool is initialized, connection works
	mockIsPoolInitialized.mockReturnValue(true);
	mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) =>
		fn({ execute: vi.fn().mockResolvedValue({ rows: [{ '1': 1 }] }) })
	);
	mockGetPoolStats.mockResolvedValue({
		connectionsOpen: 5,
		connectionsInUse: 1,
		poolMin: 2,
		poolMax: 10
	});

	// Default: OCI CLI available
	mockExecFile.mockImplementation(
		(_cmd: string, _args: string[], _opts: unknown, cb: (...a: unknown[]) => void) => {
			cb(null, '3.45.0\n');
		}
	);

	// Default: Sentry enabled, metrics available
	mockIsSentryEnabled.mockReturnValue(true);
	mockRegistryCollect.mockReturnValue('# HELP metrics\n');
});

// ── Import after mocks ────────────────────────────────────────────────────

async function getModule() {
	return import('@portal/server/health.js');
}

// ── All checks healthy ──────────────────────────────────────────────────

describe('runHealthChecks — all healthy', () => {
	it('returns ok status when all checks pass', async () => {
		const { runHealthChecks } = await getModule();
		const result = await runHealthChecks();

		expect(result.status).toBe('ok');
		expect(result.checks.database.status).toBe('ok');
		expect(result.checks.connection_pool.status).toBe('ok');
		expect(result.checks.oci_cli.status).toBe('ok');
		expect(result.checks.sentry.status).toBe('ok');
		expect(result.checks.metrics.status).toBe('ok');
	});

	it('includes timestamp, uptime, and version', async () => {
		const { runHealthChecks } = await getModule();
		const result = await runHealthChecks();

		expect(result.timestamp).toBeTruthy();
		expect(typeof result.uptime).toBe('number');
		expect(result.version).toBeTruthy();
	});

	it('includes pool stats in connection_pool details', async () => {
		const { runHealthChecks } = await getModule();
		const result = await runHealthChecks();

		expect(result.checks.connection_pool.details).toEqual({
			connectionsOpen: 5,
			connectionsInUse: 1,
			poolMin: 2,
			poolMax: 10
		});
	});
});

// ── Critical check failure (database) ────────────────────────────────────

describe('runHealthChecks — database failure', () => {
	it('returns error status when database check fails', async () => {
		mockWithConnection.mockRejectedValue(new Error('ORA-12541'));

		const { runHealthChecks } = await getModule();
		const result = await runHealthChecks();

		expect(result.status).toBe('error');
		expect(result.checks.database.status).toBe('error');
		expect(result.checks.database.details).toEqual({ error: 'ORA-12541' });
	});

	it('returns degraded when pool not initialized', async () => {
		mockIsPoolInitialized.mockReturnValue(false);

		const { runHealthChecks } = await getModule();
		const result = await runHealthChecks();

		expect(result.checks.database.status).toBe('degraded');
		expect(result.checks.database.details).toEqual({ reason: 'pool not initialized' });
		expect(result.checks.connection_pool.status).toBe('degraded');
	});
});

// ── Non-critical check failures (degraded) ───────────────────────────────

describe('runHealthChecks — non-critical failures', () => {
	it('returns degraded when OCI CLI is unavailable', async () => {
		mockExecFile.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (...a: unknown[]) => void) => {
				cb(new Error('command not found'));
			}
		);

		const { runHealthChecks } = await getModule();
		const result = await runHealthChecks();

		expect(result.status).toBe('degraded');
		expect(result.checks.oci_cli.status).toBe('degraded');
		expect(result.checks.oci_cli.details).toEqual({ error: 'command not found' });
	});

	it('returns degraded when Sentry is disabled', async () => {
		mockIsSentryEnabled.mockReturnValue(false);

		const { runHealthChecks } = await getModule();
		const result = await runHealthChecks();

		expect(result.status).toBe('degraded');
		expect(result.checks.sentry.status).toBe('degraded');
		expect(result.checks.sentry.details).toEqual({ enabled: false });
	});

	it('returns degraded when metrics returns null', async () => {
		mockRegistryCollect.mockReturnValue(null);

		const { runHealthChecks } = await getModule();
		const result = await runHealthChecks();

		expect(result.checks.metrics.status).toBe('degraded');
	});

	it('returns error for metrics when collect throws', async () => {
		mockRegistryCollect.mockImplementation(() => {
			throw new Error('registry broken');
		});

		const { runHealthChecks } = await getModule();
		const result = await runHealthChecks();

		expect(result.checks.metrics.status).toBe('error');
		// Non-critical so overall should be degraded, not error
		expect(result.status).toBe('degraded');
	});
});

// ── Pool stats edge cases ────────────────────────────────────────────────

describe('runHealthChecks — pool edge cases', () => {
	it('returns degraded when pool stats unavailable', async () => {
		mockGetPoolStats.mockResolvedValue(null);

		const { runHealthChecks } = await getModule();
		const result = await runHealthChecks();

		expect(result.checks.connection_pool.status).toBe('degraded');
		expect(result.checks.connection_pool.details).toEqual({ reason: 'pool stats unavailable' });
	});

	it('returns error when getPoolStats throws', async () => {
		mockGetPoolStats.mockRejectedValue(new Error('pool error'));

		const { runHealthChecks } = await getModule();
		const result = await runHealthChecks();

		expect(result.checks.connection_pool.status).toBe('error');
	});
});
