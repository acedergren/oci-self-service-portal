/**
 * Unit tests for fuzzy-search utility — Fuse.js wrapper providing
 * both reusable (indexed) and one-shot search functions.
 *
 * Pure utility — no mocks needed. Tests validate query matching,
 * empty-query pass-through, and custom options.
 *
 * Source: apps/frontend/src/lib/utils/fuzzy-search.ts (45 lines, 0 tests)
 */

import { describe, it, expect } from 'vitest';
import { createFuzzySearch, fuzzySearch } from '$lib/utils/fuzzy-search';

// ── Test data ─────────────────────────────────────────────────────────────

interface Tool {
	name: string;
	category: string;
	description: string;
}

const TOOLS: Tool[] = [
	{ name: 'list-instances', category: 'compute', description: 'List compute instances' },
	{ name: 'launch-instance', category: 'compute', description: 'Launch a new instance' },
	{ name: 'list-vcns', category: 'networking', description: 'List VCNs' },
	{ name: 'create-bucket', category: 'storage', description: 'Create object storage bucket' },
	{ name: 'delete-instance', category: 'compute', description: 'Delete a compute instance' }
];

// ── createFuzzySearch ────────────────────────────────────────────────────

describe('createFuzzySearch', () => {
	it('returns all items when query is empty', () => {
		const search = createFuzzySearch(TOOLS, ['name', 'category']);
		const result = search('');
		expect(result).toEqual(TOOLS);
	});

	it('returns all items for whitespace-only query', () => {
		const search = createFuzzySearch(TOOLS, ['name']);
		const result = search('   ');
		expect(result).toEqual(TOOLS);
	});

	it('matches by name key', () => {
		const search = createFuzzySearch(TOOLS, ['name']);
		const result = search('list-instances');
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0].name).toBe('list-instances');
	});

	it('matches by category key', () => {
		const search = createFuzzySearch(TOOLS, ['category']);
		const result = search('compute');
		expect(result.length).toBeGreaterThanOrEqual(2);
		expect(result.every((t) => t.category === 'compute')).toBe(true);
	});

	it('returns fuzzy matches (typo-tolerant)', () => {
		const search = createFuzzySearch(TOOLS, ['name', 'description']);
		const result = search('instanc');
		expect(result.length).toBeGreaterThanOrEqual(1);
		// Should match items containing "instance"
		expect(result.some((t) => t.name.includes('instance'))).toBe(true);
	});

	it('returns empty array when nothing matches', () => {
		const search = createFuzzySearch(TOOLS, ['name']);
		const result = search('zzzznonexistent');
		expect(result).toEqual([]);
	});

	it('respects custom threshold option', () => {
		// Very strict threshold (0.0) = exact matches only
		const strictSearch = createFuzzySearch(TOOLS, ['name'], { threshold: 0.0 });
		const result = strictSearch('list-instances');
		expect(result.length).toBe(1);
		expect(result[0].name).toBe('list-instances');
	});

	it('works with empty items array', () => {
		const search = createFuzzySearch<Tool>([], ['name']);
		expect(search('')).toEqual([]);
		expect(search('anything')).toEqual([]);
	});
});

// ── fuzzySearch (one-shot) ───────────────────────────────────────────────

describe('fuzzySearch', () => {
	it('returns all items when query is empty', () => {
		const result = fuzzySearch(TOOLS, '', ['name']);
		expect(result).toEqual(TOOLS);
	});

	it('finds matching items', () => {
		const result = fuzzySearch(TOOLS, 'bucket', ['name', 'description']);
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0].name).toBe('create-bucket');
	});

	it('searches across multiple keys', () => {
		const result = fuzzySearch(TOOLS, 'storage', ['category', 'description']);
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0].category).toBe('storage');
	});
});
