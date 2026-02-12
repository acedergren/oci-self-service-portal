/**
 * Route integration tests for Wave 5 admin endpoints:
 * - GET /api/v1/workflows/runs (list all runs, admin-scoped)
 * - GET /api/v1/workflows/:id/runs (list runs for a specific workflow)
 * - GET /api/admin/metrics/summary (structured JSON metrics)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, simulateSession } from './test-helpers.js';

// ── Mocks ────────────────────────────────────────────────────────────

const mockListByOrg = vi.fn();
const mockListByWorkflowForOrg = vi.fn();
const mockGetByIdForOrg = vi.fn();

vi.mock('../../services/workflow-repository.js', () => ({
	createWorkflowRepository: () => ({
		getByIdForOrg: (...args: unknown[]) => mockGetByIdForOrg(...args)
	}),
	createWorkflowRunRepository: () => ({
		listByOrg: (...args: unknown[]) => mockListByOrg(...args),
		listByWorkflowForOrg: (...args: unknown[]) => mockListByWorkflowForOrg(...args)
	}),
	createWorkflowRunStepRepository: () => ({})
}));

vi.mock('@portal/shared/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

const mockRegistryCollect = vi.fn();
vi.mock('@portal/server/metrics', () => ({
	registry: {
		collect: (...args: unknown[]) => mockRegistryCollect(...args)
	}
}));

// ── Setup ────────────────────────────────────────────────────────────

let app: FastifyInstance;

const fakeOracle = {
	isAvailable: () => true,
	withConnection: vi.fn()
};

beforeEach(async () => {
	vi.clearAllMocks();
	app = await buildTestApp({ withRbac: true });

	// Register the oracle decorator
	app.decorate('oracle', fakeOracle);

	// Simulate authenticated admin user with org context
	simulateSession(app, { id: 'user-1', orgId: 'org-1' }, [
		'workflows:read',
		'workflows:execute',
		'admin:all'
	]);

	// Add org context via apiKeyContext
	app.addHook('onRequest', async (request) => {
		(request as any).session = { activeOrganizationId: 'org-1' };
	});

	// Register routes
	const workflowRoutes = (await import('../../routes/workflows.js')).default;
	const { adminMetricsRoutes } = await import('../../routes/admin/metrics.js');
	await app.register(workflowRoutes);
	await app.register(adminMetricsRoutes);
	await app.ready();
});

afterEach(async () => {
	await app.close();
});

// ── GET /api/v1/workflows/runs ───────────────────────────────────────

describe('GET /api/v1/workflows/runs', () => {
	it('returns 200 with runs list and total count', async () => {
		mockListByOrg.mockResolvedValue({
			runs: [
				{
					id: 'run-1',
					definitionId: 'wf-1',
					status: 'completed',
					startedAt: new Date('2026-01-01T10:00:00Z'),
					completedAt: new Date('2026-01-01T10:05:00Z'),
					createdAt: new Date('2026-01-01T09:59:00Z')
				},
				{
					id: 'run-2',
					definitionId: 'wf-2',
					status: 'running',
					startedAt: new Date('2026-01-02T10:00:00Z'),
					completedAt: null,
					createdAt: new Date('2026-01-02T09:59:00Z')
				}
			],
			total: 2
		});

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/workflows/runs'
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.runs).toHaveLength(2);
		expect(body.total).toBe(2);
		expect(body.runs[0].id).toBe('run-1');
		expect(body.runs[0].definitionId).toBe('wf-1');
		expect(body.runs[0].status).toBe('completed');
	});

	it('passes query params to repository', async () => {
		mockListByOrg.mockResolvedValue({ runs: [], total: 0 });

		await app.inject({
			method: 'GET',
			url: '/api/v1/workflows/runs?limit=10&offset=5&status=failed'
		});

		expect(mockListByOrg).toHaveBeenCalledWith('org-1', {
			limit: 10,
			offset: 5,
			status: 'failed'
		});
	});

	it('uses default limit and offset', async () => {
		mockListByOrg.mockResolvedValue({ runs: [], total: 0 });

		await app.inject({
			method: 'GET',
			url: '/api/v1/workflows/runs'
		});

		expect(mockListByOrg).toHaveBeenCalledWith('org-1', {
			limit: 50,
			offset: 0,
			status: undefined
		});
	});

	it('returns empty list when no runs', async () => {
		mockListByOrg.mockResolvedValue({ runs: [], total: 0 });

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/workflows/runs'
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().runs).toEqual([]);
		expect(res.json().total).toBe(0);
	});
});

// ── GET /api/v1/workflows/:id/runs ───────────────────────────────────

describe('GET /api/v1/workflows/:id/runs', () => {
	const workflowId = '12345678-1234-4123-8123-123456789012';

	it('returns 200 with workflow runs', async () => {
		mockGetByIdForOrg.mockResolvedValue({
			id: workflowId,
			name: 'Test Workflow'
		});
		mockListByWorkflowForOrg.mockResolvedValue([
			{
				id: 'run-1',
				definitionId: workflowId,
				status: 'completed',
				startedAt: new Date('2026-01-01T10:00:00Z'),
				completedAt: new Date('2026-01-01T10:05:00Z'),
				createdAt: new Date('2026-01-01T09:59:00Z')
			}
		]);

		const res = await app.inject({
			method: 'GET',
			url: `/api/v1/workflows/${workflowId}/runs`
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.runs).toHaveLength(1);
		expect(body.workflowId).toBe(workflowId);
		expect(body.workflowName).toBe('Test Workflow');
	});

	it('returns 404 when workflow not found', async () => {
		mockGetByIdForOrg.mockResolvedValue(null);

		const res = await app.inject({
			method: 'GET',
			url: `/api/v1/workflows/${workflowId}/runs`
		});

		expect(res.statusCode).toBe(404);
	});

	it('validates UUID format for workflow id', async () => {
		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/workflows/not-a-uuid/runs'
		});

		expect(res.statusCode).toBe(400);
	});

	it('passes status filter to repository', async () => {
		mockGetByIdForOrg.mockResolvedValue({
			id: workflowId,
			name: 'Test Workflow'
		});
		mockListByWorkflowForOrg.mockResolvedValue([]);

		await app.inject({
			method: 'GET',
			url: `/api/v1/workflows/${workflowId}/runs?status=suspended&limit=20`
		});

		expect(mockListByWorkflowForOrg).toHaveBeenCalledWith(workflowId, 'org-1', {
			limit: 20,
			offset: 0,
			status: 'suspended'
		});
	});
});

// ── GET /api/admin/metrics/summary ───────────────────────────────────

describe('GET /api/admin/metrics/summary', () => {
	it('returns 200 with structured metrics summary', async () => {
		mockRegistryCollect.mockReturnValue(
			`# HELP portal_chat_requests_total Total chat API requests
# TYPE portal_chat_requests_total counter
portal_chat_requests_total{model="gemini"} 42
portal_chat_requests_total{model="claude"} 18
# HELP portal_tool_executions_total Total tool executions by tool name and status
# TYPE portal_tool_executions_total counter
portal_tool_executions_total{tool="listInstances",status="success"} 100
portal_tool_executions_total{tool="listInstances",status="error"} 3
# HELP portal_active_sessions Number of active sessions
# TYPE portal_active_sessions gauge
portal_active_sessions 5
`
		);

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/metrics/summary'
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();

		// Check structure
		expect(body.timestamp).toBeDefined();
		expect(body.chat.totalRequests).toBe(60); // 42 + 18
		expect(body.chat.byModel).toEqual({ gemini: 42, claude: 18 });
		expect(body.tools.totalExecutions).toBe(103); // 100 + 3
		expect(body.tools.byTool).toEqual({ listInstances: 103 });
		expect(body.tools.byStatus).toEqual({ success: 100, error: 3 });
		expect(body.sessions.active).toBe(5);
		expect(body.raw).toHaveLength(3);
	});

	it('returns zeros when no metrics recorded', async () => {
		mockRegistryCollect.mockReturnValue('');

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/metrics/summary'
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.chat.totalRequests).toBe(0);
		expect(body.tools.totalExecutions).toBe(0);
		expect(body.sessions.active).toBe(0);
	});

	it('includes timestamp in ISO format', async () => {
		mockRegistryCollect.mockReturnValue('');

		const res = await app.inject({
			method: 'GET',
			url: '/api/admin/metrics/summary'
		});

		const body = res.json();
		expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
	});
});
