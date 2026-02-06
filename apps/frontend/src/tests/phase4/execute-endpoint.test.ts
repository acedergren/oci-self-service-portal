/**
 * Phase 4 TDD: Execute Endpoint (/api/tools/execute)
 *
 * Tests the execute endpoint after duplicate executor removal (Task #3).
 * The endpoint should delegate to the central registry instead of
 * maintaining its own inline toolExecutors map.
 *
 * Mocks: registry, audit, rbac, logger
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolDefinition } from '@portal/shared/tools/types.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetToolDefinition = vi.fn<(name: string) => ToolDefinition | undefined>();
const mockRequiresApproval = vi.fn<(level: string) => boolean>();
const mockGetToolWarning = vi.fn();
const mockExecuteTool = vi.fn<(name: string, args: Record<string, unknown>) => Promise<unknown>>();

vi.mock('$lib/tools/index.js', () => ({
	getToolDefinition: (...args: unknown[]) => mockGetToolDefinition(args[0] as string),
	requiresApproval: (...args: unknown[]) => mockRequiresApproval(args[0] as string),
	getToolWarning: (...args: unknown[]) => mockGetToolWarning(args[0]),
	executeTool: (...args: unknown[]) =>
		mockExecuteTool(args[0] as string, args[1] as Record<string, unknown>)
}));

const mockConsumeApproval = vi.fn<(toolCallId: string, toolName: string) => Promise<boolean>>();

vi.mock('$lib/server/approvals.js', () => ({
	consumeApproval: (...args: unknown[]) => mockConsumeApproval(args[0] as string, args[1] as string)
}));

vi.mock('$lib/server/audit.js', () => ({
	logToolExecution: vi.fn(),
	logToolApproval: vi.fn()
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

vi.mock('$lib/server/auth/rbac.js', () => ({
	requirePermission: vi.fn()
}));

vi.mock('$lib/server/sentry.js', () => ({
	captureError: vi.fn()
}));

vi.mock('$lib/server/metrics.js', () => ({
	toolExecutions: { inc: vi.fn() },
	toolDuration: { startTimer: vi.fn().mockReturnValue(vi.fn()) }
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeToolDef(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
	return {
		name: 'listInstances',
		description: 'List compute instances',
		category: 'compute',
		approvalLevel: 'auto',
		parameters: {} as ToolDefinition['parameters'],
		...overrides
	};
}

type Locals = {
	user: { id: string };
	permissions: string[];
};

function makeRequestEvent(options: {
	method: 'GET' | 'POST';
	searchParams?: Record<string, string>;
	body?: Record<string, unknown>;
}) {
	const url = new URL('http://localhost/api/tools/execute');
	if (options.searchParams) {
		for (const [key, value] of Object.entries(options.searchParams)) {
			url.searchParams.set(key, value);
		}
	}

	const locals: Locals = {
		user: { id: 'test-user' },
		permissions: ['tools:execute']
	};

	return {
		url,
		locals,
		request: {
			json: vi.fn().mockResolvedValue(options.body ?? {})
		}
	};
}

// ── Tests ──────────────────────────────────────────────────────────────────

type MockHandlers = {
	GET: (event: ReturnType<typeof makeRequestEvent>) => Promise<Response>;
	POST: (event: ReturnType<typeof makeRequestEvent>) => Promise<Response>;
};

let serverModule: MockHandlers | null = null;
let moduleError: string | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		serverModule = (await import('../../routes/api/tools/execute/+server.js')) as any;
	} catch (err) {
		moduleError = (err as Error).message;
	}
});

describe('Execute Endpoint (Phase 4.1 - Task #3)', () => {
	describe('module availability', () => {
		it('execute endpoint module should be importable', () => {
			if (moduleError) {
				expect.fail(
					`execute endpoint not importable: ${moduleError}. ` +
						'Check that +server.ts compiles cleanly.'
				);
			}
			expect(serverModule).not.toBeNull();
		});
	});

	describe('GET /api/tools/execute — tool lookup', () => {
		it('returns 400 when toolName is missing', async () => {
			if (!serverModule) return;
			const event = makeRequestEvent({ method: 'GET' });
			const response = await serverModule.GET(event);
			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toMatch(/missing/i);
		});

		it('returns 404 for unknown tool', async () => {
			if (!serverModule) return;
			mockGetToolDefinition.mockReturnValue(undefined);

			const event = makeRequestEvent({
				method: 'GET',
				searchParams: { toolName: 'nonExistentTool' }
			});
			const response = await serverModule.GET(event);
			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error).toContain('nonExistentTool');
		});

		it('returns tool metadata for a known tool', async () => {
			if (!serverModule) return;
			const toolDef = makeToolDef({ name: 'listInstances', approvalLevel: 'auto' });
			mockGetToolDefinition.mockReturnValue(toolDef);
			mockRequiresApproval.mockReturnValue(false);
			mockGetToolWarning.mockReturnValue(undefined);

			const event = makeRequestEvent({
				method: 'GET',
				searchParams: { toolName: 'listInstances' }
			});
			const response = await serverModule.GET(event);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.toolName).toBe('listInstances');
			expect(data.category).toBe('compute');
			expect(data.approvalLevel).toBe('auto');
			expect(data.requiresApproval).toBe(false);
		});

		it('includes warning for destructive tools', async () => {
			if (!serverModule) return;
			const toolDef = makeToolDef({
				name: 'terminateInstance',
				approvalLevel: 'danger'
			});
			mockGetToolDefinition.mockReturnValue(toolDef);
			mockRequiresApproval.mockReturnValue(true);
			mockGetToolWarning.mockReturnValue({
				warning: 'This will permanently delete the instance.',
				impact: 'Instance will be unrecoverable.'
			});

			const event = makeRequestEvent({
				method: 'GET',
				searchParams: { toolName: 'terminateInstance' }
			});
			const response = await serverModule.GET(event);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.requiresApproval).toBe(true);
			expect(data.warning).toContain('permanently delete');
			expect(data.impact).toContain('unrecoverable');
		});
	});

	describe('POST /api/tools/execute — tool execution', () => {
		it('returns 400 when toolName is missing', async () => {
			if (!serverModule) return;
			const event = makeRequestEvent({
				method: 'POST',
				body: { args: { foo: 'bar' } }
			});
			const response = await serverModule.POST(event);
			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toMatch(/missing/i);
		});

		it('returns 400 when args is missing', async () => {
			if (!serverModule) return;
			const event = makeRequestEvent({
				method: 'POST',
				body: { toolName: 'listInstances' }
			});
			const response = await serverModule.POST(event);
			expect(response.status).toBe(400);
		});

		it('returns 404 for unknown tool', async () => {
			if (!serverModule) return;
			mockGetToolDefinition.mockReturnValue(undefined);

			const event = makeRequestEvent({
				method: 'POST',
				body: { toolName: 'nonExistentTool', args: {} }
			});
			const response = await serverModule.POST(event);
			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error).toContain('nonExistentTool');
		});

		it('returns 403 when approval is required but not given', async () => {
			if (!serverModule) return;
			const toolDef = makeToolDef({
				name: 'terminateInstance',
				approvalLevel: 'danger'
			});
			mockGetToolDefinition.mockReturnValue(toolDef);
			mockRequiresApproval.mockReturnValue(true);
			mockConsumeApproval.mockResolvedValue(false);

			const event = makeRequestEvent({
				method: 'POST',
				body: {
					toolName: 'terminateInstance',
					args: { instanceId: 'ocid1.instance.test' },
					toolCallId: 'tc-no-approval'
				}
			});
			const response = await serverModule.POST(event);
			expect(response.status).toBe(403);

			const data = await response.json();
			expect(data.error).toContain('approval');
			expect(data.code).toBeDefined();
		});

		it('returns 400 when invalid JSON is sent', async () => {
			if (!serverModule) return;
			const event = makeRequestEvent({ method: 'POST' });
			event.request.json = vi.fn().mockRejectedValue(new SyntaxError('Unexpected token'));

			const response = await serverModule.POST(event);
			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toMatch(/invalid json/i);
		});

		it('returns structured result with toolName and toolCallId', async () => {
			if (!serverModule) return;
			const toolDef = makeToolDef({
				name: 'stopInstance',
				approvalLevel: 'danger'
			});
			mockGetToolDefinition.mockReturnValue(toolDef);
			mockRequiresApproval.mockReturnValue(true);
			mockConsumeApproval.mockResolvedValue(true);
			mockExecuteTool.mockResolvedValue({ lifecycleState: 'STOPPING' });

			const event = makeRequestEvent({
				method: 'POST',
				body: {
					toolName: 'stopInstance',
					args: { instanceId: 'ocid1.instance.test' },
					toolCallId: 'tc-123'
				}
			});

			const response = await serverModule.POST(event);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.toolName).toBe('stopInstance');
			expect(data.toolCallId).toBe('tc-123');
			expect(data.success).toBe(true);
			expect(data.data).toEqual({ lifecycleState: 'STOPPING' });
			expect(typeof data.duration).toBe('number');
			expect(data.approvalLevel).toBe('danger');
		});

		it('returns 500 when executor throws', async () => {
			if (!serverModule) return;
			const toolDef = makeToolDef({
				name: 'stopInstance',
				approvalLevel: 'danger'
			});
			mockGetToolDefinition.mockReturnValue(toolDef);
			mockRequiresApproval.mockReturnValue(true);
			mockConsumeApproval.mockResolvedValue(true);
			mockExecuteTool.mockRejectedValue(new Error('OCI CLI error: instance not found'));

			const event = makeRequestEvent({
				method: 'POST',
				body: {
					toolName: 'stopInstance',
					args: { instanceId: 'ocid1.instance.invalid' },
					toolCallId: 'tc-456'
				}
			});

			const response = await serverModule.POST(event);
			expect(response.status).toBe(500);

			const data = await response.json();
			expect(data.success).toBe(false);
			expect(data.toolName).toBe('stopInstance');
			expect(data.toolCallId).toBe('tc-456');
			expect(data.error).toContain('instance not found');
		});
	});

	describe('RBAC enforcement', () => {
		it('calls requirePermission with tools:execute', async () => {
			if (!serverModule) return;
			const { requirePermission } = await import('$lib/server/auth/rbac.js');

			const event = makeRequestEvent({
				method: 'GET',
				searchParams: { toolName: 'listInstances' }
			});
			mockGetToolDefinition.mockReturnValue(makeToolDef());
			mockRequiresApproval.mockReturnValue(false);
			mockGetToolWarning.mockReturnValue(undefined);

			await serverModule.GET(event);

			expect(requirePermission).toHaveBeenCalledWith(
				expect.objectContaining({ locals: expect.any(Object) }),
				'tools:execute'
			);
		});
	});
});
