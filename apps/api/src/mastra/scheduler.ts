/**
 * CloudAdvisor scheduler.
 *
 * Runs CloudAdvisor workflows on configurable schedules. Uses node timers
 * (setInterval / setTimeout) since Mastra 1.2.0 does not include a built-in
 * scheduler module.
 *
 * Concurrency guard: tracks in-progress runs per workflow name to prevent
 * overlapping executions of the same analysis.
 *
 * Environment overrides:
 *   CLOUDADVISOR_FULL_CRON_HOUR    — UTC hour for daily full analysis (default: 3)
 *   CLOUDADVISOR_SECURITY_INTERVAL — ms between security runs (default: 2h)
 *   CLOUDADVISOR_COST_INTERVAL     — ms between cost runs (default: 6h)
 *   CLOUDADVISOR_AI_INTERVAL       — ms between AI performance runs (default: 12h)
 *   CLOUDADVISOR_RIGHTSIZING_CRON_HOUR — UTC hour for daily right-sizing (default: 4)
 *   CLOUDADVISOR_COMPARTMENT_ID    — default OCI compartment for analyses
 *   CLOUDADVISOR_ENABLED           — set to 'false' to disable all scheduled runs
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@portal/server/logger.js';
import type { Mastra } from '@mastra/core';
import type { FindingsRepository } from '../services/findings-repository.js';

const log = createLogger('cloud-advisor-scheduler');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SchedulerConfig {
	mastra: Mastra;
	findingsRepository: FindingsRepository;
	compartmentId?: string;
}

// ── Concurrency guard ─────────────────────────────────────────────────────────

const inProgress = new Set<string>();

// ── Schedule constants ────────────────────────────────────────────────────────

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ── Workflow runner ───────────────────────────────────────────────────────────

async function runWorkflow(
	config: SchedulerConfig,
	workflowId: string,
	inputData: Record<string, unknown>
): Promise<void> {
	if (inProgress.has(workflowId)) {
		log.info({ workflowId }, 'skipping — run already in progress');
		return;
	}

	const runId = randomUUID();
	inProgress.add(workflowId);
	log.info({ workflowId, runId }, 'scheduled run starting');

	// Record run start in DB
	await config.findingsRepository
		.upsertRun(
			runId,
			workflowId.replace('cloud-advisor-', '').replace('full', null as unknown as string) || null,
			'running'
		)
		.catch((err: unknown) => log.warn({ err }, 'failed to record run start'));

	const startedAt = Date.now();

	try {
		const workflow = config.mastra.getWorkflow(workflowId);
		const run = await workflow.createRun();
		const result = (await run.start({ inputData: { runId, ...inputData } })) as {
			results?: {
				summary?: { output?: { summary?: unknown; findings?: unknown[] } };
			};
		};

		const durationMs = Date.now() - startedAt;

		// Persist findings from the result
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const summary = (result as any)?.results?.summary?.output?.summary;

		const findings =
			(result as any)?.results?.summary?.output?.findings ??
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(result as any)?.results?.notify?.output?.findings ??
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(result as any)?.results?.persist_and_notify?.output?.findings ??
			[];

		if (Array.isArray(findings) && findings.length > 0) {
			await config.findingsRepository
				.upsertFindings(findings)
				.catch((err: unknown) =>
					log.warn({ err, findingCount: findings.length }, 'finding persistence failed')
				);
		}

		// Mark run complete
		const fc = summary?.findingCounts ?? {};
		await config.findingsRepository
			.upsertRun(runId, null, 'completed', {
				completedAt: new Date(),
				durationMs,
				findingCount: findings.length,
				criticalCount: fc.critical ?? 0,
				highCount: fc.high ?? 0,
				mediumCount: fc.medium ?? 0,
				lowCount: fc.low ?? 0,
				infoCount: fc.info ?? 0,
				estimatedSavings: summary?.estimatedSavings ?? 0,
				summaryJson: summary ? JSON.stringify(summary) : undefined
			})
			.catch((err: unknown) => log.warn({ err }, 'failed to record run completion'));

		log.info(
			{ workflowId, runId, durationMs, findingCount: findings.length },
			'scheduled run completed'
		);
	} catch (err) {
		const durationMs = Date.now() - startedAt;
		log.error({ err, workflowId, runId, durationMs }, 'scheduled run failed');

		await config.findingsRepository
			.upsertRun(runId, null, 'failed', {
				completedAt: new Date(),
				durationMs,
				errorMessage: err instanceof Error ? err.message : String(err)
			})
			.catch(() => {
				/* non-fatal */
			});
	} finally {
		inProgress.delete(workflowId);
	}
}

// ── Daily-at-hour scheduler ───────────────────────────────────────────────────

/**
 * Returns the ms until the next occurrence of the given UTC hour (0-23).
 * If the hour has already passed today, schedules for tomorrow.
 */
function msUntilNextHourUTC(targetHour: number): number {
	const now = new Date();
	const next = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), targetHour, 0, 0, 0)
	);

	if (next.getTime() <= now.getTime()) {
		next.setUTCDate(next.getUTCDate() + 1);
	}

	return next.getTime() - now.getTime();
}

function scheduleDaily(
	config: SchedulerConfig,
	workflowId: string,
	utcHour: number,
	inputData: Record<string, unknown>
): void {
	const delay = msUntilNextHourUTC(utcHour);
	log.info(
		{ workflowId, utcHour, nextRunInMin: Math.round(delay / 60_000) },
		'daily run scheduled'
	);

	setTimeout(function tick() {
		void runWorkflow(config, workflowId, inputData);
		// Re-schedule exactly 24h later to maintain daily cadence
		setTimeout(tick, ONE_DAY_MS);
	}, delay);
}

// ── Exported scheduler ────────────────────────────────────────────────────────

/**
 * Start all CloudAdvisor scheduled analyses.
 * Call once during server startup after Mastra and Oracle are initialised.
 */
export function startCloudAdvisorScheduler(config: SchedulerConfig): void {
	if (process.env.CLOUDADVISOR_ENABLED === 'false') {
		log.info('CloudAdvisor scheduler disabled via CLOUDADVISOR_ENABLED=false');
		return;
	}

	const compartmentId = config.compartmentId ?? process.env.CLOUDADVISOR_COMPARTMENT_ID;
	const baseInput: Record<string, unknown> = {
		depth: 'light',
		...(compartmentId ? { compartmentId } : {})
	};

	// ── Daily full analysis at 03:00 UTC ──────────────────────────────────
	const fullHour = parseInt(process.env.CLOUDADVISOR_FULL_CRON_HOUR ?? '3', 10);
	scheduleDaily(config, 'cloud-advisor-full', fullHour, baseInput);

	// ── Daily right-sizing at 04:00 UTC ───────────────────────────────────
	const rsHour = parseInt(process.env.CLOUDADVISOR_RIGHTSIZING_CRON_HOUR ?? '4', 10);
	scheduleDaily(config, 'cloud-advisor-right-sizing', rsHour, {
		...baseInput,
		lookbackDays: parseInt(process.env.CLOUDADVISOR_RIGHTSIZING_DAYS ?? '14', 10)
	});

	// ── Cost analysis every 6 hours ───────────────────────────────────────
	const costInterval = parseInt(process.env.CLOUDADVISOR_COST_INTERVAL ?? String(SIX_HOURS_MS), 10);
	setInterval(() => void runWorkflow(config, 'cloud-advisor-cost', baseInput), costInterval);
	log.info({ intervalMin: Math.round(costInterval / 60_000) }, 'cost analysis interval scheduled');

	// ── Security analysis every 2 hours ──────────────────────────────────
	const securityInterval = parseInt(
		process.env.CLOUDADVISOR_SECURITY_INTERVAL ?? String(TWO_HOURS_MS),
		10
	);
	setInterval(
		() => void runWorkflow(config, 'cloud-advisor-security', baseInput),
		securityInterval
	);
	log.info(
		{ intervalMin: Math.round(securityInterval / 60_000) },
		'security analysis interval scheduled'
	);

	// ── AI performance every 12 hours ─────────────────────────────────────
	const aiInterval = parseInt(process.env.CLOUDADVISOR_AI_INTERVAL ?? String(TWELVE_HOURS_MS), 10);
	setInterval(
		() => void runWorkflow(config, 'cloud-advisor-ai-performance', baseInput),
		aiInterval
	);
	log.info({ intervalMin: Math.round(aiInterval / 60_000) }, 'AI performance interval scheduled');

	log.info('CloudAdvisor scheduler started');
}

/**
 * Run a specific analysis immediately (on-demand trigger).
 * Returns the runId so callers can subscribe to SSE events.
 */
export async function triggerAnalysis(
	config: SchedulerConfig,
	domain: 'cost' | 'security' | 'right-sizing' | 'ai-performance' | 'all',
	depth: 'light' | 'deep' = 'deep'
): Promise<string> {
	const runId = randomUUID();
	const compartmentId = config.compartmentId ?? process.env.CLOUDADVISOR_COMPARTMENT_ID;
	const inputData: Record<string, unknown> = {
		runId,
		depth,
		...(compartmentId ? { compartmentId } : {})
	};

	const workflowId = domain === 'all' ? 'cloud-advisor-full' : `cloud-advisor-${domain}`;

	// Fire and forget — caller subscribes to SSE for progress
	void runWorkflow(config, workflowId, inputData);

	return runId;
}
