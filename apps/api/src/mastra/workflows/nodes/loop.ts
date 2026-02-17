/**
 * Loop Node - Iterate over an array from a previous step
 *
 * This node processes each item in an array from a preceding step, either
 * sequentially (predictable order) or in parallel (faster for independent items).
 * The loop binds iteration variables that can be referenced in the loop body.
 *
 * Key features:
 * - Configurable iteration variable name (default: 'item')
 * - Configurable index variable name (default: 'index')
 * - Sequential or parallel execution modes
 * - Optional break condition for early termination (sequential only)
 * - maxIterations cap for DoS prevention (hard cap: 1000)
 * - Expression-based iterator (resolves array from previous step output)
 */

import type { WorkflowNode } from '@portal/shared/workflows';

/**
 * Configuration for a loop node
 */
export interface LoopNodeConfig {
	/**
	 * Dot-notation path to the array in previous step results.
	 * Example: 'listInstances.data' resolves stepResults.listInstances.data
	 */
	iteratorExpression: string;
	/**
	 * Name to bind each array item to within loop body context.
	 * Defaults to 'item'. Used in breakCondition expressions.
	 */
	iterationVariable?: string;
	/**
	 * Name to bind the current iteration index to.
	 * Defaults to 'index'. Zero-based.
	 */
	indexVariable?: string;
	/**
	 * Execution mode for iterations.
	 * - 'sequential': process items one at a time (predictable, supports break)
	 * - 'parallel': process all items concurrently (faster, no break support)
	 * Defaults to 'sequential'.
	 */
	executionMode?: 'sequential' | 'parallel';
	/**
	 * Maximum number of iterations to perform.
	 * Capped at 1000 (MAX_LOOP_ITERATIONS) regardless of this value.
	 * Useful for pagination or rate-limited APIs.
	 */
	maxIterations?: number;
	/**
	 * Expression evaluated before each iteration to decide early exit.
	 * Only applies to sequential execution mode.
	 * Example: 'item.status === "TERMINATED"' — stops when a terminated instance is found
	 */
	breakCondition?: string;
	/**
	 * Node IDs that form the loop body (sub-workflow per iteration).
	 * Currently used for metadata — full sub-workflow execution is planned.
	 */
	bodyNodeIds?: string[];
}

/**
 * Create a loop workflow node.
 *
 * The executor's executeLoopNode() method processes this node by:
 * 1. Resolving the array from iteratorExpression in stepResults
 * 2. Iterating up to maxIterations items (or array length)
 * 3. Binding each item to iterationVariable and its index to indexVariable
 * 4. Checking breakCondition before each sequential iteration
 * 5. Returning an array of iteration results
 *
 * Example:
 * ```typescript
 * const node = createLoopNode('process-instances', {
 *   iteratorExpression: 'listInstances.data',
 *   iterationVariable: 'instance',
 *   indexVariable: 'idx',
 *   executionMode: 'sequential',
 *   breakCondition: 'instance.lifecycleState === "TERMINATED"',
 *   maxIterations: 50
 * });
 * ```
 */
export function createLoopNode(
	id: string,
	config: LoopNodeConfig,
	position: { x: number; y: number } = { x: 0, y: 0 }
): WorkflowNode {
	return {
		id,
		type: 'loop',
		position,
		data: {
			iteratorExpression: config.iteratorExpression,
			iterationVariable: config.iterationVariable ?? 'item',
			indexVariable: config.indexVariable ?? 'index',
			executionMode: config.executionMode ?? 'sequential',
			maxIterations: config.maxIterations,
			breakCondition: config.breakCondition,
			bodyNodeIds: config.bodyNodeIds ?? []
		}
	};
}

/**
 * Loop node result structure returned by the executor
 */
export interface LoopNodeResult {
	/** Results from each completed iteration */
	iterations: LoopIterationResult[];
	/** Total number of completed iterations */
	totalIterations: number;
	/** Whether the loop was exited early due to breakCondition */
	breakTriggered: boolean;
	/** Execution mode used ('sequential' or 'parallel') */
	executionMode: 'sequential' | 'parallel';
}

/**
 * Individual iteration result shape from the executor
 */
export interface LoopIterationResult {
	[variableName: string]: unknown;
	bodyNodeIds: string[];
}

/**
 * Type guard: check if a node result is a LoopNodeResult
 */
export function isLoopNodeResult(result: unknown): result is LoopNodeResult {
	return (
		typeof result === 'object' &&
		result !== null &&
		'iterations' in result &&
		Array.isArray((result as Record<string, unknown>).iterations) &&
		'totalIterations' in result &&
		typeof (result as Record<string, unknown>).totalIterations === 'number'
	);
}

/**
 * Extract completed iteration items from a loop result.
 *
 * Convenience helper for accessing iteration data in downstream nodes.
 * Returns the bound variable values from each iteration.
 *
 * Example:
 * ```typescript
 * const result = stepResults['process-instances'] as LoopNodeResult;
 * const items = extractIterationItems(result, 'instance');
 * // items: [{ lifecycleState: 'RUNNING', ... }, ...]
 * ```
 */
export function extractIterationItems(
	result: LoopNodeResult,
	iterationVariable: string = 'item'
): unknown[] {
	return result.iterations.map((iter) => iter[iterationVariable]);
}
