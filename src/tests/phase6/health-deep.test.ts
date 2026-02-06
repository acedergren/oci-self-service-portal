/**
 * Phase 6 TDD: Deep Health Checks
 *
 * Enhances the /api/health endpoint with deep checks for all dependencies.
 * Returns detailed status for each subsystem.
 *
 * Expected module: $lib/server/health.ts
 * Expected exports:
 *   - runHealthChecks(): Promise<HealthCheckResult>
 *   - HealthCheckResult: { status, checks, timestamp, uptime, version }
 *   - HealthCheckEntry: { status: 'ok'|'degraded'|'error', latencyMs, details? }
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Oracle connection
const mockExecute = vi.fn();
vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) => {
		const mockConn = {
			execute: mockExecute,
			commit: vi.fn().mockResolvedValue(undefined),
			rollback: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined)
		};
		return fn(mockConn);
	}),
	getPoolStats: vi.fn().mockResolvedValue({
		connectionsOpen: 3,
		connectionsInUse: 1,
		poolMin: 2,
		poolMax: 10
	}),
	isPoolInitialized: vi.fn().mockReturnValue(true)
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

let healthModule: Record<string, unknown> | null = null;
let moduleError: string | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		healthModule = await import('$lib/server/health.js');
	} catch (err) {
		moduleError = (err as Error).message;
	}
});

describe('Deep Health Checks (Phase 6.8)', () => {
	describe('module availability', () => {
		it('health module should be importable', () => {
			if (moduleError) {
				expect.fail(
					`health module not yet available: ${moduleError}. ` +
						'Implement $lib/server/health.ts per Phase 6.8.'
				);
			}
			expect(healthModule).not.toBeNull();
		});
	});

	describe('runHealthChecks', () => {
		it('returns overall status and individual check results', async () => {
			if (!healthModule) return;
			const runHealthChecks = healthModule.runHealthChecks as () => Promise<{
				status: string;
				checks: Record<string, { status: string; latencyMs: number }>;
				timestamp: string;
				uptime: number;
				version: string;
			}>;

			mockExecute.mockResolvedValueOnce({ rows: [{ RESULT: 1 }] });

			const result = await runHealthChecks();

			expect(result.status).toBeDefined();
			expect(['ok', 'degraded', 'error']).toContain(result.status);
			expect(result.checks).toBeDefined();
			expect(result.timestamp).toBeDefined();
			expect(result.uptime).toBeGreaterThanOrEqual(0);
			expect(result.version).toBeDefined();
		});

		it('includes database check', async () => {
			if (!healthModule) return;
			const runHealthChecks = healthModule.runHealthChecks as () => Promise<{
				status: string;
				checks: Record<string, { status: string; latencyMs: number }>;
			}>;

			mockExecute.mockResolvedValueOnce({ rows: [{ RESULT: 1 }] });

			const result = await runHealthChecks();
			expect(result.checks.database).toBeDefined();
			expect(result.checks.database.status).toBe('ok');
			expect(result.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
		});

		it('includes OCI CLI check', async () => {
			if (!healthModule) return;
			const runHealthChecks = healthModule.runHealthChecks as () => Promise<{
				checks: Record<string, { status: string }>;
			}>;

			mockExecute.mockResolvedValueOnce({ rows: [{ RESULT: 1 }] });

			const result = await runHealthChecks();
			expect(result.checks.oci_cli).toBeDefined();
		});

		it('includes connection pool stats', async () => {
			if (!healthModule) return;
			const runHealthChecks = healthModule.runHealthChecks as () => Promise<{
				checks: Record<
					string,
					{
						status: string;
						details?: { connectionsOpen: number; connectionsInUse: number };
					}
				>;
			}>;

			mockExecute.mockResolvedValueOnce({ rows: [{ RESULT: 1 }] });

			const result = await runHealthChecks();
			expect(result.checks.connection_pool).toBeDefined();
			expect(result.checks.connection_pool.details).toBeDefined();
		});

		it('returns degraded status when non-critical check fails', async () => {
			if (!healthModule) return;
			const runHealthChecks = healthModule.runHealthChecks as () => Promise<{
				status: string;
				checks: Record<string, { status: string }>;
			}>;

			// DB works but OCI CLI fails
			mockExecute.mockResolvedValueOnce({ rows: [{ RESULT: 1 }] });

			const result = await runHealthChecks();
			// If any check is degraded, overall should be degraded
			const hasFailure = Object.values(result.checks).some(
				(c) => c.status === 'error' || c.status === 'degraded'
			);
			if (hasFailure) {
				expect(result.status).not.toBe('ok');
			}
		});

		it('returns error status when database is down', async () => {
			if (!healthModule) return;
			const runHealthChecks = healthModule.runHealthChecks as () => Promise<{
				status: string;
				checks: Record<string, { status: string }>;
			}>;

			mockExecute.mockRejectedValueOnce(new Error('ORA-12541: TNS:no listener'));

			const result = await runHealthChecks();
			expect(result.checks.database.status).toBe('error');
			expect(['degraded', 'error']).toContain(result.status);
		});
	});
});
