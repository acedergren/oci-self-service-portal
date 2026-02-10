import fp from 'fastify-plugin';
import underPressure from '@fastify/under-pressure';
import type { FastifyPluginAsync } from 'fastify';
import { createLogger } from '@portal/shared/server/logger.js';

const logger = createLogger('under-pressure-plugin');

/**
 * Default pressure thresholds for under-pressure plugin
 */
const PRESSURE_DEFAULTS = {
	MAX_EVENT_LOOP_DELAY: 1000, // 1 second
	MAX_HEAP_USED_BYTES: 700 * 1024 * 1024, // 700MB
	MAX_RSS_BYTES: 1200 * 1024 * 1024, // 1200MB
	HEALTH_CHECK_INTERVAL: 5000, // 5 seconds
	SAMPLE_INTERVAL: 1000, // 1 second
	RETRY_AFTER_SECONDS: 30 // 30 seconds
} as const;

export interface UnderPressurePluginOptions {
	maxEventLoopDelay?: number; // default 1000ms
	maxHeapUsedBytes?: number; // default 700MB
	maxRssBytes?: number; // default 1200MB
	healthCheckInterval?: number; // default 5000ms
	sampleInterval?: number; // default 1000ms (how often to sample resource metrics)
}

const underPressurePlugin: FastifyPluginAsync<UnderPressurePluginOptions> = async (
	fastify,
	opts
) => {
	const {
		maxEventLoopDelay = PRESSURE_DEFAULTS.MAX_EVENT_LOOP_DELAY,
		maxHeapUsedBytes = PRESSURE_DEFAULTS.MAX_HEAP_USED_BYTES,
		maxRssBytes = PRESSURE_DEFAULTS.MAX_RSS_BYTES,
		healthCheckInterval = PRESSURE_DEFAULTS.HEALTH_CHECK_INTERVAL,
		sampleInterval = PRESSURE_DEFAULTS.SAMPLE_INTERVAL
	} = opts;

	// Custom health check that integrates with Oracle plugin if available
	const customHealthCheck = async (): Promise<boolean> => {
		try {
			// If Oracle plugin is registered, check its availability
			if (fastify.hasDecorator('oracle')) {
				const oracle = fastify.oracle as { isAvailable: () => boolean };
				const isAvailable = oracle.isAvailable();
				return isAvailable;
			}
			// Graceful degradation: if Oracle plugin not registered, return true
			return true;
		} catch (error) {
			// Catch errors from Oracle.isAvailable and return false
			logger.error({ error }, 'Health check failed');
			return false;
		}
	};

	// Custom pressure handler that returns 503 with proper body and Retry-After header
	const pressureHandler = async (
		_req: unknown,
		reply: {
			code: (statusCode: number) => {
				header: (key: string, value: string) => { send: (body: object) => void };
			};
		}
	) => {
		reply.code(503).header('Retry-After', String(PRESSURE_DEFAULTS.RETRY_AFTER_SECONDS)).send({
			statusCode: 503,
			error: 'Service Unavailable',
			message: 'Server is under pressure'
		});
	};

	await fastify.register(underPressure, {
		maxEventLoopDelay,
		maxHeapUsedBytes,
		maxRssBytes,
		healthCheckInterval,
		sampleInterval,
		healthCheck: customHealthCheck,
		pressureHandler,
		exposeStatusRoute: '/api/pressure'
	});

	logger.info(
		{
			maxEventLoopDelay,
			maxHeapUsedBytes,
			maxRssBytes,
			healthCheckInterval,
			sampleInterval
		},
		'Under-pressure plugin registered'
	);
};

export default fp(underPressurePlugin, {
	name: 'under-pressure',
	fastify: '5.x'
});
