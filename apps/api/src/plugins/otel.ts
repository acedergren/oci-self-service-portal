import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createLogger } from '@portal/server/logger';

const log = createLogger('otel');

/**
 * OpenTelemetry plugin
 *
 * Must register as the FIRST plugin in the Fastify plugin chain to properly instrument
 * the request lifecycle. No-op if OTEL_EXPORTER_OTLP_ENDPOINT is not configured.
 */
export default fp(
	async (app: FastifyInstance) => {
		const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

		if (otelEndpoint) {
			const serviceName = process.env.OTEL_SERVICE_NAME ?? 'oci-portal-api';
			log.info({ serviceName, endpoint: otelEndpoint }, 'Registering OpenTelemetry');

			// @fastify/otel type definitions are incorrect - default export is a plugin function at runtime
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- @fastify/otel types mismatch runtime
			const fastifyOtel = (await import('@fastify/otel')).default as any;
			await app.register(fastifyOtel, { serviceName });
		} else {
			log.info('OTEL_EXPORTER_OTLP_ENDPOINT not set, skipping OpenTelemetry setup');
		}
	},
	{
		name: 'otel',
		fastify: '5.x'
	}
);
