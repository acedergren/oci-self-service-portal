import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OracleVectorStore } from './oracle-vector-store.js';

// ── Mock Oracle connection ──────────────────────────────────────────────

function createMockConnection() {
	return {
		execute: vi.fn().mockResolvedValue({ rows: [] }),
		commit: vi.fn().mockResolvedValue(undefined),
		rollback: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined)
	};
}

function createMockWithConnection(mockConn = createMockConnection()) {
	const withConnection = vi.fn(async (fn: (conn: typeof mockConn) => unknown) => fn(mockConn));
	return { withConnection, mockConn };
}

describe('OracleVectorStore', () => {
	let store: OracleVectorStore;
	let mockConn: ReturnType<typeof createMockConnection>;

	beforeEach(() => {
		const mock = createMockWithConnection();
		store = new OracleVectorStore({ withConnection: mock.withConnection });
		mockConn = mock.mockConn;
	});

	// ── createIndex ────────────────────────────────────────────────────

	describe('createIndex', () => {
		it('creates a new table with VECTOR column when table does not exist', async () => {
			// First call: check existence → 0
			mockConn.execute.mockResolvedValueOnce({ rows: [{ CNT: 0 }] });

			await store.createIndex({
				indexName: 'test_embeddings',
				dimension: 1536
			});

			// Should check if table exists
			expect(mockConn.execute).toHaveBeenCalledWith(expect.stringContaining('user_tables'), {
				tbl: 'MASTRA_VECTOR_TEST_EMBEDDINGS'
			});
			// Should create table with VECTOR column
			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('CREATE TABLE MASTRA_VECTOR_TEST_EMBEDDINGS')
			);
			// Should create vector index
			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('CREATE VECTOR INDEX idx_mastra_vector_test_embeddings_vec')
			);
			expect(mockConn.commit).toHaveBeenCalled();
		});

		it('skips creation when table already exists with matching dimension', async () => {
			// Table exists
			mockConn.execute.mockResolvedValueOnce({ rows: [{ CNT: 1 }] });
			// Column dimension check
			mockConn.execute.mockResolvedValueOnce({
				rows: [{ DATA_LENGTH: 1536 }]
			});

			await store.createIndex({
				indexName: 'existing_index',
				dimension: 1536
			});

			// Should NOT create table (only 2 calls: exists check + dim check)
			expect(mockConn.execute).toHaveBeenCalledTimes(2);
			expect(mockConn.commit).not.toHaveBeenCalled();
		});

		it('throws when existing table has different dimension', async () => {
			mockConn.execute.mockResolvedValueOnce({ rows: [{ CNT: 1 }] });
			mockConn.execute.mockResolvedValueOnce({
				rows: [{ DATA_LENGTH: 768 }]
			});

			await expect(
				store.createIndex({
					indexName: 'wrong_dim',
					dimension: 1536
				})
			).rejects.toThrow(/dimension 768.*1536/);
		});

		it('validates table name against SQL injection', async () => {
			await expect(
				store.createIndex({
					indexName: 'DROP TABLE; --',
					dimension: 1536
				})
			).rejects.toThrow(/Invalid vector index name/);
		});

		it('rejects table names exceeding 128 characters', async () => {
			await expect(
				store.createIndex({
					indexName: 'A'.repeat(129),
					dimension: 1536
				})
			).rejects.toThrow(/too long/);
		});
	});

	// ── upsert ─────────────────────────────────────────────────────────

	describe('upsert', () => {
		it('inserts vectors with MERGE INTO and returns generated IDs', async () => {
			const ids = await store.upsert({
				indexName: 'test_embeddings',
				vectors: [[0.1, 0.2, 0.3]],
				metadata: [{ key: 'val' }]
			});

			expect(ids).toHaveLength(1);
			expect(typeof ids[0]).toBe('string'); // UUID
			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('MERGE INTO MASTRA_VECTOR_TEST_EMBEDDINGS'),
				expect.objectContaining({
					id: ids[0],
					vec: '[0.1,0.2,0.3]',
					meta: '{"key":"val"}'
				})
			);
			expect(mockConn.commit).toHaveBeenCalled();
		});

		it('uses provided IDs when given', async () => {
			const ids = await store.upsert({
				indexName: 'test_embeddings',
				vectors: [[0.1, 0.2]],
				ids: ['custom-id-1']
			});

			expect(ids).toEqual(['custom-id-1']);
			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('MERGE INTO'),
				expect.objectContaining({ id: 'custom-id-1' })
			);
		});

		it('handles deleteFilter before upserting', async () => {
			await store.upsert({
				indexName: 'test_embeddings',
				vectors: [[0.1]],
				deleteFilter: { ref_type: 'user_message' }
			});

			// First call should be DELETE with metadata filter
			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('DELETE FROM MASTRA_VECTOR_TEST_EMBEDDINGS WHERE'),
				expect.objectContaining({ df_ref_type: 'user_message' })
			);
		});

		it('handles batch vectors', async () => {
			const ids = await store.upsert({
				indexName: 'test_embeddings',
				vectors: [
					[0.1, 0.2],
					[0.3, 0.4],
					[0.5, 0.6]
				]
			});

			expect(ids).toHaveLength(3);
			// 3 MERGE calls + 1 commit
			const mergeCalls = mockConn.execute.mock.calls.filter(([sql]) =>
				String(sql).includes('MERGE INTO')
			);
			expect(mergeCalls).toHaveLength(3);
		});
	});

	// ── query ──────────────────────────────────────────────────────────

	describe('query', () => {
		it('returns scored results ordered by cosine distance', async () => {
			mockConn.execute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'v1',
						SCORE: 0.95,
						METADATA: '{"ref":"doc"}',
						DOCUMENT: 'hello'
					},
					{ ID: 'v2', SCORE: 0.8, METADATA: null, DOCUMENT: null }
				]
			});

			const results = await store.query({
				indexName: 'test_embeddings',
				queryVector: [0.1, 0.2, 0.3],
				topK: 5
			});

			expect(results).toHaveLength(2);
			expect(results[0]).toEqual({
				id: 'v1',
				score: 0.95,
				metadata: { ref: 'doc' },
				document: 'hello'
			});
			expect(results[1]).toEqual({ id: 'v2', score: 0.8 });

			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('VECTOR_DISTANCE'),
				expect.objectContaining({
					queryVec: '[0.1,0.2,0.3]',
					topK: 5
				})
			);
		});

		it('applies metadata filter to query', async () => {
			mockConn.execute.mockResolvedValueOnce({ rows: [] });

			await store.query({
				indexName: 'test_embeddings',
				queryVector: [0.1],
				topK: 3,
				filter: { ref_type: 'user_message' }
			});

			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('JSON_VALUE'),
				expect.objectContaining({ qf_ref_type: 'user_message' })
			);
		});

		it('returns empty array when no rows', async () => {
			mockConn.execute.mockResolvedValueOnce({ rows: null });

			const results = await store.query({
				indexName: 'test_embeddings',
				queryVector: [0.1]
			});

			expect(results).toEqual([]);
		});

		it('handles legacy conversation_embeddings table', async () => {
			mockConn.execute.mockResolvedValueOnce({ rows: [] });

			await store.query({
				indexName: 'conversation_embeddings',
				queryVector: [0.1, 0.2],
				topK: 10
			});

			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('FROM CONVERSATION_EMBEDDINGS'),
				expect.anything()
			);
		});
	});

	// ── listIndexes ────────────────────────────────────────────────────

	describe('listIndexes', () => {
		it('returns prefixed tables plus legacy table if exists', async () => {
			mockConn.execute
				.mockResolvedValueOnce({
					rows: [{ TABLE_NAME: 'MASTRA_VECTOR_DOCS' }, { TABLE_NAME: 'MASTRA_VECTOR_CHAT' }]
				})
				.mockResolvedValueOnce({ rows: [{ CNT: 1 }] }); // legacy exists

			const indexes = await store.listIndexes();
			expect(indexes).toEqual([
				'MASTRA_VECTOR_DOCS',
				'MASTRA_VECTOR_CHAT',
				'CONVERSATION_EMBEDDINGS'
			]);
		});

		it('excludes legacy table when it does not exist', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ TABLE_NAME: 'MASTRA_VECTOR_DOCS' }] })
				.mockResolvedValueOnce({ rows: [{ CNT: 0 }] });

			const indexes = await store.listIndexes();
			expect(indexes).toEqual(['MASTRA_VECTOR_DOCS']);
		});
	});

	// ── describeIndex ──────────────────────────────────────────────────

	describe('describeIndex', () => {
		it('returns count, dimension, and metric', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ CNT: 42 }] })
				.mockResolvedValueOnce({ rows: [{ DIM: 1536 }] });

			const stats = await store.describeIndex({
				indexName: 'test_embeddings'
			});

			expect(stats).toEqual({ count: 42, dimension: 1536, metric: 'cosine' });
		});

		it('returns dimension 0 when table is empty', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ CNT: 0 }] })
				.mockResolvedValueOnce({ rows: [{ DIM: null }] });

			const stats = await store.describeIndex({
				indexName: 'test_embeddings'
			});

			expect(stats).toEqual({ count: 0, dimension: 0, metric: 'cosine' });
		});
	});

	// ── deleteIndex ────────────────────────────────────────────────────

	describe('deleteIndex', () => {
		it('drops a MASTRA_VECTOR_ prefixed table', async () => {
			await store.deleteIndex({ indexName: 'test_embeddings' });

			expect(mockConn.execute).toHaveBeenCalledWith(
				'DROP TABLE MASTRA_VECTOR_TEST_EMBEDDINGS PURGE'
			);
			expect(mockConn.commit).toHaveBeenCalled();
		});

		it('refuses to drop legacy conversation_embeddings table', async () => {
			await expect(store.deleteIndex({ indexName: 'conversation_embeddings' })).rejects.toThrow(
				/Cannot delete legacy index/
			);
		});
	});

	// ── updateVector ───────────────────────────────────────────────────

	describe('updateVector', () => {
		it('updates vector by ID', async () => {
			await store.updateVector({
				indexName: 'test_embeddings',
				id: 'v1',
				update: { vector: [0.5, 0.6, 0.7] }
			});

			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('UPDATE MASTRA_VECTOR_TEST_EMBEDDINGS SET'),
				expect.objectContaining({
					updateId: 'v1',
					newVec: '[0.5,0.6,0.7]'
				})
			);
		});

		it('updates metadata by filter', async () => {
			await store.updateVector({
				indexName: 'test_embeddings',
				filter: { ref_type: 'doc' },
				update: { metadata: { ref_type: 'updated_doc' } }
			});

			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('metadata = :newMeta'),
				expect.objectContaining({
					newMeta: '{"ref_type":"updated_doc"}',
					uf_ref_type: 'doc'
				})
			);
		});

		it('skips when no updates provided', async () => {
			await store.updateVector({
				indexName: 'test_embeddings',
				id: 'v1',
				update: {}
			});

			// Should still call withConnection but no execute for the update
			const updateCalls = mockConn.execute.mock.calls.filter(([sql]) =>
				String(sql).includes('UPDATE')
			);
			expect(updateCalls).toHaveLength(0);
		});
	});

	// ── deleteVector / deleteVectors ───────────────────────────────────

	describe('deleteVector', () => {
		it('deletes a single vector by ID', async () => {
			await store.deleteVector({ indexName: 'test_embeddings', id: 'v1' });

			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('DELETE FROM MASTRA_VECTOR_TEST_EMBEDDINGS WHERE id = :id'),
				{ id: 'v1' }
			);
		});
	});

	describe('deleteVectors', () => {
		it('batch deletes by IDs', async () => {
			await store.deleteVectors({
				indexName: 'test_embeddings',
				ids: ['v1', 'v2', 'v3']
			});

			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('DELETE FROM MASTRA_VECTOR_TEST_EMBEDDINGS'),
				expect.objectContaining({ id0: 'v1', id1: 'v2', id2: 'v3' })
			);
		});

		it('deletes by metadata filter', async () => {
			await store.deleteVectors({
				indexName: 'test_embeddings',
				filter: { ref_type: 'obsolete' }
			});

			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('JSON_VALUE'),
				expect.objectContaining({ dvf_ref_type: 'obsolete' })
			);
		});

		it('handles batch IDs exceeding Oracle 1000 IN limit', async () => {
			const ids = Array.from({ length: 1500 }, (_, i) => `v${i}`);

			await store.deleteVectors({ indexName: 'test_embeddings', ids });

			// Should be 2 DELETE calls (1000 + 500)
			const deleteCalls = mockConn.execute.mock.calls.filter(([sql]) =>
				String(sql).includes('DELETE')
			);
			expect(deleteCalls).toHaveLength(2);
		});
	});
});
