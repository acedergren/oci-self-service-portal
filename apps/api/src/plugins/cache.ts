import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { CacheService } from '../services/cache.js';

export interface CachePluginOptions {
	url?: string;
}

/**
 * Augment FastifyInstance to include cache decorator
 */
declare module 'fastify' {
	interface FastifyInstance {
		cache: {
			get: <T>(namespace: string, key: string) => Promise<T | null>;
			set: <T>(namespace: string, key: string, value: T) => Promise<void>;
			del: (namespace: string, key: string) => Promise<void>;
			getOrFetch: <T>(
				namespace: string,
				key: string,
				fetcher: () => Promise<T | null>
			) => Promise<T | null>;
			isConnected: boolean;
		};
	}
}

/**
 * Valkey cache plugin with fail-open behavior.
 * Decorates fastify.cache with get/set/del/getOrFetch and isConnected.
 * App continues to boot even if Valkey is unreachable.
 */
const cachePlugin: FastifyPluginAsync<CachePluginOptions> = async (fastify, options) => {
	const url = options.url ?? process.env.VALKEY_URL;
	const service = new CacheService({ url });

	// Connect (fail-open — errors logged but not thrown)
	await service.connect();

	// Decorate fastify instance
	fastify.decorate('cache', {
		get: async <T>(namespace: string, key: string) => service.get<T>(namespace, key),
		set: async <T>(namespace: string, key: string, value: T) => service.set(namespace, key, value),
		del: async (namespace: string, key: string) => service.del(namespace, key),
		getOrFetch: async <T>(namespace: string, key: string, fetcher: () => Promise<T | null>) =>
			service.getOrFetch<T>(namespace, key, fetcher),
		get isConnected() {
			return service.isConnected;
		}
	});

	// Disconnect on server close with 5s timeout
	fastify.addHook('onClose', async () => {
		const timeoutPromise = new Promise<void>((resolve) => {
			setTimeout(() => {
				fastify.log.warn('[cache] Disconnect timeout after 5s');
				resolve();
			}, 5000);
		});

		await Promise.race([service.disconnect(), timeoutPromise]);
	});
};

export default fp(cachePlugin, {
	name: 'cache',
	fastify: '5.x'
});
