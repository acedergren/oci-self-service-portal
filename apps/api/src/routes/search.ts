/**
 * GET /api/v1/search — Semantic search using Oracle 26AI vector embeddings.
 *
 * Uses the OracleVectorStore and OCI GenAI embedder registered by the Mastra plugin.
 * Searches the `conversation_embeddings` index (legacy table from migration 002).
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { embed } from 'ai';
import { requireAuth } from '../plugins/rbac.js';

const SearchQuerySchema = z.object({
	q: z.string().min(1, 'Query parameter "q" is required'),
	type: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(50).default(10)
});

const searchRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();

	app.get(
		'/api/v1/search',
		{
			preHandler: requireAuth('sessions:read'),
			schema: {
				querystring: SearchQuerySchema
			}
		},
		async (request, reply) => {
			const { q, type: refType, limit } = request.query;

			const vectorStore = fastify.vectorStore;
			const embedder = fastify.ociEmbedder;

			if (!vectorStore || !embedder) {
				return reply.code(503).send({
					error: 'Vector search unavailable — Oracle or embedder not configured'
				});
			}

			// Generate embedding for the search query using AI SDK
			let queryEmbedding: number[];
			try {
				const { embedding } = await embed({ model: embedder, value: q });
				if (!embedding || embedding.length === 0) {
					return reply.send({ results: [], query: q, total: 0 });
				}
				queryEmbedding = embedding;
			} catch {
				request.log.warn('Embedding generation failed, returning empty results');
				return reply.send({ results: [], query: q, total: 0 });
			}

			// Query the vector store
			const results = await vectorStore.query({
				indexName: 'conversation_embeddings',
				queryVector: queryEmbedding,
				topK: limit,
				filter: refType ? { ref_type: refType } : undefined
			});

			// Map to API response format
			const mapped = results.map((r) => ({
				id: r.id,
				score: r.score,
				content: r.document,
				metadata: r.metadata
			}));

			request.log.info(
				{ query: q.substring(0, 50), resultCount: mapped.length },
				'search completed'
			);

			return { results: mapped, query: q, total: mapped.length };
		}
	);
};

export default searchRoutes;
