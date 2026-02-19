/**
 * Tests for the action workflow.
 *
 * Tests the two step execute functions directly (bypassing Mastra's execution
 * engine) so the retry and compensation utilities can be exercised in isolation.
 *
 * Mocking strategy:
 * - executeTool: vi.fn() intercepting all OCI API calls
 * - toolDefinitions: Map controlling which tool names are "registered"
 *
 * Mock wiring:
 * - mockExecuteTool uses the forwarding pattern (lazy reference, survives mockReset)
 * - mockToolDefinitions is created inside the factory (avoids vi.mock TDZ) and
 *   exposed via globalThis.__actionWorkflowMocks so tests can access and mutate it
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Registry mock ────────────────────────────────────────────────────────────

// Forwarding pattern: inner vi.fn() referenced lazily inside arrow fn — TDZ-safe
const mockExecuteTool = vi.fn();

vi.mock('../tools/registry.js', () => {
	// Create Map inside the factory to avoid TDZ (vi.mock factories are hoisted
	// before module-level const declarations are initialized)
	const toolDefinitions = new Map<string, { approvalLevel: string }>();
	(globalThis as Record<string, unknown>)['__actionWorkflowMocks'] = { toolDefinitions };
	return {
		executeTool: (...args: unknown[]) => mockExecuteTool(...args),
		toolDefinitions
	};
});

// Import steps AFTER mocks are in place
import { actionWorkflow } from './action-workflow.js';

// Typed handle to the shared mock Map (safe to read here — factories already ran)
const mockToolDefinitions = (
	(globalThis as Record<string, unknown>)['__actionWorkflowMocks'] as {
		toolDefinitions: Map<string, { approvalLevel: string }>;
	}
).toolDefinitions;

// ── Helpers ──────────────────────────────────────────────────────────────────

type StepId = 'validate' | 'execute';

/**
 * Call a step's execute function with minimal required params.
 * Only inputData is needed by both steps in this workflow.
 */
async function runStep(stepId: StepId, inputData: unknown): Promise<unknown> {
	// Access step definition from the committed workflow
	const step = (
		actionWorkflow as unknown as {
			steps: Record<string, { execute: (...args: unknown[]) => Promise<unknown> }>;
		}
	).steps[stepId];

	if (!step) throw new Error(`Step '${stepId}' not found in actionWorkflow`);

	return step.execute({ inputData } as never);
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	mockToolDefinitions.clear();
	// Register some tools for tests that need them
	mockToolDefinitions.set('launchInstance', { approvalLevel: 'confirm' });
	mockToolDefinitions.set('terminateInstance', { approvalLevel: 'danger' });
	mockToolDefinitions.set('listInstances', { approvalLevel: 'auto' });
	// Default: tools succeed with a simple object
	mockExecuteTool.mockResolvedValue({ success: true });
});

// ── validate step ────────────────────────────────────────────────────────────

describe('validate step', () => {
	it('passes when all tool names are registered', async () => {
		const result = (await runStep('validate', {
			actions: [{ toolName: 'launchInstance', args: {} }],
			defaultRetryPolicy: undefined
		})) as { actions: unknown[]; resolvedDefaultPolicy: object };

		expect(result.actions).toHaveLength(1);
		expect(result.resolvedDefaultPolicy).toBeDefined();
	});

	it('throws for a single unknown tool', async () => {
		await expect(
			runStep('validate', {
				actions: [{ toolName: 'nonExistentTool', args: {} }]
			})
		).rejects.toThrow('Unknown tool name(s): nonExistentTool');
	});

	it('includes all unknown tool names in the error', async () => {
		await expect(
			runStep('validate', {
				actions: [
					{ toolName: 'badToolA', args: {} },
					{ toolName: 'listInstances', args: {} }, // valid
					{ toolName: 'badToolB', args: {} }
				]
			})
		).rejects.toThrow('Unknown tool name(s): badToolA, badToolB');
	});

	it('resolves defaultRetryPolicy using STANDARD_RETRY as base', async () => {
		const result = (await runStep('validate', {
			actions: [{ toolName: 'listInstances', args: {} }],
			defaultRetryPolicy: { maxRetries: 5 }
		})) as { resolvedDefaultPolicy: { maxRetries: number; backoffMs: number } };

		// Override maxRetries=5, backoffMs stays at STANDARD_RETRY default (1000)
		expect(result.resolvedDefaultPolicy.maxRetries).toBe(5);
		expect(result.resolvedDefaultPolicy.backoffMs).toBe(1000);
	});
});

// ── execute step ─────────────────────────────────────────────────────────────

describe('execute step', () => {
	/** Build handoff input from validate step */
	function handoff(
		actions: Array<{
			toolName: string;
			args?: Record<string, unknown>;
			compensate?: { action: string; args?: Record<string, unknown> };
			retryPolicy?: Record<string, unknown>;
		}>,
		retryOverride?: object
	) {
		return {
			actions: actions.map((a) => ({ args: {}, ...a })),
			resolvedDefaultPolicy: {
				maxRetries: retryOverride ? 2 : 0, // 0 = no retries unless overridden
				backoffMs: 0,
				backoffMultiplier: 1
			}
		};
	}

	it('executes a single action and returns its result', async () => {
		mockExecuteTool.mockResolvedValue({ instanceId: 'i-123' });

		const result = (await runStep(
			'execute',
			handoff([{ toolName: 'launchInstance', args: { shape: 'VM.Standard3' } }])
		)) as { results: Array<{ success: boolean; result: unknown; attempts: number }> };

		expect(result.results).toHaveLength(1);
		expect(result.results[0].success).toBe(true);
		expect(result.results[0].result).toEqual({ instanceId: 'i-123' });
		expect(result.results[0].attempts).toBe(1);
		expect(mockExecuteTool).toHaveBeenCalledWith('launchInstance', { shape: 'VM.Standard3' });
	});

	it('executes multiple actions in order', async () => {
		const order: string[] = [];
		mockExecuteTool.mockImplementation((toolName: string) => {
			order.push(toolName as string);
			return Promise.resolve({ ok: true });
		});

		await runStep(
			'execute',
			handoff([
				{ toolName: 'listInstances' },
				{ toolName: 'launchInstance' },
				{ toolName: 'terminateInstance' }
			])
		);

		expect(order).toEqual(['listInstances', 'launchInstance', 'terminateInstance']);
	});

	it('records attempts = 1 on first-try success', async () => {
		const result = (await runStep('execute', handoff([{ toolName: 'listInstances' }]))) as {
			results: Array<{ attempts: number }>;
		};

		expect(result.results[0].attempts).toBe(1);
	});

	it('registers compensation after successful action', async () => {
		const result = (await runStep(
			'execute',
			handoff([
				{
					toolName: 'launchInstance',
					compensate: { action: 'terminateInstance', args: { id: 'i-123' } }
				},
				{ toolName: 'listInstances' } // subsequent action succeeds → no rollback triggered
			])
		)) as { results: Array<{ success: boolean }> };

		expect(result.results).toHaveLength(2);
		expect(result.results.every((r) => r.success)).toBe(true);
		// terminateInstance was never called (all steps succeeded)
		expect(mockExecuteTool).not.toHaveBeenCalledWith('terminateInstance', expect.any(Object));
	});

	it('runs compensations in reverse order when an action fails', async () => {
		const calls: string[] = [];

		let callIndex = 0;
		mockExecuteTool.mockImplementation((toolName: string) => {
			callIndex++;
			calls.push(toolName as string);
			// First two calls succeed, third fails
			if (callIndex === 3) return Promise.reject(new Error('quota exceeded'));
			return Promise.resolve({ ok: true });
		});

		const result = (await runStep(
			'execute',
			handoff([
				{
					toolName: 'launchInstance',
					compensate: { action: 'terminateInstance', args: { id: 'i-1' } }
				},
				{
					toolName: 'launchInstance',
					compensate: { action: 'terminateInstance', args: { id: 'i-2' } }
				},
				{ toolName: 'launchInstance' } // fails — triggers rollback
			])
		)) as {
			results: Array<{ success: boolean; error?: string }>;
			compensationSummary?: {
				total: number;
				succeeded: number;
				failed: number;
			};
		};

		// Third action failed
		expect(result.results[2].success).toBe(false);
		expect(result.results[2].error).toContain('quota exceeded');

		// Two compensations were registered (first two succeeded)
		expect(result.compensationSummary).toBeDefined();
		expect(result.compensationSummary!.total).toBe(2);
		expect(result.compensationSummary!.succeeded).toBe(2);

		// Compensations executed in REVERSE order (LIFO) — verify both names and args
		const compensationCalls = calls.slice(3); // after the 3 launchInstance calls
		expect(compensationCalls).toEqual(['terminateInstance', 'terminateInstance']);

		// LIFO semantics: second-registered compensation (i-2) runs before first (i-1)
		const compensationArgs = mockExecuteTool.mock.calls.slice(3).map(([, args]) => args);
		expect(compensationArgs).toEqual([{ id: 'i-2' }, { id: 'i-1' }]);
	});

	it('returns no compensationSummary when no compensations were registered', async () => {
		mockExecuteTool.mockRejectedValue(new Error('network error'));

		const result = (await runStep(
			'execute',
			handoff([
				{ toolName: 'listInstances' } // fails, but no compensate registered
			])
		)) as { results: Array<{ success: boolean }>; compensationSummary?: object };

		expect(result.results[0].success).toBe(false);
		expect(result.compensationSummary).toBeUndefined();
	});

	it('retries a failing action according to the policy', async () => {
		let callCount = 0;
		mockExecuteTool.mockImplementation(() => {
			callCount++;
			if (callCount < 3) return Promise.reject(new Error('transient'));
			return Promise.resolve({ ok: true });
		});

		const result = (await runStep('execute', {
			actions: [
				{
					toolName: 'launchInstance',
					args: {},
					// Allow 3 retries so the third call succeeds
					retryPolicy: { maxRetries: 3, backoffMs: 0, backoffMultiplier: 1 }
				}
			],
			resolvedDefaultPolicy: { maxRetries: 0, backoffMs: 0, backoffMultiplier: 1 }
		})) as { results: Array<{ success: boolean; attempts: number }> };

		expect(result.results[0].success).toBe(true);
		expect(result.results[0].attempts).toBe(3); // failed twice, succeeded on third
	});

	it('fails after exhausting all retries', async () => {
		mockExecuteTool.mockRejectedValue(new Error('persistent failure'));

		const result = (await runStep('execute', {
			actions: [
				{
					toolName: 'listInstances',
					args: {},
					retryPolicy: { maxRetries: 2, backoffMs: 0, backoffMultiplier: 1 }
				}
			],
			resolvedDefaultPolicy: { maxRetries: 0, backoffMs: 0, backoffMultiplier: 1 }
		})) as { results: Array<{ success: boolean; error?: string; attempts: number }> };

		expect(result.results[0].success).toBe(false);
		expect(result.results[0].error).toContain('persistent failure');
		// 1 initial + 2 retries = 3 total attempts
		expect(result.results[0].attempts).toBe(3);
	});

	it('does not execute remaining actions after one fails', async () => {
		let callCount = 0;
		mockExecuteTool.mockImplementation(() => {
			callCount++;
			if (callCount === 1) return Promise.reject(new Error('first action failed'));
			return Promise.resolve({ ok: true });
		});

		const result = (await runStep(
			'execute',
			handoff([
				{ toolName: 'launchInstance' }, // fails
				{ toolName: 'listInstances' } // should NOT be called
			])
		)) as { results: Array<{ success: boolean }> };

		// Only one result — execution stopped after first failure
		expect(result.results).toHaveLength(1);
		expect(callCount).toBe(1);
	});
});

// ── Workflow structure ────────────────────────────────────────────────────────

describe('actionWorkflow', () => {
	it('is committed', () => {
		expect((actionWorkflow as unknown as { committed: boolean }).committed).toBe(true);
	});

	it('has id "action-workflow"', () => {
		expect(actionWorkflow.id).toBe('action-workflow');
	});

	it('has both steps registered', () => {
		const steps = (actionWorkflow as unknown as { steps: Record<string, unknown> }).steps;
		expect(steps['validate']).toBeDefined();
		expect(steps['execute']).toBeDefined();
	});
});
