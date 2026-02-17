/**
 * Route tests for semantic search endpoint.
 *
 * Tests:
 * - GET /api/v1/search — vector search with embedding generation
 * - 503 when vectorStore or embedder not configured
 * - Graceful fallback to empty results on embedding failure
 * - Auth (401/403) and validation (400) guards
 *
 * Requires sessions:read permission.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, simulateSession } from './test-helpers.js';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockEmbed = vi.fn();

vi.mock('ai', () => ({
	embed: (...args: unknown[]) => mockEmbed(...args)
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

// ── Test data ─────────────────────────────────────────────────────────────

const MOCK_EMBEDDING = [0.1, 0.2, 0.3, 0.4, 0.5];

const MOCK_VECTOR_RESULTS = [
	{
		id: 'doc-1',
		score: 0.95,
		document: 'How to create a compute instance',
		metadata: { ref_type: 'session', session_id: 's-1' }
	},
	{
		id: 'doc-2',
		score: 0.82,
		document: 'Configuring VCN networking',
		metadata: { ref_type: 'session', session_id: 's-2' }
	}
];

// ── Helpers ───────────────────────────────────────────────────────────────

let app: FastifyInstance;

const mockVectorStore = {
	query: vi.fn()
};

const mockEmbedder = { modelId: 'test-embedder' };

async function buildSearchApp(options?: { withVectorStore?: boolean }): Promise<FastifyInstance> {
	const withVS = options?.withVectorStore ?? true;
	const a = await buildTestApp({ withRbac: true });
	simulateSession(a, { id: 'user-1' }, ['sessions:read']);

	// Decorate with vector store and embedder (simulating Mastra plugin)
	if (withVS) {
		a.decorate('vectorStore', mockVectorStore);
		a.decorate('ociEmbedder', mockEmbedder);
	} else {
		a.decorate('vectorStore', null);
		a.decorate('ociEmbedder', null);
	}

	const searchRoutes = (await import('../../routes/search.js')).default;
	await a.register(searchRoutes);
	await a.ready();
	return a;
}

beforeEach(() => {
	mockEmbed.mockResolvedValue({ embedding: MOCK_EMBEDDING });
	mockVectorStore.query.mockResolvedValue(MOCK_VECTOR_RESULTS);
});

afterEach(async () => {
	if (app) await app.close();
});

// ── GET /api/v1/search ──────────────────────────────────────────────────

describe('GET /api/v1/search', () => {
	it('returns 200 with search results', async () => {
		app = await buildSearchApp();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/search?q=compute+instance'
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.query).toBe('compute instance');
		expect(body.total).toBe(2);
		expect(body.results).toHaveLength(2);
		expect(body.results[0]).toEqual({
			id: 'doc-1',
			score: 0.95,
			content: 'How to create a compute instance',
			metadata: { ref_type: 'session', session_id: 's-1' }
		});
	});

	it('passes query embedding to vector store', async () => {
		app = await buildSearchApp();

		await app.inject({
			method: 'GET',
			url: '/api/v1/search?q=networking'
		});

		expect(mockEmbed).toHaveBeenCalledWith(
			expect.objectContaining({ model: mockEmbedder, value: 'networking' })
		);
		expect(mockVectorStore.query).toHaveBeenCalledWith(
			expect.objectContaining({
				indexName: 'conversation_embeddings',
				queryVector: MOCK_EMBEDDING,
				topK: 10
			})
		);
	});

	it('applies type filter when provided', async () => {
		app = await buildSearchApp();

		await app.inject({
			method: 'GET',
			url: '/api/v1/search?q=networking&type=session'
		});

		expect(mockVectorStore.query).toHaveBeenCalledWith(
			expect.objectContaining({ filter: { ref_type: 'session' } })
		);
	});

	it('respects custom limit', async () => {
		app = await buildSearchApp();

		await app.inject({
			method: 'GET',
			url: '/api/v1/search?q=networking&limit=5'
		});

		expect(mockVectorStore.query).toHaveBeenCalledWith(expect.objectContaining({ topK: 5 }));
	});

	it('returns 503 when vector store is not configured', async () => {
		app = await buildSearchApp({ withVectorStore: false });

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/search?q=test'
		});

		expect(res.statusCode).toBe(503);
		expect(res.json().error).toContain('Vector search unavailable');
	});

	it('returns empty results when embedding generation fails', async () => {
		mockEmbed.mockRejectedValue(new Error('Embedder down'));
		app = await buildSearchApp();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/search?q=test'
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.results).toEqual([]);
		expect(body.total).toBe(0);
	});

	it('returns empty results when embedding is empty', async () => {
		mockEmbed.mockResolvedValue({ embedding: [] });
		app = await buildSearchApp();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/search?q=test'
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().results).toEqual([]);
	});

	it('returns 400 when q parameter is missing', async () => {
		app = await buildSearchApp();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/search'
		});

		expect(res.statusCode).toBe(400);
	});

	it('returns 401 for unauthenticated request', async () => {
		app = await buildTestApp({ withRbac: true });
		app.decorate('vectorStore', mockVectorStore);
		app.decorate('ociEmbedder', mockEmbedder);
		const searchRoutes = (await import('../../routes/search.js')).default;
		await app.register(searchRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/search?q=test'
		});
		expect(res.statusCode).toBe(401);
	});

	it('returns 403 for user without sessions:read permission', async () => {
		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		app.decorate('vectorStore', mockVectorStore);
		app.decorate('ociEmbedder', mockEmbedder);
		const searchRoutes = (await import('../../routes/search.js')).default;
		await app.register(searchRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/search?q=test'
		});
		expect(res.statusCode).toBe(403);
	});
});
