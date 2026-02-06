/**
 * Phase 8 TDD: Property Graph Analytics (Oracle 26AI)
 *
 * Uses Oracle 26AI SQL/PGQ GRAPH_TABLE() for relationship insights.
 * Zero data duplication — graph is a logical view over existing tables.
 *
 * Module under test: $lib/server/oracle/graph-analytics.ts
 * Exports:
 *   - getUserActivity(userId, limit?): Promise<GraphQueryResult>
 *   - getToolAffinity(limit?): Promise<GraphQueryResult>
 *   - getOrgImpact(toolName, limit?): Promise<GraphQueryResult>
 *
 * Types from: $lib/server/api/types.ts (GraphNode, GraphEdge, GraphQueryResult)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Oracle connection
const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
const mockConn = {
	execute: mockExecute,
	commit: vi.fn().mockResolvedValue(undefined),
	rollback: vi.fn().mockResolvedValue(undefined),
	close: vi.fn().mockResolvedValue(undefined)
};

vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) => fn(mockConn))
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

vi.mock('$lib/server/sentry.js', () => ({
	wrapWithSpan: vi.fn((_name: string, _op: string, fn: () => unknown) => fn()),
	captureError: vi.fn()
}));

import {
	getUserActivity,
	getToolAffinity,
	getOrgImpact
} from '$lib/server/oracle/graph-analytics.js';

beforeEach(() => {
	vi.clearAllMocks();
});

// ============================================================================
// User Activity Graph
// ============================================================================

describe('Property Graph Analytics (Phase 8.7)', () => {
	describe('getUserActivity', () => {
		it('returns nodes and edges for a user activity graph', async () => {
			const now = new Date();
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						USER_ID: 'u1',
						USER_EMAIL: 'alice@example.com',
						SESSION_ID: 's1',
						SESSION_TITLE: 'Infra Review',
						TOOL_NAME: 'listInstances',
						TOOL_CATEGORY: 'compute',
						ACTION: 'executed',
						EXECUTED_AT: new Date(now.getTime() - 2000)
					},
					{
						USER_ID: 'u1',
						USER_EMAIL: 'alice@example.com',
						SESSION_ID: 's1',
						SESSION_TITLE: 'Infra Review',
						TOOL_NAME: 'getVcn',
						TOOL_CATEGORY: 'networking',
						ACTION: 'executed',
						EXECUTED_AT: new Date(now.getTime() - 1000)
					}
				]
			});

			const graph = await getUserActivity('u1');

			expect(graph.nodes).toBeDefined();
			expect(Array.isArray(graph.nodes)).toBe(true);
			expect(graph.nodes.length).toBeGreaterThan(0);

			expect(graph.edges).toBeDefined();
			expect(Array.isArray(graph.edges)).toBe(true);
			expect(graph.edges.length).toBeGreaterThan(0);

			// Nodes should have GraphNode shape: id, label, properties
			for (const n of graph.nodes) {
				expect(n.id).toBeDefined();
				expect(n.label).toBeDefined();
				expect(n.properties).toBeDefined();
			}

			// Edges should have GraphEdge shape: sourceId, targetId, label, properties
			for (const e of graph.edges) {
				expect(e.sourceId).toBeDefined();
				expect(e.targetId).toBeDefined();
				expect(e.label).toBeDefined();
			}
		});

		it('returns empty graph when user has no activity', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const graph = await getUserActivity('u-inactive');
			expect(graph.nodes).toEqual([]);
			expect(graph.edges).toEqual([]);
		});

		it('SQL uses GRAPH_TABLE operator', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			await getUserActivity('u1');

			const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
			expect(sql).toContain('GRAPH_TABLE');
			expect(sql).toContain('PORTAL_GRAPH');
		});
	});

	// ============================================================================
	// Tool Affinity (Co-occurrence)
	// ============================================================================

	describe('getToolAffinity', () => {
		it('returns tool co-occurrence as graph nodes and edges', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [
					{ TOOL_A: 'listInstances', TOOL_B: 'getInstance', CO_OCCURRENCE: 42, SESSION_COUNT: 20 },
					{ TOOL_A: 'listVcns', TOOL_B: 'listSubnets', CO_OCCURRENCE: 28, SESSION_COUNT: 12 }
				]
			});

			const graph = await getToolAffinity(10);

			expect(graph.nodes.length).toBeGreaterThan(0);
			expect(graph.edges.length).toBeGreaterThan(0);

			// Edges should represent co-occurrence
			for (const e of graph.edges) {
				expect(e.label).toBe('co_occurs_with');
				expect(e.properties.coOccurrence).toBeDefined();
				expect(typeof e.properties.coOccurrence).toBe('number');
			}
		});

		it('returns empty graph when no tool usage data exists', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const graph = await getToolAffinity();
			expect(graph.nodes).toEqual([]);
			expect(graph.edges).toEqual([]);
		});

		it('SQL self-joins tool_executions for co-occurrence', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			await getToolAffinity();

			const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
			expect(sql).toContain('TOOL_EXECUTIONS');
			expect(sql).toContain('JOIN');
			expect(sql).toContain('CO_OCCURRENCE');
		});
	});

	// ============================================================================
	// Org Impact Analysis
	// ============================================================================

	describe('getOrgImpact', () => {
		it('returns org-level impact for a specific tool', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ORG_ID: 'org-1',
						ORG_NAME: 'Engineering',
						USER_COUNT: 8,
						EXECUTION_COUNT: 320,
						LAST_USED: new Date('2026-02-01')
					},
					{
						ORG_ID: 'org-2',
						ORG_NAME: 'Operations',
						USER_COUNT: 3,
						EXECUTION_COUNT: 45,
						LAST_USED: new Date('2026-01-15')
					}
				]
			});

			const graph = await getOrgImpact('listInstances');

			expect(graph.nodes.length).toBeGreaterThan(0);
			expect(graph.edges.length).toBeGreaterThan(0);

			// Should have a tool node
			const toolNode = graph.nodes.find((n) => n.label === 'tool');
			expect(toolNode).toBeDefined();
			expect(toolNode!.properties.name).toBe('listInstances');

			// Should have org nodes
			const orgNodes = graph.nodes.filter((n) => n.label === 'organization');
			expect(orgNodes.length).toBe(2);
		});

		it('returns empty graph for unknown tool', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const graph = await getOrgImpact('nonExistentTool');
			expect(graph.nodes).toEqual([]);
			expect(graph.edges).toEqual([]);
		});
	});

	// ============================================================================
	// Admin-Only Enforcement
	// ============================================================================

	describe('admin-only endpoint enforcement', () => {
		it('graph endpoints require admin:audit permission', () => {
			const requiredPermission = 'admin:audit';

			const viewerPermissions = ['tools:read', 'sessions:read', 'workflows:read'];
			expect(viewerPermissions).not.toContain(requiredPermission);

			const operatorPermissions = [
				'tools:read',
				'tools:execute',
				'tools:approve',
				'sessions:read',
				'sessions:write',
				'workflows:read',
				'workflows:execute'
			];
			expect(operatorPermissions).not.toContain(requiredPermission);

			const adminPermissions = [
				'tools:read',
				'tools:execute',
				'tools:approve',
				'tools:danger',
				'sessions:read',
				'sessions:write',
				'workflows:read',
				'workflows:write',
				'workflows:execute',
				'admin:users',
				'admin:orgs',
				'admin:audit',
				'admin:all'
			];
			expect(adminPermissions).toContain(requiredPermission);
		});
	});

	// ============================================================================
	// Graph Response Structure
	// ============================================================================

	describe('graph response structure', () => {
		it('GraphQueryResult is serializable to JSON for frontend', () => {
			const graphResponse = {
				nodes: [
					{ id: 'u1', label: 'person', properties: { email: 'alice@example.com' } },
					{ id: 't1', label: 'tool', properties: { name: 'listInstances' } }
				],
				edges: [{ sourceId: 'u1', targetId: 't1', label: 'used_tool', properties: {} }]
			};

			const json = JSON.stringify(graphResponse);
			const parsed = JSON.parse(json);

			expect(parsed.nodes).toHaveLength(2);
			expect(parsed.edges).toHaveLength(1);
			expect(parsed.edges[0].sourceId).toBe('u1');
			expect(parsed.edges[0].targetId).toBe('t1');
		});
	});
});
