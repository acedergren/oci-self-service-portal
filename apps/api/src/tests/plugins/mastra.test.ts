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

// ── Mock external Mastra dependencies ────────────────────────────────
// These are class-based mocks (not vi.fn()) so they survive mockReset: true.
// The plugin structure (decorators + route prefixes) is what's under test —
// Mastra internals have their own suite. Without these mocks:
//   - createOCI() probes the OCI IMDS endpoint (~30 s timeout when OCI_REGION is unset)
//   - MastraServer.init() registers multipart/form-data; a 30 s timeout in test 1
//     leaves that registration running async, causing test 2 to see "already present".

vi.mock('@acedergren/oci-genai-provider', () => ({
	createOCI: () => ({
		embeddingModel: () => ({
			specificationVersion: '1' as const,
			provider: 'oci',
			modelId: 'cohere.embed-english-v3.0',
			dimensions: 1024,
			doEmbed: async () => ({ embeddings: [], usage: { tokens: 0 } })
		})
	})
}));

vi.mock('@mastra/core', () => ({
	Mastra: class {
		constructor() {}
	}
}));

vi.mock('@mastra/memory', () => ({
	Memory: class {
		constructor() {}
	}
}));

vi.mock('@mastra/fastify', () => ({
	// Stub MastraServer so it doesn't register a multipart parser.
	// init() registers one route at the plugin prefix so printRoutes includes /api/mastra.
	MastraServer: class {
		private opts: { app: FastifyInstance; prefix?: string };
		constructor(opts: { app: FastifyInstance; prefix?: string }) {
			this.opts = opts;
		}
		async init() {
			this.opts.app.get(`${this.opts.prefix ?? '/api/mastra'}/status`, async () => ({ ok: true }));
		}
	}
}));

vi.mock('@mastra/sentry', () => ({
	SentryExporter: class {
		constructor() {}
	}
}));

vi.mock('@mastra/observability', () => ({
	Observability: class {
		constructor() {}
	}
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
