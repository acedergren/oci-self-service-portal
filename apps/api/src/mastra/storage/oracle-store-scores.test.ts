import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScoresOracle } from './oracle-store.js';

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

/** Minimal score row returned by Oracle (UPPERCASE keys) */
function makeMockScoreRow(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		ID: 'score-1',
		SCORER_ID: 'scorer-abc',
		ENTITY_ID: 'entity-123',
		ENTITY_TYPE: 'prompt',
		SOURCE: 'LIVE',
		RUN_ID: 'run-xyz',
		SCORE: 0.85,
		REASON: 'Good response',
		INPUT: '{"question":"hello"}',
		OUTPUT: '{"answer":"world"}',
		EXTRACT_STEP_RESULT: null,
		ANALYZE_STEP_RESULT: null,
		PREPROCESS_STEP_RESULT: null,
		ANALYZE_PROMPT: null,
		PREPROCESS_PROMPT: null,
		GENERATE_REASON_PROMPT: null,
		SCORER: '{"name":"test-scorer"}',
		ENTITY: '{"type":"conversation"}',
		ADDITIONAL_CONTEXT: null,
		REQUEST_CONTEXT: null,
		METADATA: '{"tag":"test"}',
		TRACE_ID: 'trace-1',
		SPAN_ID: 'span-1',
		RESOURCE_ID: null,
		THREAD_ID: 'thread-1',
		CREATED_AT: new Date('2026-01-15'),
		UPDATED_AT: new Date('2026-01-15'),
		STRUCTURED_OUTPUT: 0,
		EXTRACT_PROMPT: null,
		REASON_PROMPT: null,
		GENERATE_SCORE_PROMPT: null,
		...overrides
	};
}

describe('ScoresOracle', () => {
	let scores: ScoresOracle;
	let mockConn: ReturnType<typeof createMockConnection>;

	beforeEach(() => {
		const mock = createMockWithConnection();
		scores = new ScoresOracle(mock.withConnection);
		mockConn = mock.mockConn;
	});

	// ── getScoreById ───────────────────────────────────────────────────

	describe('getScoreById', () => {
		it('returns ScoreRowData when found', async () => {
			const row = makeMockScoreRow();
			mockConn.execute.mockResolvedValueOnce({ rows: [row] });

			const result = await scores.getScoreById({ id: 'score-1' });

			expect(result).toBeDefined();
			expect(result!.id).toBe('score-1');
			expect(result!.scorerId).toBe('scorer-abc');
			expect(result!.score).toBe(0.85);
			expect(result!.input).toEqual({ question: 'hello' });
			expect(result!.output).toEqual({ answer: 'world' });
			expect(result!.scorer).toEqual({ name: 'test-scorer' });
			expect(result!.metadata).toEqual({ tag: 'test' });
			expect(result!.traceId).toBe('trace-1');

			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('FROM mastra_scores WHERE id = :id'),
				{ id: 'score-1' }
			);
		});

		it('returns null when not found', async () => {
			mockConn.execute.mockResolvedValueOnce({ rows: [] });

			const result = await scores.getScoreById({ id: 'nonexistent' });
			expect(result).toBeNull();
		});

		it('parses all JSON CLOB fields correctly', async () => {
			const row = makeMockScoreRow({
				EXTRACT_STEP_RESULT: '{"step":"extract"}',
				ANALYZE_STEP_RESULT: '{"step":"analyze"}',
				PREPROCESS_STEP_RESULT: '{"step":"preprocess"}',
				ADDITIONAL_CONTEXT: '{"extra":"info"}',
				REQUEST_CONTEXT: '{"req":"ctx"}'
			});
			mockConn.execute.mockResolvedValueOnce({ rows: [row] });

			const result = await scores.getScoreById({ id: 'score-1' });

			expect(result!.extractStepResult).toEqual({ step: 'extract' });
			expect(result!.analyzeStepResult).toEqual({ step: 'analyze' });
			expect(result!.preprocessStepResult).toEqual({ step: 'preprocess' });
			expect(result!.additionalContext).toEqual({ extra: 'info' });
			expect(result!.requestContext).toEqual({ req: 'ctx' });
		});

		it('handles structured_output boolean mapping', async () => {
			const row = makeMockScoreRow({ STRUCTURED_OUTPUT: 1 });
			mockConn.execute.mockResolvedValueOnce({ rows: [row] });

			const result = await scores.getScoreById({ id: 'score-1' });
			expect(result!.structuredOutput).toBe(true);
		});
	});

	// ── saveScore ──────────────────────────────────────────────────────

	describe('saveScore', () => {
		it('inserts a score and returns the saved row', async () => {
			// Mock for getScoreById after insert
			const row = makeMockScoreRow();
			mockConn.execute
				.mockResolvedValueOnce({}) // INSERT
				.mockResolvedValueOnce({ rows: [row] }); // SELECT for getScoreById

			const result = await scores.saveScore({
				scorerId: 'scorer-abc',
				entityId: 'entity-123',
				entityType: 'prompt',
				source: 'LIVE',
				runId: 'run-xyz',
				score: 0.85,
				reason: 'Good response',
				input: { question: 'hello' },
				output: { answer: 'world' },
				scorer: { name: 'test-scorer' },
				entity: { type: 'conversation' },
				metadata: { tag: 'test' }
			});

			expect(result.score).toBeDefined();
			expect(result.score.scorerId).toBe('scorer-abc');
			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('INSERT INTO mastra_scores'),
				expect.objectContaining({
					scorerId: 'scorer-abc',
					score: 0.85,
					input: '{"question":"hello"}',
					output: '{"answer":"world"}',
					scorer: '{"name":"test-scorer"}'
				})
			);
			expect(mockConn.commit).toHaveBeenCalled();
		});

		it('serializes JSON fields and handles nulls', async () => {
			const row = makeMockScoreRow();
			mockConn.execute.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [row] });

			await scores.saveScore({
				scorerId: 's1',
				entityId: 'e1',
				source: 'TEST',
				runId: 'r1',
				score: 0.5,
				scorer: {},
				entity: {}
			});

			const insertCall = mockConn.execute.mock.calls[0];
			const binds = insertCall[1] as Record<string, unknown>;
			expect(binds.reason).toBeNull();
			expect(binds.input).toBeNull();
			expect(binds.output).toBeNull();
			expect(binds.scorer).toBe('{}');
			expect(binds.entity).toBe('{}');
		});
	});

	// ── listScoresByScorerId ───────────────────────────────────────────

	describe('listScoresByScorerId', () => {
		it('queries by scorer_id with pagination', async () => {
			const row = makeMockScoreRow();
			// Count query
			mockConn.execute.mockResolvedValueOnce({ rows: [{ CNT: 1 }] });
			// Data query
			mockConn.execute.mockResolvedValueOnce({ rows: [row] });

			const result = await scores.listScoresByScorerId({
				scorerId: 'scorer-abc',
				pagination: { page: 0, perPage: 10 }
			});

			expect(result.scores).toHaveLength(1);
			expect(result.pagination.total).toBe(1);
			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('scorer_id = :scorerId'),
				expect.objectContaining({ scorerId: 'scorer-abc' })
			);
		});

		it('applies optional filters (entityId, entityType, source)', async () => {
			mockConn.execute.mockResolvedValueOnce({ rows: [{ CNT: 0 }] });
			mockConn.execute.mockResolvedValueOnce({ rows: [] });

			await scores.listScoresByScorerId({
				scorerId: 's1',
				pagination: { page: 0, perPage: 10 },
				entityId: 'e1',
				entityType: 'prompt',
				source: 'TEST'
			});

			// Count query should have all filters
			const countSql = mockConn.execute.mock.calls[0][0] as string;
			expect(countSql).toContain('scorer_id = :scorerId');
			expect(countSql).toContain('entity_id = :entityId');
			expect(countSql).toContain('entity_type = :entityType');
			expect(countSql).toContain('source = :source');
		});
	});

	// ── listScoresByRunId ──────────────────────────────────────────────

	describe('listScoresByRunId', () => {
		it('queries by run_id with pagination', async () => {
			mockConn.execute.mockResolvedValueOnce({ rows: [{ CNT: 3 }] });
			mockConn.execute.mockResolvedValueOnce({
				rows: [makeMockScoreRow(), makeMockScoreRow(), makeMockScoreRow()]
			});

			const result = await scores.listScoresByRunId({
				runId: 'run-xyz',
				pagination: { page: 0, perPage: 10 }
			});

			expect(result.scores).toHaveLength(3);
			expect(result.pagination.total).toBe(3);
			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('run_id = :runId'),
				expect.objectContaining({ runId: 'run-xyz' })
			);
		});
	});

	// ── listScoresByEntityId ───────────────────────────────────────────

	describe('listScoresByEntityId', () => {
		it('queries by entity_id and entity_type', async () => {
			mockConn.execute.mockResolvedValueOnce({ rows: [{ CNT: 0 }] });
			mockConn.execute.mockResolvedValueOnce({ rows: [] });

			await scores.listScoresByEntityId({
				entityId: 'e1',
				entityType: 'prompt',
				pagination: { page: 0, perPage: 10 }
			});

			const countSql = mockConn.execute.mock.calls[0][0] as string;
			expect(countSql).toContain('entity_id = :entityId');
			expect(countSql).toContain('entity_type = :entityType');
		});
	});

	// ── listScoresBySpan ───────────────────────────────────────────────

	describe('listScoresBySpan', () => {
		it('queries by trace_id and span_id', async () => {
			mockConn.execute.mockResolvedValueOnce({ rows: [{ CNT: 2 }] });
			mockConn.execute.mockResolvedValueOnce({
				rows: [makeMockScoreRow(), makeMockScoreRow()]
			});

			const result = await scores.listScoresBySpan({
				traceId: 'trace-1',
				spanId: 'span-1',
				pagination: { page: 0, perPage: 10 }
			});

			expect(result.scores).toHaveLength(2);
			expect(mockConn.execute).toHaveBeenCalledWith(
				expect.stringContaining('trace_id = :traceId'),
				expect.objectContaining({ traceId: 'trace-1', spanId: 'span-1' })
			);
		});
	});

	// ── dangerouslyClearAll ────────────────────────────────────────────

	describe('dangerouslyClearAll', () => {
		it('deletes all scores and commits', async () => {
			await scores.dangerouslyClearAll();

			expect(mockConn.execute).toHaveBeenCalledWith('DELETE FROM mastra_scores');
			expect(mockConn.commit).toHaveBeenCalled();
		});
	});

	// ── pagination ─────────────────────────────────────────────────────

	describe('pagination', () => {
		it('calculates hasMore correctly', async () => {
			// 15 total, page 0, perPage 10 → hasMore = true
			mockConn.execute.mockResolvedValueOnce({ rows: [{ CNT: 15 }] });
			const tenRows = Array.from({ length: 10 }, () => makeMockScoreRow());
			mockConn.execute.mockResolvedValueOnce({ rows: tenRows });

			const result = await scores.listScoresByScorerId({
				scorerId: 's1',
				pagination: { page: 0, perPage: 10 }
			});

			expect(result.pagination.hasMore).toBe(true);
		});

		it('hasMore is false on last page', async () => {
			// 5 total, page 0, perPage 10 → hasMore = false
			mockConn.execute.mockResolvedValueOnce({ rows: [{ CNT: 5 }] });
			const fiveRows = Array.from({ length: 5 }, () => makeMockScoreRow());
			mockConn.execute.mockResolvedValueOnce({ rows: fiveRows });

			const result = await scores.listScoresByScorerId({
				scorerId: 's1',
				pagination: { page: 0, perPage: 10 }
			});

			expect(result.pagination.hasMore).toBe(false);
		});
	});
});
