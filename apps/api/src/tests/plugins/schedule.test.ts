import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

// Mock logger (required — mockReset: true clears between tests)
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

describe('schedule plugin', () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) {
			await app.close();
		}
	});

	// Helper to create a minimal Fastify app with oracle decorator (schedule depends on it)
	function createAppWithOracle(oracleAvailable = true) {
		const instance = Fastify({ logger: false });

		// Schedule plugin declares 'oracle' dependency, so register a mock oracle plugin
		const mockOraclePlugin = fp(
			async (fastify) => {
				fastify.decorate('oracle', {
					isAvailable: vi.fn().mockReturnValue(oracleAvailable)
				});
			},
			{ name: 'oracle', fastify: '5.x' }
		);

		instance.register(mockOraclePlugin);
		return instance;
	}

	describe('registration', () => {
		it('should register successfully and decorate with scheduler', async () => {
			app = createAppWithOracle();

			const { default: schedulePlugin } = await import('../../plugins/schedule.js');
			await app.register(schedulePlugin);
			await app.ready();

			// @fastify/schedule decorates with 'scheduler'
			expect(app).toHaveProperty('scheduler');
		});

		it('should register two cron jobs (health-check-ping and stale-session-cleanup)', async () => {
			app = createAppWithOracle();

			const { default: schedulePlugin } = await import('../../plugins/schedule.js');
			await app.register(schedulePlugin);
			await app.ready();

			// toad-scheduler (used by @fastify/schedule) exposes getAllJobs() for introspection
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const allJobs: unknown[] = (app.scheduler as any).getAllJobs?.() ?? [];
			expect(allJobs).toHaveLength(2);
		});

		it('should boot even when oracle is unavailable', async () => {
			app = createAppWithOracle(false);

			const { default: schedulePlugin } = await import('../../plugins/schedule.js');
			await app.register(schedulePlugin);

			// Should not throw during registration
			await expect(app.ready()).resolves.toBeDefined();
		});
	});

	describe('cleanup', () => {
		it('should stop scheduler on close without error', async () => {
			app = createAppWithOracle();

			const { default: schedulePlugin } = await import('../../plugins/schedule.js');
			await app.register(schedulePlugin);
			await app.ready();

			// Close should not throw (scheduler cleanup is handled by @fastify/schedule)
			await expect(app.close()).resolves.toBeUndefined();
		});
	});
});
