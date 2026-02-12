/**
 * TDD tests for v1 Tool routes (Phase C task C-3.07)
 *
 * Tests the routes at apps/api/src/routes/v1-tools.ts:
 * - GET    /api/v1/tools              — list all tools (with category filter)
 * - GET    /api/v1/tools/:name        — get single tool definition
 * - POST   /api/v1/tools/:name/execute — execute a tool (with confirmation flow)
 *
 * Security contract:
 * - All routes require auth (401 when missing)
 * - GET routes require 'tools:read' permission
 * - POST routes require 'tools:execute' permission
 * - Danger-level tools require 'tools:danger' permission
 * - Confirmation-required tools need X-Confirm header or confirmed: true body
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, simulateSession } from './test-helpers.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAllToolDefinitions = vi.fn();
const mockGetToolsByCategory = vi.fn();
const mockGetToolDefinition = vi.fn();
const mockRequiresApproval = vi.fn();
const mockGetToolWarning = vi.fn();
const mockExecuteTool = vi.fn();

vi.mock('@portal/shared/tools/index', () => ({
	getAllToolDefinitions: (...args: unknown[]) => mockGetAllToolDefinitions(...args),
	getToolsByCategory: (...args: unknown[]) => mockGetToolsByCategory(...args),
	getToolDefinition: (...args: unknown[]) => mockGetToolDefinition(...args),
	requiresApproval: (...args: unknown[]) => mockRequiresApproval(...args),
	getToolWarning: (...args: unknown[]) => mockGetToolWarning(...args),
	executeTool: (...args: unknown[]) => mockExecuteTool(...args)
}));

const mockLogToolExecution = vi.fn();

vi.mock('@portal/server/audit', () => ({
	logToolExecution: (...args: unknown[]) => mockLogToolExecution(...args)
}));

const mockCaptureError = vi.fn();
vi.mock('@portal/server/sentry', () => ({
	captureError: (...args: unknown[]) => mockCaptureError(...args)
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
// Test fixtures
// ---------------------------------------------------------------------------

const COMPUTE_TOOLS = [
	{
		name: 'list-instances',
		category: 'compute',
		description: 'List compute instances',
		approvalLevel: 'none' as const
	},
	{
		name: 'stop-instance',
		category: 'compute',
		description: 'Stop a compute instance',
		approvalLevel: 'confirm' as const
	}
];

const NETWORK_TOOLS = [
	{
		name: 'list-vcns',
		category: 'network',
		description: 'List VCNs',
		approvalLevel: 'none' as const
	}
];

const DANGEROUS_TOOL = {
	name: 'terminate-instance',
	category: 'compute',
	description: 'Terminate a compute instance permanently',
	approvalLevel: 'danger' as const
};

const ALL_TOOLS = [...COMPUTE_TOOLS, ...NETWORK_TOOLS, DANGEROUS_TOOL];

// ---------------------------------------------------------------------------
// GET /api/v1/tools
// ---------------------------------------------------------------------------

describe('GET /api/v1/tools', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		mockGetAllToolDefinitions.mockReset();
		mockGetToolsByCategory.mockReset();
		mockValidateApiKey.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('returns 401 for unauthenticated requests', async () => {
		app = await buildTestApp({ withRbac: true });
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/tools'
		});

		expect(res.statusCode).toBe(401);
	});

	it('returns 403 when user lacks tools:read permission', async () => {
		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/tools'
		});

		expect(res.statusCode).toBe(403);
	});

	it('returns all tools when no category filter', async () => {
		mockGetAllToolDefinitions.mockReturnValue(ALL_TOOLS);

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/tools'
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.tools).toHaveLength(4);
		expect(body.total).toBe(4);
		expect(body.tools[0]).toMatchObject({
			name: 'list-instances',
			category: 'compute',
			description: 'List compute instances',
			approvalLevel: 'none'
		});
	});

	it('filters tools by category when category query param provided', async () => {
		mockGetToolsByCategory.mockReturnValue(COMPUTE_TOOLS);

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/tools?category=compute'
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.tools).toHaveLength(2);
		expect(body.total).toBe(2);
		expect(mockGetToolsByCategory).toHaveBeenCalledWith('compute');
		expect(body.tools.every((t: any) => t.category === 'compute')).toBe(true);
	});

	it('returns empty list when category has no tools', async () => {
		mockGetToolsByCategory.mockReturnValue([]);

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/tools?category=storage'
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.tools).toEqual([]);
		expect(body.total).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// GET /api/v1/tools/:name
// ---------------------------------------------------------------------------

describe('GET /api/v1/tools/:name', () => {
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
		app = await buildTestApp({ withRbac: true });
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/tools/list-instances'
		});

		expect(res.statusCode).toBe(401);
	});

	it('returns 403 when user lacks tools:read permission', async () => {
		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['sessions:write']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/tools/list-instances'
		});

		expect(res.statusCode).toBe(403);
	});

	it('returns 404 for unknown tool', async () => {
		mockGetToolDefinition.mockReturnValue(undefined);

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/tools/nonexistent-tool'
		});

		expect(res.statusCode).toBe(404);
		const body = JSON.parse(res.body);
		expect(body.message).toContain('Tool not found');
		expect(body.message).toContain('nonexistent-tool');
	});

	it('returns tool definition for known tool', async () => {
		mockGetToolDefinition.mockReturnValue(COMPUTE_TOOLS[0]);
		mockRequiresApproval.mockReturnValue(false);
		mockGetToolWarning.mockReturnValue(undefined);

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/tools/list-instances'
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.tool).toMatchObject({
			name: 'list-instances',
			description: 'List compute instances',
			category: 'compute',
			approvalLevel: 'none',
			requiresApproval: false
		});
		expect(body.tool.warning).toBeUndefined();
	});

	it('includes warning and impact for confirmation-required tools', async () => {
		mockGetToolDefinition.mockReturnValue(COMPUTE_TOOLS[1]);
		mockRequiresApproval.mockReturnValue(true);
		mockGetToolWarning.mockReturnValue({
			warning: 'This will stop the instance',
			impact: 'Instance will become unavailable'
		});

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/tools/stop-instance'
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.tool).toMatchObject({
			name: 'stop-instance',
			requiresApproval: true,
			warning: 'This will stop the instance',
			impact: 'Instance will become unavailable'
		});
	});

	it('includes warning and impact for danger-level tools', async () => {
		mockGetToolDefinition.mockReturnValue(DANGEROUS_TOOL);
		mockRequiresApproval.mockReturnValue(true);
		mockGetToolWarning.mockReturnValue({
			warning: 'DANGER: This will permanently delete the instance',
			impact: 'All data will be lost'
		});

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/tools/terminate-instance'
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.tool).toMatchObject({
			name: 'terminate-instance',
			approvalLevel: 'danger',
			requiresApproval: true,
			warning: 'DANGER: This will permanently delete the instance',
			impact: 'All data will be lost'
		});
	});
});

// ---------------------------------------------------------------------------
// POST /api/v1/tools/:name/execute
// ---------------------------------------------------------------------------

describe('POST /api/v1/tools/:name/execute', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		mockGetToolDefinition.mockReset();
		mockRequiresApproval.mockReset();
		mockExecuteTool.mockReset();
		mockLogToolExecution.mockReset();
		mockCaptureError.mockReset();
		mockToolExecutionsInc.mockReset();
		mockToolDurationStartTimer.mockReset().mockReturnValue(vi.fn());
		mockValidateApiKey.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('returns 401 for unauthenticated requests', async () => {
		app = await buildTestApp({ withRbac: true });
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/tools/list-instances/execute',
			payload: { args: {} }
		});

		expect(res.statusCode).toBe(401);
	});

	it('returns 403 when user lacks tools:execute permission', async () => {
		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/tools/list-instances/execute',
			payload: { args: {} }
		});

		expect(res.statusCode).toBe(403);
	});

	it('returns 404 for unknown tool', async () => {
		mockGetToolDefinition.mockReturnValue(undefined);

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/tools/nonexistent-tool/execute',
			payload: { args: {} }
		});

		expect(res.statusCode).toBe(404);
		const body = JSON.parse(res.body);
		expect(body.message).toContain('Tool not found');
	});

	it('executes non-approval tool successfully', async () => {
		mockGetToolDefinition.mockReturnValue(COMPUTE_TOOLS[0]);
		mockRequiresApproval.mockReturnValue(false);
		mockExecuteTool.mockResolvedValue({ instances: [{ id: 'ocid1.instance.1' }] });

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/tools/list-instances/execute',
			payload: { args: { compartmentId: 'ocid1.compartment.1' } }
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.success).toBe(true);
		expect(body.tool).toBe('list-instances');
		expect(body.data).toEqual({ instances: [{ id: 'ocid1.instance.1' }] });
		expect(body.duration).toBeGreaterThanOrEqual(0);
		expect(body.approvalLevel).toBe('none');
	});

	it('returns 422 for confirmation-required tool without confirmation', async () => {
		mockGetToolDefinition.mockReturnValue(COMPUTE_TOOLS[1]);
		mockRequiresApproval.mockReturnValue(true);

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/tools/stop-instance/execute',
			payload: { args: { instanceId: 'ocid1.instance.1' } }
		});

		expect(res.statusCode).toBe(422);
		const body = JSON.parse(res.body);
		expect(body.message).toContain('requires confirmation');
		expect(body.requiresConfirmation).toBe(true);
		expect(body.approvalLevel).toBe('confirm');
	});

	it('executes confirmation-required tool with confirmed body field', async () => {
		mockGetToolDefinition.mockReturnValue(COMPUTE_TOOLS[1]);
		mockRequiresApproval.mockReturnValue(true);
		mockExecuteTool.mockResolvedValue({ stopped: true });

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/tools/stop-instance/execute',
			payload: { args: { instanceId: 'ocid1.instance.1' }, confirmed: true }
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.success).toBe(true);
		expect(body.data).toEqual({ stopped: true });
	});

	it('executes confirmation-required tool with X-Confirm header', async () => {
		mockGetToolDefinition.mockReturnValue(COMPUTE_TOOLS[1]);
		mockRequiresApproval.mockReturnValue(true);
		mockExecuteTool.mockResolvedValue({ stopped: true });

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/tools/stop-instance/execute',
			headers: { 'x-confirm': 'true' },
			payload: { args: { instanceId: 'ocid1.instance.1' } }
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.success).toBe(true);
	});

	it('returns 403 for danger-level tool without tools:danger permission', async () => {
		mockGetToolDefinition.mockReturnValue(DANGEROUS_TOOL);

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/tools/terminate-instance/execute',
			payload: { args: { instanceId: 'ocid1.instance.1' }, confirmed: true }
		});

		expect(res.statusCode).toBe(403);
		const body = JSON.parse(res.body);
		expect(body.message).toContain('tools:danger');
	});

	it('executes danger-level tool with tools:danger permission and confirmation', async () => {
		mockGetToolDefinition.mockReturnValue(DANGEROUS_TOOL);
		mockRequiresApproval.mockReturnValue(true);
		mockExecuteTool.mockResolvedValue({ terminated: true });

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:execute', 'tools:danger']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/tools/terminate-instance/execute',
			payload: { args: { instanceId: 'ocid1.instance.1' }, confirmed: true }
		});

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.success).toBe(true);
		expect(body.data).toEqual({ terminated: true });
		expect(body.approvalLevel).toBe('danger');
	});

	it('records execution metrics on success', async () => {
		mockGetToolDefinition.mockReturnValue(COMPUTE_TOOLS[0]);
		mockRequiresApproval.mockReturnValue(false);
		mockExecuteTool.mockResolvedValue({});

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/v1/tools/list-instances/execute',
			payload: { args: {} }
		});

		expect(mockToolExecutionsInc).toHaveBeenCalledWith(
			expect.objectContaining({
				tool: 'list-instances',
				category: 'compute',
				approval_level: 'none',
				status: 'success'
			})
		);
		expect(mockToolDurationStartTimer).toHaveBeenCalledWith(
			expect.objectContaining({
				tool: 'list-instances',
				category: 'compute'
			})
		);
	});

	it('logs tool execution via audit on success', async () => {
		mockGetToolDefinition.mockReturnValue(COMPUTE_TOOLS[0]);
		mockRequiresApproval.mockReturnValue(false);
		mockExecuteTool.mockResolvedValue({});

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/v1/tools/list-instances/execute',
			payload: { args: { compartmentId: 'ocid1.compartment.1' } }
		});

		expect(mockLogToolExecution).toHaveBeenCalledWith(
			'list-instances',
			'compute',
			'none',
			{ compartmentId: 'ocid1.compartment.1' },
			true, // success
			expect.any(Number), // duration
			undefined, // error
			undefined, // sessionId
			'user-1' // userId
		);
	});

	it('handles tool execution errors gracefully', async () => {
		mockGetToolDefinition.mockReturnValue(COMPUTE_TOOLS[0]);
		mockRequiresApproval.mockReturnValue(false);
		mockExecuteTool.mockRejectedValue(new Error('OCI API timeout'));

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/tools/list-instances/execute',
			payload: { args: {} }
		});

		expect(res.statusCode).toBe(500);
		const body = JSON.parse(res.body);
		expect(body.success).toBe(false);
		expect(body.error).toContain('OCI API timeout');
		expect(body.code).toBe('INTERNAL_ERROR');
	});

	it('records error metrics when tool execution fails', async () => {
		mockGetToolDefinition.mockReturnValue(COMPUTE_TOOLS[0]);
		mockRequiresApproval.mockReturnValue(false);
		mockExecuteTool.mockRejectedValue(new Error('Network error'));

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/v1/tools/list-instances/execute',
			payload: { args: {} }
		});

		expect(mockToolExecutionsInc).toHaveBeenCalledWith(
			expect.objectContaining({
				tool: 'list-instances',
				status: 'error'
			})
		);
		expect(mockCaptureError).toHaveBeenCalled();
	});

	it('logs tool execution failure via audit', async () => {
		mockGetToolDefinition.mockReturnValue(COMPUTE_TOOLS[0]);
		mockRequiresApproval.mockReturnValue(false);
		mockExecuteTool.mockRejectedValue(new Error('Connection refused'));

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/v1/tools/list-instances/execute',
			payload: { args: {} }
		});

		expect(mockLogToolExecution).toHaveBeenCalledWith(
			'list-instances',
			'compute',
			'none',
			{},
			false, // success
			expect.any(Number), // duration
			expect.stringContaining('Connection refused'), // error
			undefined, // sessionId
			'user-1' // userId
		);
	});

	it('accepts empty payload with args defaulting to empty object', async () => {
		mockGetToolDefinition.mockReturnValue(COMPUTE_TOOLS[0]);
		mockRequiresApproval.mockReturnValue(false);
		mockExecuteTool.mockResolvedValue({ success: true });

		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		const { v1ToolRoutes } = await import('../../routes/v1-tools.js');
		await app.register(v1ToolRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/tools/list-instances/execute',
			payload: {}
		});

		expect(res.statusCode).toBe(200);
		expect(mockExecuteTool).toHaveBeenCalledWith('list-instances', {});
	});
});
