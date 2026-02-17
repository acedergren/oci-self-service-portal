/**
 * Unit tests for the property graph analytics module — PGQ-based
 * traversal queries that build node/edge graph structures.
 *
 * Mock strategy: Mock `withConnection` to invoke the callback with a fake
 * connection object, and verify graph builder output (deduplication, structure).
 *
 * Source: packages/server/src/oracle/graph-analytics.ts (287 lines, 0 tests)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockWithConnection = vi.fn();

vi.mock('@portal/server/oracle/connection', () => ({
	withConnection: (...args: unknown[]) => mockWithConnection(...args)
}));

// ── Test data ─────────────────────────────────────────────────────────────

const MOCK_DATE = new Date('2026-02-17T12:00:00Z');
const MOCK_DATE_2 = new Date('2026-02-17T12:05:00Z');

const MOCK_USER_ACTIVITY_ROWS = [
	{
		USER_ID: 'user-1',
		USER_EMAIL: 'alice@example.com',
		SESSION_ID: 'session-1',
		SESSION_TITLE: 'Cloud Setup',
		TOOL_NAME: 'list-instances',
		TOOL_CATEGORY: 'compute',
		ACTION: 'executed',
		EXECUTED_AT: MOCK_DATE
	},
	{
		USER_ID: 'user-1',
		USER_EMAIL: 'alice@example.com',
		SESSION_ID: 'session-1', // same session — should be deduped
		SESSION_TITLE: 'Cloud Setup',
		TOOL_NAME: 'list-vcns',
		TOOL_CATEGORY: 'networking',
		ACTION: 'executed',
		EXECUTED_AT: MOCK_DATE_2
	},
	{
		USER_ID: 'user-1',
		USER_EMAIL: 'alice@example.com',
		SESSION_ID: 'session-2', // different session
		SESSION_TITLE: null,
		TOOL_NAME: 'delete-instance',
		TOOL_CATEGORY: 'compute',
		ACTION: 'executed',
		EXECUTED_AT: MOCK_DATE_2
	}
];

const MOCK_AFFINITY_ROWS = [
	{ TOOL_A: 'list-instances', TOOL_B: 'list-vcns', CO_OCCURRENCE: 15, SESSION_COUNT: 8 },
	{ TOOL_A: 'list-instances', TOOL_B: 'delete-instance', CO_OCCURRENCE: 5, SESSION_COUNT: 3 }
];

const MOCK_ORG_IMPACT_ROWS = [
	{
		ORG_ID: 'org-1',
		ORG_NAME: 'Acme Corp',
		USER_COUNT: 12,
		EXECUTION_COUNT: 150,
		LAST_USED: MOCK_DATE
	},
	{
		ORG_ID: 'org-2',
		ORG_NAME: 'Beta Inc',
		USER_COUNT: 3,
		EXECUTION_COUNT: 20,
		LAST_USED: null
	}
];

// ── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();

	mockWithConnection.mockImplementation(async (fn: (conn: unknown) => unknown) =>
		fn({ execute: mockExecute, close: vi.fn(), commit: vi.fn(), rollback: vi.fn() })
	);

	mockExecute.mockResolvedValue({ rows: [] });
});

// ── Import after mocks ────────────────────────────────────────────────────

async function getModule() {
	return import('@portal/server/oracle/graph-analytics.js');
}

// ── getUserActivity ─────────────────────────────────────────────────────

describe('getUserActivity', () => {
	it('returns empty graph when no rows', async () => {
		const { getUserActivity } = await getModule();
		const result = await getUserActivity('user-1');

		expect(result).toEqual({ nodes: [], edges: [] });
	});

	it('builds user → session → tool graph', async () => {
		mockExecute.mockResolvedValue({ rows: MOCK_USER_ACTIVITY_ROWS });

		const { getUserActivity } = await getModule();
		const result = await getUserActivity('user-1');

		// 1 user node + 2 session nodes + 3 tool execution nodes = 6
		expect(result.nodes).toHaveLength(6);
		// 2 has_session edges + 3 used_tool edges = 5
		expect(result.edges).toHaveLength(5);

		// Verify user node
		const userNode = result.nodes.find((n) => n.label === 'person');
		expect(userNode).toBeTruthy();
		expect(userNode!.id).toBe('user-1');
		expect(userNode!.properties.email).toBe('alice@example.com');
	});

	it('deduplicates session nodes', async () => {
		mockExecute.mockResolvedValue({ rows: MOCK_USER_ACTIVITY_ROWS });

		const { getUserActivity } = await getModule();
		const result = await getUserActivity('user-1');

		const sessionNodes = result.nodes.filter((n) => n.label === 'chat_session');
		expect(sessionNodes).toHaveLength(2); // session-1 and session-2
		expect(sessionNodes.map((n) => n.id).sort()).toEqual(['session-1', 'session-2']);
	});

	it('uses "Untitled" for null SESSION_TITLE', async () => {
		mockExecute.mockResolvedValue({ rows: MOCK_USER_ACTIVITY_ROWS });

		const { getUserActivity } = await getModule();
		const result = await getUserActivity('user-1');

		const session2 = result.nodes.find((n) => n.id === 'session-2');
		expect(session2!.properties.title).toBe('Untitled');
	});

	it('creates composite tool node IDs', async () => {
		mockExecute.mockResolvedValue({ rows: [MOCK_USER_ACTIVITY_ROWS[0]] });

		const { getUserActivity } = await getModule();
		const result = await getUserActivity('user-1');

		const toolNode = result.nodes.find((n) => n.label === 'tool_execution');
		expect(toolNode!.id).toBe(`session-1:list-instances:${MOCK_DATE.toISOString()}`);
		expect(toolNode!.properties.toolName).toBe('list-instances');
		expect(toolNode!.properties.action).toBe('executed');
	});

	it('passes limit to SQL query', async () => {
		const { getUserActivity } = await getModule();
		await getUserActivity('user-1', 25);

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('FETCH FIRST :limit ROWS ONLY'),
			expect.objectContaining({ userId: 'user-1', limit: 25 })
		);
	});

	it('handles null rows', async () => {
		mockExecute.mockResolvedValue({ rows: null });

		const { getUserActivity } = await getModule();
		const result = await getUserActivity('user-1');
		expect(result).toEqual({ nodes: [], edges: [] });
	});
});

// ── getToolAffinity ─────────────────────────────────────────────────────

describe('getToolAffinity', () => {
	it('returns empty graph when no rows', async () => {
		const { getToolAffinity } = await getModule();
		const result = await getToolAffinity();

		expect(result).toEqual({ nodes: [], edges: [] });
	});

	it('builds co-occurrence graph with deduped tool nodes', async () => {
		mockExecute.mockResolvedValue({ rows: MOCK_AFFINITY_ROWS });

		const { getToolAffinity } = await getModule();
		const result = await getToolAffinity();

		// 3 unique tools: list-instances, list-vcns, delete-instance
		expect(result.nodes).toHaveLength(3);
		// 2 co-occurrence edges
		expect(result.edges).toHaveLength(2);

		// All nodes are 'tool' type
		for (const node of result.nodes) {
			expect(node.label).toBe('tool');
		}
	});

	it('includes co-occurrence and session count in edge properties', async () => {
		mockExecute.mockResolvedValue({ rows: MOCK_AFFINITY_ROWS });

		const { getToolAffinity } = await getModule();
		const result = await getToolAffinity();

		const firstEdge = result.edges[0];
		expect(firstEdge.label).toBe('co_occurs_with');
		expect(firstEdge.properties.coOccurrence).toBe(15);
		expect(firstEdge.properties.sessionCount).toBe(8);
	});

	it('deduplicates tool nodes across multiple edges', async () => {
		mockExecute.mockResolvedValue({ rows: MOCK_AFFINITY_ROWS });

		const { getToolAffinity } = await getModule();
		const result = await getToolAffinity();

		// list-instances appears in both rows but should be a single node
		const listInstances = result.nodes.filter((n) => n.id === 'list-instances');
		expect(listInstances).toHaveLength(1);
	});

	it('passes limit to SQL query', async () => {
		const { getToolAffinity } = await getModule();
		await getToolAffinity(100);

		expect(mockExecute).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ limit: 100 })
		);
	});
});

// ── getOrgImpact ────────────────────────────────────────────────────────

describe('getOrgImpact', () => {
	it('returns empty graph when no rows', async () => {
		const { getOrgImpact } = await getModule();
		const result = await getOrgImpact('list-instances');

		expect(result).toEqual({ nodes: [], edges: [] });
	});

	it('builds central tool node with org edges', async () => {
		mockExecute.mockResolvedValue({ rows: MOCK_ORG_IMPACT_ROWS });

		const { getOrgImpact } = await getModule();
		const result = await getOrgImpact('list-instances');

		// 1 central tool node + 2 org nodes = 3
		expect(result.nodes).toHaveLength(3);
		// 2 uses_tool edges
		expect(result.edges).toHaveLength(2);

		// Central tool node
		const toolNode = result.nodes.find((n) => n.label === 'tool');
		expect(toolNode!.id).toBe('tool:list-instances');
		expect(toolNode!.properties.name).toBe('list-instances');
	});

	it('maps org properties correctly', async () => {
		mockExecute.mockResolvedValue({ rows: MOCK_ORG_IMPACT_ROWS });

		const { getOrgImpact } = await getModule();
		const result = await getOrgImpact('list-instances');

		const acmeNode = result.nodes.find((n) => n.id === 'org-1');
		expect(acmeNode!.label).toBe('organization');
		expect(acmeNode!.properties.name).toBe('Acme Corp');
		expect(acmeNode!.properties.userCount).toBe(12);
		expect(acmeNode!.properties.executionCount).toBe(150);
		expect(acmeNode!.properties.lastUsed).toBe(MOCK_DATE.toISOString());
	});

	it('handles null LAST_USED', async () => {
		mockExecute.mockResolvedValue({ rows: MOCK_ORG_IMPACT_ROWS });

		const { getOrgImpact } = await getModule();
		const result = await getOrgImpact('list-instances');

		const betaNode = result.nodes.find((n) => n.id === 'org-2');
		expect(betaNode!.properties.lastUsed).toBeNull();
	});

	it('includes user and execution counts in edge properties', async () => {
		mockExecute.mockResolvedValue({ rows: MOCK_ORG_IMPACT_ROWS });

		const { getOrgImpact } = await getModule();
		const result = await getOrgImpact('list-instances');

		const acmeEdge = result.edges.find((e) => e.sourceId === 'org-1');
		expect(acmeEdge!.label).toBe('uses_tool');
		expect(acmeEdge!.properties.userCount).toBe(12);
		expect(acmeEdge!.properties.executionCount).toBe(150);
	});

	it('passes toolName and limit to SQL query', async () => {
		const { getOrgImpact } = await getModule();
		await getOrgImpact('delete-vcn', 10);

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('tool_name = :toolName'),
			expect.objectContaining({ toolName: 'delete-vcn', limit: 10 })
		);
	});
});
