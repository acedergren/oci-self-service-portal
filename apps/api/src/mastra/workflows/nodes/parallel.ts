/**
 * Parallel Node - Execute multiple branches concurrently
 *
 * This node executes multiple workflow branches in parallel, with configurable
 * merge strategies to combine their results into a single output object.
 *
 * Key features:
 * - Named branches: Each branch is assigned a descriptive name (e.g., 'fetch-data', 'process-image')
 * - Merge strategies: 'all' (wait for all), 'any' (first success), 'first' (fastest)
 * - Timeout per branch: Cancel slow branches after specified duration
 * - Error handling: 'fail-fast' (stop all on error) or 'collect-all' (gather all results)
 * - Result isolation: Each branch's results are keyed by branch name in output
 *
 * Two APIs are provided:
 * 1. createParallelNode() — for workflow graph designers (returns WorkflowNode)
 * 2. executeParallelBranches() — programmatic API for composing parallel steps in code
 */

import type { WorkflowNode } from '@portal/shared/workflows';

/**
 * Configuration for a single branch in a parallel node
 */
export interface ParallelBranchConfig {
	/** Descriptive name for this branch (e.g., 'fetch-users', 'process-image') */
	name: string;
	/** Array of node IDs that form this branch's execution path */
	nodeIds: string[];
}

/**
 * Configuration for a parallel node
 */
export interface ParallelNodeConfig {
	/** Map of branch name to node IDs for that branch */
	branches: Record<string, string[]>;
	/** How to merge results: 'all' (wait for all), 'any' (first success), 'first' (fastest) */
	mergeStrategy?: 'all' | 'any' | 'first';
	/** Timeout in milliseconds for each branch (optional) */
	timeoutMs?: number;
	/** How to handle errors: 'fail-fast' (stop all) or 'collect-all' (gather all) */
	errorHandling?: 'fail-fast' | 'collect-all';
}

/**
 * Create a parallel workflow node.
 *
 * This factory function creates a WorkflowNode with type 'parallel' and stores
 * the branch configuration in node.data. The executor's executeParallelNode()
 * method will read this configuration and execute branches accordingly.
 *
 * Example:
 * ```typescript
 * const node = createParallelNode({
 *   id: 'parallel-1',
 *   branches: {
 *     'fetch-data': ['api-call-1', 'api-call-2'],
 *     'process-local': ['process-1', 'validate-1']
 *   },
 *   mergeStrategy: 'all',
 *   position: { x: 100, y: 100 }
 * });
 * ```
 */
export function createParallelNode(
	id: string,
	config: ParallelNodeConfig,
	position: { x: number; y: number } = { x: 0, y: 0 }
): WorkflowNode {
	// Convert named branches to indexed format for executor compatibility
	const branchNodeIds = Object.values(config.branches);
	const branchNames = Object.keys(config.branches);

	return {
		id,
		type: 'parallel',
		position,
		data: {
			branchNodeIds,
			branchNames, // Store original names for result keying
			mergeStrategy: config.mergeStrategy || 'all',
			errorHandling: config.errorHandling || 'fail-fast',
			timeoutMs: config.timeoutMs
		}
	};
}

/**
 * Parallel node result structure
 *
 * The output is a map of branch name to branch result:
 * ```typescript
 * {
 *   'fetch-data': { ... },      // Result from first branch
 *   'process-local': { ... }    // Result from second branch
 * }
 * ```
 */
export interface ParallelNodeResult {
	[branchName: string]: unknown;
}

/**
 * Parse parallel node results and return as named map
 *
 * Converts the executor's indexed branch results (branch-0, branch-1, etc.)
 * back to the original branch names specified in the parallel node config.
 *
 * This allows downstream nodes to reference results by meaningful names:
 * - downstream.fromPath('parallel-1.fetch-data') instead of
 * - downstream.fromPath('parallel-1.branch-0')
 */
export function parseParallelResults(
	result: Record<string, unknown>,
	branchNames: string[]
): ParallelNodeResult {
	const output: Record<string, unknown> = {};

	branchNames.forEach((name, index) => {
		const indexedKey = `branch-${index}`;
		if (indexedKey in result) {
			output[name] = result[indexedKey];
		}
	});

	return output;
}

/**
 * Type guard to check if a result is a parallel node error
 */
export function isParallelNodeError(result: unknown): result is { error: string } {
	return (
		typeof result === 'object' &&
		result !== null &&
		'error' in result &&
		typeof (result as Record<string, unknown>).error === 'string'
	);
}

/**
 * Extract error messages from parallel node results
 *
 * Useful for downstream error handling after a parallel node execution.
 * Returns an object mapping branch names to error messages (if any).
 */
export function extractParallelErrors(
	result: ParallelNodeResult,
	branchNames: string[]
): Record<string, string | null> {
	const errors: Record<string, string | null> = {};

	branchNames.forEach((name) => {
		const branchResult = result[name];
		errors[name] = isParallelNodeError(branchResult) ? branchResult.error : null;
	});

	return errors;
}

// ============================================================================
// Programmatic Parallel Execution API
// ============================================================================

/**
 * A step configuration: an async function that receives shared context.
 * Used in the programmatic executeParallelBranches() API.
 */
export type StepFn<TContext = Record<string, unknown>> = (context: TContext) => Promise<unknown>;

/** Named map of step functions — the branch definitions for executeParallelBranches(). */
export type StepMap<TContext = Record<string, unknown>> = Record<string, StepFn<TContext>>;

/** Outcome of a single named branch. */
export interface BranchOutcome {
	status: 'fulfilled' | 'rejected';
	value?: unknown;
	error?: string;
}

/**
 * Aggregated result from executeParallelBranches().
 * Branches are keyed by their original branch name.
 */
export interface ParallelExecutionResult {
	/** Per-branch outcomes keyed by branch name. */
	branches: Record<string, BranchOutcome>;
	/** Number of branches that completed successfully. */
	successCount: number;
	/** Number of branches that failed. */
	failureCount: number;
	/** Total number of branches executed. */
	totalCount: number;
}

/** Options for executeParallelBranches(). */
export interface ExecuteParallelOptions<TContext = Record<string, unknown>> {
	/** Named step functions — executed concurrently. */
	branches: StepMap<TContext>;
	/** Shared context passed to every step function. */
	context?: TContext;
	/** Merge strategy (default: 'all'). */
	mergeStrategy?: 'all' | 'any' | 'first';
	/** Error handling mode when mergeStrategy is 'all' (default: 'fail-fast'). */
	errorHandling?: 'fail-fast' | 'collect-all';
	/** Timeout in milliseconds per branch. Slow branches are rejected with a timeout error. */
	timeoutMs?: number;
}

/**
 * Wrap a branch promise with an optional per-branch timeout.
 */
function applyTimeout<T>(
	promise: Promise<T>,
	branchName: string,
	timeoutMs: number | undefined
): Promise<T> {
	if (!timeoutMs) return promise;
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error(`Branch "${branchName}" timed out after ${timeoutMs}ms`)),
				timeoutMs
			)
		)
	]);
}

/**
 * Execute named branches concurrently and merge results by branch name.
 *
 * Supports three merge strategies:
 * - 'all'   — wait for every branch; respects errorHandling for failures
 * - 'any'   — return first branch to complete successfully (throws if all fail)
 * - 'first' — return first to settle regardless of success or failure
 *
 * Results are keyed by branch name: `{ branchA: { status, value }, branchB: { status, value } }`
 *
 * @throws When mergeStrategy='all' + errorHandling='fail-fast' and a branch fails.
 * @throws When mergeStrategy='any' and all branches fail (AggregateError from Promise.any).
 */
export async function executeParallelBranches<TContext = Record<string, unknown>>(
	options: ExecuteParallelOptions<TContext>
): Promise<ParallelExecutionResult> {
	const {
		branches,
		context = {} as TContext,
		mergeStrategy = 'all',
		errorHandling = 'fail-fast',
		timeoutMs
	} = options;

	const branchNames = Object.keys(branches);

	if (branchNames.length === 0) {
		return { branches: {}, successCount: 0, failureCount: 0, totalCount: 0 };
	}

	// Build per-branch promises with optional timeout
	const namedPromises = branchNames.map((name) => ({
		name,
		promise: applyTimeout(branches[name](context), name, timeoutMs)
	}));

	const resultMap: Record<string, BranchOutcome> = {};

	if (mergeStrategy === 'all') {
		const settled = await Promise.allSettled(namedPromises.map((b) => b.promise));

		for (let i = 0; i < branchNames.length; i++) {
			const name = branchNames[i];
			const outcome = settled[i];

			if (outcome.status === 'fulfilled') {
				resultMap[name] = { status: 'fulfilled', value: outcome.value };
			} else {
				const errorMsg =
					outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
				resultMap[name] = { status: 'rejected', error: errorMsg };

				if (errorHandling === 'fail-fast') {
					throw new Error(`Parallel branch "${name}" failed: ${errorMsg}`);
				}
			}
		}
	} else if (mergeStrategy === 'any') {
		// Promise.any throws AggregateError if all branches reject
		const winner = await Promise.any(
			namedPromises.map(async ({ name, promise }) => {
				const value = await promise;
				return { name, value };
			})
		);
		resultMap[winner.name] = { status: 'fulfilled', value: winner.value };
	} else {
		// 'first' — first to settle (success or failure)
		const first = await Promise.race(
			namedPromises.map(({ name, promise }) =>
				promise.then(
					(value) => ({ name, status: 'fulfilled' as const, value }),
					(err) => ({
						name,
						status: 'rejected' as const,
						error: err instanceof Error ? err.message : String(err)
					})
				)
			)
		);
		if (first.status === 'fulfilled') {
			resultMap[first.name] = { status: 'fulfilled', value: first.value };
		} else {
			resultMap[first.name] = { status: 'rejected', error: (first as { error: string }).error };
		}
	}

	const successCount = Object.values(resultMap).filter((r) => r.status === 'fulfilled').length;
	const failureCount = Object.values(resultMap).filter((r) => r.status === 'rejected').length;

	return {
		branches: resultMap,
		successCount,
		failureCount,
		totalCount: Object.keys(resultMap).length
	};
}
