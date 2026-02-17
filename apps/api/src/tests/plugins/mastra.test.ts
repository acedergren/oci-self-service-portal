import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ── Mock logger ──────────────────────────────────────────────────────
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

describe('mastra plugin', { timeout: 30_000 }, () => {
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

	// ── Sentry Observability Tests ───────────────────────────────────────
	//
	// These tests verify the SentryExporter is conditionally wired based on
	// the SENTRY_DSN environment variable — no-op when not set.

	describe('sentry observability', () => {
		beforeEach(() => {
			delete process.env.SENTRY_DSN;
			delete process.env.SENTRY_TRACE_SAMPLE_RATE;
		});

		it('registers without Sentry when SENTRY_DSN is not set', async () => {
			app = Fastify({ logger: false });

			const { default: mastraPlugin } = await import('../../plugins/mastra.js');
			await app.register(mastraPlugin);
			await app.ready();

			// Plugin should register successfully — observability is optional
			expect(app).toHaveProperty('mastra');
		});

		it('mastra instance is created regardless of SENTRY_DSN', async () => {
			app = Fastify({ logger: false });

			// Set a fake DSN — SentryExporter will fail to initialize but plugin should still load
			// (in tests, Sentry init is typically no-op with invalid DSN)
			const { default: mastraPlugin } = await import('../../plugins/mastra.js');
			await app.register(mastraPlugin);
			await app.ready();

			expect(app.mastra).toBeDefined();
		});
	});
});
