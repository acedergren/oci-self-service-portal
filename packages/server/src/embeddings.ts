/**
 * OCI GenAI Embedding Pipeline for Oracle 26AI Vector Search.
 *
 * Generates text embeddings via OCI GenAI (cohere.embed-english-v3.0)
 * and stores them in Oracle 26AI VECTOR(1536, FLOAT32) columns for
 * similarity search.
 *
 * Graceful degradation: returns null when OCI GenAI is unavailable,
 * so callers can skip embedding without breaking the request path.
 */

import { createLogger } from './logger';
import { OCIError, ValidationError } from './errors';
import { wrapWithSpan } from './sentry';

const log = createLogger('embeddings');

const EMBEDDING_MODEL = 'cohere.embed-english-v3.0';
const EMBEDDING_DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 96; // OCI GenAI batch limit

/**
 * Generate a single text embedding via OCI GenAI.
 *
 * @param text  The text to embed.
 * @returns A Float32Array of 1536 dimensions, or null if OCI GenAI is unavailable.
 * @throws ValidationError if text is empty.
 * @throws OCIError if the OCI CLI call fails with a non-transient error.
 */
export async function generateEmbedding(text: string): Promise<Float32Array | null> {
	if (!text || text.trim().length === 0) {
		throw new ValidationError('Cannot generate embedding for empty text', { field: 'text' });
	}

	return wrapWithSpan('embeddings.generate', 'ai', async () => {
		try {
			const result = await callOCIEmbedAPI([text]);
			if (!result || result.length === 0) return null;
			return result[0];
		} catch (err) {
			if (err instanceof ValidationError) throw err;
			log.warn({ err }, 'OCI GenAI embedding generation failed, returning null');
			return null;
		}
	});
}

/**
 * Generate embeddings for multiple texts in batches.
 *
 * Batches up to 96 texts per API call (OCI GenAI limit).
 * Returns an array of Float32Arrays in the same order as input.
 * Individual failures within a batch return null for that entry.
 *
 * @param texts  Array of texts to embed.
 * @returns Array of Float32Array (1536 dims) or null for failed entries.
 */
export async function generateEmbeddings(texts: string[]): Promise<(Float32Array | null)[]> {
	if (texts.length === 0) return [];

	return wrapWithSpan('embeddings.generateBatch', 'ai', async () => {
		const results: (Float32Array | null)[] = [];

		for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
			const batch = texts.slice(i, i + MAX_BATCH_SIZE);
			try {
				const batchResults = await callOCIEmbedAPI(batch);
				if (batchResults) {
					results.push(...batchResults);
				} else {
					results.push(...Array.from({ length: batch.length }, () => null));
				}
			} catch (err) {
				log.warn({ err, batchStart: i, batchSize: batch.length }, 'batch embedding failed');
				results.push(...Array.from({ length: batch.length }, () => null));
			}
		}

		return results;
	});
}

/**
 * Call OCI GenAI embed-text API via OCI CLI.
 *
 * Uses `oci generative-ai-inference embed-text` with the cohere model.
 * Returns array of Float32Arrays, one per input text.
 */
async function callOCIEmbedAPI(texts: string[]): Promise<Float32Array[] | null> {
	const { execFile } = await import('child_process');
	const { promisify } = await import('util');
	const execFileAsync = promisify(execFile);

	const compartmentId = process.env.OCI_COMPARTMENT_ID;
	if (!compartmentId) {
		log.warn('OCI_COMPARTMENT_ID not set, skipping embedding generation');
		return null;
	}

	const region = process.env.OCI_REGION || 'eu-frankfurt-1';

	// Build the embed-text input JSON
	const inputPayload = JSON.stringify({
		inputs: texts,
		servingMode: {
			servingType: 'ON_DEMAND',
			modelId: EMBEDDING_MODEL
		},
		truncate: 'END',
		inputType: 'SEARCH_DOCUMENT',
		compartmentId
	});

	try {
		const { stdout } = await execFileAsync(
			'oci',
			[
				'generative-ai-inference',
				'embed-text',
				'--embed-text-details',
				inputPayload,
				'--region',
				region,
				'--output',
				'json'
			],
			{
				timeout: 30000,
				maxBuffer: 10 * 1024 * 1024 // 10MB for large batch responses
			}
		);

		const response = JSON.parse(stdout);
		const embeddings = response.data?.embeddings ?? response.embeddings;

		if (!embeddings || !Array.isArray(embeddings)) {
			log.warn({ responseKeys: Object.keys(response) }, 'unexpected embedding response shape');
			return null;
		}

		return embeddings.map((emb: number[]) => {
			if (emb.length !== EMBEDDING_DIMENSIONS) {
				log.warn(
					{ actual: emb.length, expected: EMBEDDING_DIMENSIONS },
					'unexpected embedding dimensions'
				);
			}
			return new Float32Array(emb);
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);

		// Check for specific OCI errors
		if (message.includes('NotAuthorized') || message.includes('403')) {
			throw new OCIError(
				'Not authorized to call OCI GenAI embedding API',
				{
					service: 'generative-ai-inference',
					model: EMBEDDING_MODEL,
					region
				},
				err instanceof Error ? err : undefined
			);
		}

		if (message.includes('ServiceUnavailable') || message.includes('503')) {
			log.warn({ region }, 'OCI GenAI embedding service unavailable');
			return null;
		}

		throw new OCIError(
			'OCI GenAI embedding call failed',
			{
				service: 'generative-ai-inference',
				model: EMBEDDING_MODEL,
				region,
				errorMessage: message
			},
			err instanceof Error ? err : undefined
		);
	}
}
