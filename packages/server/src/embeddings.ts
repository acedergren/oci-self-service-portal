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

import * as oci from 'oci-sdk';
import { createLogger } from './logger.js';
import { OCIError, ValidationError } from './errors.js';
import { wrapWithSpan } from './sentry.js';

const log = createLogger('embeddings');

const EMBEDDING_MODEL = 'cohere.embed-english-v3.0';
const EMBEDDING_DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 96; // OCI GenAI batch limit

/** Cached GenAI inference client (lazily created per region) */
let cachedClient: oci.generativeaiinference.GenerativeAiInferenceClient | null = null;
let cachedClientRegion: string | null = null;

/**
 * Get (or create) the cached OCI GenAI inference client.
 * Lazily initialised on first use; re-created if region changes.
 */
function getGenAiClient(region: string): oci.generativeaiinference.GenerativeAiInferenceClient {
	if (cachedClient && cachedClientRegion === region) {
		return cachedClient;
	}

	// Auto-detect auth strategy following the same pattern as sdk-auth.ts
	let provider: oci.common.AuthenticationDetailsProvider;

	if (process.env.OCI_RESOURCE_PRINCIPAL_VERSION) {
		// Resource principal — async init required; for now fall through to config-file
		// (resource principal async init handled at startup via initOCIAuth())
		provider = new oci.common.ConfigFileAuthenticationDetailsProvider();
	} else if (process.env.OCI_INSTANCE_PRINCIPAL) {
		provider = new oci.common.ConfigFileAuthenticationDetailsProvider();
	} else {
		const profile = process.env.OCI_CLI_PROFILE ?? 'DEFAULT';
		provider = new oci.common.ConfigFileAuthenticationDetailsProvider(undefined, profile);
	}

	cachedClient = new oci.generativeaiinference.GenerativeAiInferenceClient({
		authenticationDetailsProvider: provider
	});
	(cachedClient as unknown as { region: string }).region = region;
	cachedClientRegion = region;

	return cachedClient;
}

/**
 * Reset the cached GenAI client (for testing).
 */
export function resetGenAiClient(): void {
	cachedClient = null;
	cachedClientRegion = null;
}

/**
 * Inject a mock GenAI client (for testing only).
 * Must be called before generateEmbedding/generateEmbeddings.
 * Use resetGenAiClient() to clear the injected client after tests.
 */
export function __setGenAiClientForTesting(
	client: oci.generativeaiinference.GenerativeAiInferenceClient,
	region: string
): void {
	cachedClient = client;
	cachedClientRegion = region;
}

/**
 * Generate a single text embedding via OCI GenAI.
 *
 * @param text  The text to embed.
 * @returns A Float32Array of 1536 dimensions, or null if OCI GenAI is unavailable.
 * @throws ValidationError if text is empty.
 * @throws OCIError if the OCI SDK call fails with a non-transient error.
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
 * Call OCI GenAI embed-text API via the OCI SDK (GenerativeAiInferenceClient).
 *
 * Uses the cohere.embed-english-v3.0 model with ON_DEMAND serving mode.
 * Returns array of Float32Arrays, one per input text.
 */
async function callOCIEmbedAPI(texts: string[]): Promise<Float32Array[] | null> {
	const compartmentId = process.env.OCI_COMPARTMENT_ID;
	if (!compartmentId) {
		log.warn('OCI_COMPARTMENT_ID not set, skipping embedding generation');
		return null;
	}

	const region = process.env.OCI_REGION ?? process.env.OCI_CLI_REGION ?? 'eu-frankfurt-1';

	try {
		const client = getGenAiClient(region);

		const response = await client.embedText({
			embedTextDetails: {
				inputs: texts,
				servingMode: {
					servingType: 'ON_DEMAND',
					modelId: EMBEDDING_MODEL
				} as oci.generativeaiinference.models.OnDemandServingMode,
				compartmentId,
				truncate: oci.generativeaiinference.models.EmbedTextDetails.Truncate.End,
				inputType: oci.generativeaiinference.models.EmbedTextDetails.InputType.SearchDocument
			}
		});

		const embeddings = response.embedTextResult?.embeddings;

		if (!embeddings || !Array.isArray(embeddings)) {
			log.warn(
				{ resultKeys: Object.keys(response.embedTextResult ?? {}) },
				'unexpected embedding response shape'
			);
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
		const sdkError = err as {
			statusCode?: number;
			serviceCode?: string;
			message?: string;
			opcRequestId?: string;
		};

		const statusCode = sdkError.statusCode;
		const message = sdkError.message ?? String(err);

		// 401/403 — authorization errors are non-transient, throw
		if (statusCode === 401 || statusCode === 403 || message.includes('NotAuthorized')) {
			throw new OCIError(
				'Not authorized to call OCI GenAI embedding API',
				{
					service: 'generative-ai-inference',
					model: EMBEDDING_MODEL,
					region,
					statusCode,
					opcRequestId: sdkError.opcRequestId
				},
				err instanceof Error ? err : undefined
			);
		}

		// 503 — transient, degrade gracefully
		if (statusCode === 503 || message.includes('ServiceUnavailable')) {
			log.warn({ region, statusCode }, 'OCI GenAI embedding service unavailable');
			return null;
		}

		throw new OCIError(
			'OCI GenAI embedding call failed',
			{
				service: 'generative-ai-inference',
				model: EMBEDDING_MODEL,
				region,
				statusCode,
				serviceCode: sdkError.serviceCode,
				opcRequestId: sdkError.opcRequestId,
				errorMessage: message
			},
			err instanceof Error ? err : undefined
		);
	}
}
