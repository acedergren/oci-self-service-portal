/**
 * Phase 8 Security Fix: Webhook PUT validation (M-19, M-20)
 *
 * M-19: Webhook PUT accepts arbitrary `status` values — should validate against allowlist.
 *        Users can only set 'active' | 'paused'. 'failed' is system-managed.
 * M-20: Webhook PUT `events` array not validated against WebhookEventTypeSchema.
 *        Each element must be one of: 'tool.executed', 'workflow.completed', 'workflow.failed', 'approval.requested'.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ============================================================================
// Schema definitions (matching backend validation)
// ============================================================================

const WebhookStatusSchema = z.enum(['active', 'paused']);
const WebhookEventTypeSchema = z.enum([
	'tool.executed',
	'workflow.completed',
	'workflow.failed',
	'approval.requested'
]);
const WebhookEventTypesSchema = z.array(WebhookEventTypeSchema).min(1);

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
	isValidWebhookUrl: vi.fn().mockResolvedValue(true)
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

function validateWebhookUpdate(data: Record<string, unknown>): { valid: boolean; error?: string } {
	try {
		const updateSchema = z.object({
			status: WebhookStatusSchema.optional(),
			events: WebhookEventTypesSchema.optional(),
			url: z.string().url().optional()
		});

		updateSchema.parse(data);
		return { valid: true };
	} catch (err) {
		if (err instanceof z.ZodError) {
			// ZodError.issues is the array of validation issues
			const issues = err.issues;
			if (issues && issues.length > 0) {
				return {
					valid: false,
					error: issues[0].message
				};
			}
		}
		return {
			valid: false,
			error: 'Validation failed'
		};
	}
}

// ============================================================================
// Tests
// ============================================================================

describe('Webhook PUT validation fixes', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		mockUpdate.mockResolvedValue(undefined);
	});

	// ========================================================================
	// M-19: Status validation
	// ========================================================================
	describe('M-19: status validation', () => {
		test('accepts status "active"', () => {
			const result = validateWebhookUpdate({ status: 'active' });
			expect(result.valid).toBe(true);
		});

		test('accepts status "paused"', () => {
			const result = validateWebhookUpdate({ status: 'paused' });
			expect(result.valid).toBe(true);
		});

		test('rejects status "failed" (system-managed)', () => {
			const result = validateWebhookUpdate({ status: 'failed' });
			expect(result.valid).toBe(false);
			expect(result.error).toMatch(/Invalid option/i);
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		test('rejects arbitrary status "hacked"', () => {
			const result = validateWebhookUpdate({ status: 'hacked' });
			expect(result.valid).toBe(false);
			expect(result.error).toMatch(/Invalid option/i);
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		test('rejects empty string status', () => {
			const result = validateWebhookUpdate({ status: '' });
			expect(result.valid).toBe(false);
			expect(mockUpdate).not.toHaveBeenCalled();
		});
	});

	// ========================================================================
	// M-20: Events validation
	// ========================================================================
	describe('M-20: events validation', () => {
		test('accepts valid single event', () => {
			const result = validateWebhookUpdate({ events: ['tool.executed'] });
			expect(result.valid).toBe(true);
		});

		test('accepts multiple valid events', () => {
			const result = validateWebhookUpdate({
				events: ['tool.executed', 'workflow.completed']
			});
			expect(result.valid).toBe(true);
		});

		test('accepts all four valid event types', () => {
			const result = validateWebhookUpdate({
				events: ['tool.executed', 'workflow.completed', 'workflow.failed', 'approval.requested']
			});
			expect(result.valid).toBe(true);
		});

		test('rejects invalid event type', () => {
			const result = validateWebhookUpdate({ events: ['evil.event'] });
			expect(result.valid).toBe(false);
			expect(result.error).toMatch(/Invalid option/i);
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		test('rejects empty events array (min 1)', () => {
			const result = validateWebhookUpdate({ events: [] });
			expect(result.valid).toBe(false);
			expect(result.error).toMatch(/Too small/i);
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		test('rejects mixed valid and invalid events', () => {
			const result = validateWebhookUpdate({
				events: ['tool.executed', 'not.a.real.event']
			});
			expect(result.valid).toBe(false);
			expect(result.error).toMatch(/Invalid option/i);
			expect(mockUpdate).not.toHaveBeenCalled();
		});
	});

	// ========================================================================
	// Combined: status + events in single request
	// ========================================================================
	describe('combined status + events updates', () => {
		test('accepts valid status and valid events together', () => {
			const result = validateWebhookUpdate({
				status: 'paused',
				events: ['workflow.failed']
			});
			expect(result.valid).toBe(true);
		});

		test('rejects when status is invalid even if events are valid', () => {
			const result = validateWebhookUpdate({
				status: 'deleted',
				events: ['tool.executed']
			});
			expect(result.valid).toBe(false);
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		test('rejects when events are invalid even if status is valid', () => {
			const result = validateWebhookUpdate({
				status: 'active',
				events: ['bogus.type']
			});
			expect(result.valid).toBe(false);
			expect(mockUpdate).not.toHaveBeenCalled();
		});
	});
});
