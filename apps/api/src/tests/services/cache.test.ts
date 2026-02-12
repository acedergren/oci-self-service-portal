import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

class MockRedisClass {
	constructor(url?: string) {
		constructorCalls.push({ url });
		return mockClient as unknown as Redis;
	}
}

vi.mock('iovalkey', () => ({
	default: MockRedisClass
}));

describe('CacheService', () => {
	let CacheService: typeof import('../../services/cache.js').CacheService;

	beforeEach(async () => {
		vi.clearAllMocks();
		constructorCalls.length = 0; // Clear constructor call tracking
		mockClient.status = 'ready';
		mockClient.get.mockResolvedValue(null);
		mockClient.set.mockResolvedValue('OK');
		mockClient.setex.mockResolvedValue('OK');
		mockClient.del.mockResolvedValue(1);
		mockClient.quit.mockResolvedValue('OK');
		mockClient.on.mockReturnValue(mockClient); // Return mockClient for chaining

		// Dynamic import after mocks
		const mod = await import('../../services/cache.js');
		CacheService = mod.CacheService;
	});

	afterEach(() => {
		vi.resetModules();
	});

	describe('Connection', () => {
		it('should create client with provided URL', async () => {
			const service = new CacheService({ url: 'redis://test:6379' });
			await service.connect();

			expect(constructorCalls).toHaveLength(1);
			expect(constructorCalls[0]?.url).toBe('redis://test:6379');
		});

		it('should default to localhost when no URL provided', async () => {
			const service = new CacheService({});
			await service.connect();

			expect(constructorCalls).toHaveLength(1);
			expect(constructorCalls[0]?.url).toBeUndefined();
		});

		it('should set isConnected to true on ready event', async () => {
			let readyHandler: (() => void) | undefined;
			mockClient.on.mockImplementation((event: string, handler: () => void) => {
				if (event === 'ready') readyHandler = handler;
			});

			const service = new CacheService({});
			await service.connect();

			expect(service.isConnected).toBe(false);
			readyHandler?.();
			expect(service.isConnected).toBe(true);
		});

		it('should set isConnected to false on error event', async () => {
			let readyHandler: (() => void) | undefined;
			let errorHandler: ((err: Error) => void) | undefined;
			mockClient.on.mockImplementation(
				(event: string, handler: (() => void) | ((err: Error) => void)) => {
					if (event === 'ready') readyHandler = handler as () => void;
					if (event === 'error') errorHandler = handler as (err: Error) => void;
				}
			);

			const service = new CacheService({});
			await service.connect();

			readyHandler?.();
			expect(service.isConnected).toBe(true);

			errorHandler?.(new Error('Connection lost'));
			expect(service.isConnected).toBe(false);
		});
	});

	describe('get', () => {
		it('should return parsed JSON value', async () => {
			const service = new CacheService({});
			await service.connect();

			const testData = { foo: 'bar' };
			mockClient.get.mockResolvedValue(JSON.stringify(testData));

			const result = await service.get('session', 'key1');
			expect(result).toEqual(testData);
			expect(mockClient.get).toHaveBeenCalledWith('session:key1');
		});

		it('should return null for missing key', async () => {
			const service = new CacheService({});
			await service.connect();

			mockClient.get.mockResolvedValue(null);

			const result = await service.get('session', 'missing');
			expect(result).toBeNull();
		});

		it('should fail-open on disconnect', async () => {
			const service = new CacheService({});
			await service.connect();

			mockClient.get.mockRejectedValue(new Error('Connection refused'));

			const result = await service.get('session', 'key1');
			expect(result).toBeNull();
		});

		it('should fail-open on error', async () => {
			const service = new CacheService({});
			await service.connect();

			mockClient.get.mockRejectedValue(new Error('Parse error'));

			const result = await service.get('session', 'key1');
			expect(result).toBeNull();
		});
	});

	describe('set', () => {
		it('should store JSON with namespace-specific TTL', async () => {
			const service = new CacheService({});
			await service.connect();

			const testData = { foo: 'bar' };
			await service.set('session', 'key1', testData);

			expect(mockClient.setex).toHaveBeenCalledWith(
				'session:key1',
				600, // session TTL
				JSON.stringify(testData)
			);
		});

		it('should use different TTLs per namespace', async () => {
			const service = new CacheService({});
			await service.connect();

			await service.set('tool', 'key1', { data: 1 });
			expect(mockClient.setex).toHaveBeenCalledWith('tool:key1', 300, expect.any(String));

			await service.set('mcp', 'key2', { data: 2 });
			expect(mockClient.setex).toHaveBeenCalledWith('mcp:key2', 1800, expect.any(String));
		});

		it('should fail-open on error', async () => {
			const service = new CacheService({});
			await service.connect();

			mockClient.setex.mockRejectedValue(new Error('Connection refused'));

			await expect(service.set('session', 'key1', { foo: 'bar' })).resolves.toBeUndefined();
		});
	});

	describe('del', () => {
		it('should delete key with namespace prefix', async () => {
			const service = new CacheService({});
			await service.connect();

			await service.del('session', 'key1');

			expect(mockClient.del).toHaveBeenCalledWith('session:key1');
		});

		it('should fail-open on error', async () => {
			const service = new CacheService({});
			await service.connect();

			mockClient.del.mockRejectedValue(new Error('Connection refused'));

			await expect(service.del('session', 'key1')).resolves.toBeUndefined();
		});
	});

	describe('getOrFetch', () => {
		it('should return cached value on hit', async () => {
			const service = new CacheService({});
			await service.connect();

			const cachedData = { cached: true };
			mockClient.get.mockResolvedValue(JSON.stringify(cachedData));

			const fetcher = vi.fn();
			const result = await service.getOrFetch('session', 'key1', fetcher);

			expect(result).toEqual(cachedData);
			expect(fetcher).not.toHaveBeenCalled();
		});

		it('should call fetcher on miss and store result', async () => {
			const service = new CacheService({});
			await service.connect();

			mockClient.get.mockResolvedValue(null);

			const fetchedData = { fetched: true };
			const fetcher = vi.fn().mockResolvedValue(fetchedData);

			const result = await service.getOrFetch('session', 'key1', fetcher);

			expect(result).toEqual(fetchedData);
			expect(fetcher).toHaveBeenCalled();
			expect(mockClient.setex).toHaveBeenCalledWith(
				'session:key1',
				600,
				JSON.stringify(fetchedData)
			);
		});

		it('should call fetcher when Valkey is down', async () => {
			const service = new CacheService({});
			await service.connect();

			mockClient.get.mockRejectedValue(new Error('Connection refused'));

			const fetchedData = { fetched: true };
			const fetcher = vi.fn().mockResolvedValue(fetchedData);

			const result = await service.getOrFetch('session', 'key1', fetcher);

			expect(result).toEqual(fetchedData);
			expect(fetcher).toHaveBeenCalled();
		});

		it('should not cache null results', async () => {
			const service = new CacheService({});
			await service.connect();

			mockClient.get.mockResolvedValue(null);

			const fetcher = vi.fn().mockResolvedValue(null);

			const result = await service.getOrFetch('session', 'key1', fetcher);

			expect(result).toBeNull();
			expect(fetcher).toHaveBeenCalled();
			expect(mockClient.setex).not.toHaveBeenCalled();
		});
	});

	describe('disconnect', () => {
		it('should call quit on client', async () => {
			const service = new CacheService({});
			await service.connect();

			await service.disconnect();

			expect(mockClient.quit).toHaveBeenCalled();
		});

		it('should handle quit errors gracefully', async () => {
			const service = new CacheService({});
			await service.connect();

			mockClient.quit.mockRejectedValue(new Error('Already closed'));

			await expect(service.disconnect()).resolves.toBeUndefined();
		});
	});
});
