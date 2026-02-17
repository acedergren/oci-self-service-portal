import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifySchedule from '@fastify/schedule';
import { AsyncTask, CronJob } from 'toad-scheduler';
import { createLogger } from '@portal/server/logger';

const log = createLogger('schedule');

/**
 * Stale session cleanup configuration.
 *
 * - Auth sessions (Better Auth): deleted when expires_at < SYSTIMESTAMP
 * - Chat sessions: deleted when updated_at > TTL days old AND status is completed/error
 * - Batch size: maximum rows deleted per cleanup run (avoids lock contention)
 */
const CLEANUP_CONFIG = {
	/** Max auth_sessions rows deleted per run. */
	authSessionBatchSize: 500,
	/** Max chat_sessions rows deleted per run. */
	chatSessionBatchSize: 500,
	/** Chat sessions older than this many days (in non-active states) are deleted. */
	chatSessionTtlDays: 30
} as const;

/**
 * Clean up stale sessions from the Oracle database.
 *
 * Exported for direct testing and for use in the cron job.
 * Errors are caught and logged — cleanup is always best-effort.
 *
 * Cleans two tables:
 * 1. `auth_sessions` — rows where expires_at < SYSTIMESTAMP (Better Auth sessions)
 * 2. `chat_sessions` — rows where updated_at is older than TTL and status is completed/error
 */
export async function cleanupStaleSessions(fastify: FastifyInstance): Promise<void> {
	if (!fastify.oracle?.isAvailable()) {
		log.debug('[schedule:stale-session-cleanup] Oracle not available, skipping');
		return;
	}

	try {
		let authSessionsDeleted = 0;
		let chatSessionsDeleted = 0;

		// 1. Delete expired auth_sessions (Better Auth managed sessions).
		//    expires_at is set by Better Auth and is always present.
		await fastify.oracle.withConnection(async (conn) => {
			const result = await conn.execute(
				`DELETE FROM auth_sessions
				 WHERE id IN (
				   SELECT id FROM auth_sessions
				   WHERE expires_at < SYSTIMESTAMP
				   FETCH FIRST :batchSize ROWS ONLY
				 )`,
				{ batchSize: CLEANUP_CONFIG.authSessionBatchSize }
			);
			authSessionsDeleted = (result as { rowsAffected?: number }).rowsAffected ?? 0;
		});

		// 2. Delete old completed/error chat_sessions beyond the TTL.
		//    Active sessions are never deleted — only completed and error states.
		await fastify.oracle.withConnection(async (conn) => {
			const result = await conn.execute(
				`DELETE FROM chat_sessions
				 WHERE id IN (
				   SELECT id FROM chat_sessions
				   WHERE status IN ('completed', 'error')
				     AND updated_at < SYSTIMESTAMP - NUMTODSINTERVAL(:ttlDays, 'DAY')
				   FETCH FIRST :batchSize ROWS ONLY
				 )`,
				{
					ttlDays: CLEANUP_CONFIG.chatSessionTtlDays,
					batchSize: CLEANUP_CONFIG.chatSessionBatchSize
				}
			);
			chatSessionsDeleted = (result as { rowsAffected?: number }).rowsAffected ?? 0;
		});

		log.info(
			{ authSessionsDeleted, chatSessionsDeleted },
			'[schedule:stale-session-cleanup] Completed stale session cleanup'
		);
	} catch (error) {
		log.error(
			{ err: error },
			'[schedule:stale-session-cleanup] Completed stale session cleanup failed'
		);
	}
}

/**
 * Fastify schedule plugin for recurring background tasks.
 *
 * Registers cron jobs:
 * - Health check ping every 5 minutes (system stats)
 * - Stale session cleanup every hour
 */
const schedulePlugin: FastifyPluginAsync = async (fastify) => {
	await fastify.register(fastifySchedule);

	// Health check ping: every 5 minutes, log system memory/heap stats
	const healthCheckTask = new AsyncTask(
		'health-check-ping',
		async () => {
			try {
				const memUsage = process.memoryUsage();
				log.info(
					{
						rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
						heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
						heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
						external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
					},
					'[schedule:health-check-ping] System memory stats'
				);
			} catch (error) {
				log.error({ err: error }, '[schedule:health-check-ping] Failed to collect memory stats');
			}
		},
		(error: Error) => {
			log.error({ err: error }, '[schedule:health-check-ping] Task failed');
		}
	);

	const healthCheckJob = new CronJob({ cronExpression: '*/5 * * * *' }, healthCheckTask, {
		preventOverrun: true
	});
	fastify.scheduler.addCronJob(healthCheckJob);

	// Stale session cleanup: every hour
	const cleanupTask = new AsyncTask(
		'stale-session-cleanup',
		async () => {
			await cleanupStaleSessions(fastify);
		},
		(error: Error) => {
			log.error({ err: error }, '[schedule:stale-session-cleanup] Task failed');
		}
	);

	const cleanupJob = new CronJob({ cronExpression: '0 * * * *' }, cleanupTask, {
		preventOverrun: true
	});
	fastify.scheduler.addCronJob(cleanupJob);

	log.info(
		'[schedule] Cron jobs registered: health-check-ping (*/5 * * * *), stale-session-cleanup (0 * * * *)'
	);
};

export default fp(schedulePlugin, {
	name: 'schedule',
	fastify: '5.x',
	dependencies: ['oracle'] // Ensure Oracle plugin is registered first
});
