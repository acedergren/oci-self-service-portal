import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type Redis from 'iovalkey';

// Mock logger
vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

// Mock iovalkey with forwarding pattern
const mockClient = {
	get: vi.fn(),
	set: vi.fn(),
	setex: vi.fn(),
	del: vi.fn(),
	quit: vi.fn(),
	on: vi.fn(),
	status: 'ready' as const
};

// Constructor tracking
const constructorCalls: Array<{ url?: string }> = [];
let shouldThrowOnConstruct = false;

class MockRedisClass {
	constructor(url?: string) {
		if (shouldThrowOnConstruct) {
			throw new Error('Connection refused');
		}
		constructorCalls.push({ url });
		return mockClient as unknown as Redis;
	}
}

vi.mock('iovalkey', () => ({
	default: MockRedisClass
}));

describe('cache plugin', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		vi.clearAllMocks();
		constructorCalls.length = 0; // Clear constructor call tracking
		shouldThrowOnConstruct = false; // Reset throw flag
		mockClient.status = 'ready';
		mockClient.get.mockResolvedValue(null);
		mockClient.set.mockResolvedValue('OK');
		mockClient.setex.mockResolvedValue('OK');
		mockClient.del.mockResolvedValue(1);
		mockClient.quit.mockResolvedValue('OK');
		mockClient.on.mockReturnValue(mockClient); // Return mockClient for chaining

		app = Fastify({ logger: false });
	});

	afterEach(async () => {
		await app.close();
		vi.resetModules();
	});

	describe('Decoration', () => {
		it('should decorate app.cache with get/set/del/getOrFetch', async () => {
			const cachePlugin = await import('../../plugins/cache.js');
			await app.register(cachePlugin.default);

			expect(app.cache).toBeDefined();
			expect(app.cache.get).toBeInstanceOf(Function);
			expect(app.cache.set).toBeInstanceOf(Function);
			expect(app.cache.del).toBeInstanceOf(Function);
			expect(app.cache.getOrFetch).toBeInstanceOf(Function);
		});

		it('should expose isConnected property', async () => {
			const cachePlugin = await import('../../plugins/cache.js');
			await app.register(cachePlugin.default);

			expect(typeof app.cache.isConnected).toBe('boolean');
		});
	});

	describe('Lifecycle', () => {
		it('should call disconnect on server close', async () => {
			const cachePlugin = await import('../../plugins/cache.js');
			await app.register(cachePlugin.default);
			await app.ready();

			await app.close();

			expect(mockClient.quit).toHaveBeenCalled();
		});

		it('should survive Valkey connection failure on startup', async () => {
			shouldThrowOnConstruct = true;

			const cachePlugin = await import('../../plugins/cache.js');

			// Plugin should register successfully (fail-open)
			await app.register(cachePlugin.default);

			// Cache should be decorated but not connected
			expect(app.cache).toBeDefined();
			expect(app.cache.isConnected).toBe(false);

			// App should still be usable (fail-open behavior)
			const result = await app.cache.get('test', 'key');
			expect(result).toBeNull();
		});
	});

	describe('Configuration', () => {
		it('should read VALKEY_URL from env when option not provided', async () => {
			const originalEnv = process.env.VALKEY_URL;
			process.env.VALKEY_URL = 'redis://env-test:6379';

			const cachePlugin = await import('../../plugins/cache.js');
			await app.register(cachePlugin.default);

			expect(constructorCalls).toHaveLength(1);
			expect(constructorCalls[0]?.url).toBe('redis://env-test:6379');

			// Restore
			if (originalEnv) {
				process.env.VALKEY_URL = originalEnv;
			} else {
				delete process.env.VALKEY_URL;
			}
		});

		it('should use provided url option over env', async () => {
			const originalEnv = process.env.VALKEY_URL;
			process.env.VALKEY_URL = 'redis://env-test:6379';

			const cachePlugin = await import('../../plugins/cache.js');
			await app.register(cachePlugin.default, { url: 'redis://option-test:6379' });

			expect(constructorCalls).toHaveLength(1);
			expect(constructorCalls[0]?.url).toBe('redis://option-test:6379');

			// Restore
			if (originalEnv) {
				process.env.VALKEY_URL = originalEnv;
			} else {
				delete process.env.VALKEY_URL;
			}
		});
	});

	describe('Integration', () => {
		it('should allow setting and getting values through decorated methods', async () => {
			const cachePlugin = await import('../../plugins/cache.js');
			await app.register(cachePlugin.default);
			await app.ready();

			const testData = { test: 'value' };
			mockClient.setex.mockResolvedValue('OK');
			mockClient.get.mockResolvedValue(JSON.stringify(testData));

			await app.cache.set('session', 'key1', testData);
			const result = await app.cache.get('session', 'key1');

			expect(result).toEqual(testData);
		});

		it('should support getOrFetch pattern', async () => {
			const cachePlugin = await import('../../plugins/cache.js');
			await app.register(cachePlugin.default);
			await app.ready();

			mockClient.get.mockResolvedValue(null);

			const fetchedData = { fetched: true };
			const fetcher = vi.fn().mockResolvedValue(fetchedData);

			const result = await app.cache.getOrFetch('session', 'key1', fetcher);

			expect(result).toEqual(fetchedData);
			expect(fetcher).toHaveBeenCalled();
		});
	});
});
