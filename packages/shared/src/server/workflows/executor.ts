/**
 * Workflow executor — runs a workflow definition by traversing the DAG.
 *
 * Features:
 * - Topological sort with cycle detection
 * - Tool node execution via executeTool()
 * - Approval nodes suspend the workflow
 * - Condition nodes use safe expression evaluation (no dynamic code execution)
 * - Input/Output node handling
 * - Error wrapping with PortalError hierarchy
 */
import { createLogger } from '../logger';
import { executeTool } from '../../tools/registry';
import { ValidationError } from '../errors';
import type {
	AIStepNodeData,
	LoopNodeData,
	ParallelNodeData,
	WorkflowDefinition,
	WorkflowEdge,
	WorkflowNode
} from '../../workflows/types';

const log = createLogger('workflow-executor');

const DEFAULT_MAX_STEPS = 100;
const DEFAULT_MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_NODE_TIMEOUT_MS = 120_000; // 2 minutes per node
const DEFAULT_LOOP_ITERATIONS = 1000;
const DEFAULT_LOOP_RETRY_LIMIT = 2;
const INITIAL_RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 5_000;

type WaitFn = (ms: number) => Promise<void>;

export type WorkflowProgressEvent =
	| {
			type: 'step';
			stage: 'start' | 'complete' | 'error';
			nodeId: string;
			nodeType: WorkflowNode['type'];
			payload?: unknown;
	  }
	| {
			type: 'status';
			status: ExecutionResult['status'];
			output?: Record<string, unknown>;
			error?: string;
	  };

export type WorkflowProgressEmitter = (event: WorkflowProgressEvent) => void;

export interface WorkflowExecutorOptions {
	aiStepHandler?: (payload: AIStepHandlerPayload) => Promise<unknown>;
	loopHandler?: (payload: LoopIterationContext) => Promise<unknown>;
	parallelHandler?: (payload: ParallelBranchContext) => Promise<unknown>;
	progressEmitter?: WorkflowProgressEmitter;
	maxSteps?: number;
	maxDurationMs?: number;
	maxLoopIterations?: number;
	nodeTimeoutMs?: number;
	loopRetryLimit?: number;
	now?: () => number;
	wait?: WaitFn;
}

export interface AIStepHandlerPayload {
	nodeId: string;
	node: WorkflowNode;
	prompt: string;
	systemPrompt?: string;
	temperature?: number;
	maxTokens?: number;
	outputSchema?: Record<string, unknown>;
	input: Record<string, unknown>;
	stepResults: Record<string, unknown>;
}

export interface LoopIterationContext {
	nodeId: string;
	node: WorkflowNode;
	iteration: number;
	item: unknown;
	stepResults: Record<string, unknown>;
}

export interface ParallelBranchContext {
	nodeId: string;
	node: WorkflowNode;
	branchIndex: number;
	branchKey: string;
	branchNodeIds: string[];
	stepResults: Record<string, unknown>;
}

const defaultWait: WaitFn = (ms) =>
	new Promise((resolve) => {
		setTimeout(resolve, ms).unref?.();
	});

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
// Graph Utilities
// ============================================================================

/**
 * Build adjacency list from edges.
 */
function buildAdjacency(
	nodes: WorkflowNode[],
	edges: WorkflowEdge[]
): { adjacency: Map<string, string[]>; inDegree: Map<string, number> } {
	const adjacency = new Map<string, string[]>();
	const inDegree = new Map<string, number>();

	for (const node of nodes) {
		adjacency.set(node.id, []);
		inDegree.set(node.id, 0);
	}

	for (const edge of edges) {
		const neighbors = adjacency.get(edge.source);
		if (neighbors) {
			neighbors.push(edge.target);
		}
		inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
	}

	return { adjacency, inDegree };
}

/**
 * Kahn's algorithm for topological sort.
 * Returns nodes in execution order.
 * Throws ValidationError if the graph contains a cycle.
 */
export function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
	const { adjacency, inDegree } = buildAdjacency(nodes, edges);
	const nodeMap = new Map(nodes.map((n) => [n.id, n]));

	const queue: string[] = [];
	for (const [nodeId, degree] of inDegree) {
		if (degree === 0) queue.push(nodeId);
	}

	const sorted: WorkflowNode[] = [];
	while (queue.length > 0) {
		const current = queue.shift()!;
		const node = nodeMap.get(current);
		if (node) sorted.push(node);

		for (const neighbor of adjacency.get(current) ?? []) {
			const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
			inDegree.set(neighbor, newDegree);
			if (newDegree === 0) queue.push(neighbor);
		}
	}

	if (sorted.length !== nodes.length) {
		throw new ValidationError('Workflow contains a cycle — cannot execute', {
			totalNodes: nodes.length,
			sortedNodes: sorted.length
		});
	}

	return sorted;
}

/**
 * Detect whether the graph has any cycles (DFS-based).
 * Returns true if a cycle exists.
 */
export function detectCycles(nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
	const { adjacency } = buildAdjacency(nodes, edges);

	const WHITE = 0; // unvisited
	const GRAY = 1; // in current DFS path
	const BLACK = 2; // fully processed

	const color = new Map<string, number>();
	for (const node of nodes) {
		color.set(node.id, WHITE);
	}

	function dfs(nodeId: string): boolean {
		color.set(nodeId, GRAY);

		for (const neighbor of adjacency.get(nodeId) ?? []) {
			const neighborColor = color.get(neighbor) ?? WHITE;
			if (neighborColor === GRAY) return true; // back edge = cycle
			if (neighborColor === WHITE && dfs(neighbor)) return true;
		}

		color.set(nodeId, BLACK);
		return false;
	}

	for (const node of nodes) {
		if (color.get(node.id) === WHITE) {
			if (dfs(node.id)) return true;
		}
	}

	return false;
}

// ============================================================================
// Safe Expression Evaluator
// ============================================================================

/**
 * Safely evaluate a simple dot-path expression against a context object.
 * Supports: `result.data.length > 0`, `result.status == "ok"`, etc.
 *
 * Uses property access parsing, NEVER dynamic code execution.
 */
function safeEvaluateExpression(expression: string, context: Record<string, unknown>): boolean {
	// Parse comparison: left operator right
	const comparisonMatch = expression.match(/^([\w.[\]]+)\s*(===?|!==?|>=?|<=?|>|<)\s*(.+)$/);

	if (!comparisonMatch) {
		// Simple truthy check: resolve path and check truthiness
		const value = resolvePath(expression.trim(), context);
		return Boolean(value);
	}

	const [, leftPath, operator, rightRaw] = comparisonMatch;
	const leftValue = resolvePath(leftPath.trim(), context);
	const rightValue = parseRightValue(rightRaw.trim(), context);

	switch (operator) {
		case '==':
		case '===':
			return leftValue === rightValue;
		case '!=':
		case '!==':
			return leftValue !== rightValue;
		case '>':
			return (leftValue as number) > (rightValue as number);
		case '>=':
			return (leftValue as number) >= (rightValue as number);
		case '<':
			return (leftValue as number) < (rightValue as number);
		case '<=':
			return (leftValue as number) <= (rightValue as number);
		default:
			return false;
	}
}

/** Keys that must never be traversed to prevent prototype pollution. */
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Safely read a single own-property from an object.
 * Returns undefined for prototype-pollution keys or missing properties.
 */
function safeGet(target: unknown, key: string): unknown {
	if (BLOCKED_KEYS.has(key)) return undefined;
	if (target == null || typeof target !== 'object') return undefined;
	if (key === 'length' && Array.isArray(target)) return target.length;
	// Use a null-prototype intermediary to avoid prototype chain lookups
	const safeMap: Record<string, unknown> = Object.create(null);
	const ownKeys = Object.keys(target as Record<string, unknown>);
	for (let i = 0; i < ownKeys.length; i++) {
		safeMap[ownKeys[i]] = (target as Record<string, unknown>)[ownKeys[i]];
	}
	return safeMap[key];
}

/**
 * Resolve a dot-path like "result.data.length" against an object.
 * Blocks prototype pollution paths (__proto__, constructor, prototype).
 */
function resolvePath(path: string, obj: Record<string, unknown>): unknown {
	return path.split('.').reduce<unknown>((current, part) => safeGet(current, part), obj as unknown);
}

/**
 * Parse a right-hand value: number, quoted string, boolean, null, or path.
 */
function parseRightValue(raw: string, context: Record<string, unknown>): unknown {
	// Numeric
	if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
	// Quoted string
	if (/^["'].*["']$/.test(raw)) return raw.slice(1, -1);
	// Boolean
	if (raw === 'true') return true;
	if (raw === 'false') return false;
	// Null
	if (raw === 'null') return null;
	// Path reference
	return resolvePath(raw, context);
}

// ============================================================================
// Output Mapping
// ============================================================================

/**
 * Resolve output mapping references like "n1.data.id" against step results.
 */
function resolveOutputMapping(
	mapping: Record<string, string>,
	stepResults: Record<string, unknown>
): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [key, path] of Object.entries(mapping)) {
		output[key] = resolvePath(path, stepResults);
	}
	return output;
}

// ============================================================================
// Workflow Executor
// ============================================================================

export class WorkflowExecutor {
	private readonly options: Required<
		Pick<
			WorkflowExecutorOptions,
			| 'maxSteps'
			| 'maxDurationMs'
			| 'maxLoopIterations'
			| 'nodeTimeoutMs'
			| 'loopRetryLimit'
			| 'now'
			| 'wait'
		>
	> &
		WorkflowExecutorOptions;

	constructor(options: WorkflowExecutorOptions = {}) {
		this.options = {
			maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
			maxDurationMs: options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
			maxLoopIterations: options.maxLoopIterations ?? DEFAULT_LOOP_ITERATIONS,
			nodeTimeoutMs: options.nodeTimeoutMs ?? DEFAULT_NODE_TIMEOUT_MS,
			loopRetryLimit: options.loopRetryLimit ?? DEFAULT_LOOP_RETRY_LIMIT,
			now: options.now ?? (() => Date.now()),
			wait: options.wait ?? defaultWait,
			...options
		};
	}

	run(definition: WorkflowDefinition, input: Record<string, unknown>): Promise<ExecutionResult> {
		return this.execute(definition, input);
	}

	/**
	 * Execute a workflow definition from the beginning.
	 */
	async execute(
		definition: WorkflowDefinition,
		input: Record<string, unknown>
	): Promise<ExecutionResult> {
		log.info({ workflowId: definition.id, name: definition.name }, 'Starting workflow execution');

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
		log.info(
			{ workflowId: definition.id, resumeFrom: engineState.suspendedAtNodeId },
			'Resuming workflow execution'
		);

		const sorted = topologicalSort(definition.nodes, definition.edges);
		const completedSet = new Set(engineState.completedNodeIds);
		// Mark the approval node as completed (it's been approved)
		completedSet.add(engineState.suspendedAtNodeId);

		return this.executeNodes(
			sorted,
			definition.edges,
			engineState.stepResults,
			completedSet,
			engineState.stepResults as Record<string, unknown>
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
		let executedSteps = 0;
		const startedAt = this.options.now();

		for (const node of sortedNodes) {
			if (completedNodeIds.has(node.id)) continue;
			if (skippedNodes.has(node.id)) continue;

			this.ensureBudgets(startedAt, executedSteps + 1);
			executedSteps += 1;
			this.emitStepEvent('start', node);

			try {
				const nodeResult = await this.executeNode(node, edges, input, stepResults, skippedNodes);

				if (nodeResult.suspended) {
					const suspended: ExecutionResult = {
						status: 'suspended',
						stepResults,
						engineState: {
							suspendedAtNodeId: node.id,
							completedNodeIds: [...completedNodeIds, ...Object.keys(stepResults)],
							stepResults
						}
					};
					this.emitStepEvent('complete', node, { suspended: true });
					this.emitStatus(suspended);
					return suspended;
				}

				stepResults[node.id] = nodeResult.result;
				this.emitStepEvent('complete', node, nodeResult.result);

				if (node.type === 'output' && nodeResult.result) {
					output = nodeResult.result as Record<string, unknown>;
				}
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				log.error({ nodeId: node.id, error: errorMsg }, 'Node execution failed');
				this.emitStepEvent('error', node, { error: errorMsg });

				const failed: ExecutionResult = {
					status: 'failed',
					stepResults,
					error: errorMsg
				};
				this.emitStatus(failed);
				return failed;
			}
		}

		const completed: ExecutionResult = {
			status: 'completed',
			stepResults,
			output
		};
		this.emitStatus(completed);
		return completed;
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
				return this.executeAiStepNode(node, input, stepResults);

			case 'loop':
				return this.executeLoopNode(node, input, stepResults);

			case 'parallel':
				return this.executeParallelNode(node, input, stepResults);

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
		const data = node.data as { toolName?: string; args?: Record<string, unknown> };
		const toolName = data.toolName;

		if (!toolName) {
			throw new ValidationError('Tool node missing toolName', { nodeId: node.id });
		}

		// Merge configured args with any inherited context
		const args: Record<string, unknown> = { ...data.args };

		log.info({ nodeId: node.id, toolName }, 'Executing tool node');

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
			throw new ValidationError('Condition node missing expression', { nodeId: node.id });
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

		log.info(
			{ nodeId: node.id, expression: data.expression, result: conditionResult },
			'Condition evaluated'
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

		return { result: { conditionResult, expression: data.expression } };
	}

	/**
	 * Execute an output node by resolving output mapping.
	 */
	private executeOutputNode(
		node: WorkflowNode,
		stepResults: Record<string, unknown>
	): { result: unknown } {
		const data = node.data as { outputMapping?: Record<string, string> };

		if (data.outputMapping) {
			const output = resolveOutputMapping(data.outputMapping, stepResults);
			return { result: output };
		}

		return { result: stepResults };
	}

	private async executeAiStepNode(
		node: WorkflowNode,
		input: Record<string, unknown>,
		stepResults: Record<string, unknown>
	): Promise<{ result: unknown }> {
		const data = node.data as AIStepNodeData | undefined;
		if (!data?.prompt) {
			throw new ValidationError('AI step missing prompt', { nodeId: node.id });
		}

		if (!this.options.aiStepHandler) {
			throw new ValidationError('AI step handler not configured', { nodeId: node.id });
		}

		const context = this.createTemplateContext(input, stepResults);
		const prompt = this.interpolateTemplate(data.prompt, context);
		const payload: AIStepHandlerPayload = {
			nodeId: node.id,
			node,
			prompt,
			systemPrompt: data.systemPrompt,
			temperature: data.temperature,
			maxTokens: data.maxTokens,
			outputSchema: data.outputSchema,
			input,
			stepResults
		};

		const result = await this.runWithTimeout(
			() => this.options.aiStepHandler!(payload),
			data.timeoutMs ?? this.options.nodeTimeoutMs
		);
		return { result };
	}

	private async executeLoopNode(
		node: WorkflowNode,
		input: Record<string, unknown>,
		stepResults: Record<string, unknown>
	): Promise<{ result: unknown }> {
		const data = node.data as LoopNodeData | undefined;
		if (!data?.iteratorExpression) {
			throw new ValidationError('Loop node missing iterator expression', { nodeId: node.id });
		}

		const context = this.createTemplateContext(input, stepResults);
		const source = resolvePath(data.iteratorExpression, context);
		if (!Array.isArray(source)) {
			throw new ValidationError('Loop iterator must resolve to an array', {
				nodeId: node.id,
				iteratorExpression: data.iteratorExpression
			});
		}

		const iterationVariable = data.iterationVariable ?? 'item';
		const indexVariable = data.indexVariable ?? 'index';
		const maxIterations = Math.min(
			source.length,
			data.maxIterations ?? this.options.maxLoopIterations
		);
		const loopHandler =
			this.options.loopHandler ?? (async ({ item }: LoopIterationContext) => item);

		const results: unknown[] = [];
		let breakTriggered = false;

		const templateContextBase = this.createTemplateContext(input, stepResults);
		const runIteration = async (item: unknown, index: number) => {
			if (breakTriggered) return;
			const iterationContext = {
				...templateContextBase,
				[iterationVariable]: item,
				[indexVariable]: index
			} as Record<string, unknown>;

			if (data.breakCondition) {
				const shouldBreak = safeEvaluateExpression(data.breakCondition, iterationContext);
				if (shouldBreak) {
					breakTriggered = true;
					return;
				}
			}

			const handlerContext: LoopIterationContext = {
				nodeId: node.id,
				node,
				iteration: index,
				item,
				stepResults
			};

			const value = await this.withRetry(
				() => this.runWithTimeout(() => loopHandler(handlerContext)),
				this.options.loopRetryLimit ?? DEFAULT_LOOP_RETRY_LIMIT
			);
			results.push(value);
		};

		if (data.executionMode === 'parallel') {
			await Promise.all(
				source.slice(0, maxIterations).map((item, index) => runIteration(item, index))
			);
		} else {
			for (let i = 0; i < maxIterations; i++) {
				await runIteration(source[i], i);
				if (breakTriggered) break;
			}
		}

		return {
			result: {
				items: results,
				totalIterations: results.length,
				breakTriggered,
				executionMode: data.executionMode ?? 'sequential',
				resumeToken: breakTriggered ? { nextIndex: results.length } : undefined
			}
		};
	}

	private async executeParallelNode(
		node: WorkflowNode,
		input: Record<string, unknown>,
		stepResults: Record<string, unknown>
	): Promise<{ result: unknown }> {
		const data = node.data as ParallelNodeData | undefined;
		if (!data?.branchNodeIds || data.branchNodeIds.length === 0) {
			throw new ValidationError('Parallel node missing branches', { nodeId: node.id });
		}

		const branchPromises = data.branchNodeIds.map((branchNodeIds, index) => {
			const branchKey = this.resolveBranchKey(branchNodeIds, index);
			const context: ParallelBranchContext = {
				nodeId: node.id,
				node,
				branchIndex: index,
				branchKey,
				branchNodeIds,
				stepResults
			};
			return this.runParallelBranch(context, data.timeoutMs ?? this.options.nodeTimeoutMs);
		});

		if (data.errorHandling === 'collect-all') {
			const settled = await Promise.allSettled(branchPromises);
			const branches: Record<string, unknown> = {};
			settled.forEach((result, idx) => {
				const branchKey = this.resolveBranchKey(data.branchNodeIds[idx], idx);
				if (result.status === 'fulfilled') {
					branches[branchKey] = result.value;
				} else {
					branches[branchKey] = { error: this.serializeError(result.reason) };
				}
			});
			return { result: { branches } };
		}

		if (data.mergeStrategy === 'first' || data.mergeStrategy === 'any') {
			const value = await Promise.any(branchPromises);
			return {
				result: {
					branches: {
						[this.resolveBranchKey(data.branchNodeIds[0], 0)]: value
					}
				}
			};
		}

		const branchResults = await Promise.all(branchPromises);
		const branches: Record<string, unknown> = {};
		branchResults.forEach((value, idx) => {
			const branchKey = this.resolveBranchKey(data.branchNodeIds[idx], idx);
			branches[branchKey] = value;
		});
		return { result: { branches } };
	}

	private resolveBranchKey(branchNodeIds: string[], index: number): string {
		return branchNodeIds[0] ?? `branch-${index + 1}`;
	}

	private ensureBudgets(startedAt: number, executedSteps: number): void {
		if (executedSteps > this.options.maxSteps) {
			throw new ValidationError('Workflow exceeded maximum step budget', {
				maxSteps: this.options.maxSteps
			});
		}

		const elapsed = this.options.now() - startedAt;
		if (elapsed > this.options.maxDurationMs) {
			throw new ValidationError('Workflow exceeded maximum duration', {
				maxDurationMs: this.options.maxDurationMs,
				elapsed
			});
		}
	}

	private emitStepEvent(
		stage: 'start' | 'complete' | 'error',
		node: WorkflowNode,
		payload?: unknown
	): void {
		this.options.progressEmitter?.({
			type: 'step',
			stage,
			nodeId: node.id,
			nodeType: node.type,
			payload
		});
	}

	private emitStatus(result: ExecutionResult): void {
		this.options.progressEmitter?.({
			type: 'status',
			status: result.status,
			output: result.output,
			error: result.error
		});
	}

	private createTemplateContext(
		input: Record<string, unknown>,
		stepResults: Record<string, unknown>
	): Record<string, unknown> {
		return { input, ...stepResults };
	}

	private interpolateTemplate(template: string, context: Record<string, unknown>): string {
		return template.replace(/{{\s*([^}]+)\s*}}/g, (_match, expression) => {
			const value = resolvePath(expression.trim(), context);
			if (value == null) return '';
			return typeof value === 'string' ? value : JSON.stringify(value);
		});
	}

	private async runWithTimeout<T>(operation: () => Promise<T>, timeoutMs?: number): Promise<T> {
		const ms = timeoutMs ?? this.options.nodeTimeoutMs;
		if (!ms || ms === Infinity) return operation();

		let timeoutId: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				operation(),
				new Promise<T>((_, reject) => {
					timeoutId = setTimeout(() => {
						reject(new ValidationError('Node execution timed out', { timeoutMs: ms }));
					}, ms);
				})
			]);
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		}
	}

	private async withRetry<T>(operation: () => Promise<T>, retries: number): Promise<T> {
		let attempt = 0;
		let delay = INITIAL_RETRY_DELAY_MS;
		let lastError: unknown;
		while (attempt <= retries) {
			try {
				return await operation();
			} catch (err) {
				lastError = err;
				if (attempt === retries) {
					throw err;
				}
				await this.options.wait(delay);
				delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
				attempt += 1;
			}
		}
		throw lastError ?? new Error('retry failed');
	}

	private runParallelBranch(context: ParallelBranchContext, timeoutMs?: number): Promise<unknown> {
		const handler =
			this.options.parallelHandler ?? (async () => ({ nodeIds: context.branchNodeIds }));
		return this.runWithTimeout(() => handler(context), timeoutMs);
	}

	private serializeError(err: unknown): string {
		if (err instanceof Error) return err.message;
		return typeof err === 'string' ? err : 'unknown error';
	}
}
