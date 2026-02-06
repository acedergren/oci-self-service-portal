/**
 * GET /api/v1/search - Semantic search across portal data using Oracle 26AI vector search.
 *
 * Query params:
 *   q     : Search query text (required)
 *   type  : Filter by reference type (optional: 'user_message', 'tool_result', etc.)
 *   limit : Max results (optional, default 10, max 50)
 *
 * Returns ranked results with cosine similarity scores.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiAuth, resolveOrgId } from '@portal/shared/server/api/require-auth.js';
import { generateEmbedding } from '@portal/shared/server/embeddings.js';
import { embeddingRepository } from '@portal/shared/server/oracle/repositories/embedding-repository.js';
import { createLogger } from '@portal/shared/server/logger.js';
import { toPortalError, errorResponse } from '@portal/shared/server/errors.js';

const log = createLogger('search-api');

export const GET: RequestHandler = async (event) => {
	requireApiAuth(event, 'sessions:read');

	const url = event.url;
	const query = url.searchParams.get('q');
	const refType = url.searchParams.get('type') ?? undefined;
	const limitParam = url.searchParams.get('limit');
	const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 10, 50) : 10;

	if (!query || query.trim().length === 0) {
		return json({ error: 'Query parameter "q" is required' }, { status: 400 });
	}

	const orgId = resolveOrgId(event);
	if (!orgId) {
		return json({ error: 'Organization context required for search' }, { status: 400 });
	}

	try {
		// Generate embedding for the search query
		const queryEmbedding = await generateEmbedding(query);

		if (!queryEmbedding) {
			// OCI GenAI unavailable — return empty results gracefully
			log.warn('embedding generation returned null, returning empty search results');
			return json({
				results: [],
				query,
				total: 0
			});
		}

		// Search for similar embeddings
		const results = await embeddingRepository.similaritySearch({
			embedding: queryEmbedding,
			orgId,
			limit,
			refType
		});

		log.info(
			{ query: query.substring(0, 50), resultCount: results.length, orgId },
			'search completed'
		);

		return json({
			results,
			query,
			total: results.length
		});
	} catch (err) {
		const portalErr = toPortalError(err, 'Search failed');
		log.error({ err: portalErr }, 'search request failed');
		return errorResponse(portalErr);
	}
};
