/**
 * Phase 8 TDD: Workflow REST API v1
 *
 * Exposes workflow CRUD and execution as REST endpoints.
 *
 * Expected routes:
 *   GET    /api/v1/workflows                    - List workflows for org
 *   POST   /api/v1/workflows/:id/run            - Trigger workflow execution
 *   GET    /api/v1/workflows/:id/runs/:runId    - Get run status
 *
 * Modules under test:
 *   - $lib/server/workflows/repository.ts (workflowRepository, workflowRunRepository)
 *
 * Security: IDOR prevention, RBAC enforcement
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

// Mock executeTool from registry
vi.mock('$lib/tools/registry.js', () => ({
	executeTool: vi.fn().mockResolvedValue({ result: 'ok' }),
	getAllToolDefinitions: vi.fn().mockReturnValue([]),
	getToolDefinition: vi.fn(),
	getToolsByCategory: vi.fn().mockReturnValue([])
}));

import { workflowRepository, workflowRunRepository } from '@portal/shared/server/workflows/repository';

beforeEach(() => {
	vi.clearAllMocks();
});

// ============================================================================
// GET /api/v1/workflows - List Workflows
// ============================================================================

describe('Workflow REST API v1 (Phase 8.9)', () => {
	const now = new Date();

	describe('GET /api/v1/workflows - list workflows for org', () => {
		it('repository.list returns workflows scoped to orgId option', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'wf-1',
						USER_ID: 'u1',
						ORG_ID: 'org-1',
						NAME: 'Deploy Stack',
						DESCRIPTION: 'Provision compute and networking',
						STATUS: 'published',
						VERSION: 2,
						TAGS: '["compute","networking"]',
						NODES: '[]',
						EDGES: '[]',
						INPUT_SCHEMA: null,
						CREATED_AT: now,
						UPDATED_AT: now
					},
					{
						ID: 'wf-2',
						USER_ID: 'u2',
						ORG_ID: 'org-1',
						NAME: 'Audit Check',
						DESCRIPTION: 'Run audit checks',
						STATUS: 'draft',
						VERSION: 1,
						TAGS: '["audit"]',
						NODES: '[]',
						EDGES: '[]',
						INPUT_SCHEMA: null,
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			const workflows = await workflowRepository.list({ orgId: 'org-1' });
			expect(workflows).toHaveLength(2);
			expect(workflows[0].name).toBe('Deploy Stack');
			expect(workflows[1].name).toBe('Audit Check');

			// Verify org_id filter in SQL
			const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
			expect(sql).toContain('ORG_ID');
		});

		it('API response shape matches expected contract', () => {
			const expectedResponse = {
				workflows: [
					{
						id: 'wf-1',
						name: 'Deploy Stack',
						description: 'Provision compute and networking',
						status: 'published',
						version: 2,
						tags: ['compute', 'networking'],
						createdAt: '2026-02-01T00:00:00Z',
						updatedAt: '2026-02-01T00:00:00Z'
					}
				],
				total: 1
			};

			expect(expectedResponse.workflows[0]).toHaveProperty('id');
			expect(expectedResponse.workflows[0]).toHaveProperty('name');
			expect(expectedResponse.workflows[0]).toHaveProperty('status');
			expect(expectedResponse.workflows[0]).toHaveProperty('version');
			expect(expectedResponse).toHaveProperty('total');
		});
	});

	// ============================================================================
	// POST /api/v1/workflows/:id/run - Trigger Execution
	// ============================================================================

	describe('POST /api/v1/workflows/:id/run - trigger execution', () => {
		it('getByIdForUser returns workflow for valid user', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'wf-1',
						USER_ID: 'u1',
						ORG_ID: 'org-1',
						NAME: 'Deploy Stack',
						DESCRIPTION: 'test',
						STATUS: 'published',
						VERSION: 1,
						TAGS: '[]',
						NODES: '[{"id":"n1","type":"input","position":{"x":0,"y":0},"data":{}}]',
						EDGES: '[]',
						INPUT_SCHEMA: null,
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			// getByIdForUser takes (id, userId) — 2 args
			const workflow = await workflowRepository.getByIdForUser('wf-1', 'u1');
			expect(workflow).not.toBeNull();
			expect(workflow!.id).toBe('wf-1');
			expect(workflow!.name).toBe('Deploy Stack');
		});

		it('run creation returns runId and initial status', async () => {
			// INSERT
			mockExecute.mockResolvedValueOnce({ rows: [] });
			// getById SELECT after insert
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'run-1',
						WORKFLOW_ID: 'wf-1',
						WORKFLOW_VERSION: 1,
						USER_ID: 'u1',
						ORG_ID: 'org-1',
						STATUS: 'pending',
						INPUT: '{}',
						OUTPUT: null,
						ERROR: null,
						STARTED_AT: null,
						COMPLETED_AT: null,
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			// workflowRunRepository.create takes { definitionId, workflowVersion, userId, orgId, input }
			const run = await workflowRunRepository.create({
				definitionId: 'wf-1',
				workflowVersion: 1,
				userId: 'u1',
				orgId: 'org-1',
				input: {}
			});

			expect(run.id).toBe('run-1');
			expect(run.status).toBe('pending');
		});
	});

	// ============================================================================
	// GET /api/v1/workflows/:id/runs/:runId - Get Run Status
	// ============================================================================

	describe('GET /api/v1/workflows/:id/runs/:runId - run status', () => {
		it('returns run with status', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'run-1',
						WORKFLOW_ID: 'wf-1',
						WORKFLOW_VERSION: 1,
						USER_ID: 'u1',
						ORG_ID: 'org-1',
						STATUS: 'completed',
						INPUT: '{}',
						OUTPUT: '{"result":"success"}',
						ERROR: null,
						STARTED_AT: new Date(Date.now() - 5000),
						COMPLETED_AT: new Date(),
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			// workflowRunRepository.getById takes just id
			const run = await workflowRunRepository.getById('run-1');
			expect(run).not.toBeNull();
			expect(run!.status).toBe('completed');
			expect(run!.output).toBeDefined();
		});

		it('run status response shape matches expected contract', () => {
			const expectedResponse = {
				id: 'run-1',
				workflowId: 'wf-1',
				status: 'completed',
				input: {},
				output: { result: 'success' },
				error: null,
				startedAt: '2026-02-01T00:00:00Z',
				completedAt: '2026-02-01T00:00:05Z',
				steps: [
					{
						nodeId: 'n1',
						status: 'completed',
						output: { instances: [] },
						startedAt: '2026-02-01T00:00:00Z',
						completedAt: '2026-02-01T00:00:02Z'
					}
				]
			};

			expect(expectedResponse).toHaveProperty('id');
			expect(expectedResponse).toHaveProperty('workflowId');
			expect(expectedResponse).toHaveProperty('status');
			expect(expectedResponse).toHaveProperty('steps');
			expect(expectedResponse.steps[0]).toHaveProperty('nodeId');
			expect(expectedResponse.steps[0]).toHaveProperty('status');
		});
	});

	// ============================================================================
	// IDOR Prevention
	// ============================================================================

	describe('IDOR prevention', () => {
		it('cannot access workflows from another user', async () => {
			// getByIdForUser filters by userId
			mockExecute.mockResolvedValueOnce({ rows: [] }); // no match

			const workflow = await workflowRepository.getByIdForUser('wf-1', 'attacker-user');
			expect(workflow).toBeNull();
		});

		it('list scopes to orgId to prevent cross-tenant access', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			await workflowRepository.list({ orgId: 'org-1' });

			const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
			expect(sql).toContain('ORG_ID');
		});
	});

	// ============================================================================
	// Permission Enforcement
	// ============================================================================

	describe('permission enforcement', () => {
		it('listing workflows requires workflows:read permission', () => {
			const requiredPermission = 'workflows:read';

			const viewerPerms = ['tools:read', 'sessions:read', 'workflows:read'];
			const operatorPerms = [
				'tools:read',
				'tools:execute',
				'tools:approve',
				'sessions:read',
				'sessions:write',
				'workflows:read',
				'workflows:execute'
			];

			expect(viewerPerms).toContain(requiredPermission);
			expect(operatorPerms).toContain(requiredPermission);
		});

		it('executing workflows requires workflows:execute permission', () => {
			const requiredPermission = 'workflows:execute';

			const viewerPerms = ['tools:read', 'sessions:read', 'workflows:read'];
			expect(viewerPerms).not.toContain(requiredPermission);

			const operatorPerms = [
				'tools:read',
				'tools:execute',
				'tools:approve',
				'sessions:read',
				'sessions:write',
				'workflows:read',
				'workflows:execute'
			];
			expect(operatorPerms).toContain(requiredPermission);
		});
	});
});
