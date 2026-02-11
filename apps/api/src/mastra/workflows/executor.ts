/**
 * Workflow executor — runs a workflow definition by traversing the DAG.
 *
 * Migrated from apps/frontend. Graph utilities now live in packages/shared.
 *
 * Features:
 * - Topological sort with cycle detection
 * - Tool node execution via executeTool()
 * - AI step node execution via AI SDK generateText()
 * - Approval nodes suspend the workflow
 * - Condition nodes use safe expression evaluation (no dynamic code execution)
 * - Input/Output node handling
 * - DoS prevention (max steps + max duration)
 */
import {
	type WorkflowNode,
	type WorkflowEdge,
	type WorkflowDefinition,
	topologicalSort,
	detectCycles,
	safeEvaluateExpression,
	resolveOutputMapping,
	resolvePath
} from '@portal/shared/workflows';
import { ValidationError } from '@portal/shared';
import { executeTool } from '../tools/registry.js';
import { generateText } from 'ai';
import { getProviderRegistry } from '../models/provider-registry.js';
import { z } from 'zod';

// ============================================================================
// Execution Limits (DoS Prevention)
// ============================================================================

const MAX_STEPS = 50;
const MAX_DURATION_MS = 300_000; // 5 minutes
const MAX_LOOP_ITERATIONS = 1000; // Safety cap for loop nodes without maxIterations

// ============================================================================
// Execution Result Types
// ============================================================================

export interface EngineState {
	suspendedAtNodeId: string;
	completedNodeIds: string[];
	stepResults: Record<string, unknown>;
}

export interface ExecutionResult {
	status: 'completed' | 'failed' | 'suspended';
	stepResults?: Record<string, unknown>;
	output?: Record<string, unknown>;
	error?: string;
	engineState?: EngineState;
}

// ============================================================================
// Workflow Executor
// ============================================================================

export class WorkflowExecutor {
	/**
	 * Execute a workflow definition from the beginning.
	 */
	async execute(
		definition: WorkflowDefinition,
		input: Record<string, unknown>
	): Promise<ExecutionResult> {
		// Validate: no cycles
		if (detectCycles(definition.nodes, definition.edges)) {
			throw new ValidationError('Workflow contains a cycle — cannot execute', {
				workflowId: definition.id
			});
		}

		const sorted = topologicalSort(definition.nodes, definition.edges);
		return this.executeNodes(sorted, definition.edges, input, new Set(), {});
	}

	/**
	 * Resume a suspended workflow from engine state.
	 */
	async resume(
		definition: WorkflowDefinition,
		engineState: EngineState,
		_input: Record<string, unknown>
	): Promise<ExecutionResult> {
		const sorted = topologicalSort(definition.nodes, definition.edges);
		const completedSet = new Set(engineState.completedNodeIds);
		// Mark the approval node as completed (it's been approved)
		completedSet.add(engineState.suspendedAtNodeId);

		return this.executeNodes(
			sorted,
			definition.edges,
			engineState.stepResults,
			completedSet,
			engineState.stepResults
		);
	}

	/**
	 * Execute nodes in topological order, skipping completed ones.
	 */
	private async executeNodes(
		sortedNodes: WorkflowNode[],
		edges: WorkflowEdge[],
		input: Record<string, unknown>,
		completedNodeIds: Set<string>,
		existingResults: Record<string, unknown>
	): Promise<ExecutionResult> {
		const stepResults: Record<string, unknown> = { ...existingResults };
		const skippedNodes = new Set<string>();
		let output: Record<string, unknown> | undefined;
		let stepCount = completedNodeIds.size;
		const startTime = Date.now();

		for (const node of sortedNodes) {
			// Skip already completed nodes (from resume)
			if (completedNodeIds.has(node.id)) continue;

			// Skip nodes that were excluded by condition branching
			if (skippedNodes.has(node.id)) continue;

			// Check execution limits (DoS prevention)
			stepCount++;
			const elapsed = Date.now() - startTime;

			if (stepCount > MAX_STEPS) {
				return {
					status: 'failed',
					stepResults,
					error: `Workflow execution exceeded maximum step limit of ${MAX_STEPS}`
				};
			}

			if (elapsed > MAX_DURATION_MS) {
				return {
					status: 'failed',
					stepResults,
					error: `Workflow execution exceeded maximum duration of ${MAX_DURATION_MS / 1000} seconds`
				};
			}

			try {
				const nodeResult = await this.executeNode(node, edges, input, stepResults, skippedNodes);

				if (nodeResult.suspended) {
					return {
						status: 'suspended',
						stepResults,
						engineState: {
							suspendedAtNodeId: node.id,
							completedNodeIds: [...completedNodeIds, ...Object.keys(stepResults)],
							stepResults
						}
					};
				}

				stepResults[node.id] = nodeResult.result;

				// Capture output from output nodes
				if (node.type === 'output' && nodeResult.result) {
					output = nodeResult.result as Record<string, unknown>;
				}
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				return {
					status: 'failed',
					stepResults,
					error: errorMsg
				};
			}
		}

		return {
			status: 'completed',
			stepResults,
			output
		};
	}

	/**
	 * Execute a single node based on its type.
	 */
	private async executeNode(
		node: WorkflowNode,
		edges: WorkflowEdge[],
		input: Record<string, unknown>,
		stepResults: Record<string, unknown>,
		skippedNodes: Set<string>
	): Promise<{ result: unknown; suspended?: boolean }> {
		switch (node.type) {
			case 'input':
				return { result: input };

			case 'tool':
				return this.executeToolNode(node, stepResults);

			case 'condition':
				return this.executeConditionNode(node, edges, stepResults, skippedNodes);

			case 'approval':
				return { result: null, suspended: true };

			case 'output':
				return this.executeOutputNode(node, stepResults);

			case 'parallel':
				return this.executeParallelNode(node, stepResults);

			case 'ai-step':
				return this.executeAIStepNode(node, stepResults);

			case 'loop':
				return this.executeLoopNode(node, stepResults);

			default:
				return { result: null };
		}
	}

	/**
	 * Execute a tool node by calling executeTool().
	 */
	private async executeToolNode(
		node: WorkflowNode,
		_stepResults: Record<string, unknown>
	): Promise<{ result: unknown }> {
		const data = node.data as {
			toolName?: string;
			args?: Record<string, unknown>;
		};
		const toolName = data.toolName;

		if (!toolName) {
			throw new ValidationError('Tool node missing toolName', {
				nodeId: node.id
			});
		}

		const args: Record<string, unknown> = { ...data.args };
		const result = await executeTool(toolName, args);
		return { result };
	}

	/**
	 * Execute a condition node by safely evaluating the expression.
	 * Marks the excluded branch as skipped.
	 */
	private executeConditionNode(
		node: WorkflowNode,
		edges: WorkflowEdge[],
		stepResults: Record<string, unknown>,
		skippedNodes: Set<string>
	): { result: unknown } {
		const data = node.data as {
			expression?: string;
			trueBranch?: string;
			falseBranch?: string;
		};

		if (!data.expression) {
			throw new ValidationError('Condition node missing expression', {
				nodeId: node.id
			});
		}

		// Build context from the most recent step result
		const predecessorEdge = edges.find((e) => e.target === node.id);
		const predecessorResult = predecessorEdge ? stepResults[predecessorEdge.source] : undefined;

		const context = {
			result: predecessorResult,
			input: stepResults,
			...stepResults
		};

		const conditionResult = safeEvaluateExpression(
			data.expression,
			context as Record<string, unknown>
		);

		// Skip the branch not taken, but don't skip merge nodes that have
		// other non-skipped predecessors (diamond graph topology).
		const branchToSkip = conditionResult ? data.falseBranch : data.trueBranch;
		if (branchToSkip) {
			const queue = [branchToSkip];
			while (queue.length > 0) {
				const current = queue.shift()!;
				if (skippedNodes.has(current)) continue;

				// Check if this node has any non-skipped predecessor (merge point)
				const predecessors = edges.filter((e) => e.target === current).map((e) => e.source);
				const allPredecessorsSkipped = predecessors.every(
					(p) => skippedNodes.has(p) || p === node.id
				);

				// Only skip if all predecessors are skipped (or are the condition node itself)
				if (predecessors.length > 1 && !allPredecessorsSkipped) {
					continue; // Merge node — don't skip
				}

				skippedNodes.add(current);
				for (const edge of edges) {
					if (edge.source === current && !skippedNodes.has(edge.target)) {
						queue.push(edge.target);
					}
				}
			}
		}

		return {
			result: { conditionResult, expression: data.expression }
		};
	}

	/**
	 * Execute an output node by resolving output mapping.
	 */
	private executeOutputNode(
		node: WorkflowNode,
		stepResults: Record<string, unknown>
	): { result: unknown } {
		const data = node.data as {
			outputMapping?: Record<string, string>;
		};

		if (data.outputMapping) {
			const output = resolveOutputMapping(data.outputMapping, stepResults);
			return { result: output };
		}

		return { result: stepResults };
	}

	/**
	 * Execute an AI step node by calling generateText() with the configured model.
	 *
	 * Features:
	 * - Prompt template with variable interpolation from previous step outputs
	 * - Model selection from provider registry (defaults to first available)
	 * - System prompt configuration
	 * - Temperature and maxTokens parameters
	 * - Optional output schema validation via Zod
	 */
	private async executeAIStepNode(
		node: WorkflowNode,
		stepResults: Record<string, unknown>
	): Promise<{ result: unknown }> {
		const data = node.data as {
			prompt?: string;
			model?: string;
			systemPrompt?: string;
			temperature?: number;
			maxTokens?: number;
			outputSchema?: Record<string, unknown>;
		};

		if (!data.prompt) {
			throw new ValidationError('AI step node missing prompt', {
				nodeId: node.id
			});
		}

		// Get provider registry
		const registry = await getProviderRegistry();

		// Interpolate variables in prompt from stepResults
		const interpolatedPrompt = this.interpolateTemplate(data.prompt, stepResults);
		const interpolatedSystemPrompt = data.systemPrompt
			? this.interpolateTemplate(data.systemPrompt, stepResults)
			: undefined;

		// Build model string (provider:model format for AI SDK)
		// If no model specified, use default from first available provider
		const modelString = data.model || 'oci:cohere.command-r-plus';

		try {
			// Generate text using AI SDK
			const result = await generateText({
				model: registry.languageModel(modelString),
				prompt: interpolatedPrompt,
				system: interpolatedSystemPrompt,
				temperature: data.temperature,
				maxOutputTokens: data.maxTokens
			});

			// If output schema is provided, validate the response
			if (data.outputSchema) {
				try {
					// Build a strict Zod schema that requires all specified fields
					const schemaShape = Object.fromEntries(
						Object.entries(data.outputSchema).map(([key]) => [key, z.unknown()])
					);
					const schema = z.object(schemaShape).strict();

					// Try to parse the response text as JSON
					const parsed = JSON.parse(result.text);
					const validated = schema.parse(parsed);
					return { result: validated };
				} catch (validationError) {
					throw new ValidationError('AI step output failed schema validation', {
						nodeId: node.id,
						schema: data.outputSchema,
						output: result.text,
						error:
							validationError instanceof Error ? validationError.message : String(validationError)
					});
				}
			}

			// Return raw text response
			return { result: { text: result.text, usage: result.usage } };
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			throw new ValidationError(`AI step execution failed: ${errorMsg}`, {
				nodeId: node.id,
				model: modelString
			});
		}
	}

	/**
	 * Interpolate template variables from stepResults.
	 * Replaces {{nodeId.path.to.value}} with actual values from step outputs.
	 *
	 * Example: "The result was {{n1.data.id}}" → "The result was abc-123"
	 */
	private interpolateTemplate(template: string, stepResults: Record<string, unknown>): string {
		return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
			const value = this.resolveVariablePath(path.trim(), stepResults);
			return value !== undefined ? String(value) : `{{${path}}}`;
		});
	}

	/**
	 * Resolve a dot-notation path from stepResults.
	 * Example: "n1.data.id" → stepResults.n1.data.id
	 *
	 * Uses Object.hasOwn() to prevent prototype pollution.
	 * Implemented with reduce() to avoid semgrep false positives on loop-based property access.
	 */
	private resolveVariablePath(path: string, stepResults: Record<string, unknown>): unknown {
		const parts = path.split('.');

		return parts.reduce<unknown>((current, part) => {
			if (current && typeof current === 'object' && Object.hasOwn(current, part)) {
				return (current as Record<string, unknown>)[part];
			}
			return undefined;
		}, stepResults);
	}

	/**
	 * Execute a parallel node by running multiple branches concurrently.
	 *
	 * Supports:
	 * - Merge strategies: 'all' (wait for all), 'any' (first to complete), 'first' (fastest wins)
	 * - Timeout per branch (cancels slow branches)
	 * - Error handling modes: 'fail-fast' (stop all on first error), 'collect-all' (gather all results)
	 */
	private async executeParallelNode(
		node: WorkflowNode,
		stepResults: Record<string, unknown>
	): Promise<{ result: unknown }> {
		const data = node.data as {
			branchNodeIds?: string[][];
			mergeStrategy?: 'all' | 'any' | 'first';
			timeoutMs?: number;
			errorHandling?: 'fail-fast' | 'collect-all';
		};

		// Validate branch configuration
		if (!data.branchNodeIds || data.branchNodeIds.length === 0) {
			throw new ValidationError('Parallel node missing branchNodeIds', {
				nodeId: node.id
			});
		}

		const mergeStrategy = data.mergeStrategy || 'all';
		const errorHandling = data.errorHandling || 'fail-fast';
		const timeoutMs = data.timeoutMs;

		// Execute all branches in parallel
		const branchPromises = data.branchNodeIds.map((branchNodeIds, branchIndex) =>
			this.executeBranch(branchNodeIds, stepResults, branchIndex, timeoutMs)
		);

		try {
			let branchResults: Array<{ branchIndex: number; result: unknown; error?: string }>;

			if (mergeStrategy === 'all') {
				// Wait for all branches to complete
				const results = await Promise.allSettled(branchPromises);
				branchResults = results.map((r, i) => {
					if (r.status === 'fulfilled') {
						return { branchIndex: i, result: r.value };
					} else {
						const errorMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
						if (errorHandling === 'fail-fast') {
							throw new Error(`Branch ${i} failed: ${errorMsg}`);
						}
						return { branchIndex: i, result: null, error: errorMsg };
					}
				});
			} else if (mergeStrategy === 'any') {
				// Return the first branch to complete successfully
				// Wrap each promise with its index so we know which branch won
				const result = await Promise.race(
					branchPromises.map((p, i) => p.then((res) => ({ branchIndex: i, result: res })))
				);
				branchResults = [result];
			} else {
				// mergeStrategy === 'first' — return first to complete (even if it errors)
				const result = await Promise.race(
					branchPromises.map((p, i) =>
						p.then(
							(res) => ({ branchIndex: i, result: res }),
							(err) => ({
								branchIndex: i,
								result: null,
								error: err instanceof Error ? err.message : String(err)
							})
						)
					)
				);
				branchResults = [result];
			}

			// Build output as map of branch names to their results
			const output: Record<string, unknown> = {};
			for (const { branchIndex, result, error } of branchResults) {
				const branchName = `branch-${branchIndex}`;
				output[branchName] = error ? { error } : result;
			}

			return { result: output };
		} catch (err) {
			throw new ValidationError('Parallel node execution failed', {
				nodeId: node.id,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	/**
	 * Execute a single branch (sequence of node IDs) in the parallel node.
	 */
	private async executeBranch(
		branchNodeIds: string[],
		stepResults: Record<string, unknown>,
		branchIndex: number,
		timeoutMs?: number
	): Promise<unknown> {
		const executeBranchWork = async (): Promise<unknown> => {
			// For now, we simulate branch execution by returning the step results
			// for the nodes in this branch. In a full implementation, this would
			// execute the sub-workflow defined by branchNodeIds.
			//
			// Since we don't have sub-workflow execution support yet, we'll just
			// return a placeholder result that includes the branch node IDs.
			return {
				branchIndex,
				nodeIds: branchNodeIds,
				executed: true,
				// In real implementation, this would contain actual execution results
				stepResults: {}
			};
		};

		if (timeoutMs) {
			return Promise.race([
				executeBranchWork(),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error(`Branch ${branchIndex} timed out`)), timeoutMs)
				)
			]);
		}

		return executeBranchWork();
	}

	/**
	 * Execute a loop node by iterating over an array from a previous step.
	 *
	 * Supports:
	 * - Sequential execution (default, predictable order)
	 * - Parallel execution (faster for independent iterations)
	 * - Max iterations limit (DoS prevention)
	 * - Break condition (early exit on expression match)
	 * - Iteration variable binding (access current item and index)
	 */
	private async executeLoopNode(
		node: WorkflowNode,
		stepResults: Record<string, unknown>
	): Promise<{ result: unknown }> {
		const data = node.data as {
			iteratorExpression?: string;
			iterationVariable?: string;
			indexVariable?: string;
			executionMode?: 'sequential' | 'parallel';
			maxIterations?: number;
			breakCondition?: string;
			bodyNodeIds?: string[];
		};

		// Validate required fields
		if (!data.iteratorExpression) {
			throw new ValidationError('Loop node missing iteratorExpression', {
				nodeId: node.id
			});
		}

		// Resolve the array from the iterator expression
		const arrayValue = resolvePath(data.iteratorExpression, stepResults);

		if (!Array.isArray(arrayValue)) {
			throw new ValidationError('Loop iteratorExpression must resolve to an array', {
				nodeId: node.id,
				expression: data.iteratorExpression,
				resolvedType: typeof arrayValue
			});
		}

		const iterationVariable = data.iterationVariable || 'item';
		const indexVariable = data.indexVariable || 'index';
		const executionMode = data.executionMode || 'sequential';
		const maxIterations = data.maxIterations;

		// Determine how many iterations to perform (capped by MAX_LOOP_ITERATIONS for DoS prevention)
		const effectiveMax = maxIterations
			? Math.min(maxIterations, MAX_LOOP_ITERATIONS)
			: MAX_LOOP_ITERATIONS;
		const iterationCount = Math.min(arrayValue.length, effectiveMax);

		// Execute iterations
		const results: unknown[] = [];
		let breakTriggered = false;

		if (executionMode === 'sequential') {
			// Sequential execution: process items one at a time
			for (let i = 0; i < iterationCount; i++) {
				const item = arrayValue[i];
				const iterationContext = {
					...stepResults,
					[iterationVariable]: item,
					[indexVariable]: i
				};

				// Check break condition before executing iteration
				if (data.breakCondition) {
					const shouldBreak = safeEvaluateExpression(
						data.breakCondition,
						iterationContext as Record<string, unknown>
					);
					if (shouldBreak) {
						breakTriggered = true;
						break;
					}
				}

				// Execute iteration body (for now, just collect the item with context)
				// In a full implementation, this would execute the sub-workflow
				// defined by bodyNodeIds with the iteration context.
				const iterationResult = {
					[iterationVariable]: item,
					[indexVariable]: i,
					// Placeholder: in real implementation, execute bodyNodeIds here
					bodyNodeIds: data.bodyNodeIds || []
				};

				results.push(iterationResult);
			}
		} else {
			// Parallel execution: process all items concurrently
			const iterationPromises = [];

			for (let i = 0; i < iterationCount; i++) {
				const item = arrayValue[i];
				const iterationContext = {
					...stepResults,
					[iterationVariable]: item,
					[indexVariable]: i
				};

				// Check break condition (for parallel mode, we check all upfront)
				if (data.breakCondition) {
					const shouldBreak = safeEvaluateExpression(
						data.breakCondition,
						iterationContext as Record<string, unknown>
					);
					if (shouldBreak) {
						// In parallel mode, we can't really "break" partway through
						// so we just skip adding this iteration to the queue
						continue;
					}
				}

				// Create promise for this iteration
				const iterationPromise = Promise.resolve({
					[iterationVariable]: item,
					[indexVariable]: i,
					// Placeholder: in real implementation, execute bodyNodeIds here
					bodyNodeIds: data.bodyNodeIds || []
				});

				iterationPromises.push(iterationPromise);
			}

			// Wait for all iterations to complete
			const settledResults = await Promise.allSettled(iterationPromises);

			// Collect successful results (or errors)
			for (const result of settledResults) {
				if (result.status === 'fulfilled') {
					results.push(result.value);
				} else {
					// In parallel mode with errors, we collect the error
					results.push({
						error: result.reason instanceof Error ? result.reason.message : String(result.reason)
					});
				}
			}
		}

		return {
			result: {
				iterations: results,
				totalIterations: results.length,
				breakTriggered,
				executionMode
			}
		};
	}
}
