/**
 * Unit tests for the workflow repository service — factories for
 * workflow definitions, runs, and run steps.
 *
 * Mock strategy: These repos use a factory pattern that accepts
 * a `withConnection` function, so we pass a mock directly —
 * no vi.mock() needed for the connection module.
 *
 * Source: apps/api/src/services/workflow-repository.ts (829 lines, 0 tests)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	createWorkflowRepository,
	createWorkflowRunRepository,
	createWorkflowRunStepRepository
} from '../../services/workflow-repository.js';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockConn = {
	execute: mockExecute,
	close: vi.fn(),
	commit: vi.fn(),
	rollback: vi.fn()
};

const mockWithConnection = vi
	.fn()
	.mockImplementation(async <T>(fn: (conn: typeof mockConn) => Promise<T>) => fn(mockConn));

// ── Test data ─────────────────────────────────────────────────────────────

const MOCK_DATE = new Date('2026-02-17T12:00:00Z');

const MOCK_DEFINITION_ROW = {
	ID: '12345678-1234-4123-8123-123456789012',
	USER_ID: 'user-1',
	ORG_ID: 'org-1',
	NAME: 'Test Workflow',
	DESCRIPTION: 'A test workflow',
	STATUS: 'draft',
	VERSION: 1,
	TAGS: '["automation","oci"]',
	NODES: '[{"id":"n1","type":"start"}]',
	EDGES: '[{"source":"n1","target":"n2"}]',
	INPUT_SCHEMA: '{"type":"object"}',
	CREATED_AT: MOCK_DATE,
	UPDATED_AT: MOCK_DATE
};

const MOCK_RUN_ROW = {
	ID: 'run-1',
	WORKFLOW_ID: '12345678-1234-4123-8123-123456789012',
	WORKFLOW_VERSION: 1,
	USER_ID: 'user-1',
	ORG_ID: 'org-1',
	STATUS: 'pending',
	INPUT: '{"key":"val"}',
	OUTPUT: null,
	ERROR: null,
	ENGINE_STATE: null,
	STARTED_AT: null,
	COMPLETED_AT: null,
	SUSPENDED_AT: null,
	RESUMED_AT: null,
	CREATED_AT: MOCK_DATE,
	UPDATED_AT: MOCK_DATE
};

const MOCK_STEP_ROW = {
	ID: 'step-1',
	RUN_ID: 'run-1',
	NODE_ID: 'n1',
	NODE_TYPE: 'tool',
	STEP_NUMBER: 1,
	STATUS: 'pending',
	INPUT: '{"arg":"value"}',
	OUTPUT: null,
	ERROR: null,
	STARTED_AT: null,
	COMPLETED_AT: null,
	DURATION_MS: null,
	TOOL_EXECUTION_ID: null,
	CREATED_AT: MOCK_DATE,
	UPDATED_AT: MOCK_DATE
};

// ── Setup ─────────────────────────────────────────────────────────────────

let callCount: number;

beforeEach(() => {
	vi.clearAllMocks();
	callCount = 0;

	mockWithConnection.mockImplementation(async <T>(fn: (conn: typeof mockConn) => Promise<T>) =>
		fn(mockConn)
	);

	mockExecute.mockImplementation(async () => {
		callCount++;
		return { rows: [] };
	});
});

// ============================================================================
// Workflow Definition Repository
// ============================================================================

describe('createWorkflowRepository', () => {
	function getRepo() {
		return createWorkflowRepository(mockWithConnection as never);
	}

	describe('create', () => {
		it('inserts and returns the created definition', async () => {
			callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return { rows: [] }; // INSERT
				return { rows: [MOCK_DEFINITION_ROW] }; // getById SELECT
			});

			const repo = getRepo();
			const result = await repo.create({
				name: 'Test Workflow',
				nodes: [{ id: 'n1', type: 'start' }],
				edges: [{ source: 'n1', target: 'n2' }],
				orgId: 'org-1',
				tags: ['automation', 'oci']
			});

			expect(result.name).toBe('Test Workflow');
			expect(result.nodes).toEqual([{ id: 'n1', type: 'start' }]);
			expect(callCount).toBe(2);
		});

		it('serializes nodes/edges/tags as JSON', async () => {
			callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return { rows: [] };
				return { rows: [MOCK_DEFINITION_ROW] };
			});

			const repo = getRepo();
			await repo.create({
				name: 'Test',
				nodes: [{ id: 'n1' }],
				edges: [],
				tags: ['tag1']
			});

			const insertBinds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
			expect(insertBinds.nodes).toBe('[{"id":"n1"}]');
			expect(insertBinds.edges).toBe('[]');
			expect(insertBinds.tags).toBe('["tag1"]');
		});
	});

	describe('getById', () => {
		it('returns mapped definition', async () => {
			mockExecute.mockResolvedValue({ rows: [MOCK_DEFINITION_ROW] });

			const repo = getRepo();
			const result = await repo.getById('12345678-1234-4123-8123-123456789012');

			expect(result).toBeTruthy();
			expect(result!.id).toBe('12345678-1234-4123-8123-123456789012');
			expect(result!.name).toBe('Test Workflow');
			expect(result!.tags).toEqual(['automation', 'oci']);
			expect(result!.nodes).toEqual([{ id: 'n1', type: 'start' }]);
		});

		it('returns null when not found', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			const repo = getRepo();
			const result = await repo.getById('nonexistent');
			expect(result).toBeNull();
		});

		it('handles null optional fields', async () => {
			mockExecute.mockResolvedValue({
				rows: [
					{
						...MOCK_DEFINITION_ROW,
						USER_ID: null,
						ORG_ID: null,
						DESCRIPTION: null,
						TAGS: null,
						INPUT_SCHEMA: null
					}
				]
			});

			const repo = getRepo();
			const result = await repo.getById('test');
			expect(result!.userId).toBeUndefined();
			expect(result!.orgId).toBeUndefined();
			expect(result!.description).toBeUndefined();
			expect(result!.tags).toBeUndefined();
			expect(result!.inputSchema).toBeUndefined();
		});
	});

	describe('getByIdForOrg', () => {
		it('scopes query by orgId', async () => {
			mockExecute.mockResolvedValue({ rows: [MOCK_DEFINITION_ROW] });

			const repo = getRepo();
			await repo.getByIdForOrg('wf-1', 'org-1');

			expect(mockExecute).toHaveBeenCalledWith(
				expect.stringContaining('org_id = :orgId'),
				expect.objectContaining({ id: 'wf-1', orgId: 'org-1' })
			);
		});
	});

	describe('list', () => {
		it('accepts string orgId for backward compat', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			const repo = getRepo();
			await repo.list('org-1');

			expect(mockExecute).toHaveBeenCalledWith(
				expect.stringContaining('org_id = :orgId'),
				expect.objectContaining({ orgId: 'org-1' })
			);
		});

		it('accepts options object with filters', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			const repo = getRepo();
			await repo.list({ status: 'active', search: 'test', limit: 10, offset: 5 });

			const sql = mockExecute.mock.calls[0][0] as string;
			expect(sql).toContain('status = :status');
			expect(sql).toContain('LOWER(name) LIKE');

			const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
			expect(binds.status).toBe('active');
			expect(binds.search).toBe('%test%');
			expect(binds.maxRows).toBe(10);
			expect(binds.offset).toBe(5);
		});

		it('returns empty array for null rows', async () => {
			mockExecute.mockResolvedValue({ rows: null });

			const repo = getRepo();
			const result = await repo.list();
			expect(result).toEqual([]);
		});
	});

	describe('update', () => {
		it('builds dynamic SET clause', async () => {
			callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return { rows: [] }; // UPDATE
				return { rows: [MOCK_DEFINITION_ROW] }; // getById
			});

			const repo = getRepo();
			await repo.update('wf-1', { name: 'Updated', status: 'active' });

			const sql = mockExecute.mock.calls[0][0] as string;
			expect(sql).toContain('name = :name');
			expect(sql).toContain('status = :status');
			expect(sql).toContain('updated_at = SYSTIMESTAMP');
		});
	});

	describe('delete', () => {
		it('returns true when row affected', async () => {
			mockExecute.mockResolvedValue({ rowsAffected: 1 });

			const repo = getRepo();
			const result = await repo.delete('wf-1');
			expect(result).toBe(true);
		});

		it('returns false when no row affected', async () => {
			mockExecute.mockResolvedValue({ rowsAffected: 0 });

			const repo = getRepo();
			const result = await repo.delete('nonexistent');
			expect(result).toBe(false);
		});

		it('scopes by userId and orgId when provided', async () => {
			mockExecute.mockResolvedValue({ rowsAffected: 1 });

			const repo = getRepo();
			await repo.delete('wf-1', 'user-1', 'org-1');

			expect(mockExecute).toHaveBeenCalledWith(
				expect.stringContaining('user_id = :userId'),
				expect.objectContaining({ userId: 'user-1', orgId: 'org-1' })
			);
		});
	});

	describe('count', () => {
		it('returns count from Oracle result', async () => {
			mockExecute.mockResolvedValue({ rows: [{ CNT: 42 }] });

			const repo = getRepo();
			const result = await repo.count({ orgId: 'org-1' });
			expect(result).toBe(42);
		});

		it('returns 0 for empty result', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			const repo = getRepo();
			const result = await repo.count();
			expect(result).toBe(0);
		});
	});
});

// ============================================================================
// Workflow Run Repository
// ============================================================================

describe('createWorkflowRunRepository', () => {
	function getRepo() {
		return createWorkflowRunRepository(mockWithConnection as never);
	}

	describe('create', () => {
		it('inserts and returns the created run', async () => {
			callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return { rows: [] };
				return { rows: [MOCK_RUN_ROW] };
			});

			const repo = getRepo();
			const result = await repo.create({
				definitionId: '12345678-1234-4123-8123-123456789012',
				userId: 'user-1',
				orgId: 'org-1',
				input: { key: 'val' }
			});

			expect(result.definitionId).toBe('12345678-1234-4123-8123-123456789012');
			expect(result.status).toBe('pending');
		});

		it('uses workflowId as fallback', async () => {
			callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return { rows: [] };
				return { rows: [MOCK_RUN_ROW] };
			});

			const repo = getRepo();
			await repo.create({ workflowId: 'wf-1' });

			const insertBinds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
			expect(insertBinds.workflowId).toBe('wf-1');
		});
	});

	describe('updateStatus', () => {
		it('sets started_at when status is running', async () => {
			callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return { rows: [] };
				return { rows: [{ ...MOCK_RUN_ROW, STATUS: 'running' }] };
			});

			const repo = getRepo();
			await repo.updateStatus('run-1', { status: 'running' });

			const sql = mockExecute.mock.calls[0][0] as string;
			expect(sql).toContain('started_at = SYSTIMESTAMP');
		});

		it('sets completed_at when status is completed', async () => {
			callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return { rows: [] };
				return { rows: [{ ...MOCK_RUN_ROW, STATUS: 'completed' }] };
			});

			const repo = getRepo();
			await repo.updateStatus('run-1', { status: 'completed' });

			const sql = mockExecute.mock.calls[0][0] as string;
			expect(sql).toContain('completed_at = SYSTIMESTAMP');
		});

		it('sets suspended_at when status is suspended', async () => {
			callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return { rows: [] };
				return { rows: [{ ...MOCK_RUN_ROW, STATUS: 'suspended' }] };
			});

			const repo = getRepo();
			await repo.updateStatus('run-1', { status: 'suspended' });

			const sql = mockExecute.mock.calls[0][0] as string;
			expect(sql).toContain('suspended_at = SYSTIMESTAMP');
		});

		it('serializes output, error, and engineState as JSON', async () => {
			callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return { rows: [] };
				return { rows: [MOCK_RUN_ROW] };
			});

			const repo = getRepo();
			await repo.updateStatus('run-1', {
				output: { result: 'ok' },
				error: { message: 'boom' },
				engineState: { step: 3 }
			});

			const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
			expect(binds.output).toBe('{"result":"ok"}');
			expect(binds.error).toBe('{"message":"boom"}');
			expect(binds.engineState).toBe('{"step":3}');
		});
	});

	describe('listByOrg', () => {
		it('returns runs and total count', async () => {
			callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return { rows: [{ CNT: 1 }] }; // COUNT
				return { rows: [MOCK_RUN_ROW] }; // SELECT
			});

			const repo = getRepo();
			const result = await repo.listByOrg('org-1');

			expect(result.total).toBe(1);
			expect(result.runs).toHaveLength(1);
			expect(result.runs[0].orgId).toBe('org-1');
		});
	});

	describe('getByIdForOrg', () => {
		it('scopes query by orgId', async () => {
			mockExecute.mockResolvedValue({ rows: [MOCK_RUN_ROW] });

			const repo = getRepo();
			await repo.getByIdForOrg('run-1', 'org-1');

			expect(mockExecute).toHaveBeenCalledWith(
				expect.stringContaining('org_id = :orgId'),
				expect.objectContaining({ id: 'run-1', orgId: 'org-1' })
			);
		});
	});
});

// ============================================================================
// Workflow Run Step Repository
// ============================================================================

describe('createWorkflowRunStepRepository', () => {
	function getRepo() {
		return createWorkflowRunStepRepository(mockWithConnection as never);
	}

	describe('create', () => {
		it('inserts and returns the created step', async () => {
			callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return { rows: [] };
				return { rows: [MOCK_STEP_ROW] };
			});

			const repo = getRepo();
			const result = await repo.create({
				runId: 'run-1',
				nodeId: 'n1',
				nodeType: 'tool',
				stepNumber: 1,
				input: { arg: 'value' }
			});

			expect(result.runId).toBe('run-1');
			expect(result.nodeType).toBe('tool');
			expect(result.status).toBe('pending');
		});
	});

	describe('updateStatus', () => {
		it('sets started_at when running', async () => {
			callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return { rows: [] };
				return { rows: [{ ...MOCK_STEP_ROW, STATUS: 'running' }] };
			});

			const repo = getRepo();
			await repo.updateStatus('step-1', { status: 'running' });

			const sql = mockExecute.mock.calls[0][0] as string;
			expect(sql).toContain('started_at = SYSTIMESTAMP');
		});

		it('sets completed_at when completed', async () => {
			callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return { rows: [] };
				return { rows: [{ ...MOCK_STEP_ROW, STATUS: 'completed' }] };
			});

			const repo = getRepo();
			await repo.updateStatus('step-1', {
				status: 'completed',
				durationMs: 1500,
				output: { result: 'done' }
			});

			const sql = mockExecute.mock.calls[0][0] as string;
			expect(sql).toContain('completed_at = SYSTIMESTAMP');
			expect(sql).toContain('duration_ms = :durationMs');
			expect(sql).toContain('output = :output');
		});
	});

	describe('listByRun', () => {
		it('returns steps ordered by step_number', async () => {
			mockExecute.mockResolvedValue({ rows: [MOCK_STEP_ROW] });

			const repo = getRepo();
			const result = await repo.listByRun('run-1');

			expect(result).toHaveLength(1);
			expect(result[0].stepNumber).toBe(1);
			expect(mockExecute).toHaveBeenCalledWith(
				expect.stringContaining('ORDER BY step_number ASC'),
				expect.objectContaining({ runId: 'run-1' })
			);
		});

		it('returns empty array for null rows', async () => {
			mockExecute.mockResolvedValue({ rows: null });

			const repo = getRepo();
			const result = await repo.listByRun('run-1');
			expect(result).toEqual([]);
		});
	});
});
