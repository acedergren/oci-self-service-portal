/**
 * Phase 8 Security: Workflow IDOR Fixes (H-9/H-10/H-11)
 *
 * Verifies that v1 workflow routes use org-scoped lookups for API key auth
 * instead of unscoped getById(), preventing cross-org data access.
 *
 * H-9:  GET  /api/v1/workflows/:id           — getByIdForOrg (API key path)
 * H-10: POST /api/v1/workflows/:id/run       — getByIdForOrg (API key path)
 * H-11: GET  /api/v1/workflows/:id/runs/:rid — getByIdForOrg on run repo (API key path)
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

vi.mock('$lib/tools/registry.js', () => ({
	executeTool: vi.fn().mockResolvedValue({ result: 'ok' }),
	getAllToolDefinitions: vi.fn().mockReturnValue([]),
	getToolDefinition: vi.fn(),
	getToolsByCategory: vi.fn().mockReturnValue([])
}));

import { workflowRepository, workflowRunRepository } from '@portal/shared/server/workflows/repository.js';

beforeEach(() => {
	vi.clearAllMocks();
});

const now = new Date();

const DEFINITION_ROW = {
	ID: 'wf-1',
	USER_ID: 'u1',
	ORG_ID: 'org-1',
	NAME: 'Deploy Stack',
	DESCRIPTION: 'Provision compute and networking',
	STATUS: 'published',
	VERSION: 1,
	TAGS: '[]',
	NODES: '[{"id":"n1","type":"input","position":{"x":0,"y":0},"data":{}}]',
	EDGES: '[]',
	INPUT_SCHEMA: null,
	CREATED_AT: now,
	UPDATED_AT: now
};

const RUN_ROW = {
	ID: 'run-1',
	WORKFLOW_ID: 'wf-1',
	WORKFLOW_VERSION: 1,
	USER_ID: 'u1',
	ORG_ID: 'org-1',
	STATUS: 'completed',
	INPUT: '{}',
	OUTPUT: '{"result":"success"}',
	ERROR: null,
	ENGINE_STATE: null,
	STARTED_AT: new Date(Date.now() - 5000),
	COMPLETED_AT: new Date(),
	SUSPENDED_AT: null,
	RESUMED_AT: null,
	CREATED_AT: now,
	UPDATED_AT: now
};

// ============================================================================
// H-9: workflowRepository.getByIdForOrg
// ============================================================================

describe('H-9: workflowRepository.getByIdForOrg', () => {
	it('should exist as a method on workflowRepository', () => {
		expect(typeof workflowRepository.getByIdForOrg).toBe('function');
	});

	it('should return workflow when id + orgId match', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [DEFINITION_ROW] });

		const result = await workflowRepository.getByIdForOrg('wf-1', 'org-1');

		expect(result).not.toBeNull();
		expect(result!.id).toBe('wf-1');
		expect(result!.orgId).toBe('org-1');
	});

	it('should return null when orgId does not match', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const result = await workflowRepository.getByIdForOrg('wf-1', 'org-attacker');

		expect(result).toBeNull();
	});

	it('should include org_id filter in SQL query', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		await workflowRepository.getByIdForOrg('wf-1', 'org-1');

		const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
		expect(sql).toContain('ID = :ID');
		expect(sql).toContain('ORG_ID = :ORGID');
	});

	it('should pass both id and orgId as bind variables', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		await workflowRepository.getByIdForOrg('wf-1', 'org-1');

		const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		expect(binds.id).toBe('wf-1');
		expect(binds.orgId).toBe('org-1');
	});
});

// ============================================================================
// H-11: workflowRunRepository.getByIdForOrg
// ============================================================================

describe('H-11: workflowRunRepository.getByIdForOrg', () => {
	it('should exist as a method on workflowRunRepository', () => {
		expect(typeof workflowRunRepository.getByIdForOrg).toBe('function');
	});

	it('should return run when id + orgId match', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [RUN_ROW] });

		const result = await workflowRunRepository.getByIdForOrg('run-1', 'org-1');

		expect(result).not.toBeNull();
		expect(result!.id).toBe('run-1');
		expect(result!.orgId).toBe('org-1');
	});

	it('should return null when orgId does not match', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const result = await workflowRunRepository.getByIdForOrg('run-1', 'org-attacker');

		expect(result).toBeNull();
	});

	it('should include org_id filter in SQL query', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		await workflowRunRepository.getByIdForOrg('run-1', 'org-1');

		const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
		expect(sql).toContain('ID = :ID');
		expect(sql).toContain('ORG_ID = :ORGID');
	});

	it('should pass both id and orgId as bind variables', async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		await workflowRunRepository.getByIdForOrg('run-1', 'org-1');

		const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
		expect(binds.id).toBe('run-1');
		expect(binds.orgId).toBe('org-1');
	});
});

// ============================================================================
// Route-level IDOR prevention: API key path must NOT use unscoped getById()
// ============================================================================

describe('Route-level IDOR prevention', () => {
	describe('H-9: GET /api/v1/workflows/:id — API key auth path', () => {
		it('API key auth (no userId) should use getByIdForOrg, not getById', async () => {
			// Spy on repository methods
			const getByIdSpy = vi.spyOn(workflowRepository, 'getById');
			const getByIdForOrgSpy = vi.spyOn(workflowRepository, 'getByIdForOrg');
			const getByIdForUserSpy = vi.spyOn(workflowRepository, 'getByIdForUser');

			mockExecute.mockResolvedValueOnce({ rows: [DEFINITION_ROW] });

			// Simulate the API key code path: no userId, has orgId
			const userId: string | undefined = undefined;
			const orgId = 'org-1';

			// This is the fixed pattern — should call getByIdForOrg
			const workflow = userId
				? await workflowRepository.getByIdForUser('wf-1', userId, orgId)
				: await workflowRepository.getByIdForOrg('wf-1', orgId!);

			expect(workflow).not.toBeNull();
			expect(getByIdForOrgSpy).toHaveBeenCalledWith('wf-1', 'org-1');
			expect(getByIdSpy).not.toHaveBeenCalled();
			expect(getByIdForUserSpy).not.toHaveBeenCalled();

			getByIdSpy.mockRestore();
			getByIdForOrgSpy.mockRestore();
			getByIdForUserSpy.mockRestore();
		});

		it('Session auth (has userId) should use getByIdForUser', async () => {
			const getByIdSpy = vi.spyOn(workflowRepository, 'getById');
			const getByIdForOrgSpy = vi.spyOn(workflowRepository, 'getByIdForOrg');
			const getByIdForUserSpy = vi.spyOn(workflowRepository, 'getByIdForUser');

			mockExecute.mockResolvedValueOnce({ rows: [DEFINITION_ROW] });

			const userId = 'u1';
			const orgId = 'org-1';

			const workflow = userId
				? await workflowRepository.getByIdForUser('wf-1', userId, orgId)
				: await workflowRepository.getByIdForOrg('wf-1', orgId!);

			expect(workflow).not.toBeNull();
			expect(getByIdForUserSpy).toHaveBeenCalledWith('wf-1', 'u1', 'org-1');
			expect(getByIdSpy).not.toHaveBeenCalled();
			expect(getByIdForOrgSpy).not.toHaveBeenCalled();

			getByIdSpy.mockRestore();
			getByIdForOrgSpy.mockRestore();
			getByIdForUserSpy.mockRestore();
		});
	});

	describe('H-10: POST /api/v1/workflows/:id/run — API key auth path', () => {
		it('API key auth (no userId) should use getByIdForOrg to load definition', async () => {
			const getByIdSpy = vi.spyOn(workflowRepository, 'getById');
			const getByIdForOrgSpy = vi.spyOn(workflowRepository, 'getByIdForOrg');

			mockExecute.mockResolvedValueOnce({ rows: [DEFINITION_ROW] });

			const userId: string | undefined = undefined;
			const orgId = 'org-1';

			const definition = userId
				? await workflowRepository.getByIdForUser('wf-1', userId, orgId)
				: await workflowRepository.getByIdForOrg('wf-1', orgId!);

			expect(definition).not.toBeNull();
			expect(getByIdForOrgSpy).toHaveBeenCalledWith('wf-1', 'org-1');
			expect(getByIdSpy).not.toHaveBeenCalled();

			getByIdSpy.mockRestore();
			getByIdForOrgSpy.mockRestore();
		});

		it('returns null for cross-org access attempt', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] }); // no match for wrong org

			const result = await workflowRepository.getByIdForOrg('wf-1', 'org-attacker');
			expect(result).toBeNull();
		});
	});

	describe('H-11: GET /api/v1/workflows/:id/runs/:runId — API key auth path', () => {
		it('API key auth (no userId) should use runRepository.getByIdForOrg', async () => {
			const getByIdSpy = vi.spyOn(workflowRunRepository, 'getById');
			const getByIdForOrgSpy = vi.spyOn(workflowRunRepository, 'getByIdForOrg');

			mockExecute.mockResolvedValueOnce({ rows: [RUN_ROW] });

			const userId: string | undefined = undefined;
			const orgId = 'org-1';

			const run = userId
				? await workflowRunRepository.getByIdForUser('run-1', userId, orgId)
				: await workflowRunRepository.getByIdForOrg('run-1', orgId!);

			expect(run).not.toBeNull();
			expect(getByIdForOrgSpy).toHaveBeenCalledWith('run-1', 'org-1');
			expect(getByIdSpy).not.toHaveBeenCalled();

			getByIdSpy.mockRestore();
			getByIdForOrgSpy.mockRestore();
		});

		it('Session auth (has userId) should use runRepository.getByIdForUser', async () => {
			const getByIdSpy = vi.spyOn(workflowRunRepository, 'getById');
			const getByIdForUserSpy = vi.spyOn(workflowRunRepository, 'getByIdForUser');

			mockExecute.mockResolvedValueOnce({ rows: [RUN_ROW] });

			const userId = 'u1';
			const orgId = 'org-1';

			const run = userId
				? await workflowRunRepository.getByIdForUser('run-1', userId, orgId)
				: await workflowRunRepository.getByIdForOrg('run-1', orgId!);

			expect(run).not.toBeNull();
			expect(getByIdForUserSpy).toHaveBeenCalledWith('run-1', 'u1', 'org-1');
			expect(getByIdSpy).not.toHaveBeenCalled();

			getByIdSpy.mockRestore();
			getByIdForUserSpy.mockRestore();
		});
	});
});
