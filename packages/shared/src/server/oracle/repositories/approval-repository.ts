import { withConnection } from '../connection';
import {
	PendingApprovalSchema,
	type PendingApproval,
	type InsertPendingApproval
} from '../types';

/** Oracle row shape for pending_approvals (OUT_FORMAT_OBJECT, uppercase keys). */
interface PendingApprovalRow {
	ID: string;
	SESSION_ID: string | null;
	USER_ID: string | null;
	TOOL_NAME: string;
	TOOL_CATEGORY: string;
	APPROVAL_LEVEL: string;
	ARGS: string | null;
	STATUS: string;
	EXPIRES_AT: Date;
	RESOLVED_BY: string | null;
	RESOLVED_AT: Date | null;
	CREATED_AT: Date;
}

function rowToApproval(row: PendingApprovalRow): PendingApproval {
	return PendingApprovalSchema.parse({
		id: row.ID,
		sessionId: row.SESSION_ID ?? undefined,
		userId: row.USER_ID ?? undefined,
		toolName: row.TOOL_NAME,
		toolCategory: row.TOOL_CATEGORY,
		approvalLevel: row.APPROVAL_LEVEL,
		args: row.ARGS ? JSON.parse(row.ARGS) : undefined,
		status: row.STATUS,
		expiresAt: row.EXPIRES_AT,
		resolvedBy: row.RESOLVED_BY ?? undefined,
		resolvedAt: row.RESOLVED_AT ?? undefined,
		createdAt: row.CREATED_AT
	});
}

/** Default approval TTL: 5 minutes. */
const DEFAULT_EXPIRY_MS = 5 * 60 * 1000;

export const approvalRepository = {
	async create(input: InsertPendingApproval): Promise<PendingApproval> {
		const id = crypto.randomUUID();
		const expiresAt = input.expiresAt ?? new Date(Date.now() + DEFAULT_EXPIRY_MS);

		await withConnection(async (conn) => {
			await conn.execute(
				`INSERT INTO pending_approvals
				   (id, session_id, user_id, tool_name, tool_category,
				    approval_level, args, status, expires_at)
				 VALUES
				   (:id, :sessionId, :userId, :toolName, :toolCategory,
				    :approvalLevel, :args, :status, :expiresAt)`,
				{
					id,
					sessionId: input.sessionId ?? null,
					userId: input.userId ?? null,
					toolName: input.toolName,
					toolCategory: input.toolCategory,
					approvalLevel: input.approvalLevel,
					args: input.args ? JSON.stringify(input.args) : null,
					status: input.status ?? 'pending',
					expiresAt
				}
			);
		});

		return (await this.getById(id))!;
	},

	async getById(id: string): Promise<PendingApproval | null> {
		return withConnection(async (conn) => {
			const result = await conn.execute<PendingApprovalRow>(
				'SELECT * FROM pending_approvals WHERE id = :id',
				{ id }
			);

			if (!result.rows || result.rows.length === 0) return null;
			return rowToApproval(result.rows[0]);
		});
	},

	async resolve(
		id: string,
		status: 'approved' | 'rejected',
		resolvedBy?: string
	): Promise<PendingApproval | null> {
		await withConnection(async (conn) => {
			await conn.execute(
				`UPDATE pending_approvals
				 SET status = :status,
				     resolved_at = SYSTIMESTAMP,
				     resolved_by = :resolvedBy
				 WHERE id = :id AND status = 'pending'`,
				{
					id,
					status,
					resolvedBy: resolvedBy ?? null
				}
			);
		});

		return this.getById(id);
	},

	async getPending(sessionId?: string): Promise<PendingApproval[]> {
		return withConnection(async (conn) => {
			const conditions = ["status = 'pending'", 'expires_at > SYSTIMESTAMP'];
			const binds: Record<string, unknown> = {};

			if (sessionId) {
				conditions.push('session_id = :sessionId');
				binds.sessionId = sessionId;
			}

			const result = await conn.execute<PendingApprovalRow>(
				`SELECT * FROM pending_approvals
				 WHERE ${conditions.join(' AND ')}
				 ORDER BY created_at ASC`,
				binds
			);

			if (!result.rows) return [];
			return result.rows.map(rowToApproval);
		});
	},

	async expireOld(maxAgeMs?: number): Promise<number> {
		const cutoff = new Date(Date.now() - (maxAgeMs ?? DEFAULT_EXPIRY_MS));

		return withConnection(async (conn) => {
			const result = await conn.execute<never>(
				`UPDATE pending_approvals
				 SET status = 'expired'
				 WHERE status = 'pending'
				   AND (expires_at <= SYSTIMESTAMP OR created_at <= :cutoff)`,
				{ cutoff }
			);

			return (result as { rowsAffected?: number }).rowsAffected ?? 0;
		});
	}
};
