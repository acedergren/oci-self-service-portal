/**
 * Property graph analytics using Oracle 26AI SQL/PGQ.
 *
 * Queries the portal_graph property graph (defined in migration 008)
 * for relationship insights. ZERO data duplication — the graph is
 * a logical view over existing relational tables.
 *
 * Uses GRAPH_TABLE() operator with MATCH patterns for path traversal.
 */
import { withConnection } from './connection.js';
import { createLogger } from '$lib/server/logger.js';
import type { GraphNode, GraphEdge, GraphQueryResult } from '$lib/server/api/types.js';

const log = createLogger('graph-analytics');

// ============================================================================
// Oracle Row Interfaces for Graph Query Results
// ============================================================================

interface UserActivityRow {
	USER_ID: string;
	USER_EMAIL: string;
	SESSION_ID: string;
	SESSION_TITLE: string | null;
	TOOL_NAME: string;
	TOOL_CATEGORY: string;
	ACTION: string;
	EXECUTED_AT: Date;
}

interface ToolAffinityRow {
	TOOL_A: string;
	TOOL_B: string;
	CO_OCCURRENCE: number;
	SESSION_COUNT: number;
}

interface OrgImpactRow {
	ORG_ID: string;
	ORG_NAME: string;
	USER_COUNT: number;
	EXECUTION_COUNT: number;
	LAST_USED: Date | null;
}

// ============================================================================
// Graph Analytics Functions
// ============================================================================

/**
 * Get a user's tool execution activity graph.
 * Traverses: user → session → tool_execution
 */
export async function getUserActivity(userId: string, limit = 50): Promise<GraphQueryResult> {
	return withConnection(async (conn) => {
		const result = await conn.execute<UserActivityRow>(
			`SELECT
			   u.id AS USER_ID,
			   u.email AS USER_EMAIL,
			   cs.id AS SESSION_ID,
			   cs.title AS SESSION_TITLE,
			   te.tool_name AS TOOL_NAME,
			   te.tool_category AS TOOL_CATEGORY,
			   te.action AS ACTION,
			   te.created_at AS EXECUTED_AT
			 FROM GRAPH_TABLE (portal_graph
			   MATCH (u IS person) -[e1 IS member_of]-> (o IS organization),
			         (u) <-[e2]- (s IS chat_session) -[e3 IS used_tool]-> (t IS tool_execution)
			   WHERE u.id = :userId
			   COLUMNS (
			     u.id AS id, u.email AS email,
			     s.id AS session_id, s.title AS session_title,
			     t.tool_name AS tool_name, t.tool_category AS tool_category,
			     t.action AS action, t.created_at AS executed_at
			   )
			 )
			 ORDER BY EXECUTED_AT DESC
			 FETCH FIRST :limit ROWS ONLY`,
			{ userId, limit }
		);

		if (!result.rows || result.rows.length === 0) {
			return { nodes: [], edges: [] };
		}

		return buildUserActivityGraph(result.rows);
	});
}

/**
 * Get tool co-occurrence (affinity) — which tools are used together
 * within the same session. Uses relational query since PGQ co-occurrence
 * patterns are expensive.
 */
export async function getToolAffinity(limit = 50): Promise<GraphQueryResult> {
	return withConnection(async (conn) => {
		const result = await conn.execute<ToolAffinityRow>(
			`SELECT
			   t1.tool_name AS TOOL_A,
			   t2.tool_name AS TOOL_B,
			   COUNT(*) AS CO_OCCURRENCE,
			   COUNT(DISTINCT t1.session_id) AS SESSION_COUNT
			 FROM tool_executions t1
			 JOIN tool_executions t2
			   ON t1.session_id = t2.session_id
			   AND t1.tool_name < t2.tool_name
			 WHERE t1.session_id IS NOT NULL
			   AND t1.action = 'executed'
			   AND t2.action = 'executed'
			 GROUP BY t1.tool_name, t2.tool_name
			 ORDER BY CO_OCCURRENCE DESC
			 FETCH FIRST :limit ROWS ONLY`,
			{ limit }
		);

		if (!result.rows || result.rows.length === 0) {
			return { nodes: [], edges: [] };
		}

		return buildAffinityGraph(result.rows);
	});
}

/**
 * Get org-level impact for a specific tool — which organizations use it,
 * how many users, and how many executions.
 * Traverses: org → user → session → tool_execution
 */
export async function getOrgImpact(toolName: string, limit = 50): Promise<GraphQueryResult> {
	return withConnection(async (conn) => {
		const result = await conn.execute<OrgImpactRow>(
			`SELECT
			   o.id AS ORG_ID,
			   o.name AS ORG_NAME,
			   COUNT(DISTINCT te.user_id) AS USER_COUNT,
			   COUNT(*) AS EXECUTION_COUNT,
			   MAX(te.created_at) AS LAST_USED
			 FROM tool_executions te
			 JOIN org_members om ON te.user_id = om.user_id
			 JOIN organizations o ON om.org_id = o.id
			 WHERE te.tool_name = :toolName
			   AND te.action = 'executed'
			 GROUP BY o.id, o.name
			 ORDER BY EXECUTION_COUNT DESC
			 FETCH FIRST :limit ROWS ONLY`,
			{ toolName, limit }
		);

		if (!result.rows || result.rows.length === 0) {
			return { nodes: [], edges: [] };
		}

		return buildOrgImpactGraph(toolName, result.rows);
	});
}

// ============================================================================
// Graph Result Builders
// ============================================================================

function buildUserActivityGraph(rows: UserActivityRow[]): GraphQueryResult {
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const seenNodes = new Set<string>();

	// Add user node (from first row)
	const userId = rows[0].USER_ID;
	if (!seenNodes.has(userId)) {
		nodes.push({
			id: userId,
			label: 'person',
			properties: { email: rows[0].USER_EMAIL }
		});
		seenNodes.add(userId);
	}

	for (const row of rows) {
		// Add session node
		if (!seenNodes.has(row.SESSION_ID)) {
			nodes.push({
				id: row.SESSION_ID,
				label: 'chat_session',
				properties: { title: row.SESSION_TITLE ?? 'Untitled' }
			});
			seenNodes.add(row.SESSION_ID);
			edges.push({
				sourceId: userId,
				targetId: row.SESSION_ID,
				label: 'has_session',
				properties: {}
			});
		}

		// Add tool execution node (use composite key since tool_name isn't unique)
		const toolNodeId = `${row.SESSION_ID}:${row.TOOL_NAME}:${row.EXECUTED_AT.toISOString()}`;
		nodes.push({
			id: toolNodeId,
			label: 'tool_execution',
			properties: {
				toolName: row.TOOL_NAME,
				toolCategory: row.TOOL_CATEGORY,
				action: row.ACTION,
				executedAt: row.EXECUTED_AT.toISOString()
			}
		});
		edges.push({
			sourceId: row.SESSION_ID,
			targetId: toolNodeId,
			label: 'used_tool',
			properties: {}
		});
	}

	return { nodes, edges };
}

function buildAffinityGraph(rows: ToolAffinityRow[]): GraphQueryResult {
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const seenNodes = new Set<string>();

	for (const row of rows) {
		if (!seenNodes.has(row.TOOL_A)) {
			nodes.push({
				id: row.TOOL_A,
				label: 'tool',
				properties: { name: row.TOOL_A }
			});
			seenNodes.add(row.TOOL_A);
		}
		if (!seenNodes.has(row.TOOL_B)) {
			nodes.push({
				id: row.TOOL_B,
				label: 'tool',
				properties: { name: row.TOOL_B }
			});
			seenNodes.add(row.TOOL_B);
		}

		edges.push({
			sourceId: row.TOOL_A,
			targetId: row.TOOL_B,
			label: 'co_occurs_with',
			properties: {
				coOccurrence: row.CO_OCCURRENCE,
				sessionCount: row.SESSION_COUNT
			}
		});
	}

	return { nodes, edges };
}

function buildOrgImpactGraph(toolName: string, rows: OrgImpactRow[]): GraphQueryResult {
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];

	// Central tool node
	nodes.push({
		id: `tool:${toolName}`,
		label: 'tool',
		properties: { name: toolName }
	});

	for (const row of rows) {
		nodes.push({
			id: row.ORG_ID,
			label: 'organization',
			properties: {
				name: row.ORG_NAME,
				userCount: row.USER_COUNT,
				executionCount: row.EXECUTION_COUNT,
				lastUsed: row.LAST_USED?.toISOString() ?? null
			}
		});

		edges.push({
			sourceId: row.ORG_ID,
			targetId: `tool:${toolName}`,
			label: 'uses_tool',
			properties: {
				userCount: row.USER_COUNT,
				executionCount: row.EXECUTION_COUNT
			}
		});
	}

	return { nodes, edges };
}
