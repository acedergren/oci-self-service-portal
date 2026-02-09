/**
 * Workflow graph utilities — pure functions for DAG traversal.
 *
 * Extracted from the WorkflowExecutor for reuse across
 * the API (executor) and shared (validation) packages.
 */
import type { WorkflowNode, WorkflowEdge } from './types.js';

// ============================================================================
// Adjacency / In-degree
// ============================================================================

export interface AdjacencyResult {
	adjacency: Map<string, string[]>;
	inDegree: Map<string, number>;
}

/**
 * Build adjacency list and in-degree map from nodes + edges.
 */
export function buildAdjacency(nodes: WorkflowNode[], edges: WorkflowEdge[]): AdjacencyResult {
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

// ============================================================================
// Topological Sort (Kahn's Algorithm)
// ============================================================================

/**
 * Kahn's algorithm for topological sort.
 * Returns nodes in execution order.
 * Throws if the graph contains a cycle.
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
		throw new Error(
			`Workflow contains a cycle — cannot execute (${sorted.length}/${nodes.length} nodes sorted)`
		);
	}

	return sorted;
}

// ============================================================================
// Cycle Detection (DFS)
// ============================================================================

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

/** Keys that must never be traversed to prevent prototype pollution. */
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Safely read a single own-property from an object.
 * Returns undefined for prototype-pollution keys or missing properties.
 */
export function safeGet(target: unknown, key: string): unknown {
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
export function resolvePath(path: string, obj: Record<string, unknown>): unknown {
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

/**
 * Safely evaluate a simple comparison expression against a context object.
 * Supports: `result.data.length > 0`, `result.status == "ok"`, etc.
 *
 * Uses property access parsing, NEVER dynamic code execution.
 */
export function safeEvaluateExpression(
	expression: string,
	context: Record<string, unknown>
): boolean {
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

// ============================================================================
// Output Mapping
// ============================================================================

/**
 * Resolve output mapping references like "n1.data.id" against step results.
 */
export function resolveOutputMapping(
	mapping: Record<string, string>,
	stepResults: Record<string, unknown>
): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [key, path] of Object.entries(mapping)) {
		output[key] = resolvePath(path, stepResults);
	}
	return output;
}
