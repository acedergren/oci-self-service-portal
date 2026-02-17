/**
 * Unit tests for the workflow routes module.
 *
 * Mock strategy: Mock the three workflow repository factories, the
 * WorkflowExecutor class, and the workflow stream bus. Use buildTestApp()
 * with a fake `oracle` decorator so getRepos() works, and
 * simulateOrgSession() for auth + org context.
 *
 * Source: apps/api/src/routes/workflows.ts (1147 lines, 0 tests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildTestApp, simulateSession } from './test-helpers.js';

// ── Mock fns ─────────────────────────────────────────────────────────────

const mockWorkflowRepo = {
	list: vi.fn(),
	count: vi.fn(),
	create: vi.fn(),
	getByIdForUser: vi.fn(),
	getByIdForOrg: vi.fn(),
	updateForUser: vi.fn(),
	delete: vi.fn()
};

const mockRunRepo = {
	create: vi.fn(),
	updateStatus: vi.fn(),
	getByIdForUser: vi.fn(),
	getByIdForOrg: vi.fn(),
	listByOrg: vi.fn(),
	listByWorkflowForOrg: vi.fn()
};

const mockStepRepo = {
	listByRun: vi.fn()
};

const mockExecutorExecute = vi.fn();
const mockExecutorResume = vi.fn();
const mockEmitWorkflowStream = vi.fn();
const mockGetLatestWorkflowStatus = vi.fn();
const mockSubscribeWorkflowStream = vi.fn();

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock('../../services/workflow-repository.js', () => ({
	createWorkflowRepository: () => ({
		list: (...args: unknown[]) => mockWorkflowRepo.list(...args),
		count: (...args: unknown[]) => mockWorkflowRepo.count(...args),
		create: (...args: unknown[]) => mockWorkflowRepo.create(...args),
		getByIdForUser: (...args: unknown[]) => mockWorkflowRepo.getByIdForUser(...args),
		getByIdForOrg: (...args: unknown[]) => mockWorkflowRepo.getByIdForOrg(...args),
		updateForUser: (...args: unknown[]) => mockWorkflowRepo.updateForUser(...args),
		delete: (...args: unknown[]) => mockWorkflowRepo.delete(...args)
	}),
	createWorkflowRunRepository: () => ({
		create: (...args: unknown[]) => mockRunRepo.create(...args),
		updateStatus: (...args: unknown[]) => mockRunRepo.updateStatus(...args),
		getByIdForUser: (...args: unknown[]) => mockRunRepo.getByIdForUser(...args),
		getByIdForOrg: (...args: unknown[]) => mockRunRepo.getByIdForOrg(...args),
		listByOrg: (...args: unknown[]) => mockRunRepo.listByOrg(...args),
		listByWorkflowForOrg: (...args: unknown[]) => mockRunRepo.listByWorkflowForOrg(...args)
	}),
	createWorkflowRunStepRepository: () => ({
		listByRun: (...args: unknown[]) => mockStepRepo.listByRun(...args)
	})
}));

vi.mock('@portal/shared/server/workflows/executor.js', () => ({
	WorkflowExecutor: class MockWorkflowExecutor {
		execute(...args: unknown[]) {
			return mockExecutorExecute(...args);
		}
		resume(...args: unknown[]) {
			return mockExecutorResume(...args);
		}
	}
}));

vi.mock('../../services/workflow-stream-bus.js', () => ({
	emitWorkflowStream: (...args: unknown[]) => mockEmitWorkflowStream(...args),
	getLatestWorkflowStatus: (...args: unknown[]) => mockGetLatestWorkflowStatus(...args),
	subscribeWorkflowStream: (...args: unknown[]) => mockSubscribeWorkflowStream(...args)
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

// ── Test data ────────────────────────────────────────────────────────────

const VALID_UUID = '12345678-1234-4123-8123-123456789012';
const VALID_UUID_2 = '22345678-1234-4123-8123-223456789012';
const MOCK_DATE = new Date('2026-02-17T12:00:00Z');

const MOCK_WORKFLOW = {
	id: VALID_UUID,
	name: 'Test Workflow',
	description: 'A test',
	status: 'published',
	version: 1,
	tags: ['test'],
	nodes: [{ id: 'n1', type: 'action' }],
	edges: [{ source: 'n1', target: 'n2' }],
	inputSchema: {},
	createdAt: MOCK_DATE,
	updatedAt: MOCK_DATE
};

const MOCK_RUN = {
	id: VALID_UUID_2,
	definitionId: VALID_UUID,
	status: 'completed' as const,
	input: { key: 'value' },
	output: { result: 'success' },
	error: null,
	startedAt: MOCK_DATE,
	completedAt: MOCK_DATE,
	createdAt: MOCK_DATE,
	engineState: null
};

const MOCK_STEP = {
	id: '32345678-1234-4123-8123-323456789012',
	nodeId: 'n1',
	nodeType: 'action',
	stepNumber: 1,
	status: 'completed',
	input: {},
	output: { done: true },
	error: null,
	startedAt: MOCK_DATE,
	completedAt: MOCK_DATE,
	durationMs: 150
};

// ── Helpers ──────────────────────────────────────────────────────────────

function simulateOrgSession(
	app: FastifyInstance,
	user: Record<string, unknown>,
	permissions: string[],
	orgId: string
): void {
	simulateSession(app, user, permissions);
	app.addHook('onRequest', async (request) => {
		(request as FastifyRequest).session = {
			activeOrganizationId: orgId
		} as FastifyRequest['session'];
	});
}

/** Adds a fake oracle decorator so getRepos() doesn't throw. */
function addOracleDecorator(app: FastifyInstance): void {
	app.decorate('oracle', {
		isAvailable: () => true,
		withConnection: vi.fn()
	});
}

async function createApp(
	user: Record<string, unknown> = { id: 'user-1' },
	permissions: string[] = ['workflows:read', 'workflows:execute'],
	orgId = 'org-1'
): Promise<FastifyInstance> {
	const app = await buildTestApp({ withRbac: true });
	addOracleDecorator(app);
	simulateOrgSession(app, user, permissions, orgId);

	const { default: workflowRoutes } = await import('../../routes/workflows.js');
	await app.register(workflowRoutes);
	await app.ready();
	return app;
}

// ── Setup ────────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeEach(() => {
	vi.clearAllMocks();

	// Sensible defaults for repo mocks
	mockWorkflowRepo.list.mockResolvedValue([]);
	mockWorkflowRepo.count.mockResolvedValue(0);
	mockWorkflowRepo.create.mockResolvedValue(MOCK_WORKFLOW);
	mockWorkflowRepo.getByIdForUser.mockResolvedValue(null);
	mockWorkflowRepo.getByIdForOrg.mockResolvedValue(null);
	mockWorkflowRepo.updateForUser.mockResolvedValue(null);
	mockWorkflowRepo.delete.mockResolvedValue(false);

	mockRunRepo.create.mockResolvedValue(MOCK_RUN);
	mockRunRepo.updateStatus.mockResolvedValue(MOCK_RUN);
	mockRunRepo.getByIdForUser.mockResolvedValue(null);
	mockRunRepo.getByIdForOrg.mockResolvedValue(null);
	mockRunRepo.listByOrg.mockResolvedValue({ runs: [], total: 0 });
	mockRunRepo.listByWorkflowForOrg.mockResolvedValue([]);

	mockStepRepo.listByRun.mockResolvedValue([]);

	mockExecutorExecute.mockResolvedValue({
		status: 'completed',
		output: { result: 'ok' },
		error: null
	});
	mockExecutorResume.mockResolvedValue({
		status: 'completed',
		output: { result: 'ok' },
		error: null
	});
});

afterEach(async () => {
	if (app) await app.close();
});

// ── Auth gates ───────────────────────────────────────────────────────────

describe('auth gates', () => {
	it('GET /api/v1/workflows returns 401 without auth', async () => {
		const unauthApp = await buildTestApp({ withRbac: true });
		addOracleDecorator(unauthApp);
		const { default: workflowRoutes } = await import('../../routes/workflows.js');
		await unauthApp.register(workflowRoutes);
		await unauthApp.ready();

		const res = await unauthApp.inject({ method: 'GET', url: '/api/v1/workflows' });
		expect(res.statusCode).toBe(401);
		await unauthApp.close();
	});

	it('POST /api/v1/workflows returns 401 without auth', async () => {
		const unauthApp = await buildTestApp({ withRbac: true });
		addOracleDecorator(unauthApp);
		const { default: workflowRoutes } = await import('../../routes/workflows.js');
		await unauthApp.register(workflowRoutes);
		await unauthApp.ready();

		const res = await unauthApp.inject({
			method: 'POST',
			url: '/api/v1/workflows',
			payload: { name: 'Test', nodes: [], edges: [] }
		});
		expect(res.statusCode).toBe(401);
		await unauthApp.close();
	});

	it('GET /api/v1/workflows returns 403 without workflows:read', async () => {
		const wrongPermsApp = await buildTestApp({ withRbac: true });
		addOracleDecorator(wrongPermsApp);
		simulateOrgSession(wrongPermsApp, { id: 'user-1' }, ['tools:read'], 'org-1');
		const { default: workflowRoutes } = await import('../../routes/workflows.js');
		await wrongPermsApp.register(workflowRoutes);
		await wrongPermsApp.ready();

		const res = await wrongPermsApp.inject({ method: 'GET', url: '/api/v1/workflows' });
		expect(res.statusCode).toBe(403);
		await wrongPermsApp.close();
	});
});

// ── Missing org context ──────────────────────────────────────────────────

describe('missing org context', () => {
	it('GET /api/v1/workflows returns 400 when no org', async () => {
		const noOrgApp = await buildTestApp({ withRbac: true });
		addOracleDecorator(noOrgApp);
		simulateSession(noOrgApp, { id: 'user-1' }, ['workflows:read']);
		const { default: workflowRoutes } = await import('../../routes/workflows.js');
		await noOrgApp.register(workflowRoutes);
		await noOrgApp.ready();

		const res = await noOrgApp.inject({ method: 'GET', url: '/api/v1/workflows' });
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toContain('Organization context required');
		await noOrgApp.close();
	});

	it('POST /api/v1/workflows returns 400 when no org', async () => {
		const noOrgApp = await buildTestApp({ withRbac: true });
		addOracleDecorator(noOrgApp);
		simulateSession(noOrgApp, { id: 'user-1' }, ['workflows:execute']);
		const { default: workflowRoutes } = await import('../../routes/workflows.js');
		await noOrgApp.register(workflowRoutes);
		await noOrgApp.ready();

		const res = await noOrgApp.inject({
			method: 'POST',
			url: '/api/v1/workflows',
			payload: { name: 'Test', nodes: [], edges: [] }
		});
		expect(res.statusCode).toBe(400);
		await noOrgApp.close();
	});
});

// ── GET /api/v1/workflows ────────────────────────────────────────────────

describe('GET /api/v1/workflows', () => {
	it('returns workflow list with totals', async () => {
		mockWorkflowRepo.list.mockResolvedValue([MOCK_WORKFLOW]);
		mockWorkflowRepo.count.mockResolvedValue(1);

		app = await createApp();
		const res = await app.inject({ method: 'GET', url: '/api/v1/workflows' });

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.workflows).toHaveLength(1);
		expect(body.workflows[0].name).toBe('Test Workflow');
		expect(body.workflows[0].nodeCount).toBe(1);
		expect(body.workflows[0].edgeCount).toBe(1);
		expect(body.total).toBe(1);
	});

	it('passes query params to repository', async () => {
		app = await createApp();
		await app.inject({
			method: 'GET',
			url: '/api/v1/workflows?limit=10&offset=5&status=draft&search=hello'
		});

		expect(mockWorkflowRepo.list).toHaveBeenCalledWith(
			expect.objectContaining({
				orgId: 'org-1',
				limit: 10,
				offset: 5,
				status: 'draft',
				search: 'hello'
			})
		);
	});
});

// ── POST /api/v1/workflows ───────────────────────────────────────────────

describe('POST /api/v1/workflows', () => {
	it('creates workflow and returns 201', async () => {
		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/workflows',
			payload: { name: 'New WF', nodes: [{ id: 'n1' }], edges: [] }
		});

		expect(res.statusCode).toBe(201);
		expect(res.json().workflow.name).toBe('Test Workflow'); // from mock
		expect(mockWorkflowRepo.create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'New WF',
				orgId: 'org-1',
				userId: 'user-1'
			})
		);
	});

	it('validates body — missing name returns 400', async () => {
		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/workflows',
			payload: { nodes: [], edges: [] } // missing name
		});

		expect(res.statusCode).toBe(400);
	});
});

// ── GET /api/v1/workflows/:id ────────────────────────────────────────────

describe('GET /api/v1/workflows/:id', () => {
	it('returns workflow detail', async () => {
		mockWorkflowRepo.getByIdForUser.mockResolvedValue(MOCK_WORKFLOW);

		app = await createApp();
		const res = await app.inject({
			method: 'GET',
			url: `/api/v1/workflows/${VALID_UUID}`
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().workflow.id).toBe(VALID_UUID);
	});

	it('returns 404 when not found', async () => {
		app = await createApp();
		const res = await app.inject({
			method: 'GET',
			url: `/api/v1/workflows/${VALID_UUID}`
		});

		expect(res.statusCode).toBe(404);
	});

	it('rejects invalid UUID param with 400', async () => {
		app = await createApp();
		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/workflows/not-a-uuid'
		});

		expect(res.statusCode).toBe(400);
	});
});

// ── PUT /api/v1/workflows/:id ────────────────────────────────────────────

describe('PUT /api/v1/workflows/:id', () => {
	it('updates workflow and returns result', async () => {
		mockWorkflowRepo.updateForUser.mockResolvedValue({
			...MOCK_WORKFLOW,
			name: 'Updated'
		});

		app = await createApp();
		const res = await app.inject({
			method: 'PUT',
			url: `/api/v1/workflows/${VALID_UUID}`,
			payload: { name: 'Updated' }
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().workflow.name).toBe('Updated');
	});

	it('returns 404 when workflow not found', async () => {
		app = await createApp();
		const res = await app.inject({
			method: 'PUT',
			url: `/api/v1/workflows/${VALID_UUID}`,
			payload: { name: 'Updated' }
		});

		expect(res.statusCode).toBe(404);
	});
});

// ── DELETE /api/v1/workflows/:id ─────────────────────────────────────────

describe('DELETE /api/v1/workflows/:id', () => {
	it('returns 204 on successful delete', async () => {
		mockWorkflowRepo.delete.mockResolvedValue(true);

		app = await createApp();
		const res = await app.inject({
			method: 'DELETE',
			url: `/api/v1/workflows/${VALID_UUID}`
		});

		expect(res.statusCode).toBe(204);
	});

	it('returns 404 when workflow not found', async () => {
		app = await createApp();
		const res = await app.inject({
			method: 'DELETE',
			url: `/api/v1/workflows/${VALID_UUID}`
		});

		expect(res.statusCode).toBe(404);
	});
});

// ── POST /api/v1/workflows/:id/run ──────────────────────────────────────

describe('POST /api/v1/workflows/:id/run', () => {
	it('executes workflow and returns 201', async () => {
		mockWorkflowRepo.getByIdForUser.mockResolvedValue(MOCK_WORKFLOW);

		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: `/api/v1/workflows/${VALID_UUID}/run`,
			payload: { input: { key: 'val' } }
		});

		expect(res.statusCode).toBe(201);
		const body = res.json();
		expect(body.status).toBe('completed');
		expect(body.output).toEqual({ result: 'ok' });
		expect(mockRunRepo.create).toHaveBeenCalled();
		expect(mockExecutorExecute).toHaveBeenCalled();
	});

	it('returns 404 when workflow not found', async () => {
		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: `/api/v1/workflows/${VALID_UUID}/run`,
			payload: {}
		});

		expect(res.statusCode).toBe(404);
	});

	it('rejects non-executable workflow status', async () => {
		mockWorkflowRepo.getByIdForUser.mockResolvedValue({
			...MOCK_WORKFLOW,
			status: 'archived'
		});

		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: `/api/v1/workflows/${VALID_UUID}/run`,
			payload: {}
		});

		expect(res.statusCode).toBe(400);
	});

	it('handles execution failure', async () => {
		mockWorkflowRepo.getByIdForUser.mockResolvedValue(MOCK_WORKFLOW);
		mockExecutorExecute.mockRejectedValue(new Error('Engine crashed'));

		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: `/api/v1/workflows/${VALID_UUID}/run`,
			payload: {}
		});

		expect(res.statusCode).toBe(500);
		expect(mockRunRepo.updateStatus).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ status: 'failed' })
		);
	});
});

// ── GET /api/v1/workflows/:id/runs/:runId ────────────────────────────────

describe('GET /api/v1/workflows/:id/runs/:runId', () => {
	it('returns run detail with steps', async () => {
		mockRunRepo.getByIdForUser.mockResolvedValue(MOCK_RUN);
		mockStepRepo.listByRun.mockResolvedValue([MOCK_STEP]);

		app = await createApp();
		const res = await app.inject({
			method: 'GET',
			url: `/api/v1/workflows/${VALID_UUID}/runs/${VALID_UUID_2}`
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.id).toBe(VALID_UUID_2);
		expect(body.steps).toHaveLength(1);
		expect(body.steps[0].nodeId).toBe('n1');
	});

	it('returns 404 when run belongs to different workflow', async () => {
		// Run exists but its definitionId doesn't match :id param
		mockRunRepo.getByIdForUser.mockResolvedValue({
			...MOCK_RUN,
			definitionId: '99345678-1234-4123-8123-993456789012' // different workflow
		});

		app = await createApp();
		const res = await app.inject({
			method: 'GET',
			url: `/api/v1/workflows/${VALID_UUID}/runs/${VALID_UUID_2}`
		});

		expect(res.statusCode).toBe(404);
	});

	it('returns 404 when run not found', async () => {
		app = await createApp();
		const res = await app.inject({
			method: 'GET',
			url: `/api/v1/workflows/${VALID_UUID}/runs/${VALID_UUID_2}`
		});

		expect(res.statusCode).toBe(404);
	});
});

// ── POST /api/v1/workflows/:id/runs/:runId/cancel ───────────────────────

describe('POST /api/v1/workflows/:id/runs/:runId/cancel', () => {
	it('cancels a running run', async () => {
		mockRunRepo.getByIdForOrg.mockResolvedValue({
			...MOCK_RUN,
			status: 'running'
		});
		mockRunRepo.updateStatus.mockResolvedValue({
			...MOCK_RUN,
			status: 'cancelled'
		});

		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: `/api/v1/workflows/${VALID_UUID}/runs/${VALID_UUID_2}/cancel`
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().run.status).toBe('cancelled');
	});

	it('rejects cancel for terminal status', async () => {
		mockRunRepo.getByIdForOrg.mockResolvedValue({
			...MOCK_RUN,
			status: 'completed'
		});

		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: `/api/v1/workflows/${VALID_UUID}/runs/${VALID_UUID_2}/cancel`
		});

		expect(res.statusCode).toBe(400);
	});
});

// ── POST /api/v1/workflows/:id/runs/:runId/resume ───────────────────────

describe('POST /api/v1/workflows/:id/runs/:runId/resume', () => {
	it('resumes a suspended run', async () => {
		mockRunRepo.getByIdForOrg.mockResolvedValue({
			...MOCK_RUN,
			status: 'suspended',
			engineState: { pendingNodeId: 'n2' }
		});
		mockWorkflowRepo.getByIdForOrg.mockResolvedValue(MOCK_WORKFLOW);

		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: `/api/v1/workflows/${VALID_UUID}/runs/${VALID_UUID_2}/resume`
		});

		expect(res.statusCode).toBe(200);
		expect(mockExecutorResume).toHaveBeenCalled();
	});

	it('rejects resume for non-suspended run', async () => {
		mockRunRepo.getByIdForOrg.mockResolvedValue({
			...MOCK_RUN,
			status: 'completed'
		});

		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: `/api/v1/workflows/${VALID_UUID}/runs/${VALID_UUID_2}/resume`
		});

		expect(res.statusCode).toBe(400);
	});

	it('rejects resume without engine state', async () => {
		mockRunRepo.getByIdForOrg.mockResolvedValue({
			...MOCK_RUN,
			status: 'suspended',
			engineState: null
		});

		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: `/api/v1/workflows/${VALID_UUID}/runs/${VALID_UUID_2}/resume`
		});

		expect(res.statusCode).toBe(400);
	});
});

// ── GET /api/v1/workflows/runs (admin list) ──────────────────────────────

describe('GET /api/v1/workflows/runs', () => {
	it('returns paginated runs for org', async () => {
		mockRunRepo.listByOrg.mockResolvedValue({
			runs: [MOCK_RUN],
			total: 1
		});

		app = await createApp();
		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/workflows/runs'
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.runs).toHaveLength(1);
		expect(body.total).toBe(1);
		expect(body.runs[0].id).toBe(VALID_UUID_2);
	});
});

// ── GET /api/v1/workflows/runs/:runId (convenience) ──────────────────────

describe('GET /api/v1/workflows/runs/:runId', () => {
	it('returns single run with steps', async () => {
		mockRunRepo.getByIdForUser.mockResolvedValue(MOCK_RUN);
		mockStepRepo.listByRun.mockResolvedValue([MOCK_STEP]);

		app = await createApp();
		const res = await app.inject({
			method: 'GET',
			url: `/api/v1/workflows/runs/${VALID_UUID_2}`
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.run.id).toBe(VALID_UUID_2);
		expect(body.run.steps).toHaveLength(1);
	});

	it('returns 404 when run not found', async () => {
		app = await createApp();
		const res = await app.inject({
			method: 'GET',
			url: `/api/v1/workflows/runs/${VALID_UUID_2}`
		});

		expect(res.statusCode).toBe(404);
	});
});

// ── GET /api/v1/workflows/:id/runs (list runs for workflow) ──────────────

describe('GET /api/v1/workflows/:id/runs', () => {
	it('returns runs with workflow context', async () => {
		mockWorkflowRepo.getByIdForOrg.mockResolvedValue(MOCK_WORKFLOW);
		mockRunRepo.listByWorkflowForOrg.mockResolvedValue([MOCK_RUN]);

		app = await createApp();
		const res = await app.inject({
			method: 'GET',
			url: `/api/v1/workflows/${VALID_UUID}/runs`
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.runs).toHaveLength(1);
		expect(body.workflowId).toBe(VALID_UUID);
		expect(body.workflowName).toBe('Test Workflow');
	});

	it('returns 404 when workflow not found', async () => {
		app = await createApp();
		const res = await app.inject({
			method: 'GET',
			url: `/api/v1/workflows/${VALID_UUID}/runs`
		});

		// getByIdForOrg returns null by default
		expect(res.statusCode).toBe(404);
	});
});

// ── POST /api/v1/workflows/:id/runs/:runId/approve ──────────────────────

describe('POST /api/v1/workflows/:id/runs/:runId/approve', () => {
	it('approves and resumes a suspended run', async () => {
		mockRunRepo.getByIdForUser.mockResolvedValue({
			...MOCK_RUN,
			status: 'suspended',
			engineState: { pendingNodeId: 'approval-gate' }
		});
		mockWorkflowRepo.getByIdForUser.mockResolvedValue(MOCK_WORKFLOW);

		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: `/api/v1/workflows/${VALID_UUID}/runs/${VALID_UUID_2}/approve`
		});

		expect(res.statusCode).toBe(200);
		expect(mockExecutorResume).toHaveBeenCalled();
		expect(res.json().run.status).toBe('completed');
	});

	it('rejects when run is not suspended', async () => {
		mockRunRepo.getByIdForUser.mockResolvedValue({
			...MOCK_RUN,
			status: 'completed'
		});

		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: `/api/v1/workflows/${VALID_UUID}/runs/${VALID_UUID_2}/approve`
		});

		expect(res.statusCode).toBe(400);
	});
});

// ── POST /api/v1/workflows/runs/:runId/approve (convenience) ─────────────

describe('POST /api/v1/workflows/runs/:runId/approve', () => {
	it('approves via convenience endpoint', async () => {
		mockRunRepo.getByIdForUser.mockResolvedValue({
			...MOCK_RUN,
			status: 'suspended',
			engineState: { pendingNodeId: 'approval-gate' }
		});
		mockWorkflowRepo.getByIdForUser.mockResolvedValue(MOCK_WORKFLOW);

		app = await createApp();
		const res = await app.inject({
			method: 'POST',
			url: `/api/v1/workflows/runs/${VALID_UUID_2}/approve`
		});

		expect(res.statusCode).toBe(200);
		expect(mockExecutorResume).toHaveBeenCalled();
	});
});
