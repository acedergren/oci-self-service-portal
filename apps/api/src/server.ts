import { createApp, startServer, stopServer } from './app.js';
import { createLogger } from '@portal/shared/server/logger';
import { initPool, closePool } from '@portal/shared/server/oracle/connection';
import { runMigrations } from '@portal/shared/server/oracle/migrations';
import { initSentry, closeSentry } from '@portal/shared/server/sentry';

const log = createLogger('server');

async function main() {
	try {
		// Initialize Sentry (optional)
		if (process.env.SENTRY_DSN) {
			initSentry(process.env.SENTRY_DSN);
			log.info('Sentry initialized');
		}

		// Initialize Oracle connection pool
		try {
			await initPool();
			log.info('Oracle connection pool initialized');

			// Run database migrations
			await runMigrations();
			log.info('Database migrations complete');
		} catch (error) {
			log.warn({ err: error }, 'Oracle initialization failed, continuing with fallback storage');
		}

		// Create and start Fastify app
		const app = await createApp({
			corsOrigin: process.env.CORS_ORIGIN || '*',
			enableRateLimit: process.env.ENABLE_RATE_LIMIT !== 'false',
			enableTracing: process.env.ENABLE_TRACING !== 'false'
		});

		const port = Number(process.env.PORT) || 3000;
		const host = process.env.HOST || '0.0.0.0';

		await startServer(app, port, host);

		// Graceful shutdown handlers
		const shutdown = async (signal: string) => {
			log.info(`${signal} received, shutting down gracefully`);

			try {
				// Stop accepting new requests
				await stopServer(app);

				// Close Oracle pool
				await closePool();
				log.info('Oracle connection pool closed');

				// Close Sentry
				await closeSentry();
				log.info('Sentry closed');

				process.exit(0);
			} catch (error) {
				log.error({ err: error }, 'Error during shutdown');
				process.exit(1);
			}
		};

		process.on('SIGTERM', () => shutdown('SIGTERM'));
		process.on('SIGINT', () => shutdown('SIGINT'));
	} catch (error) {
		log.fatal({ err: error }, 'Failed to start server');
		process.exit(1);
	}
}

main();
