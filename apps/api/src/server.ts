import { createApp, startServer, stopServer } from './app.js';
import { createLogger } from '@portal/server/logger';
import { initSentry, closeSentry } from '@portal/server/sentry';

const log = createLogger('server');

async function main() {
	try {
		// Initialize Sentry (optional)
		if (process.env.SENTRY_DSN) {
			await initSentry({ dsn: process.env.SENTRY_DSN });
			log.info('Sentry initialized');
		}

		// Create and start Fastify app
		// Oracle pool init + migrations are handled by the oracle plugin inside createApp()
		const app = await createApp({
			corsOrigin: process.env.CORS_ORIGIN,
			enableRateLimit: process.env.ENABLE_RATE_LIMIT !== 'false',
			enableTracing: process.env.ENABLE_TRACING !== 'false'
		});

		const port = Number(process.env.PORT) || 3000;
		const host = process.env.HOST || '0.0.0.0';

		await startServer(app, port, host);

		// Graceful shutdown handlers
		// Note: Oracle pool close is handled by the oracle plugin's onClose hook.
		const shutdown = async (signal: string) => {
			log.info(`${signal} received, shutting down gracefully`);

			try {
				// Fastify close triggers all onClose hooks (oracle pool, etc.)
				await stopServer(app);

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
