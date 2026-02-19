/**
 * Action Workflow — OCI tool execution with retry and saga compensation.
 *
 * A Mastra-native workflow that runs a sequence of OCI tool calls safely:
 *
 *   validate → execute
 *
 * The `execute` step wraps every tool call in `withRetry` (from retry.ts) and
 * tracks compensation entries in a `CompensationPlan` (from compensation.ts).
 * If any action fails after exhausting retries, the plan is rolled back in
 * reverse order via `runCompensations` before returning the failure result.
 *
 * Because compensation happens inside the step (not at the Mastra level), the
 * workflow always completes — callers inspect `results[].success` to check for
 * per-action failures.
 *
 * Usage:
 *   const run = await mastra.getWorkflow('actionWorkflow')
 *     .createRun({ runId: crypto.randomUUID() });
 *   await run.start({ inputData: { actions: [...] } });
 */

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { executeTool, toolDefinitions } from '../tools/registry.js';
import { withRetry, STANDARD_RETRY, mergeRetryPolicy, type RetryPolicy } from './retry.js';
import {
	CompensationPlan,
	runCompensations,
	describeCompensationPlan,
	type CompensationSummary
} from './compensation.js';

// ── Schemas ──────────────────────────────────────────────────────────────────

/**
 * Per-action retry policy override.
 * Subset of RetryPolicy — all fields optional; missing fields fall back to the
 * workflow-level defaultRetryPolicy, then to STANDARD_RETRY.
 */
const RetryOverrideSchema = z.object({
	maxRetries: z.number().int().min(0).max(10).optional(),
	backoffMs: z.number().int().min(0).optional(),
	backoffMultiplier: z.number().min(1).optional(),
	maxBackoffMs: z.number().int().min(0).optional(),
	jitter: z.boolean().optional()
});

/**
 * A single OCI action to execute.
 */
const ActionSchema = z.object({
	/** OCI tool name from the registry (e.g. 'launchInstance', 'createBucket'). */
	toolName: z.string().min(1),
	/** Arguments forwarded verbatim to the tool. */
	args: z.record(z.string(), z.unknown()).default({}),
	/**
	 * Compensation declaration: if a LATER step fails, this rollback tool
	 * is called with these args in reverse order (saga pattern).
	 */
	compensate: z
		.object({
			action: z.string().min(1),
			args: z.record(z.string(), z.unknown()).optional()
		})
		.optional(),
	/** Per-action retry override. Merged on top of defaultRetryPolicy. */
	retryPolicy: RetryOverrideSchema.optional()
});

/** Workflow input. */
const ActionWorkflowInputSchema = z.object({
	/** Ordered list of OCI actions to execute. At least one is required. */
	actions: z.array(ActionSchema).min(1),
	/**
	 * Default retry policy for all actions.
	 * Per-action retryPolicy overrides individual fields.
	 * Defaults to STANDARD_RETRY (3 retries, 1 s base, exponential).
	 */
	defaultRetryPolicy: RetryOverrideSchema.optional()
});

/** Schema threaded between validate and execute steps. */
const StepHandoffSchema = z.object({
	actions: z.array(ActionSchema),
	resolvedDefaultPolicy: z.record(z.string(), z.unknown())
});

/** Per-action execution result. */
const ActionResultSchema = z.object({
	nodeId: z.string(),
	toolName: z.string(),
	success: z.boolean(),
	result: z.unknown().optional(),
	error: z.string().optional(),
	/** Total attempts made (including retries). */
	attempts: z.number().int().min(1)
});

/** Workflow output. */
const ActionWorkflowOutputSchema = z.object({
	results: z.array(ActionResultSchema),
	/**
	 * Only present when one or more actions failed AND at least one
	 * compensation was registered at the time of failure.
	 */
	compensationSummary: z
		.object({
			total: z.number().int().nonnegative(),
			succeeded: z.number().int().nonnegative(),
			failed: z.number().int().nonnegative(),
			results: z.array(
				z.object({
					nodeId: z.string(),
					toolName: z.string(),
					success: z.boolean(),
					error: z.string().optional()
				})
			)
		})
		.optional()
});

// ── Steps ────────────────────────────────────────────────────────────────────

/**
 * Validate that every requested tool name exists in the OCI registry.
 * Fast-fails with a clear error before any OCI API call is made.
 */
const validateStep = createStep({
	id: 'validate',
	description: 'Validate tool names against the OCI tool registry',
	inputSchema: ActionWorkflowInputSchema,
	outputSchema: StepHandoffSchema,
	execute: async ({ inputData }) => {
		const unknown = inputData.actions
			.map((a) => a.toolName)
			.filter((name) => !toolDefinitions.has(name));

		if (unknown.length > 0) {
			throw new Error(`Unknown tool name(s): ${unknown.join(', ')}`);
		}

		// Resolve the default policy upfront so execute step receives a concrete object.
		const resolvedDefaultPolicy: RetryPolicy = inputData.defaultRetryPolicy
			? mergeRetryPolicy(STANDARD_RETRY, inputData.defaultRetryPolicy as Partial<RetryPolicy>)
			: STANDARD_RETRY;

		return {
			actions: inputData.actions,
			resolvedDefaultPolicy: resolvedDefaultPolicy as unknown as Record<string, unknown>
		};
	}
});

/**
 * Execute each OCI action with:
 *  - `withRetry` from retry.ts for exponential-backoff retry
 *  - `CompensationPlan` from compensation.ts for saga rollback tracking
 *  - `runCompensations` from compensation.ts for best-effort rollback on failure
 *
 * Returns normally in all cases — callers check `results[].success`.
 */
const executeStep = createStep({
	id: 'execute',
	description: 'Execute OCI actions with retry and saga compensation',
	inputSchema: StepHandoffSchema,
	outputSchema: ActionWorkflowOutputSchema,
	execute: async ({ inputData }) => {
		const defaultPolicy = inputData.resolvedDefaultPolicy as unknown as RetryPolicy;
		const plan = new CompensationPlan();
		const results: z.infer<typeof ActionResultSchema>[] = [];

		for (let i = 0; i < inputData.actions.length; i++) {
			const action = inputData.actions[i];
			const nodeId = `action-${i}`;

			// Merge per-action override on top of the default policy
			const policy: RetryPolicy = action.retryPolicy
				? mergeRetryPolicy(defaultPolicy, action.retryPolicy as Partial<RetryPolicy>)
				: defaultPolicy;

			let attempts = 0;

			try {
				const result = await withRetry({
					fn: async () => {
						attempts++;
						return executeTool(action.toolName, action.args ?? {});
					},
					policy,
					onError: (_msg, _attempt, willRetry) => {
						if (willRetry) {
							// Retry count is tracked by withRetry; nothing extra needed here
						}
					}
				});

				// Register compensation entry now that the step succeeded.
				// Rollback will only occur if a LATER step fails.
				if (action.compensate) {
					plan.add({
						nodeId,
						toolName: action.toolName,
						compensateAction: action.compensate.action,
						compensateArgs: action.compensate.args
					});
				}

				results.push({ nodeId, toolName: action.toolName, success: true, result, attempts });
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				results.push({
					nodeId,
					toolName: action.toolName,
					success: false,
					error: errorMsg,
					attempts
				});

				// Run saga rollback in reverse order (best-effort, non-throwing).
				let compensationSummary: CompensationSummary | undefined;

				if (plan.hasCompensations) {
					// Log the rollback plan before executing (useful for observability).
					process.stdout.write(
						JSON.stringify({
							level: 'warn',
							module: 'action-workflow',
							msg: 'Action failed — running saga rollback',
							failedNode: nodeId,
							failedTool: action.toolName,
							rollback: describeCompensationPlan(plan.entries())
						}) + '\n'
					);

					compensationSummary = await runCompensations(
						plan.entries(),
						async (compensateAction, args) => {
							await executeTool(compensateAction, args);
						}
					);
				}

				return { results, compensationSummary };
			}
		}

		// All actions succeeded — clear the plan (no rollback needed).
		plan.clear();

		return { results };
	}
});

// ── Workflow ─────────────────────────────────────────────────────────────────

/**
 * Mastra-native action workflow.
 *
 * Register on the Mastra instance under key 'actionWorkflow' and access via:
 *   mastra.getWorkflow('actionWorkflow')
 */
export const actionWorkflow = createWorkflow({
	id: 'action-workflow',
	description: 'Execute a sequence of OCI tool actions with per-action retry and saga compensation',
	inputSchema: ActionWorkflowInputSchema,
	outputSchema: ActionWorkflowOutputSchema
})
	.then(validateStep)
	.then(executeStep)
	.commit();
