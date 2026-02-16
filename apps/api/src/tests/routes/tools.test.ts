/**
 * TDD tests for Tool routes (Phase 9 task 9.10)
 *
 * Tests the routes at apps/api/src/routes/tools.ts:
 * - GET    /api/tools/execute?toolName=xxx — approval requirements for a tool
 * - POST   /api/tools/execute              — execute a tool
 * - GET    /api/tools/approve              — list pending approvals
 * - POST   /api/tools/approve              — approve/reject a tool execution
 *
 * Security contract:
 * - GET/POST /api/tools/execute require 'tools:execute' permission
 * - GET/POST /api/tools/approve require 'tools:approve' permission
 * - Returns 401 for unauthenticated requests
 * - Returns 403 when user lacks required permission
 * - Approval-required tools must have server-side approval consumed before execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToolDefinition = vi.fn();
const mockRequiresApproval = vi.fn();
const mockGetToolWarning = vi.fn();
const mockExecuteTool = vi.fn();

vi.mock('@portal/shared/tools/index', () => ({
	getToolDefinition: (...args: unknown[]) => mockGetToolDefinition(...args),
	requiresApproval: (...args: unknown[]) => mockRequiresApproval(...args),
	getToolWarning: (...args: unknown[]) => mockGetToolWarning(...args),
	executeTool: (...args: unknown[]) => mockExecuteTool(...args)
}));

const mockConsumeApproval = vi.fn();
const mockRecordApproval = vi.fn();
const realPendingApprovals = new Map<
	string,
	{
		toolName: string;
		args: Record<string, unknown>;
		sessionId?: string;
		createdAt: number;
		resolve: (approved: boolean) => void;
	}
>();

vi.mock('@portal/server/approvals', () => ({
	consumeApproval: (...args: unknown[]) => mockConsumeApproval(...args),
	recordApproval: (...args: unknown[]) => mockRecordApproval(...args),
	pendingApprovals: realPendingApprovals
}));

const mockLogToolExecution = vi.fn();
const mockLogToolApproval = vi.fn();

vi.mock('@portal/server/audit', () => ({
	logToolExecution: (...args: unknown[]) => mockLogToolExecution(...args),
	logToolApproval: (...args: unknown[]) => mockLogToolApproval(...args)
}));

const mockCaptureError = vi.fn();
vi.mock('@portal/server/sentry', () => ({
	captureError: (...args: unknown[]) => mockCaptureError(...args),
	wrapWithSpan: vi.fn((_n: string, _o: string, fn: () => unknown) => fn()),
	isSentryEnabled: vi.fn(() => false)
}));

const mockToolExecutionsInc = vi.fn();
const mockToolDurationStartTimer = vi.fn().mockReturnValue(vi.fn());

vi.mock('@portal/server/metrics', () => ({
	toolExecutions: { inc: (...args: unknown[]) => mockToolExecutionsInc(...args) },
	toolDuration: { startTimer: (...args: unknown[]) => mockToolDurationStartTimer(...args) }
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

const mockValidateApiKey = vi.fn();
vi.mock('@portal/server/auth/api-keys', () => ({
	validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args)
}));

vi.mock('@portal/server/auth/rbac', async () => {
	const actual = await vi.importActual<typeof import('@portal/server/auth/rbac')>(
		'@portal/server/auth/rbac'
	);
	return actual;
});

vi.mock('@portal/server/auth/config', () => ({
	auth: {
		api: {
			getSession: vi.fn().mockResolvedValue(null)
		}
	}
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const PERMS_KEY = Symbol('permissions');

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);

	const fakeAuthPlugin = fp(
		async (fastify) => {
			fastify.decorateRequest('user', null);
			fastify.decorateRequest('session', null);
			fastify.decorateRequest('permissions', {
				getter(this: FastifyRequest) {
					const self = this as FastifyRequest & { [PERMS_KEY]?: string[] };
					if (!self[PERMS_KEY]) self[PERMS_KEY] = [];
					return self[PERMS_KEY];
				},
				setter(this: FastifyRequest, value: string[]) {
					(this as FastifyRequest & { [PERMS_KEY]?: string[] })[PERMS_KEY] = value;
				}
			});
			fastify.decorateRequest('apiKeyContext', null);
			fastify.decorateRequest('dbAvailable', true);
		},
		{ name: 'auth', fastify: '5.x' }
	);

	await app.register(fakeAuthPlugin);

	const rbacPlugin = (await import('../../plugins/rbac.js')).default;
	await app.register(rbacPlugin);

	const { toolRoutes } = await import('../../routes/tools.js');
	await app.register(async (instance) => toolRoutes(instance));

	return app;
}

function simulateSession(
	app: FastifyInstance,
	user: Record<string, unknown>,
	permissions: string[]
) {
	app.addHook('onRequest', async (request) => {
		(request as Record<string, unknown>).user = user;
		(request as FastifyRequest).permissions = permissions;
	});
}

// Reusable tool definition for tests
const MOCK_TOOL_DEF = {
	name: 'list-instances',
	category: 'compute',
	description: 'List compute instances',
	approvalLevel: 'none' as const
};

const DESTRUCTIVE_TOOL_DEF = {
	name: 'terminate-instance',
	category: 'compute',
	description: 'Terminate a compute instance',
	approvalLevel: 'confirm' as const
};

// ---------------------------------------------------------------------------
// GET /api/tools/execute?toolName=xxx
// ---------------------------------------------------------------------------

describe('GET /api/tools/execute', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		mockGetToolDefinition.mockReset();
		mockRequiresApproval.mockReset();
		mockGetToolWarning.mockReset();
		mockValidateApiKey.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('returns 401 for unauthenticated requests', async () => {
		app = await buildApp();
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/tools/execute?toolName=list-instances'
		});

		expect(res.statusCode).toBe(401);
	});

	it('returns 403 when user lacks tools:execute permission', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/tools/execute?toolName=list-instances'
		});

		expect(res.statusCode).toBe(403);
	});

	it('returns tool approval requirements for known tool', async () => {
		mockGetToolDefinition.mockReturnValue(MOCK_TOOL_DEF);
		mockRequiresApproval.mockReturnValue(false);
		mockGetToolWarning.mockReturnValue(undefined);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/tools/execute?toolName=list-instances'
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.toolName).toBe('list-instances');
		expect(body.category).toBe('compute');
		expect(body.requiresApproval).toBe(false);
		expect(body.description).toBe('List compute instances');
	});

	it('returns 404 for unknown tool', async () => {
		mockGetToolDefinition.mockReturnValue(undefined);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/tools/execute?toolName=nonexistent-tool'
		});

		expect(res.statusCode).toBe(404);
		const body = JSON.parse(res.body);
		expect(body.message).toContain('Unknown tool');
	});

	it('returns warning and impact for destructive tools', async () => {
		mockGetToolDefinition.mockReturnValue(DESTRUCTIVE_TOOL_DEF);
		mockRequiresApproval.mockReturnValue(true);
		mockGetToolWarning.mockReturnValue({
			warning: 'This will terminate the instance',
			impact: 'Instance and all attached resources will be destroyed'
		});

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/tools/execute?toolName=terminate-instance'
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.requiresApproval).toBe(true);
		expect(body.warning).toBe('This will terminate the instance');
		expect(body.impact).toContain('destroyed');
	});

	it('validates toolName query param is required', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/tools/execute'
		});

		expect(res.statusCode).toBe(400);
	});
});

// ---------------------------------------------------------------------------
// POST /api/tools/execute
// ---------------------------------------------------------------------------

describe('POST /api/tools/execute', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		mockGetToolDefinition.mockReset();
		mockRequiresApproval.mockReset();
		mockExecuteTool.mockReset();
		mockConsumeApproval.mockReset();
		mockLogToolExecution.mockReset();
		mockLogToolApproval.mockReset();
		mockCaptureError.mockReset();
		mockToolExecutionsInc.mockReset();
		mockToolDurationStartTimer.mockReset().mockReturnValue(vi.fn());
		mockValidateApiKey.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('returns 401 for unauthenticated requests', async () => {
		app = await buildApp();
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: { toolName: 'list-instances', args: {} }
		});

		expect(res.statusCode).toBe(401);
	});

	it('returns 403 when user lacks tools:execute permission', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: { toolName: 'list-instances', args: {} }
		});

		expect(res.statusCode).toBe(403);
	});

	it('returns 404 for unknown tool', async () => {
		mockGetToolDefinition.mockReturnValue(undefined);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: { toolName: 'nonexistent-tool', args: {} }
		});

		expect(res.statusCode).toBe(404);
	});

	it('executes non-approval tool successfully', async () => {
		mockGetToolDefinition.mockReturnValue(MOCK_TOOL_DEF);
		mockRequiresApproval.mockReturnValue(false);
		mockExecuteTool.mockResolvedValue({ instances: [{ id: 'i-1' }] });

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: { toolName: 'list-instances', args: { compartmentId: 'ocid1...' } }
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.success).toBe(true);
		expect(body.toolName).toBe('list-instances');
		expect(body.data).toEqual({ instances: [{ id: 'i-1' }] });
		expect(body.duration).toBeGreaterThanOrEqual(0);
	});

	it('records execution metrics on success', async () => {
		mockGetToolDefinition.mockReturnValue(MOCK_TOOL_DEF);
		mockRequiresApproval.mockReturnValue(false);
		mockExecuteTool.mockResolvedValue({});

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: { toolName: 'list-instances', args: {} }
		});

		expect(mockToolExecutionsInc).toHaveBeenCalledWith(
			expect.objectContaining({
				tool: 'list-instances',
				category: 'compute',
				status: 'success'
			})
		);
		expect(mockToolDurationStartTimer).toHaveBeenCalledWith(
			expect.objectContaining({ tool: 'list-instances' })
		);
	});

	it('logs tool execution via audit on success', async () => {
		mockGetToolDefinition.mockReturnValue(MOCK_TOOL_DEF);
		mockRequiresApproval.mockReturnValue(false);
		mockExecuteTool.mockResolvedValue({});

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: { toolName: 'list-instances', args: {}, sessionId: 'sess-1' }
		});

		expect(mockLogToolExecution).toHaveBeenCalledWith(
			'list-instances', // toolName
			'compute', // category
			'none', // approvalLevel
			{}, // args
			true, // success
			expect.any(Number), // duration
			undefined, // error
			'sess-1' // sessionId
		);
	});

	it('returns 403 for approval-required tool without approval', async () => {
		mockGetToolDefinition.mockReturnValue(DESTRUCTIVE_TOOL_DEF);
		mockRequiresApproval.mockReturnValue(true);
		mockConsumeApproval.mockResolvedValue(false);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: {
				toolCallId: 'tc-1',
				toolName: 'terminate-instance',
				args: { instanceId: 'ocid1...' }
			}
		});

		expect(res.statusCode).toBe(403);
		const body = JSON.parse(res.body);
		expect(body.message).toContain('approval');
	});

	it('returns 403 for approval-required tool without toolCallId', async () => {
		mockGetToolDefinition.mockReturnValue(DESTRUCTIVE_TOOL_DEF);
		mockRequiresApproval.mockReturnValue(true);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: {
				toolName: 'terminate-instance',
				args: { instanceId: 'ocid1...' }
			}
		});

		expect(res.statusCode).toBe(403);
	});

	it('executes approval-required tool with valid server-side approval', async () => {
		mockGetToolDefinition.mockReturnValue(DESTRUCTIVE_TOOL_DEF);
		mockRequiresApproval.mockReturnValue(true);
		mockConsumeApproval.mockResolvedValue(true);
		mockExecuteTool.mockResolvedValue({ terminated: true });

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: {
				toolCallId: 'tc-approved',
				toolName: 'terminate-instance',
				args: { instanceId: 'ocid1...' }
			}
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.success).toBe(true);
		expect(body.data).toEqual({ terminated: true });
	});

	it('consumes approval with correct toolCallId and toolName', async () => {
		mockGetToolDefinition.mockReturnValue(DESTRUCTIVE_TOOL_DEF);
		mockRequiresApproval.mockReturnValue(true);
		mockConsumeApproval.mockResolvedValue(true);
		mockExecuteTool.mockResolvedValue({});

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: {
				toolCallId: 'tc-check',
				toolName: 'terminate-instance',
				args: {}
			}
		});

		expect(mockConsumeApproval).toHaveBeenCalledWith('tc-check', 'terminate-instance');
	});

	it('logs approval decision via audit for approval-required tool', async () => {
		mockGetToolDefinition.mockReturnValue(DESTRUCTIVE_TOOL_DEF);
		mockRequiresApproval.mockReturnValue(true);
		mockConsumeApproval.mockResolvedValue(true);
		mockExecuteTool.mockResolvedValue({});

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: {
				toolCallId: 'tc-audit',
				toolName: 'terminate-instance',
				args: { instanceId: 'ocid1...' },
				sessionId: 'sess-1'
			}
		});

		// Should log approval=true (consumed successfully)
		expect(mockLogToolApproval).toHaveBeenCalledWith(
			'terminate-instance',
			'compute',
			'confirm',
			expect.any(Object),
			true, // approved
			'sess-1'
		);
	});

	it('handles tool execution errors gracefully', async () => {
		mockGetToolDefinition.mockReturnValue(MOCK_TOOL_DEF);
		mockRequiresApproval.mockReturnValue(false);
		mockExecuteTool.mockRejectedValue(new Error('OCI API timeout'));

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: { toolName: 'list-instances', args: {} }
		});

		expect(res.statusCode).toBe(500);
		const body = JSON.parse(res.body);
		expect(body.success).toBe(false);
		expect(body.error).toContain('OCI API timeout');
	});

	it('records error metrics when tool execution fails', async () => {
		mockGetToolDefinition.mockReturnValue(MOCK_TOOL_DEF);
		mockRequiresApproval.mockReturnValue(false);
		mockExecuteTool.mockRejectedValue(new Error('fail'));

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: { toolName: 'list-instances', args: {} }
		});

		expect(mockToolExecutionsInc).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'error' })
		);
		expect(mockCaptureError).toHaveBeenCalled();
	});

	it('logs tool execution failure via audit', async () => {
		mockGetToolDefinition.mockReturnValue(MOCK_TOOL_DEF);
		mockRequiresApproval.mockReturnValue(false);
		mockExecuteTool.mockRejectedValue(new Error('Connection refused'));

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: { toolName: 'list-instances', args: {}, sessionId: 'sess-2' }
		});

		expect(mockLogToolExecution).toHaveBeenCalledWith(
			'list-instances',
			'compute',
			'none',
			{},
			false, // success
			expect.any(Number), // duration
			expect.stringContaining('Connection refused'), // error message
			'sess-2'
		);
	});

	it('validates body schema (toolName required)', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: { args: {} }
		});

		expect(res.statusCode).toBe(400);
	});

	it('validates body schema (args required)', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/execute',
			payload: { toolName: 'list-instances' }
		});

		expect(res.statusCode).toBe(400);
	});
});

// ---------------------------------------------------------------------------
// GET /api/tools/approve
// ---------------------------------------------------------------------------

describe('GET /api/tools/approve', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		realPendingApprovals.clear();
		mockValidateApiKey.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('returns 401 for unauthenticated requests', async () => {
		app = await buildApp();
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/tools/approve' });
		expect(res.statusCode).toBe(401);
	});

	it('returns 403 when user lacks tools:approve permission', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/tools/approve' });
		expect(res.statusCode).toBe(403);
	});

	it('returns empty list when no pending approvals', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:approve']);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/tools/approve' });
		expect(res.statusCode).toBe(200);

		const body = JSON.parse(res.body);
		expect(body.pending).toEqual([]);
		expect(body.count).toBe(0);
	});

	it('returns pending approvals from in-memory map', async () => {
		const now = Date.now();
		realPendingApprovals.set('tc-pending-1', {
			toolName: 'terminate-instance',
			args: { instanceId: 'ocid1...' },
			sessionId: 'sess-1',
			createdAt: now,
			resolve: vi.fn()
		});
		realPendingApprovals.set('tc-pending-2', {
			toolName: 'delete-bucket',
			args: { bucketName: 'my-bucket' },
			createdAt: now - 60000,
			resolve: vi.fn()
		});

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:approve']);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/tools/approve' });
		expect(res.statusCode).toBe(200);

		const body = JSON.parse(res.body);
		expect(body.count).toBe(2);
		expect(body.pending[0].toolCallId).toBe('tc-pending-1');
		expect(body.pending[0].toolName).toBe('terminate-instance');
		expect(body.pending[0].sessionId).toBe('sess-1');
		expect(body.pending[1].toolCallId).toBe('tc-pending-2');
		expect(body.pending[1].toolName).toBe('delete-bucket');
	});

	it('formats createdAt as ISO string and includes age', async () => {
		const now = Date.now();
		realPendingApprovals.set('tc-formatted', {
			toolName: 'stop-instance',
			args: {},
			createdAt: now - 5000,
			resolve: vi.fn()
		});

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:approve']);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/tools/approve' });
		const body = JSON.parse(res.body);

		expect(body.pending[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(body.pending[0].age).toBeGreaterThanOrEqual(5000);
	});
});

// ---------------------------------------------------------------------------
// POST /api/tools/approve
// ---------------------------------------------------------------------------

describe('POST /api/tools/approve', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		realPendingApprovals.clear();
		mockGetToolDefinition.mockReset();
		mockRecordApproval.mockReset().mockResolvedValue(undefined);
		mockLogToolApproval.mockReset();
		mockValidateApiKey.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('returns 401 for unauthenticated requests', async () => {
		app = await buildApp();
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/approve',
			payload: { toolCallId: 'tc-1', approved: true }
		});

		expect(res.statusCode).toBe(401);
	});

	it('returns 403 when user lacks tools:approve permission', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/approve',
			payload: { toolCallId: 'tc-1', approved: true }
		});

		expect(res.statusCode).toBe(403);
	});

	it('returns 404 when tool call not in pending map', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:approve']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/approve',
			payload: { toolCallId: 'tc-nonexistent', approved: true }
		});

		expect(res.statusCode).toBe(404);
		const body = JSON.parse(res.body);
		expect(body.message).toContain('No pending approval');
	});

	it('approves tool and records server-side approval', async () => {
		const mockResolve = vi.fn();
		realPendingApprovals.set('tc-approve-1', {
			toolName: 'terminate-instance',
			args: { instanceId: 'ocid1...' },
			sessionId: 'sess-1',
			createdAt: Date.now(),
			resolve: mockResolve
		});

		mockGetToolDefinition.mockReturnValue(DESTRUCTIVE_TOOL_DEF);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:approve']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/approve',
			payload: { toolCallId: 'tc-approve-1', approved: true }
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.success).toBe(true);
		expect(body.approved).toBe(true);
		expect(body.message).toContain('approved');

		// Should record server-side approval
		expect(mockRecordApproval).toHaveBeenCalledWith('tc-approve-1', 'terminate-instance');
		// Should resolve the pending promise
		expect(mockResolve).toHaveBeenCalledWith(true);
		// Should remove from pending map
		expect(realPendingApprovals.has('tc-approve-1')).toBe(false);
	});

	it('rejects tool and does NOT record server-side approval', async () => {
		const mockResolve = vi.fn();
		realPendingApprovals.set('tc-reject-1', {
			toolName: 'terminate-instance',
			args: { instanceId: 'ocid1...' },
			createdAt: Date.now(),
			resolve: mockResolve
		});

		mockGetToolDefinition.mockReturnValue(DESTRUCTIVE_TOOL_DEF);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:approve']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/approve',
			payload: { toolCallId: 'tc-reject-1', approved: false, reason: 'Too risky' }
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.success).toBe(true);
		expect(body.approved).toBe(false);
		expect(body.message).toContain('rejected');

		// Should NOT record approval
		expect(mockRecordApproval).not.toHaveBeenCalled();
		// Should resolve with false
		expect(mockResolve).toHaveBeenCalledWith(false);
		// Should remove from pending map
		expect(realPendingApprovals.has('tc-reject-1')).toBe(false);
	});

	it('logs approval decision via audit', async () => {
		realPendingApprovals.set('tc-audit-1', {
			toolName: 'terminate-instance',
			args: { instanceId: 'ocid1...' },
			sessionId: 'sess-1',
			createdAt: Date.now(),
			resolve: vi.fn()
		});

		mockGetToolDefinition.mockReturnValue(DESTRUCTIVE_TOOL_DEF);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:approve']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/tools/approve',
			payload: { toolCallId: 'tc-audit-1', approved: true }
		});

		expect(mockLogToolApproval).toHaveBeenCalledWith(
			'terminate-instance',
			'compute',
			'confirm',
			expect.any(Object),
			true,
			'sess-1'
		);
	});

	it('validates body schema (toolCallId required)', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:approve']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/approve',
			payload: { approved: true }
		});

		expect(res.statusCode).toBe(400);
	});

	it('validates body schema (approved required)', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:approve']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/approve',
			payload: { toolCallId: 'tc-1' }
		});

		expect(res.statusCode).toBe(400);
	});

	it('uses "unknown" category when tool definition not found', async () => {
		realPendingApprovals.set('tc-unknown-tool', {
			toolName: 'removed-tool',
			args: {},
			createdAt: Date.now(),
			resolve: vi.fn()
		});

		mockGetToolDefinition.mockReturnValue(undefined);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:approve']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/tools/approve',
			payload: { toolCallId: 'tc-unknown-tool', approved: true }
		});

		expect(mockLogToolApproval).toHaveBeenCalledWith(
			'removed-tool',
			'unknown', // fallback category
			'confirm', // fallback approvalLevel
			expect.any(Object),
			true,
			undefined
		);
	});
});
