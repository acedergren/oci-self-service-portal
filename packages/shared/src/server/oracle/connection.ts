// @ts-expect-error oracledb ships no type declarations
import oracledb from 'oracledb';
import { createLogger } from '../logger';
import { wrapWithSpan } from '../sentry';

const log = createLogger('oracle');

// Thin mode: no Oracle Client needed. Set global defaults.
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = true;

export interface OracleConfig {
	user: string;
	password: string;
	connectString: string;
	walletLocation?: string;
	walletPassword?: string;
	poolMin?: number;
	poolMax?: number;
	poolIncrement?: number;
	poolTimeout?: number;
}

export interface OracleConnection {
	close(): Promise<void>;
	execute<T = Record<string, unknown>>(
		sql: string,
		binds?: unknown,
		options?: unknown
	): Promise<{ rows?: T[] }>;
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

export interface OraclePool {
	getConnection(): Promise<OracleConnection>;
	close(drainTime?: number): Promise<void>;
	connectionsOpen: number;
	connectionsInUse: number;
	poolMin: number;
	poolMax: number;
}

function getConfigFromEnv(): OracleConfig {
	return {
		user: process.env.ORACLE_USER ?? '',
		password: process.env.ORACLE_PASSWORD ?? '',
		connectString: process.env.ORACLE_CONNECT_STRING ?? process.env.ORACLE_DSN ?? '',
		walletLocation: process.env.ORACLE_WALLET_LOCATION,
		walletPassword: process.env.ORACLE_WALLET_PASSWORD
	};
}

let pool: OraclePool | null = null;

/**
 * Create the connection pool. Safe to call multiple times; subsequent calls are no-ops.
 * Config values fall back to environment variables when omitted.
 */
export async function initPool(config?: Partial<OracleConfig>): Promise<void> {
	if (pool) {
		log.info('Connection pool already initialized');
		return;
	}

	const envConfig = getConfigFromEnv();
	const merged: OracleConfig = { ...envConfig, ...config };

	const poolAttrs: Record<string, unknown> = {
		user: merged.user,
		password: merged.password,
		connectString: merged.connectString,
		poolMin: merged.poolMin ?? 2,
		poolMax: merged.poolMax ?? 10,
		poolIncrement: merged.poolIncrement ?? 2,
		poolTimeout: merged.poolTimeout ?? 60
	};

	// For ADB wallet-based auth, set configDir so oracledb can find tnsnames.ora + wallet files
	if (merged.walletLocation) {
		poolAttrs.configDir = merged.walletLocation;
		poolAttrs.walletLocation = merged.walletLocation;
		poolAttrs.walletPassword = merged.walletPassword;
	}

	pool = await oracledb.createPool(poolAttrs);
	log.info(
		{
			poolMin: poolAttrs.poolMin,
			poolMax: poolAttrs.poolMax,
			connectString: merged.connectString
		},
		'Oracle connection pool created'
	);
}

/**
 * Borrow a connection from the pool, execute `fn`, and always release.
 * Initializes the pool on first call if it has not been created yet.
 */
export async function withConnection<T>(fn: (conn: OracleConnection) => Promise<T>): Promise<T> {
	return wrapWithSpan('db.withConnection', 'db', async () => {
		if (!pool) {
			await initPool();
		}

		const conn = await pool!.getConnection();
		try {
			return await fn(conn);
		} finally {
			await conn.close();
		}
	});
}

/**
 * Gracefully drain and close the pool.
 */
export async function closePool(): Promise<void> {
	if (!pool) {
		log.info('No connection pool to close');
		return;
	}

	await pool.close(10);
	pool = null;
	log.info('Oracle connection pool closed');
}

/**
 * Access the raw pool. Throws if the pool is not initialized.
 */
export function getPool(): OraclePool {
	if (!pool) {
		throw new Error('Oracle connection pool is not initialized. Call initPool() first.');
	}
	return pool;
}

/**
 * Return basic pool statistics, or null if the pool is not initialized.
 */
export async function getPoolStats(): Promise<{
	connectionsOpen: number;
	connectionsInUse: number;
	poolMin: number;
	poolMax: number;
} | null> {
	if (!pool) {
		return null;
	}

	return {
		connectionsOpen: pool.connectionsOpen,
		connectionsInUse: pool.connectionsInUse,
		poolMin: pool.poolMin,
		poolMax: pool.poolMax
	};
}

export function isPoolInitialized(): boolean {
	return pool !== null;
}
