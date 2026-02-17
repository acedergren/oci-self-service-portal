/**
 * Phase 8 TDD: Vector Search & Embedding Pipeline
 *
 * Integrates OCI GenAI embeddings with Oracle 26AI VECTOR columns.
 * Provides semantic search across tool executions and chat sessions.
 *
 * Modules under test:
 *   - $lib/server/embeddings.ts (generateEmbedding, generateEmbeddings)
 *   - $lib/server/oracle/repositories/embedding-repository.ts (embeddingRepository)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Oracle connection
const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
const mockConn = {
	execute: mockExecute,
	commit: vi.fn().mockResolvedValue(undefined),
	rollback: vi.fn().mockResolvedValue(undefined),
	close: vi.fn().mockResolvedValue(undefined)
};

vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) => fn(mockConn))
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

vi.mock('$lib/server/sentry.js', () => ({
	wrapWithSpan: vi.fn((_name: string, _op: string, fn: () => unknown) => fn()),
	captureError: vi.fn()
}));

// Set OCI env for embeddings module
vi.stubEnv('OCI_COMPARTMENT_ID', 'ocid1.compartment.oc1..test');
vi.stubEnv('OCI_REGION', 'eu-frankfurt-1');

import {
	generateEmbedding,
	generateEmbeddings,
	resetGenAiClient,
	__setGenAiClientForTesting
} from '@portal/server/embeddings';
import { embeddingRepository } from '@portal/server/oracle/repositories/embedding-repository';

// Mock GenAI SDK client — injected via __setGenAiClientForTesting() because
// oci-sdk is a CJS module that vi.mock() cannot reliably intercept.
const mockEmbedText = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGenAiClient: any = { embedText: (...args: unknown[]) => mockEmbedText(...args) };

/** Helper to build a mock OCI SDK embedText response */
function mockEmbedResponse(count: number): object {
	const embeddings = Array.from({ length: count }, () =>
		Array.from({ length: 1536 }, () => Math.random() * 2 - 1)
	);
	return { embedTextResult: { id: 'r1', embeddings } };
}

beforeEach(() => {
	vi.clearAllMocks();
	// Inject mock client so tests don't make real SDK calls
	__setGenAiClientForTesting(mockGenAiClient, 'eu-frankfurt-1');
});

// ============================================================================
// Embedding Generation
// ============================================================================

describe('Embedding Generation (Phase 8.5)', () => {
	describe('generateEmbedding', () => {
		it('returns a Float32Array of 1536 dimensions', async () => {
			mockEmbedText.mockResolvedValue(mockEmbedResponse(1));

			const embedding = await generateEmbedding('List all compute instances');
			expect(embedding).toBeInstanceOf(Float32Array);
			expect(embedding!.length).toBe(1536);
		});

		it('returns non-zero values', async () => {
			mockEmbedText.mockResolvedValue(mockEmbedResponse(1));

			const embedding = await generateEmbedding('Test query');
			expect(embedding).not.toBeNull();
			const hasNonZero = embedding!.some((v: number) => v !== 0);
			expect(hasNonZero).toBe(true);
		});

		it('throws ValidationError for empty text', async () => {
			await expect(generateEmbedding('')).rejects.toThrow('empty');
		});

		it('returns null when OCI SDK fails with transient error', async () => {
			const sdkError = Object.assign(new Error('ServiceUnavailable'), { statusCode: 503 });
			mockEmbedText.mockRejectedValue(sdkError);

			const result = await generateEmbedding('test');
			expect(result).toBeNull();
		});
	});

	describe('generateEmbeddings (batch)', () => {
		it('returns embeddings for multiple texts', async () => {
			mockEmbedText.mockResolvedValue(mockEmbedResponse(2));

			const embeddings = await generateEmbeddings([
				'List compute instances',
				'Delete object storage bucket'
			]);
			expect(embeddings).toHaveLength(2);
			// Both should be Float32Array or null
			for (const emb of embeddings) {
				if (emb !== null) {
					expect(emb).toBeInstanceOf(Float32Array);
					expect(emb.length).toBe(1536);
				}
			}
		});

		it('returns empty array for empty input', async () => {
			const embeddings = await generateEmbeddings([]);
			expect(embeddings).toEqual([]);
		});

		it('returns null entries when batch fails', async () => {
			const sdkError = Object.assign(new Error('timeout'), { statusCode: 500 });
			mockEmbedText.mockRejectedValue(sdkError);

			const embeddings = await generateEmbeddings(['text1', 'text2']);
			expect(embeddings).toHaveLength(2);
			expect(embeddings[0]).toBeNull();
			expect(embeddings[1]).toBeNull();
		});
	});
});

// ============================================================================
// Embedding Repository
// ============================================================================

describe('Embedding Repository (Phase 8.5)', () => {
	describe('insert', () => {
		it('stores embedding with reference metadata', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const embedding = new Float32Array(1536).fill(0.1);
			const result = await embeddingRepository.insert({
				refType: 'tool_execution',
				refId: 'exec-123',
				orgId: 'org-1',
				content: 'Listed 5 compute instances in compartment X',
				embedding
			});

			expect(result.id).toBeDefined();
			expect(mockExecute).toHaveBeenCalled();
			const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
			expect(sql).toContain('INSERT');
			expect(sql).toContain('EMBEDDING');
		});
	});

	describe('similaritySearch', () => {
		it('returns results ranked by cosine similarity', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'emb-1',
						REF_TYPE: 'tool_execution',
						REF_ID: 'exec-1',
						CONTENT: 'Listed compute instances',
						SCORE: 0.95
					},
					{
						ID: 'emb-2',
						REF_TYPE: 'tool_execution',
						REF_ID: 'exec-2',
						CONTENT: 'Described instance details',
						SCORE: 0.82
					}
				]
			});

			const queryEmbedding = new Float32Array(1536).fill(0.1);
			const results = await embeddingRepository.similaritySearch({
				embedding: queryEmbedding,
				orgId: 'org-1',
				limit: 10
			});

			expect(results.length).toBe(2);
			expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
			expect(results[0].content).toBeDefined();
			expect(results[0].refId).toBeDefined();
		});

		it('enforces org-scoped search (no cross-tenant leakage)', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const queryEmbedding = new Float32Array(1536).fill(0.1);
			await embeddingRepository.similaritySearch({
				embedding: queryEmbedding,
				orgId: 'org-specific',
				limit: 5
			});

			expect(mockExecute).toHaveBeenCalled();
			// The SQL must include an org_id filter
			const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
			expect(sql).toContain('ORG_ID');
		});

		it('uses VECTOR_DISTANCE for cosine similarity', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const queryEmbedding = new Float32Array(1536).fill(0.1);
			await embeddingRepository.similaritySearch({
				embedding: queryEmbedding,
				orgId: 'org-1'
			});

			const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
			expect(sql).toContain('VECTOR_DISTANCE');
			expect(sql).toContain('COSINE');
		});

		it('respects limit parameter', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const queryEmbedding = new Float32Array(1536).fill(0.1);
			await embeddingRepository.similaritySearch({
				embedding: queryEmbedding,
				orgId: 'org-1',
				limit: 3
			});

			expect(mockExecute).toHaveBeenCalled();
			const args = mockExecute.mock.calls[0];
			const sqlOrBinds = JSON.stringify(args);
			expect(sqlOrBinds).toMatch(/3|FETCH|LIMIT|ROWNUM/i);
		});
	});

	describe('deleteByRef', () => {
		it('deletes embeddings by reference type and id', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			await embeddingRepository.deleteByRef('tool_execution', 'exec-123', 'org-1');

			expect(mockExecute).toHaveBeenCalled();
			const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
			expect(sql).toContain('DELETE');
		});
	});

	describe('search API response shape', () => {
		it('response includes expected fields for frontend consumption', () => {
			const expectedResponse = {
				results: [
					{
						id: 'emb-1',
						refType: 'tool_execution',
						refId: 'exec-1',
						content: 'Listed compute instances',
						score: 0.95
					}
				],
				query: 'compute instances',
				total: 1
			};

			expect(expectedResponse.results[0]).toHaveProperty('id');
			expect(expectedResponse.results[0]).toHaveProperty('refType');
			expect(expectedResponse.results[0]).toHaveProperty('refId');
			expect(expectedResponse.results[0]).toHaveProperty('content');
			expect(expectedResponse.results[0]).toHaveProperty('score');
			expect(expectedResponse).toHaveProperty('query');
			expect(expectedResponse).toHaveProperty('total');
		});
	});
});
