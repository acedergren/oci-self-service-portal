import Redis from 'iovalkey';
import { createLogger } from '@portal/server/logger';

const logger = createLogger('cache');

/**
 * Default TTL (seconds) for each cache namespace
 */
const DEFAULT_NAMESPACE_TTLS: Record<string, number> = {
	session: 600, // 10 minutes
	tool: 300, // 5 minutes
	mcp: 1800 // 30 minutes
};

export interface CacheServiceOptions {
	url?: string;
}

/**
 * Valkey/Redis cache service with namespace-scoped TTLs and fail-open behavior.
 * All methods wrap operations in try/catch and never throw — the app continues if cache is down.
 */
export class CacheService {
	private client: Redis | null = null;
	private connected = false;

	constructor(private readonly options: CacheServiceOptions) {}

	/**
	 * Connect to Valkey/Redis and set up event handlers.
	 * Does NOT throw on connection failure — app continues without cache.
	 */
	async connect(): Promise<void> {
		try {
			this.client = this.options.url ? new Redis(this.options.url) : new Redis();

			this.client.on('ready', () => {
				this.connected = true;
				logger.info('[cache] Connected to Valkey');
			});

			this.client.on('error', (err) => {
				this.connected = false;
				logger.error({ err }, '[cache] Connection error');
			});
		} catch (err) {
			logger.error({ err }, '[cache] Failed to create client');
			this.connected = false;
		}
	}

	/**
	 * Disconnect from Valkey/Redis.
	 * Swallows errors — always safe to call.
	 */
	async disconnect(): Promise<void> {
		try {
			if (this.client) {
				await this.client.quit();
				logger.info('[cache] Disconnected');
			}
		} catch (err) {
			logger.error({ err }, '[cache] Error during disconnect');
		}
	}

	/**
	 * Check if the cache is currently connected
	 */
	get isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Get a value from cache. Returns null on miss or error (fail-open).
	 */
	async get<T>(namespace: string, key: string): Promise<T | null> {
		try {
			if (!this.client) return null;

			const fullKey = `${namespace}:${key}`;
			const value = await this.client.get(fullKey);

			if (!value) return null;

			return JSON.parse(value) as T;
		} catch (err) {
			logger.warn({ err, namespace, key }, '[cache] get failed (fail-open)');
			return null;
		}
	}

	/**
	 * Set a value in cache with namespace-specific TTL.
	 * Fails silently on error (fail-open).
	 */
	async set<T>(namespace: string, key: string, value: T): Promise<void> {
		try {
			if (!this.client) return;

			const fullKey = `${namespace}:${key}`;
			const ttl = DEFAULT_NAMESPACE_TTLS[namespace] ?? 300; // Default 5 minutes
			const serialized = JSON.stringify(value);

			await this.client.setex(fullKey, ttl, serialized);
		} catch (err) {
			logger.warn({ err, namespace, key }, '[cache] set failed (fail-open)');
		}
	}

	/**
	 * Delete a key from cache.
	 * Fails silently on error (fail-open).
	 */
	async del(namespace: string, key: string): Promise<void> {
		try {
			if (!this.client) return;

			const fullKey = `${namespace}:${key}`;
			await this.client.del(fullKey);
		} catch (err) {
			logger.warn({ err, namespace, key }, '[cache] del failed (fail-open)');
		}
	}

	/**
	 * Cache-aside pattern: return cached value if present, otherwise call fetcher,
	 * store result, and return it. Does NOT cache null results.
	 *
	 * If cache is down, falls back to calling fetcher directly (fail-open).
	 */
	async getOrFetch<T>(
		namespace: string,
		key: string,
		fetcher: () => Promise<T | null>
	): Promise<T | null> {
		try {
			// Try cache first
			const cached = await this.get<T>(namespace, key);
			if (cached !== null) return cached;

			// Cache miss or cache down — call fetcher
			const value = await fetcher();

			// Store in cache if not null
			if (value !== null) {
				await this.set(namespace, key, value);
			}

			return value;
		} catch (err) {
			logger.warn({ err, namespace, key }, '[cache] getOrFetch failed, calling fetcher');
			// Fail-open: call fetcher directly
			return fetcher();
		}
	}
}
