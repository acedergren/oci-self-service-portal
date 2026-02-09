import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
	initPool,
	closePool,
	withConnection,
	getPoolStats,
	isPoolInitialized,
	type OracleConfig,
	type OracleConnection
} from '@portal/shared/server/oracle/connection';
import { runMigrations } from '@portal/shared/server/oracle/migrations';
import { webhookRepository } from '@portal/shared/server/oracle/repositories/webhook-repository';
import { createLogger } from '@portal/shared/server/logger';

const log = createLogger('fastify-oracle');

export interface OraclePluginOptions {
	/** Oracle connection config. Falls back to env vars when omitted. */
	config?: Partial<OracleConfig>;
	/** Run migrations on startup (default: true). */
	migrate?: boolean;
}

export interface OracleDecorator {
	/** Borrow a connection, execute fn, auto-release. */
	withConnection: <T>(fn: (conn: OracleConnection) => Promise<T>) => Promise<T>;
	/** Pool health stats, or null if pool is not initialized. */
	getPoolStats: typeof getPoolStats;
	/** Whether the pool was successfully initialized. */
	isAvailable: () => boolean;
}

declare module 'fastify' {
	interface FastifyInstance {
		oracle: OracleDecorator;
	}
	interface FastifyRequest {
		/** Whether the Oracle DB is available for this request. */
		dbAvailable: boolean;
	}
}

const oraclePlugin: FastifyPluginAsync<OraclePluginOptions> = async (fastify, opts) => {
	const { config, migrate = true } = opts;

	let available = false;

	try {
		await initPool(config);
		available = true;
		log.info('Oracle connection pool initialized via Fastify plugin');

		if (migrate) {
			await runMigrations();
			const webhookSecretMigration = await webhookRepository.migratePlaintextSecrets();
			if (webhookSecretMigration.migrated > 0 || webhookSecretMigration.remaining > 0) {
				log.info({ webhookSecretMigration }, 'Webhook secret migration complete');
			}
			log.info('Database migrations complete');
		}
	} catch (err) {
		log.warn({ err }, 'Oracle initialization failed — running in fallback mode');
	}

	const decorator: OracleDecorator = {
		withConnection,
		getPoolStats,
		isAvailable: () => available && isPoolInitialized()
	};

	fastify.decorate('oracle', decorator);

	// Decorate every request with dbAvailable flag (mirrors SvelteKit locals.dbAvailable)
	fastify.decorateRequest('dbAvailable', false);
	fastify.addHook('onRequest', async (request) => {
		request.dbAvailable = decorator.isAvailable();
	});

	// Close pool on server shutdown
	fastify.addHook('onClose', async () => {
		await closePool();
		log.info('Oracle connection pool closed via Fastify plugin');
	});
};

export default fp(oraclePlugin, {
	name: 'oracle',
	fastify: '5.x'
});
