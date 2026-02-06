/**
 * Phase 8 Security Fix: Webhook PUT validation (M-19, M-20)
 *
 * M-19: Webhook PUT accepts arbitrary `status` values — should validate against allowlist.
 *        Users can only set 'active' | 'paused'. 'failed' is system-managed.
 * M-20: Webhook PUT `events` array not validated against WebhookEventTypeSchema.
 *        Each element must be one of: 'tool.executed', 'workflow.completed', 'workflow.failed', 'approval.requested'.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('$lib/server/api/require-auth.js', () => ({
	requireApiAuth: vi.fn(),
	resolveOrgId: vi.fn(() => 'test-org')
}));

const mockGetById = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('$lib/server/oracle/repositories/webhook-repository.js', () => ({
	webhookRepository: {
		getById: mockGetById,
		update: mockUpdate,
		delete: mockDelete
	}
}));

vi.mock('$lib/server/webhooks.js', () => ({
	isValidWebhookUrl: vi.fn(() => true)
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn()
	})
}));

// ============================================================================
// Helpers
// ============================================================================

function createMockEvent(body: Record<string, unknown>): RequestEvent {
	return {
		params: { id: 'wh-test-123' },
		request: new Request('http://localhost/api/v1/webhooks/wh-test-123', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		locals: { requestId: 'req-test' },
		url: new URL('http://localhost/api/v1/webhooks/wh-test-123')
	} as unknown as RequestEvent;
}

// ============================================================================
// Tests
// ============================================================================

describe('Webhook PUT validation fixes', () => {
	let PUT: (event: RequestEvent) => Promise<Response>;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockUpdate.mockResolvedValue(undefined);
		vi.resetModules();
		const mod = await import('../../routes/api/v1/webhooks/[id]/+server.js');
		PUT = mod.PUT as (event: RequestEvent) => Promise<Response>;
	});

	// ========================================================================
	// M-19: Status validation
	// ========================================================================
	describe('M-19: status validation', () => {
		test('accepts status "active"', async () => {
			const event = createMockEvent({ status: 'active' });
			const response = await PUT(event);
			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(mockUpdate).toHaveBeenCalledWith('wh-test-123', 'test-org', { status: 'active' });
		});

		test('accepts status "paused"', async () => {
			const event = createMockEvent({ status: 'paused' });
			const response = await PUT(event);
			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(mockUpdate).toHaveBeenCalledWith('wh-test-123', 'test-org', { status: 'paused' });
		});

		test('rejects status "failed" (system-managed)', async () => {
			const event = createMockEvent({ status: 'failed' });
			const response = await PUT(event);
			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toMatch(/invalid status/i);
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		test('rejects arbitrary status "hacked"', async () => {
			const event = createMockEvent({ status: 'hacked' });
			const response = await PUT(event);
			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toMatch(/invalid status/i);
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		test('rejects empty string status', async () => {
			const event = createMockEvent({ status: '' });
			const response = await PUT(event);
			// Empty string is typeof 'string' so it should hit validation and fail
			expect(response.status).toBe(400);
			expect(mockUpdate).not.toHaveBeenCalled();
		});
	});

	// ========================================================================
	// M-20: Events validation
	// ========================================================================
	describe('M-20: events validation', () => {
		test('accepts valid single event', async () => {
			const event = createMockEvent({ events: ['tool.executed'] });
			const response = await PUT(event);
			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(mockUpdate).toHaveBeenCalledWith('wh-test-123', 'test-org', {
				events: ['tool.executed']
			});
		});

		test('accepts multiple valid events', async () => {
			const event = createMockEvent({
				events: ['tool.executed', 'workflow.completed']
			});
			const response = await PUT(event);
			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(mockUpdate).toHaveBeenCalledWith('wh-test-123', 'test-org', {
				events: ['tool.executed', 'workflow.completed']
			});
		});

		test('accepts all four valid event types', async () => {
			const event = createMockEvent({
				events: ['tool.executed', 'workflow.completed', 'workflow.failed', 'approval.requested']
			});
			const response = await PUT(event);
			expect(response.status).toBe(200);
		});

		test('rejects invalid event type', async () => {
			const event = createMockEvent({ events: ['evil.event'] });
			const response = await PUT(event);
			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toMatch(/invalid events/i);
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		test('rejects empty events array (min 1)', async () => {
			const event = createMockEvent({ events: [] });
			const response = await PUT(event);
			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toMatch(/invalid events/i);
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		test('rejects mixed valid and invalid events', async () => {
			const event = createMockEvent({
				events: ['tool.executed', 'not.a.real.event']
			});
			const response = await PUT(event);
			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toMatch(/invalid events/i);
			expect(mockUpdate).not.toHaveBeenCalled();
		});
	});

	// ========================================================================
	// Combined: status + events in single request
	// ========================================================================
	describe('combined status + events updates', () => {
		test('accepts valid status and valid events together', async () => {
			const event = createMockEvent({
				status: 'paused',
				events: ['workflow.failed']
			});
			const response = await PUT(event);
			expect(response.status).toBe(200);
			expect(mockUpdate).toHaveBeenCalledWith('wh-test-123', 'test-org', {
				status: 'paused',
				events: ['workflow.failed']
			});
		});

		test('rejects when status is invalid even if events are valid', async () => {
			const event = createMockEvent({
				status: 'deleted',
				events: ['tool.executed']
			});
			const response = await PUT(event);
			expect(response.status).toBe(400);
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		test('rejects when events are invalid even if status is valid', async () => {
			const event = createMockEvent({
				status: 'active',
				events: ['bogus.type']
			});
			const response = await PUT(event);
			expect(response.status).toBe(400);
			expect(mockUpdate).not.toHaveBeenCalled();
		});
	});
});
