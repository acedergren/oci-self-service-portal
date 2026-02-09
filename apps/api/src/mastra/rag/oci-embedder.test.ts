import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted ensures mockExecFile is accessible inside vi.mock factories
const { mockExecFile } = vi.hoisted(() => ({
	mockExecFile: vi.fn()
}));

vi.mock('child_process', () => ({
	execFile: mockExecFile
}));
vi.mock('util', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		promisify: () => mockExecFile
	};
});

import {
	createOCIEmbedder,
	generateEmbedding,
	generateEmbeddings,
	EMBEDDING_DIMENSIONS,
	MAX_BATCH_SIZE
} from './oci-embedder.js';

describe('OCI GenAI Embedder', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = {
			...originalEnv,
			OCI_REGION: 'eu-frankfurt-1',
			OCI_COMPARTMENT_ID: 'ocid1.compartment.test'
		};
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	// ── generateEmbedding ──────────────────────────────────────────────

	describe('generateEmbedding', () => {
		it('returns a number[] of 1536 dimensions', async () => {
			const fakeEmbedding = new Array(1536).fill(0.1);
			mockExecFile.mockResolvedValueOnce({
				stdout: JSON.stringify({
					data: { embeddings: [fakeEmbedding] }
				})
			});

			const result = await generateEmbedding('hello world');

			expect(result).toHaveLength(1536);
			expect(typeof result![0]).toBe('number');
		});

		it('throws ValidationError for empty text', async () => {
			await expect(generateEmbedding('')).rejects.toThrow(/empty text/);
			await expect(generateEmbedding('   ')).rejects.toThrow(/empty text/);
		});

		it('returns null when OCI GenAI is unavailable (503)', async () => {
			mockExecFile.mockRejectedValueOnce(new Error('ServiceUnavailable: 503'));

			const result = await generateEmbedding('hello');
			expect(result).toBeNull();
		});

		it('throws OCIError for authorization failures (403)', async () => {
			mockExecFile.mockRejectedValueOnce(new Error('NotAuthorized: 403 Forbidden'));

			await expect(generateEmbedding('hello')).rejects.toThrow(/Not authorized/);
		});

		it('returns null when compartmentId is not configured', async () => {
			delete process.env.OCI_COMPARTMENT_ID;

			const result = await generateEmbedding('hello', {
				compartmentId: undefined
			});
			expect(result).toBeNull();
		});
	});

	// ── generateEmbeddings (batch) ─────────────────────────────────────

	describe('generateEmbeddings', () => {
		it('returns embeddings for multiple texts', async () => {
			const emb = new Array(1536).fill(0.1);
			mockExecFile.mockResolvedValueOnce({
				stdout: JSON.stringify({
					data: { embeddings: [emb, emb] }
				})
			});

			const results = await generateEmbeddings(['hello', 'world']);
			expect(results).toHaveLength(2);
			expect(results[0]).toHaveLength(1536);
			expect(results[1]).toHaveLength(1536);
		});

		it('returns empty array for empty input', async () => {
			const results = await generateEmbeddings([]);
			expect(results).toEqual([]);
		});

		it('returns null entries on batch failure', async () => {
			mockExecFile.mockRejectedValueOnce(new Error('timeout'));

			const results = await generateEmbeddings(['a', 'b']);
			expect(results).toEqual([null, null]);
		});
	});

	// ── createOCIEmbedder ──────────────────────────────────────────────

	describe('createOCIEmbedder', () => {
		it('returns a function matching Mastra embedder interface', () => {
			const embedder = createOCIEmbedder();
			expect(typeof embedder).toBe('function');
		});

		it('returns { embeddings: number[][] } when called', async () => {
			const emb = new Array(1536).fill(0.1);
			mockExecFile.mockResolvedValueOnce({
				stdout: JSON.stringify({ data: { embeddings: [emb] } })
			});

			const embedder = createOCIEmbedder();
			const result = await embedder({ value: ['test text'] });

			expect(result.embeddings).toHaveLength(1);
			expect(result.embeddings[0]).toHaveLength(1536);
		});

		it('replaces null embeddings with zero vectors', async () => {
			// Simulate null return (OCI unavailable)
			delete process.env.OCI_COMPARTMENT_ID;

			const embedder = createOCIEmbedder({ compartmentId: undefined });
			const result = await embedder({ value: ['test'] });

			// Should return zero vector instead of null
			expect(result.embeddings[0]).toHaveLength(EMBEDDING_DIMENSIONS);
			expect(result.embeddings[0]!.every((v) => v === 0)).toBe(true);
		});
	});

	// ── Constants ──────────────────────────────────────────────────────

	describe('constants', () => {
		it('exports expected dimensions and batch size', () => {
			expect(EMBEDDING_DIMENSIONS).toBe(1536);
			expect(MAX_BATCH_SIZE).toBe(96);
		});
	});
});
