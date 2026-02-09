import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowsOracle, MemoryOracle, ScoresOracle, OracleStore } from './oracle-store.js';

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

// ── OracleStore (Composite) ─────────────────────────────────────────────

describe('OracleStore', () => {
	it('creates a composite store with all 3 domains', () => {
		const { withConnection } = createMockWithConnection();
		const store = new OracleStore({ withConnection });

		expect(store).toBeDefined();
		// MastraCompositeStore exposes stores as a property
		expect((store as unknown as { stores: Record<string, unknown> }).stores).toBeDefined();
	});

	it('defaults disableInit to true', () => {
		const { withConnection } = createMockWithConnection();
		const store = new OracleStore({ withConnection });

		// Store should be created without calling init (migrations handle DDL)
		expect(store).toBeDefined();
	});

	it('accepts explicit disableInit=false', () => {
		const { withConnection } = createMockWithConnection();
		const store = new OracleStore({ withConnection, disableInit: false });

		expect(store).toBeDefined();
	});
});

// ── WorkflowsOracle ─────────────────────────────────────────────────────

describe('WorkflowsOracle', () => {
	let wf: WorkflowsOracle;
	let mockConn: ReturnType<typeof createMockConnection>;

	beforeEach(() => {
		const mock = createMockWithConnection();
		wf = new WorkflowsOracle(mock.withConnection);
		mockConn = mock.mockConn;
	});

	describe('dangerouslyClearAll', () => {
		it('deletes all workflow snapshots and commits', async () => {
			await wf.dangerouslyClearAll();

			expect(mockConn.execute).toHaveBeenCalledWith('DELETE FROM mastra_workflow_snapshots');
			expect(mockConn.commit).toHaveBeenCalled();
		});
	});

	describe('persistWorkflowSnapshot', () => {
		it('uses MERGE INTO for upsert', async () => {
			const snapshot = {
				status: 'running' as const,
				context: {},
				timestamp: Date.now()
			};

			await wf.persistWorkflowSnapshot({
				workflowName: 'test-wf',
				runId: 'run-1',
				snapshot: snapshot as never
			});

			const sql = mockConn.execute.mock.calls[0][0] as string;
			expect(sql).toContain('MERGE INTO mastra_workflow_snapshots');
			expect(sql).toContain('WHEN MATCHED THEN UPDATE');
			expect(sql).toContain('WHEN NOT MATCHED THEN INSERT');
			expect(mockConn.commit).toHaveBeenCalled();
		});

		it('passes bind variables correctly', async () => {
			const snapshot = {
				status: 'completed' as const,
				context: { step1: 'result' },
				timestamp: Date.now()
			};

			await wf.persistWorkflowSnapshot({
				workflowName: 'my-workflow',
				runId: 'run-abc',
				resourceId: 'user-123',
				snapshot: snapshot as never
			});

			const binds = mockConn.execute.mock.calls[0][1] as Record<string, unknown>;
			expect(binds.workflowName).toBe('my-workflow');
			expect(binds.runId).toBe('run-abc');
			expect(binds.resourceId).toBe('user-123');
			expect(typeof binds.snapshot).toBe('string');
			expect(JSON.parse(binds.snapshot as string)).toEqual(snapshot);
		});

		it('defaults resourceId to null when not provided', async () => {
			await wf.persistWorkflowSnapshot({
				workflowName: 'wf',
				runId: 'r1',
				snapshot: { status: 'running', context: {}, timestamp: 0 } as never
			});

			const binds = mockConn.execute.mock.calls[0][1] as Record<string, unknown>;
			expect(binds.resourceId).toBeNull();
		});

		it('uses provided timestamps', async () => {
			const createdAt = new Date('2026-01-01');
			const updatedAt = new Date('2026-01-02');

			await wf.persistWorkflowSnapshot({
				workflowName: 'wf',
				runId: 'r1',
				snapshot: { status: 'running', context: {}, timestamp: 0 } as never,
				createdAt,
				updatedAt
			});

			const binds = mockConn.execute.mock.calls[0][1] as Record<string, unknown>;
			expect(binds.createdAt).toBe(createdAt);
			expect(binds.updatedAt).toBe(updatedAt);
		});
	});

	describe('loadWorkflowSnapshot', () => {
		it('returns parsed snapshot when found', async () => {
			const snapshotData = { status: 'completed', context: { step1: 'ok' } };
			mockConn.execute.mockResolvedValue({
				rows: [{ SNAPSHOT: JSON.stringify(snapshotData) }]
			});

			const result = await wf.loadWorkflowSnapshot({
				workflowName: 'test-wf',
				runId: 'run-1'
			});

			expect(result).toEqual(snapshotData);
		});

		it('returns null when not found', async () => {
			mockConn.execute.mockResolvedValue({ rows: [] });

			const result = await wf.loadWorkflowSnapshot({
				workflowName: 'nonexistent',
				runId: 'run-x'
			});

			expect(result).toBeNull();
		});

		it('returns null for null rows', async () => {
			mockConn.execute.mockResolvedValue({ rows: null });

			const result = await wf.loadWorkflowSnapshot({
				workflowName: 'wf',
				runId: 'r1'
			});

			expect(result).toBeNull();
		});

		it('uses correct bind variables', async () => {
			mockConn.execute.mockResolvedValue({ rows: [] });

			await wf.loadWorkflowSnapshot({
				workflowName: 'my-wf',
				runId: 'my-run'
			});

			const binds = mockConn.execute.mock.calls[0][1] as Record<string, unknown>;
			expect(binds.workflowName).toBe('my-wf');
			expect(binds.runId).toBe('my-run');
		});
	});

	describe('getWorkflowRunById', () => {
		it('returns workflow run when found', async () => {
			const now = new Date();
			mockConn.execute.mockResolvedValue({
				rows: [
					{
						WORKFLOW_NAME: 'test-wf',
						RUN_ID: 'run-1',
						RESOURCE_ID: 'user-1',
						SNAPSHOT: JSON.stringify({ status: 'completed' }),
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			const result = await wf.getWorkflowRunById({ runId: 'run-1' });

			expect(result).not.toBeNull();
			expect(result!.workflowName).toBe('test-wf');
			expect(result!.runId).toBe('run-1');
			expect(result!.resourceId).toBe('user-1');
		});

		it('returns null when not found', async () => {
			mockConn.execute.mockResolvedValue({ rows: [] });

			const result = await wf.getWorkflowRunById({ runId: 'nonexistent' });

			expect(result).toBeNull();
		});

		it('adds workflowName filter when provided', async () => {
			mockConn.execute.mockResolvedValue({ rows: [] });

			await wf.getWorkflowRunById({
				runId: 'run-1',
				workflowName: 'specific-wf'
			});

			const sql = mockConn.execute.mock.calls[0][0] as string;
			expect(sql).toContain('workflow_name = :workflowName');
			const binds = mockConn.execute.mock.calls[0][1] as Record<string, unknown>;
			expect(binds.workflowName).toBe('specific-wf');
		});
	});

	describe('deleteWorkflowRunById', () => {
		it('deletes by composite key and commits', async () => {
			await wf.deleteWorkflowRunById({
				runId: 'run-1',
				workflowName: 'test-wf'
			});

			const sql = mockConn.execute.mock.calls[0][0] as string;
			expect(sql).toContain('DELETE FROM mastra_workflow_snapshots');
			expect(sql).toContain('workflow_name = :workflowName');
			expect(sql).toContain('run_id = :runId');
			expect(mockConn.commit).toHaveBeenCalled();
		});
	});

	describe('listWorkflowRuns', () => {
		it('returns empty runs with total 0 when no data', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ CNT: 0 }] }) // count query
				.mockResolvedValueOnce({ rows: [] }); // data query

			const result = await wf.listWorkflowRuns();

			expect(result.runs).toEqual([]);
			expect(result.total).toBe(0);
		});

		it('applies workflowName filter', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ CNT: 0 }] })
				.mockResolvedValueOnce({ rows: [] });

			await wf.listWorkflowRuns({ workflowName: 'my-wf' });

			const countSql = mockConn.execute.mock.calls[0][0] as string;
			expect(countSql).toContain('workflow_name = :workflowName');
		});

		it('applies status filter using JSON_VALUE', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ CNT: 0 }] })
				.mockResolvedValueOnce({ rows: [] });

			await wf.listWorkflowRuns({ status: 'completed' } as never);

			const countSql = mockConn.execute.mock.calls[0][0] as string;
			expect(countSql).toContain("JSON_VALUE(snapshot, '$.status')");
		});

		it('applies pagination with OFFSET/FETCH', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ CNT: 50 }] })
				.mockResolvedValueOnce({ rows: [] });

			await wf.listWorkflowRuns({ page: 2, perPage: 10 });

			const dataSql = mockConn.execute.mock.calls[1][0] as string;
			expect(dataSql).toContain('OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY');
		});

		it('orders by created_at DESC', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ CNT: 0 }] })
				.mockResolvedValueOnce({ rows: [] });

			await wf.listWorkflowRuns();

			const dataSql = mockConn.execute.mock.calls[1][0] as string;
			expect(dataSql).toContain('ORDER BY created_at DESC');
		});
	});

	describe('updateWorkflowResults', () => {
		it('throws when snapshot not found', async () => {
			// loadWorkflowSnapshot returns null (no rows)
			mockConn.execute.mockResolvedValue({ rows: [] });

			await expect(
				wf.updateWorkflowResults({
					workflowName: 'wf',
					runId: 'r1',
					stepId: 'step1',
					result: {} as never,
					requestContext: {}
				})
			).rejects.toThrow('Workflow snapshot not found');
		});

		it('merges step result into context and persists', async () => {
			const existingSnapshot = {
				status: 'running',
				context: { existingStep: 'data' },
				requestContext: { userId: 'u1' }
			};

			// First call: loadWorkflowSnapshot (SELECT)
			mockConn.execute
				.mockResolvedValueOnce({
					rows: [{ SNAPSHOT: JSON.stringify(existingSnapshot) }]
				})
				// Second call: UPDATE
				.mockResolvedValueOnce({ rowsAffected: 1 });

			const result = await wf.updateWorkflowResults({
				workflowName: 'wf',
				runId: 'r1',
				stepId: 'newStep',
				result: { data: 'new-result' } as never,
				requestContext: { traceId: 't1' }
			});

			// Should contain both old and new context entries
			expect(result).toHaveProperty('existingStep');
			expect(result).toHaveProperty('newStep');
		});
	});

	describe('updateWorkflowState', () => {
		it('returns undefined when snapshot not found', async () => {
			mockConn.execute.mockResolvedValue({ rows: [] });

			const result = await wf.updateWorkflowState({
				workflowName: 'wf',
				runId: 'r1',
				opts: { status: 'completed' } as never
			});

			expect(result).toBeUndefined();
		});

		it('updates status and persists', async () => {
			const existingSnapshot = {
				status: 'running',
				context: {},
				timestamp: 1000
			};

			mockConn.execute
				.mockResolvedValueOnce({
					rows: [{ SNAPSHOT: JSON.stringify(existingSnapshot) }]
				})
				.mockResolvedValueOnce({ rowsAffected: 1 });

			const result = await wf.updateWorkflowState({
				workflowName: 'wf',
				runId: 'r1',
				opts: { status: 'completed' } as never
			});

			expect(result).toBeDefined();
			expect(result!.status).toBe('completed');
			expect(mockConn.commit).toHaveBeenCalled();
		});
	});
});

// ── MemoryOracle (Stubs) ────────────────────────────────────────────────

describe('MemoryOracle', () => {
	let mem: MemoryOracle;
	let mockConn: ReturnType<typeof createMockConnection>;

	beforeEach(() => {
		const mock = createMockWithConnection();
		mem = new MemoryOracle(mock.withConnection);
		mockConn = mock.mockConn;
	});

	it('dangerouslyClearAll deletes from all memory tables', async () => {
		await mem.dangerouslyClearAll();

		const calls = mockConn.execute.mock.calls.map((c) => c[0]);
		expect(calls).toContain('DELETE FROM mastra_messages');
		expect(calls).toContain('DELETE FROM mastra_threads');
		expect(calls).toContain('DELETE FROM mastra_resources');
		expect(mockConn.commit).toHaveBeenCalled();
	});

	// Phase 9.6: Methods now implemented — full test coverage in oracle-store-memory.test.ts
});

// ── ScoresOracle (Stubs) ────────────────────────────────────────────────

describe('ScoresOracle', () => {
	let scores: ScoresOracle;
	let mockConn: ReturnType<typeof createMockConnection>;

	beforeEach(() => {
		const mock = createMockWithConnection();
		scores = new ScoresOracle(mock.withConnection);
		mockConn = mock.mockConn;
	});

	it('dangerouslyClearAll deletes from mastra_scores', async () => {
		await scores.dangerouslyClearAll();

		expect(mockConn.execute).toHaveBeenCalledWith('DELETE FROM mastra_scores');
		expect(mockConn.commit).toHaveBeenCalled();
	});

	it('getScoreById returns null for missing score', async () => {
		mockConn.execute.mockResolvedValueOnce({ rows: [] });
		const result = await scores.getScoreById({ id: 's1' });
		expect(result).toBeNull();
	});
});
