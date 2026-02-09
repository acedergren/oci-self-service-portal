/**
 * OCI GenAI Embedding Pipeline.
 *
 * Generates text embeddings via OCI GenAI (cohere.embed-english-v3.0)
 * for use with Oracle 26AI VECTOR columns and Mastra's Memory semantic recall.
 *
 * Returns number[] (not Float32Array) for Mastra compatibility.
 * Graceful degradation: returns null when OCI GenAI is unavailable.
 */

import { OCIError, ValidationError } from '@portal/shared';

const EMBEDDING_MODEL = 'cohere.embed-english-v3.0';
const EMBEDDING_DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 96; // OCI GenAI batch limit

/**
 * Create a Mastra-compatible embedder function.
 *
 * Returns an async function: (text: string) => Promise<number[]>
 * suitable for Mastra Memory's `embedder` option.
 */
export function createOCIEmbedder(config?: {
	region?: string;
	compartmentId?: string;
}): (values: { value: string[] }) => Promise<{ embeddings: number[][] }> {
	const region = config?.region ?? process.env.OCI_REGION ?? 'eu-frankfurt-1';
	const compartmentId = config?.compartmentId ?? process.env.OCI_COMPARTMENT_ID;

	return async function ociEmbed(values: { value: string[] }): Promise<{ embeddings: number[][] }> {
		const results = await generateEmbeddings(values.value, {
			region,
			compartmentId
		});
		// Replace nulls with zero vectors (Mastra expects all embeddings)
		const embeddings = results.map((r) => r ?? new Array(EMBEDDING_DIMENSIONS).fill(0));
		return { embeddings };
	};
}

/**
 * Generate a single text embedding via OCI GenAI.
 *
 * @returns A number[] of 1536 dimensions, or null if OCI GenAI is unavailable.
 * @throws ValidationError if text is empty.
 * @throws OCIError if the OCI CLI call fails with a non-transient error.
 */
export async function generateEmbedding(
	text: string,
	opts?: { region?: string; compartmentId?: string }
): Promise<number[] | null> {
	if (!text || text.trim().length === 0) {
		throw new ValidationError('Cannot generate embedding for empty text', {
			field: 'text'
		});
	}

	try {
		const result = await callOCIEmbedAPI([text], opts);
		if (!result || result.length === 0) return null;
		return result[0];
	} catch (err) {
		if (err instanceof ValidationError) throw err;
		if (err instanceof OCIError) throw err;
		return null;
	}
}

/**
 * Generate embeddings for multiple texts in batches.
 *
 * Batches up to 96 texts per API call (OCI GenAI limit).
 * Returns number[][] in the same order as input.
 * Individual failures within a batch return null for that entry.
 */
export async function generateEmbeddings(
	texts: string[],
	opts?: { region?: string; compartmentId?: string }
): Promise<(number[] | null)[]> {
	if (texts.length === 0) return [];

	const results: (number[] | null)[] = [];

	for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
		const batch = texts.slice(i, i + MAX_BATCH_SIZE);
		try {
			const batchResults = await callOCIEmbedAPI(batch, opts);
			if (batchResults) {
				results.push(...batchResults);
			} else {
				results.push(...new Array<null>(batch.length).fill(null));
			}
		} catch {
			results.push(...new Array<null>(batch.length).fill(null));
		}
	}

	return results;
}

/**
 * Call OCI GenAI embed-text API via OCI CLI.
 * Returns array of number[], one per input text.
 */
async function callOCIEmbedAPI(
	texts: string[],
	opts?: { region?: string; compartmentId?: string }
): Promise<number[][] | null> {
	const { execFile } = await import('child_process');
	const { promisify } = await import('util');
	const execFileAsync = promisify(execFile);

	const compartmentId = opts?.compartmentId ?? process.env.OCI_COMPARTMENT_ID;
	if (!compartmentId) {
		return null;
	}

	const region = opts?.region ?? process.env.OCI_REGION ?? 'eu-frankfurt-1';

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

		let parsed: { data?: { embeddings?: number[][] }; embeddings?: number[][] };
		try {
			parsed = JSON.parse(stdout);
		} catch {
			throw new OCIError('OCI CLI returned invalid JSON for embed-text', {
				service: 'generative-ai-inference',
				model: EMBEDDING_MODEL,
				stdoutLength: stdout.length
			});
		}
		const embeddings = parsed.data?.embeddings ?? parsed.embeddings;

		if (!embeddings || !Array.isArray(embeddings)) {
			return null;
		}

		return embeddings.map((emb: number[]) => {
			if (emb.length !== EMBEDDING_DIMENSIONS) {
				// Log dimension mismatch but still return the embedding
			}
			return emb; // Already number[] — no Float32Array conversion needed
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);

		if (message.includes('NotAuthorized') || message.includes('403')) {
			throw new OCIError('Not authorized to call OCI GenAI embedding API', {
				service: 'generative-ai-inference',
				model: EMBEDDING_MODEL,
				region
			});
		}

		if (message.includes('ServiceUnavailable') || message.includes('503')) {
			return null;
		}

		throw new OCIError('OCI GenAI embedding call failed', {
			service: 'generative-ai-inference',
			model: EMBEDDING_MODEL,
			region,
			errorMessage: message
		});
	}
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, MAX_BATCH_SIZE };
