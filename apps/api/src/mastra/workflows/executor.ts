/**
 * Workflow executor — runs a workflow definition by traversing the DAG.
 *
 * Migrated from apps/frontend. Graph utilities now live in packages/shared.
 *
 * Features:
 * - Topological sort with cycle detection
 * - Tool node execution via executeTool()
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
	resolveOutputMapping
} from '@portal/shared/workflows';
import { ValidationError } from '@portal/shared';
import { executeTool } from '../tools/registry.js';

// ============================================================================
// Execution Limits (DoS Prevention)
// ============================================================================

const MAX_STEPS = 50;
const MAX_DURATION_MS = 300_000; // 5 minutes

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

			case 'ai-step':
			case 'loop':
			case 'parallel':
				// Not yet implemented — return empty result
				return { result: null };

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

		// Skip the branch not taken — recursively skip all downstream nodes
		const branchToSkip = conditionResult ? data.falseBranch : data.trueBranch;
		if (branchToSkip) {
			// BFS from the skipped branch root through the adjacency list
			const queue = [branchToSkip];
			while (queue.length > 0) {
				const current = queue.shift()!;
				if (skippedNodes.has(current)) continue;
				skippedNodes.add(current);
				// Find all nodes reachable from current (via edges)
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
}
