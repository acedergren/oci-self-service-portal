import { withConnection } from '../connection.js';
import { ToolExecutionSchema, type ToolExecution, type InsertToolExecution } from '../types.js';

/** Oracle row shape for tool_executions (OUT_FORMAT_OBJECT, uppercase keys). */
interface ToolExecutionRow {
	ID: string;
	SESSION_ID: string | null;
	USER_ID: string | null;
	ORG_ID: string | null;
	TOOL_NAME: string;
	TOOL_CATEGORY: string;
	APPROVAL_LEVEL: string;
	ACTION: string;
	ARGS: string | null;
	REDACTED_ARGS: string | null;
	SUCCESS: number | null;
	ERROR: string | null;
	DURATION_MS: number | null;
	IP_ADDRESS: string | null;
	USER_AGENT: string | null;
	CREATED_AT: Date;
}

function rowToToolExecution(row: ToolExecutionRow): ToolExecution {
	return ToolExecutionSchema.parse({
		id: row.ID,
		sessionId: row.SESSION_ID ?? undefined,
		userId: row.USER_ID ?? undefined,
		orgId: row.ORG_ID ?? undefined,
		toolName: row.TOOL_NAME,
		toolCategory: row.TOOL_CATEGORY,
		approvalLevel: row.APPROVAL_LEVEL,
		action: row.ACTION,
		args: row.ARGS ? JSON.parse(row.ARGS) : undefined,
		redactedArgs: row.REDACTED_ARGS ? JSON.parse(row.REDACTED_ARGS) : undefined,
		success: row.SUCCESS === null ? undefined : row.SUCCESS === 1,
		error: row.ERROR ?? undefined,
		durationMs: row.DURATION_MS ?? undefined,
		ipAddress: row.IP_ADDRESS ?? undefined,
		userAgent: row.USER_AGENT ?? undefined,
		createdAt: row.CREATED_AT
	});
}

export interface AuditSummary {
	totalExecutions: number;
	byAction: Record<string, number>;
	byTool: Record<string, number>;
	failureRate: number;
}

export const auditRepository = {
	async write(entry: InsertToolExecution): Promise<string> {
		const id = crypto.randomUUID();

		await withConnection(async (conn) => {
			await conn.execute(
				`INSERT INTO tool_executions
				   (id, session_id, user_id, org_id, tool_name, tool_category,
				    approval_level, action, args, redacted_args, success, error,
				    duration_ms, ip_address, user_agent)
				 VALUES
				   (:id, :sessionId, :userId, :orgId, :toolName, :toolCategory,
				    :approvalLevel, :action, :args, :redactedArgs, :success, :error,
				    :durationMs, :ipAddress, :userAgent)`,
				{
					id,
					sessionId: entry.sessionId ?? null,
					userId: entry.userId ?? null,
					orgId: entry.orgId ?? null,
					toolName: entry.toolName,
					toolCategory: entry.toolCategory,
					approvalLevel: entry.approvalLevel,
					action: entry.action,
					args: entry.args ? JSON.stringify(entry.args) : null,
					redactedArgs: entry.redactedArgs ? JSON.stringify(entry.redactedArgs) : null,
					success: entry.success === undefined ? null : entry.success ? 1 : 0,
					error: entry.error ?? null,
					durationMs: entry.durationMs ?? null,
					ipAddress: entry.ipAddress ?? null,
					userAgent: entry.userAgent ?? null
				}
			);
		});

		return id;
	},

	async getBySession(sessionId: string): Promise<ToolExecution[]> {
		return withConnection(async (conn) => {
			const result = await conn.execute<ToolExecutionRow>(
				`SELECT * FROM tool_executions
				 WHERE session_id = :sessionId
				 ORDER BY created_at ASC`,
				{ sessionId }
			);

			if (!result.rows) return [];
			return result.rows.map(rowToToolExecution);
		});
	},

	async getByDateRange(
		start: Date,
		end: Date,
		options?: { toolName?: string; action?: string }
	): Promise<ToolExecution[]> {
		return withConnection(async (conn) => {
			const conditions = ['created_at >= :startDate', 'created_at <= :endDate'];
			const binds: Record<string, unknown> = { startDate: start, endDate: end };

			if (options?.toolName) {
				conditions.push('tool_name = :toolName');
				binds.toolName = options.toolName;
			}
			if (options?.action) {
				conditions.push('action = :action');
				binds.action = options.action;
			}

			const result = await conn.execute<ToolExecutionRow>(
				`SELECT * FROM tool_executions
				 WHERE ${conditions.join(' AND ')}
				 ORDER BY created_at DESC`,
				binds
			);

			if (!result.rows) return [];
			return result.rows.map(rowToToolExecution);
		});
	},

	async getSummary(start: Date, end: Date): Promise<AuditSummary> {
		return withConnection(async (conn) => {
			// Total count
			const countResult = await conn.execute<{ CNT: number }>(
				`SELECT COUNT(*) AS CNT FROM tool_executions
				 WHERE created_at >= :startDate AND created_at <= :endDate`,
				{ startDate: start, endDate: end }
			);
			const totalExecutions = countResult.rows?.[0]?.CNT ?? 0;

			// By action
			const actionResult = await conn.execute<{ ACTION: string; CNT: number }>(
				`SELECT action AS ACTION, COUNT(*) AS CNT FROM tool_executions
				 WHERE created_at >= :startDate AND created_at <= :endDate
				 GROUP BY action`,
				{ startDate: start, endDate: end }
			);
			const byAction: Record<string, number> = {};
			for (const row of actionResult.rows ?? []) {
				byAction[row.ACTION] = row.CNT;
			}

			// By tool
			const toolResult = await conn.execute<{ TOOL_NAME: string; CNT: number }>(
				`SELECT tool_name AS TOOL_NAME, COUNT(*) AS CNT FROM tool_executions
				 WHERE created_at >= :startDate AND created_at <= :endDate
				 GROUP BY tool_name`,
				{ startDate: start, endDate: end }
			);
			const byTool: Record<string, number> = {};
			for (const row of toolResult.rows ?? []) {
				byTool[row.TOOL_NAME] = row.CNT;
			}

			// Failure rate
			const failedCount = (byAction['failed'] ?? 0) + (byAction['rejected'] ?? 0);
			const failureRate = totalExecutions > 0 ? failedCount / totalExecutions : 0;

			return { totalExecutions, byAction, byTool, failureRate };
		});
	}
};
