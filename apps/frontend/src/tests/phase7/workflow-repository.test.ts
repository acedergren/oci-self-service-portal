/**
 * Phase 7 TDD: Workflow Repository
 *
 * Tests for CRUD operations on workflow definitions, runs, and steps.
 * Uses mocked Oracle connection following session-repository.ts patterns.
 *
 * TDD: Written FIRST, before implementation.
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
	wrapWithSpan: vi.fn((_name: string, _op: string, fn: () => unknown) => fn())
}));

import {
	workflowRepository,
	workflowRunRepository,
	workflowRunStepRepository
} from '@portal/shared/server/workflows/repository';

beforeEach(() => {
	vi.clearAllMocks();
});

// ============================================================================
// Workflow Definition CRUD
// ============================================================================

describe('workflowRepository', () => {
	const now = new Date();

	describe('create', () => {
		it('inserts a workflow and returns the created entity', async () => {
			mockExecute
				.mockResolvedValueOnce({ rows: [] }) // INSERT
				.mockResolvedValueOnce({
					rows: [
						{
							ID: 'wf-new',
							USER_ID: 'u1',
							ORG_ID: 'o1',
							NAME: 'Test Workflow',
							DESCRIPTION: 'A test workflow',
							STATUS: 'draft',
							VERSION: 1,
							TAGS: '["compute"]',
							NODES:
								'[{"id":"n1","type":"tool","position":{"x":0,"y":0},"data":{"toolName":"list"}}]',
							EDGES: '[]',
							INPUT_SCHEMA: null,
							CREATED_AT: now,
							UPDATED_AT: now
						}
					]
				}); // SELECT after insert

			const wf = await workflowRepository.create({
				name: 'Test Workflow',
				description: 'A test workflow',
				nodes: [{ id: 'n1', type: 'tool', position: { x: 0, y: 0 }, data: { toolName: 'list' } }],
				edges: [],
				userId: 'u1',
				orgId: 'o1',
				tags: ['compute']
			});

			expect(wf).toBeDefined();
			expect(wf.name).toBe('Test Workflow');
			expect(wf.status).toBe('draft');
			expect(wf.nodes).toHaveLength(1);

			// Verify INSERT was called with bind variables
			const insertCall = mockExecute.mock.calls[0];
			expect(insertCall[0]).toContain('INSERT INTO workflow_definitions');
			expect(insertCall[1]).toHaveProperty('name', 'Test Workflow');
		});
	});

	describe('getById', () => {
		it('returns a workflow definition when found', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'wf-1',
						USER_ID: 'u1',
						ORG_ID: null,
						NAME: 'My Workflow',
						DESCRIPTION: null,
						STATUS: 'published',
						VERSION: 2,
						TAGS: null,
						NODES: '[]',
						EDGES: '[]',
						INPUT_SCHEMA: null,
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			const wf = await workflowRepository.getById('wf-1');
			expect(wf).not.toBeNull();
			expect(wf!.id).toBe('wf-1');
			expect(wf!.name).toBe('My Workflow');
			expect(wf!.status).toBe('published');
		});

		it('returns null when not found', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const wf = await workflowRepository.getById('non-existent');
			expect(wf).toBeNull();
		});
	});

	describe('list', () => {
		it('returns workflows filtered by userId', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'wf-1',
						USER_ID: 'u1',
						ORG_ID: null,
						NAME: 'WF 1',
						DESCRIPTION: '',
						STATUS: 'draft',
						VERSION: 1,
						TAGS: null,
						NODES: '[]',
						EDGES: '[]',
						INPUT_SCHEMA: null,
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			const workflows = await workflowRepository.list({ userId: 'u1' });
			expect(workflows).toHaveLength(1);

			// Verify userId is bound
			const query = mockExecute.mock.calls[0][0];
			expect(query).toContain('user_id = :userId');
		});

		it('returns workflows filtered by status', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			await workflowRepository.list({ status: 'published' });

			const query = mockExecute.mock.calls[0][0];
			expect(query).toContain('status = :status');
		});

		it('supports search with LIKE escaping', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			await workflowRepository.list({ search: 'test%workflow' });

			const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
			// The % in user input should be escaped
			expect(binds.search).toContain('\\%');
		});

		it('applies pagination with OFFSET/FETCH', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			await workflowRepository.list({ limit: 10, offset: 20 });

			const query = mockExecute.mock.calls[0][0];
			expect(query).toContain('OFFSET');
			expect(query).toContain('FETCH');
		});

		it('defaults limit to 50', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			await workflowRepository.list({});

			const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
			expect(binds.maxRows).toBe(50);
		});
	});

	describe('update', () => {
		it('updates specified fields and returns updated entity', async () => {
			mockExecute
				.mockResolvedValueOnce({ rows: [] }) // UPDATE
				.mockResolvedValueOnce({
					rows: [
						{
							ID: 'wf-1',
							USER_ID: 'u1',
							ORG_ID: null,
							NAME: 'Updated Name',
							DESCRIPTION: 'New desc',
							STATUS: 'draft',
							VERSION: 1,
							TAGS: null,
							NODES: '[]',
							EDGES: '[]',
							INPUT_SCHEMA: null,
							CREATED_AT: now,
							UPDATED_AT: now
						}
					]
				}); // SELECT after update

			const wf = await workflowRepository.update('wf-1', {
				name: 'Updated Name',
				description: 'New desc'
			});
			expect(wf).not.toBeNull();
			expect(wf!.name).toBe('Updated Name');

			// Verify UPDATE uses bind variables
			const updateCall = mockExecute.mock.calls[0];
			expect(updateCall[0]).toContain('UPDATE workflow_definitions');
			expect(updateCall[0]).toContain('updated_at = SYSTIMESTAMP');
		});

		it('can update nodes and edges', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
				rows: [
					{
						ID: 'wf-1',
						USER_ID: 'u1',
						ORG_ID: null,
						NAME: 'WF',
						DESCRIPTION: null,
						STATUS: 'draft',
						VERSION: 1,
						TAGS: null,
						NODES: '[{"id":"n1","type":"tool","position":{"x":0,"y":0},"data":{}}]',
						EDGES: '[{"id":"e1","source":"n1","target":"n2"}]',
						INPUT_SCHEMA: null,
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			const newNodes = [{ id: 'n1', type: 'tool', position: { x: 0, y: 0 }, data: {} }];
			await workflowRepository.update('wf-1', { nodes: newNodes });

			const updateCall = mockExecute.mock.calls[0];
			expect(updateCall[0]).toContain('nodes = :nodes');
			expect(updateCall[1].nodes).toBe(JSON.stringify(newNodes));
		});
	});

	describe('delete', () => {
		it('deletes a workflow by id and userId', async () => {
			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });

			const deleted = await workflowRepository.delete('wf-1', 'u1');
			expect(deleted).toBe(true);

			const deleteCall = mockExecute.mock.calls[0];
			expect(deleteCall[0]).toContain('DELETE FROM workflow_definitions');
			expect(deleteCall[0]).toContain('user_id = :userId');
		});

		it('scopes DELETE by org_id when orgId provided', async () => {
			mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });

			const deleted = await workflowRepository.delete('wf-1', 'u1', 'org-1');
			expect(deleted).toBe(true);

			const deleteCall = mockExecute.mock.calls[0];
			expect(deleteCall[0]).toContain('org_id = :orgId');
			expect(deleteCall[0]).toContain('user_id = :userId');
			expect(deleteCall[1]).toEqual({ id: 'wf-1', userId: 'u1', orgId: 'org-1' });
		});

		it('returns false when no row deleted', async () => {
			mockExecute.mockResolvedValueOnce({ rowsAffected: 0 });

			const deleted = await workflowRepository.delete('wf-nonexistent', 'u1');
			expect(deleted).toBe(false);
		});
	});
});

// ============================================================================
// Workflow Run CRUD
// ============================================================================

describe('workflowRunRepository', () => {
	const now = new Date();

	describe('create', () => {
		it('creates a workflow run', async () => {
			mockExecute
				.mockResolvedValueOnce({ rows: [] }) // INSERT
				.mockResolvedValueOnce({
					rows: [
						{
							ID: 'run-1',
							WORKFLOW_ID: 'wf-1',
							WORKFLOW_VERSION: 1,
							USER_ID: 'u1',
							ORG_ID: null,
							STATUS: 'pending',
							INPUT: '{"compartmentId":"ocid1..."}',
							OUTPUT: null,
							ERROR: null,
							ENGINE_STATE: null,
							STARTED_AT: null,
							COMPLETED_AT: null,
							SUSPENDED_AT: null,
							RESUMED_AT: null,
							CREATED_AT: now,
							UPDATED_AT: now
						}
					]
				});

			const run = await workflowRunRepository.create({
				definitionId: 'wf-1',
				workflowVersion: 1,
				userId: 'u1',
				input: { compartmentId: 'ocid1...' }
			});

			expect(run).toBeDefined();
			expect(run.status).toBe('pending');
			expect(run.definitionId).toBe('wf-1');
		});
	});

	describe('getById', () => {
		it('returns a run when found', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'run-1',
						WORKFLOW_ID: 'wf-1',
						WORKFLOW_VERSION: 1,
						USER_ID: 'u1',
						ORG_ID: null,
						STATUS: 'running',
						INPUT: '{}',
						OUTPUT: null,
						ERROR: null,
						ENGINE_STATE: null,
						STARTED_AT: now,
						COMPLETED_AT: null,
						SUSPENDED_AT: null,
						RESUMED_AT: null,
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			const run = await workflowRunRepository.getById('run-1');
			expect(run).not.toBeNull();
			expect(run!.status).toBe('running');
		});

		it('returns null when not found', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const run = await workflowRunRepository.getById('non-existent');
			expect(run).toBeNull();
		});
	});

	describe('updateStatus', () => {
		it('updates run status and timestamps', async () => {
			mockExecute
				.mockResolvedValueOnce({ rows: [] }) // UPDATE
				.mockResolvedValueOnce({
					rows: [
						{
							ID: 'run-1',
							WORKFLOW_ID: 'wf-1',
							WORKFLOW_VERSION: 1,
							USER_ID: 'u1',
							ORG_ID: null,
							STATUS: 'completed',
							INPUT: '{}',
							OUTPUT: '{"result":"ok"}',
							ERROR: null,
							ENGINE_STATE: null,
							STARTED_AT: now,
							COMPLETED_AT: now,
							SUSPENDED_AT: null,
							RESUMED_AT: null,
							CREATED_AT: now,
							UPDATED_AT: now
						}
					]
				});

			const run = await workflowRunRepository.updateStatus('run-1', {
				status: 'completed',
				output: { result: 'ok' }
			});
			expect(run).not.toBeNull();
			expect(run!.status).toBe('completed');
		});
	});

	describe('listByWorkflow', () => {
		it('returns runs for a workflow', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'run-1',
						WORKFLOW_ID: 'wf-1',
						WORKFLOW_VERSION: 1,
						USER_ID: 'u1',
						ORG_ID: null,
						STATUS: 'completed',
						INPUT: '{}',
						OUTPUT: null,
						ERROR: null,
						ENGINE_STATE: null,
						STARTED_AT: now,
						COMPLETED_AT: now,
						SUSPENDED_AT: null,
						RESUMED_AT: null,
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			const runs = await workflowRunRepository.listByWorkflow('wf-1');
			expect(runs).toHaveLength(1);
		});
	});
});

// ============================================================================
// Workflow Run Step CRUD
// ============================================================================

describe('workflowRunStepRepository', () => {
	const now = new Date();

	describe('create', () => {
		it('creates a step for a run', async () => {
			mockExecute
				.mockResolvedValueOnce({ rows: [] }) // INSERT
				.mockResolvedValueOnce({
					rows: [
						{
							ID: 'step-1',
							RUN_ID: 'run-1',
							NODE_ID: 'n1',
							NODE_TYPE: 'tool',
							STEP_NUMBER: 1,
							STATUS: 'pending',
							INPUT: null,
							OUTPUT: null,
							ERROR: null,
							STARTED_AT: null,
							COMPLETED_AT: null,
							DURATION_MS: null,
							TOOL_EXECUTION_ID: null,
							CREATED_AT: now,
							UPDATED_AT: now
						}
					]
				});

			const step = await workflowRunStepRepository.create({
				runId: 'run-1',
				nodeId: 'n1',
				nodeType: 'tool',
				stepNumber: 1
			});

			expect(step).toBeDefined();
			expect(step.nodeId).toBe('n1');
			expect(step.status).toBe('pending');
		});
	});

	describe('updateStatus', () => {
		it('updates step status, output, and duration', async () => {
			mockExecute
				.mockResolvedValueOnce({ rows: [] }) // UPDATE
				.mockResolvedValueOnce({
					rows: [
						{
							ID: 'step-1',
							RUN_ID: 'run-1',
							NODE_ID: 'n1',
							NODE_TYPE: 'tool',
							STEP_NUMBER: 1,
							STATUS: 'completed',
							INPUT: null,
							OUTPUT: '{"result":"ok"}',
							ERROR: null,
							STARTED_AT: now,
							COMPLETED_AT: now,
							DURATION_MS: 500,
							TOOL_EXECUTION_ID: 'exec-1',
							CREATED_AT: now,
							UPDATED_AT: now
						}
					]
				});

			const step = await workflowRunStepRepository.updateStatus('step-1', {
				status: 'completed',
				output: { result: 'ok' },
				durationMs: 500,
				toolExecutionId: 'exec-1'
			});

			expect(step).not.toBeNull();
			expect(step!.status).toBe('completed');
			expect(step!.durationMs).toBe(500);
		});
	});

	describe('listByRun', () => {
		it('returns steps ordered by step_number', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'step-1',
						RUN_ID: 'run-1',
						NODE_ID: 'n1',
						NODE_TYPE: 'input',
						STEP_NUMBER: 1,
						STATUS: 'completed',
						INPUT: null,
						OUTPUT: null,
						ERROR: null,
						STARTED_AT: now,
						COMPLETED_AT: now,
						DURATION_MS: 10,
						TOOL_EXECUTION_ID: null,
						CREATED_AT: now,
						UPDATED_AT: now
					},
					{
						ID: 'step-2',
						RUN_ID: 'run-1',
						NODE_ID: 'n2',
						NODE_TYPE: 'tool',
						STEP_NUMBER: 2,
						STATUS: 'running',
						INPUT: '{"a":"b"}',
						OUTPUT: null,
						ERROR: null,
						STARTED_AT: now,
						COMPLETED_AT: null,
						DURATION_MS: null,
						TOOL_EXECUTION_ID: null,
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			const steps = await workflowRunStepRepository.listByRun('run-1');
			expect(steps).toHaveLength(2);
			expect(steps[0].stepNumber).toBe(1);
			expect(steps[1].stepNumber).toBe(2);

			const query = mockExecute.mock.calls[0][0];
			expect(query).toContain('ORDER BY step_number');
		});
	});
});
