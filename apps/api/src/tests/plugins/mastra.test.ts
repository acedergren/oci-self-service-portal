import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ── Mock logger ──────────────────────────────────────────────────────
vi.mock('@portal/shared/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

describe('mastra plugin', () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) {
			await app.close();
		}
	});

	// ── Basic Registration Tests ────────────────────────────────────────
	//
	// These tests verify the plugin can register and decorate the Fastify
	// instance without crashing. Deep testing of Mastra internals is
	// deferred to Mastra's own test suite.

	describe('plugin registration', () => {
		it('should register successfully and decorate fastify instance', async () => {
			app = Fastify({ logger: false });

			const { default: mastraPlugin } = await import('../../plugins/mastra.js');
			await app.register(mastraPlugin);
			await app.ready();

			// Verify decorators are present
			expect(app).toHaveProperty('mastra');
			expect(app).toHaveProperty('mcpConnectionManager');
			expect(app).toHaveProperty('ociEmbedder');
		});

		it('should register routes under /api/mastra prefix', async () => {
			app = Fastify({ logger: false });

			const { default: mastraPlugin } = await import('../../plugins/mastra.js');
			await app.register(mastraPlugin);
			await app.ready();

			// Check that Mastra routes are registered
			const routes = app.printRoutes({ commonPrefix: false });
			expect(routes).toContain('/api/mastra');
		});
	});
});
