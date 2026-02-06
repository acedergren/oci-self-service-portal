/**
 * Deep health check runner for the OCI Self-Service Portal.
 *
 * Checks each subsystem independently and returns a composite status.
 * Critical checks (database) drive overall status to 'error' on failure.
 * Non-critical checks (OCI CLI, Sentry, metrics) degrade gracefully.
 *
 * Usage:
 *   import { runHealthChecks } from '$lib/server/health.js';
 *   const result = await runHealthChecks();
 *   // result.status: 'ok' | 'degraded' | 'error'
 */

import { execFile } from 'node:child_process';
import { withConnection, getPoolStats, isPoolInitialized } from '$lib/server/oracle/connection.js';
import { isSentryEnabled } from '$lib/server/sentry.js';
import { registry } from '$lib/server/metrics.js';
import { createLogger } from '$lib/server/logger.js';

const log = createLogger('health');

const APP_VERSION = process.env.APP_VERSION || '0.1.0';
const startedAt = Date.now();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthCheckEntry {
	status: 'ok' | 'degraded' | 'error';
	latencyMs: number;
	details?: Record<string, unknown>;
}

export interface HealthCheckResult {
	status: 'ok' | 'degraded' | 'error';
	checks: Record<string, HealthCheckEntry>;
	timestamp: string;
	uptime: number;
	version: string;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkDatabase(): Promise<HealthCheckEntry> {
	const start = performance.now();
	try {
		if (!isPoolInitialized()) {
			return {
				status: 'degraded',
				latencyMs: performance.now() - start,
				details: { reason: 'pool not initialized' }
			};
		}
		await withConnection(async (conn) => {
			await conn.execute('SELECT 1 FROM DUAL');
		});
		return { status: 'ok', latencyMs: performance.now() - start };
	} catch (err) {
		log.warn({ err }, 'Database health check failed');
		return {
			status: 'error',
			latencyMs: performance.now() - start,
			details: { error: (err as Error).message }
		};
	}
}

async function checkConnectionPool(): Promise<HealthCheckEntry> {
	const start = performance.now();
	try {
		if (!isPoolInitialized()) {
			return {
				status: 'degraded',
				latencyMs: performance.now() - start,
				details: { reason: 'pool not initialized' }
			};
		}
		const stats = await getPoolStats();
		if (!stats) {
			return {
				status: 'degraded',
				latencyMs: performance.now() - start,
				details: { reason: 'pool stats unavailable' }
			};
		}
		return {
			status: 'ok',
			latencyMs: performance.now() - start,
			details: {
				connectionsOpen: stats.connectionsOpen,
				connectionsInUse: stats.connectionsInUse,
				poolMin: stats.poolMin,
				poolMax: stats.poolMax
			}
		};
	} catch (err) {
		return {
			status: 'error',
			latencyMs: performance.now() - start,
			details: { error: (err as Error).message }
		};
	}
}

function checkOciCli(): Promise<HealthCheckEntry> {
	const start = performance.now();
	return new Promise((resolve) => {
		execFile('oci', ['--version'], { timeout: 5000 }, (error, stdout) => {
			if (error) {
				resolve({
					status: 'degraded',
					latencyMs: performance.now() - start,
					details: { error: error.message }
				});
			} else {
				resolve({
					status: 'ok',
					latencyMs: performance.now() - start,
					details: { version: stdout.trim() }
				});
			}
		});
	});
}

function checkSentry(): HealthCheckEntry {
	const start = performance.now();
	return {
		status: isSentryEnabled() ? 'ok' : 'degraded',
		latencyMs: performance.now() - start,
		details: { enabled: isSentryEnabled() }
	};
}

function checkMetrics(): HealthCheckEntry {
	const start = performance.now();
	try {
		const output = registry.collect();
		return { status: output ? 'ok' : 'degraded', latencyMs: performance.now() - start };
	} catch {
		return { status: 'error', latencyMs: performance.now() - start };
	}
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Critical checks — if any fail, overall status is 'error'. */
const CRITICAL_CHECKS = new Set(['database']);

export async function runHealthChecks(): Promise<HealthCheckResult> {
	const [database, connection_pool, oci_cli] = await Promise.all([
		checkDatabase(),
		checkConnectionPool(),
		checkOciCli()
	]);

	const checks: Record<string, HealthCheckEntry> = {
		database,
		connection_pool,
		oci_cli,
		sentry: checkSentry(),
		metrics: checkMetrics()
	};

	// Determine overall status
	let status: 'ok' | 'degraded' | 'error' = 'ok';
	for (const [name, check] of Object.entries(checks)) {
		if (check.status === 'error' && CRITICAL_CHECKS.has(name)) {
			status = 'error';
			break;
		}
		if (check.status === 'error' || check.status === 'degraded') {
			status = status === 'error' ? 'error' : 'degraded';
		}
	}

	return {
		status,
		checks,
		timestamp: new Date().toISOString(),
		uptime: (Date.now() - startedAt) / 1000,
		version: APP_VERSION
	};
}
