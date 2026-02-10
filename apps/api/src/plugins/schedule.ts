import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifySchedule from '@fastify/schedule';
import { AsyncTask, CronJob } from 'toad-scheduler';
import { createLogger } from '@portal/server/logger';

const log = createLogger('schedule');

/**
 * Fastify schedule plugin for recurring background tasks.
 *
 * Registers cron jobs:
 * - Health check ping every 5 minutes (system stats)
 * - Stale session cleanup every hour (placeholder)
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

	// Stale session cleanup: every hour (placeholder)
	const cleanupTask = new AsyncTask(
		'stale-session-cleanup',
		async () => {
			try {
				// Check if Oracle is available before attempting cleanup
				if (!fastify.oracle?.isAvailable()) {
					log.debug('[schedule:stale-session-cleanup] Oracle not available, skipping');
					return;
				}

				log.info('[schedule:stale-session-cleanup] Running stale session cleanup (placeholder)');
				// TODO: Implement actual session cleanup logic
				// Example: DELETE FROM sessions WHERE last_activity < NOW() - INTERVAL '7 days'
			} catch (error) {
				log.error({ err: error }, '[schedule:stale-session-cleanup] Cleanup job failed');
			}
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
