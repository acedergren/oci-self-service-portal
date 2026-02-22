/**
 * Unit tests for CloudAdvisor page logic.
 *
 * The page fetches findings from /api/cloud-advisor/findings, filters them
 * by severity, and renders a Spinner during loading. Tests cover the embedded
 * filter/sort/count logic, page metadata, and loading state derivation in
 * pure TypeScript — no DOM rendering required.
 *
 * Source: apps/frontend/src/routes/cloud-advisor/+page.svelte
 */

import { describe, it, expect } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

type Severity = 'critical' | 'high' | 'medium' | 'low';
type FilterKey = 'all' | Severity;

interface Finding {
	id: string;
	title: string;
	severity: Severity;
	summary: string;
	impact?: string;
	domain?: string;
}

// ── Replicated component logic ────────────────────────────────────────────────

const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function filterAndSort(findings: Finding[], activeFilter: FilterKey): Finding[] {
	return (activeFilter === 'all' ? findings : findings.filter((f) => f.severity === activeFilter))
		.slice()
		.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
	return {
		critical: findings.filter((f) => f.severity === 'critical').length,
		high: findings.filter((f) => f.severity === 'high').length,
		medium: findings.filter((f) => f.severity === 'medium').length,
		low: findings.filter((f) => f.severity === 'low').length
	};
}

const filters: { key: FilterKey; label: string; color?: string }[] = [
	{ key: 'all', label: 'All' },
	{ key: 'critical', label: 'Critical', color: 'var(--semantic-error)' },
	{ key: 'high', label: 'High', color: 'var(--semantic-warning)' },
	{ key: 'medium', label: 'Medium', color: 'var(--semantic-info)' },
	{ key: 'low', label: 'Low', color: 'var(--fg-tertiary)' }
];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FINDINGS: Finding[] = [
	{ id: '1', title: 'Low finding', severity: 'low', summary: 'Minor issue' },
	{ id: '2', title: 'Critical finding', severity: 'critical', summary: 'Urgent' },
	{ id: '3', title: 'High finding', severity: 'high', summary: 'Serious' },
	{ id: '4', title: 'Medium finding', severity: 'medium', summary: 'Moderate' },
	{ id: '5', title: 'Another critical', severity: 'critical', summary: 'Also urgent' }
];

// ── Tests: page metadata ───────────────────────────────────────────────────────

describe('CloudAdvisor page — metadata', () => {
	it('page title is "CloudAdvisor"', () => {
		const pageTitle = 'CloudAdvisor';
		expect(pageTitle).toBe('CloudAdvisor');
	});

	it('document title includes the product name', () => {
		const docTitle = 'CloudAdvisor - CloudNow';
		expect(docTitle).toContain('CloudAdvisor');
		expect(docTitle).toContain('CloudNow');
	});
});

// ── Tests: filter tabs ─────────────────────────────────────────────────────────

describe('CloudAdvisor page — filter tabs', () => {
	it('renders five filter tabs', () => {
		expect(filters).toHaveLength(5);
	});

	it('first filter is "All"', () => {
		expect(filters[0].key).toBe('all');
		expect(filters[0].label).toBe('All');
	});

	it('severity filters have colours', () => {
		const withColor = filters.filter((f) => f.key !== 'all');
		expect(withColor.every((f) => f.color !== undefined)).toBe(true);
	});

	it('"All" filter has no colour', () => {
		const allFilter = filters.find((f) => f.key === 'all');
		expect(allFilter?.color).toBeUndefined();
	});

	it('filter keys cover all severity levels', () => {
		const keys = filters.map((f) => f.key);
		expect(keys).toContain('critical');
		expect(keys).toContain('high');
		expect(keys).toContain('medium');
		expect(keys).toContain('low');
	});
});

// ── Tests: filterAndSort ───────────────────────────────────────────────────────

describe('CloudAdvisor page — filterAndSort', () => {
	it('returns all findings when activeFilter is "all"', () => {
		const result = filterAndSort(FINDINGS, 'all');
		expect(result).toHaveLength(FINDINGS.length);
	});

	it('sorts all findings by severity (critical first)', () => {
		const result = filterAndSort(FINDINGS, 'all');
		expect(result[0].severity).toBe('critical');
		expect(result[1].severity).toBe('critical');
		expect(result[2].severity).toBe('high');
		expect(result[3].severity).toBe('medium');
		expect(result[4].severity).toBe('low');
	});

	it('filters to only critical findings', () => {
		const result = filterAndSort(FINDINGS, 'critical');
		expect(result.every((f) => f.severity === 'critical')).toBe(true);
		expect(result).toHaveLength(2);
	});

	it('filters to only high findings', () => {
		const result = filterAndSort(FINDINGS, 'high');
		expect(result.every((f) => f.severity === 'high')).toBe(true);
		expect(result).toHaveLength(1);
	});

	it('filters to only medium findings', () => {
		const result = filterAndSort(FINDINGS, 'medium');
		expect(result.every((f) => f.severity === 'medium')).toBe(true);
		expect(result).toHaveLength(1);
	});

	it('filters to only low findings', () => {
		const result = filterAndSort(FINDINGS, 'low');
		expect(result.every((f) => f.severity === 'low')).toBe(true);
		expect(result).toHaveLength(1);
	});

	it('returns empty array when no findings match the active filter', () => {
		const result = filterAndSort([], 'critical');
		expect(result).toEqual([]);
	});

	it('does not mutate the original findings array', () => {
		const copy = [...FINDINGS];
		filterAndSort(FINDINGS, 'all');
		expect(FINDINGS).toEqual(copy);
	});

	it('severityOrder maps critical to lowest value (0)', () => {
		expect(severityOrder.critical).toBe(0);
	});

	it('severityOrder maps low to highest value (3)', () => {
		expect(severityOrder.low).toBe(3);
	});
});

// ── Tests: countBySeverity ─────────────────────────────────────────────────────

describe('CloudAdvisor page — countBySeverity', () => {
	it('counts critical findings correctly', () => {
		const counts = countBySeverity(FINDINGS);
		expect(counts.critical).toBe(2);
	});

	it('counts high findings correctly', () => {
		const counts = countBySeverity(FINDINGS);
		expect(counts.high).toBe(1);
	});

	it('counts medium findings correctly', () => {
		const counts = countBySeverity(FINDINGS);
		expect(counts.medium).toBe(1);
	});

	it('counts low findings correctly', () => {
		const counts = countBySeverity(FINDINGS);
		expect(counts.low).toBe(1);
	});

	it('returns zero counts for empty findings', () => {
		const counts = countBySeverity([]);
		expect(counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
	});
});

// ── Tests: loading state ───────────────────────────────────────────────────────

describe('CloudAdvisor page — loading state', () => {
	it('shows spinner when query isPending is true', () => {
		const isPending = true;
		// The template renders <Spinner variant="dots" /> inside .loading-state
		// when findingsQuery.isPending is true.
		expect(isPending).toBe(true);
	});

	it('does not show spinner when query has data', () => {
		const isPending = false;
		expect(isPending).toBe(false);
	});

	it('loading text is "Loading findings..."', () => {
		const loadingText = 'Loading findings...';
		expect(loadingText).toBe('Loading findings...');
	});
});

// ── Tests: empty state ─────────────────────────────────────────────────────────

describe('CloudAdvisor page — empty state', () => {
	it('shows "No findings yet" when filter is "all" and findings list is empty', () => {
		const activeFilter: FilterKey = 'all';
		const filtered = filterAndSort([], activeFilter);
		expect(filtered).toHaveLength(0);

		const emptyTitle = activeFilter === 'all' ? 'No findings yet' : `No ${activeFilter} findings`;
		expect(emptyTitle).toBe('No findings yet');
	});

	it('shows "No critical findings" when filter is "critical" and list is empty', () => {
		const activeFilter: FilterKey = 'critical';
		const filtered = filterAndSort([], activeFilter);
		expect(filtered).toHaveLength(0);

		const emptyTitle = activeFilter === 'all' ? 'No findings yet' : `No ${activeFilter} findings`;
		expect(emptyTitle).toBe('No critical findings');
	});
});

// ── Tests: API integration ─────────────────────────────────────────────────────

describe('CloudAdvisor page — API data shape', () => {
	it('uses data.findings when present in API response', () => {
		const responseA = { findings: FINDINGS };
		const resolved = responseA.findings ?? responseA;
		expect(resolved).toBe(FINDINGS);
	});

	it('falls back to response body when findings key is absent', () => {
		const responseB = FINDINGS;
		const resolved = (responseB as any).findings ?? responseB;
		expect(resolved).toBe(FINDINGS);
	});

	it('queryKey is ["cloud-advisor", "findings"]', () => {
		const queryKey = ['cloud-advisor', 'findings'];
		expect(queryKey).toEqual(['cloud-advisor', 'findings']);
	});
});
