import { describe, it, expect } from 'vitest';
import {
	buildAdjacency,
	topologicalSort,
	detectCycles,
	safeGet,
	resolvePath,
	safeEvaluateExpression,
	resolveOutputMapping
} from './graph-utils.js';
import type { WorkflowNode, WorkflowEdge } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeNode(
	id: string,
	type: 'input' | 'tool' | 'condition' | 'output' = 'tool'
): WorkflowNode {
	return { id, type, position: { x: 0, y: 0 }, data: {} };
}

function makeEdge(source: string, target: string): WorkflowEdge {
	return { id: `${source}-${target}`, source, target };
}

// ── buildAdjacency ──────────────────────────────────────────────────────

describe('buildAdjacency', () => {
	it('returns adjacency list and in-degree map', () => {
		const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
		const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];

		const { adjacency, inDegree } = buildAdjacency(nodes, edges);

		expect(adjacency.get('a')).toEqual(['b']);
		expect(adjacency.get('b')).toEqual(['c']);
		expect(adjacency.get('c')).toEqual([]);
		expect(inDegree.get('a')).toBe(0);
		expect(inDegree.get('b')).toBe(1);
		expect(inDegree.get('c')).toBe(1);
	});

	it('handles empty graph', () => {
		const { adjacency, inDegree } = buildAdjacency([], []);
		expect(adjacency.size).toBe(0);
		expect(inDegree.size).toBe(0);
	});

	it('handles node with multiple outgoing edges', () => {
		const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
		const edges = [makeEdge('a', 'b'), makeEdge('a', 'c')];

		const { adjacency } = buildAdjacency(nodes, edges);

		expect(adjacency.get('a')).toEqual(['b', 'c']);
	});
});

// ── topologicalSort ─────────────────────────────────────────────────────

describe('topologicalSort', () => {
	it('returns nodes in topological order', () => {
		const nodes = [makeNode('c'), makeNode('a'), makeNode('b')];
		const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];

		const sorted = topologicalSort(nodes, edges);

		const ids = sorted.map((n) => n.id);
		expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
		expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'));
	});

	it('throws on cyclic graph', () => {
		const nodes = [makeNode('a'), makeNode('b')];
		const edges = [makeEdge('a', 'b'), makeEdge('b', 'a')];

		expect(() => topologicalSort(nodes, edges)).toThrow('cycle');
	});

	it('handles single node with no edges', () => {
		const nodes = [makeNode('a')];
		const sorted = topologicalSort(nodes, []);
		expect(sorted).toHaveLength(1);
		expect(sorted[0].id).toBe('a');
	});

	it('handles diamond DAG', () => {
		const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
		const edges = [makeEdge('a', 'b'), makeEdge('a', 'c'), makeEdge('b', 'd'), makeEdge('c', 'd')];

		const sorted = topologicalSort(nodes, edges);
		const ids = sorted.map((n) => n.id);

		expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
		expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('c'));
		expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('d'));
		expect(ids.indexOf('c')).toBeLessThan(ids.indexOf('d'));
	});
});

// ── detectCycles ────────────────────────────────────────────────────────

describe('detectCycles', () => {
	it('returns false for DAG', () => {
		const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
		const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];

		expect(detectCycles(nodes, edges)).toBe(false);
	});

	it('returns true for cycle', () => {
		const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
		const edges = [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'a')];

		expect(detectCycles(nodes, edges)).toBe(true);
	});

	it('returns true for self-loop', () => {
		const nodes = [makeNode('a')];
		const edges = [makeEdge('a', 'a')];

		expect(detectCycles(nodes, edges)).toBe(true);
	});

	it('returns false for empty graph', () => {
		expect(detectCycles([], [])).toBe(false);
	});

	it('returns false for disconnected DAG', () => {
		const nodes = [makeNode('a'), makeNode('b')];
		expect(detectCycles(nodes, [])).toBe(false);
	});
});

// ── safeGet ─────────────────────────────────────────────────────────────

describe('safeGet', () => {
	it('reads own properties', () => {
		expect(safeGet({ foo: 'bar' }, 'foo')).toBe('bar');
	});

	it('returns undefined for __proto__', () => {
		expect(safeGet({}, '__proto__')).toBeUndefined();
	});

	it('returns undefined for constructor', () => {
		expect(safeGet({}, 'constructor')).toBeUndefined();
	});

	it('returns undefined for prototype', () => {
		expect(safeGet({}, 'prototype')).toBeUndefined();
	});

	it('returns undefined for null target', () => {
		expect(safeGet(null, 'foo')).toBeUndefined();
	});

	it('returns undefined for primitive target', () => {
		expect(safeGet('hello', 'length')).toBeUndefined();
	});

	it('returns array length', () => {
		expect(safeGet([1, 2, 3], 'length')).toBe(3);
	});

	it('returns undefined for missing key', () => {
		expect(safeGet({ a: 1 }, 'b')).toBeUndefined();
	});
});

// ── resolvePath ─────────────────────────────────────────────────────────

describe('resolvePath', () => {
	it('resolves dot-path', () => {
		const obj = { result: { data: { count: 42 } } };
		expect(resolvePath('result.data.count', obj)).toBe(42);
	});

	it('returns undefined for missing path', () => {
		expect(resolvePath('a.b.c', {})).toBeUndefined();
	});

	it('blocks prototype pollution path', () => {
		expect(resolvePath('__proto__.polluted', {})).toBeUndefined();
		expect(resolvePath('constructor.prototype', {})).toBeUndefined();
	});
});

// ── safeEvaluateExpression ──────────────────────────────────────────────

describe('safeEvaluateExpression', () => {
	it('evaluates equality', () => {
		expect(safeEvaluateExpression('status == "ok"', { status: 'ok' })).toBe(true);
		expect(safeEvaluateExpression('status == "fail"', { status: 'ok' })).toBe(false);
	});

	it('evaluates strict equality', () => {
		expect(safeEvaluateExpression('x === "hello"', { x: 'hello' })).toBe(true);
	});

	it('evaluates inequality', () => {
		expect(safeEvaluateExpression('x != 5', { x: 10 })).toBe(true);
		expect(safeEvaluateExpression('x != 10', { x: 10 })).toBe(false);
	});

	it('evaluates numeric comparisons', () => {
		expect(safeEvaluateExpression('count > 0', { count: 5 })).toBe(true);
		expect(safeEvaluateExpression('count >= 5', { count: 5 })).toBe(true);
		expect(safeEvaluateExpression('count < 10', { count: 5 })).toBe(true);
		expect(safeEvaluateExpression('count <= 4', { count: 5 })).toBe(false);
	});

	it('evaluates dot-path on left side', () => {
		const context = { result: { data: { length: 3 } } };
		expect(safeEvaluateExpression('result.data.length > 0', context)).toBe(true);
	});

	it('evaluates truthy check (no operator)', () => {
		expect(safeEvaluateExpression('result', { result: true })).toBe(true);
		expect(safeEvaluateExpression('result', { result: false })).toBe(false);
		expect(safeEvaluateExpression('result', { result: null })).toBe(false);
		expect(safeEvaluateExpression('result', {})).toBe(false);
	});

	it('parses boolean right-hand values', () => {
		expect(safeEvaluateExpression('x == true', { x: true })).toBe(true);
		expect(safeEvaluateExpression('x == false', { x: false })).toBe(true);
	});

	it('parses null right-hand value', () => {
		expect(safeEvaluateExpression('x == null', { x: null })).toBe(true);
	});

	it('resolves path references on right side', () => {
		expect(safeEvaluateExpression('a == b', { a: 'hello', b: 'hello' })).toBe(true);
	});
});

// ── resolveOutputMapping ────────────────────────────────────────────────

describe('resolveOutputMapping', () => {
	it('maps paths to output keys', () => {
		const stepResults = {
			n1: { data: { id: 'abc' } },
			n2: { count: 5 }
		};

		const output = resolveOutputMapping(
			{ resourceId: 'n1.data.id', total: 'n2.count' },
			stepResults
		);

		expect(output).toEqual({ resourceId: 'abc', total: 5 });
	});

	it('returns undefined for missing paths', () => {
		const output = resolveOutputMapping({ missing: 'n1.x.y' }, {});
		expect(output.missing).toBeUndefined();
	});
});
