/**
 * Blockchain audit repository — tamper-proof INSERT-only ledger on Oracle 26AI.
 *
 * Uses Oracle Blockchain Table (NO DROP/DELETE for 365 days) with SHA2_256
 * chain hashing. The blockchain table is append-only; no UPDATE or DELETE
 * is permitted by the database for the retention period.
 *
 * Follows the patterns established in audit-repository.ts:
 * - Oracle UPPERCASE row interfaces
 * - rowToEntity() converters with JSON.parse for CLOB columns
 * - withConnection() wrapper for all operations
 * - Bind variables only (never string interpolation for data)
 */
import { withConnection } from '../connection.js';
import { createLogger } from '$lib/server/logger.js';
import type {
	BlockchainAuditEntry,
	BlockchainAuditRecord,
	BlockchainAuditRow
} from '$lib/server/api/types.js';
import { auditRowToRecord } from '$lib/server/api/types.js';

const log = createLogger('blockchain-audit');

export const blockchainAuditRepository = {
	/**
	 * Insert an audit entry into the blockchain table.
	 * This is append-only — the database enforces NO DELETE for 365 days.
	 */
	async insert(entry: BlockchainAuditEntry): Promise<void> {
		await withConnection(async (conn) => {
			await conn.execute(
				`INSERT INTO audit_blockchain
				   (user_id, org_id, action, tool_name, resource_type,
				    resource_id, detail, ip_address, request_id)
				 VALUES
				   (:userId, :orgId, :action, :toolName, :resourceType,
				    :resourceId, :detail, :ipAddress, :requestId)`,
				{
					userId: entry.userId,
					orgId: entry.orgId ?? null,
					action: entry.action,
					toolName: entry.toolName ?? null,
					resourceType: entry.resourceType ?? null,
					resourceId: entry.resourceId ?? null,
					detail: entry.detail ? JSON.stringify(entry.detail) : null,
					ipAddress: entry.ipAddress ?? null,
					requestId: entry.requestId ?? null
				}
			);
		});
	},

	/**
	 * Verify blockchain table integrity using Oracle's built-in
	 * DBMS_BLOCKCHAIN_TABLE.VERIFY_ROWS procedure.
	 *
	 * Returns validation status, row count, and timestamp of last verified row.
	 */
	async verify(): Promise<{ valid: boolean; rowCount: number; lastVerified: Date | null }> {
		return withConnection(async (conn) => {
			// Get row count
			const countResult = await conn.execute<{ CNT: number }>(
				'SELECT COUNT(*) AS CNT FROM audit_blockchain'
			);
			const rowCount = countResult.rows?.[0]?.CNT ?? 0;

			if (rowCount === 0) {
				return { valid: true, rowCount: 0, lastVerified: null };
			}

			// Verify rows using Oracle blockchain verification
			// DBMS_BLOCKCHAIN_TABLE.VERIFY_ROWS returns the number of verified rows.
			// If any row is tampered, it throws ORA-05715.
			try {
				const verifyResult = await conn.execute<{ VERIFIED: number }>(
					`DECLARE
					   v_rows NUMBER;
					 BEGIN
					   DBMS_BLOCKCHAIN_TABLE.VERIFY_ROWS(
					     schema_name     => USER,
					     table_name      => 'AUDIT_BLOCKCHAIN',
					     number_of_rows_verified => v_rows
					   );
					   :verified := v_rows;
					 END;`,
					{ verified: { dir: 'out', type: 'NUMBER', val: 0 } } as Record<string, unknown>
				);

				const verified =
					(verifyResult as unknown as { outBinds: { verified: number } }).outBinds?.verified ?? 0;

				// Get the latest entry timestamp
				const lastResult = await conn.execute<{ LAST_AT: Date }>(
					'SELECT MAX(created_at) AS LAST_AT FROM audit_blockchain'
				);
				const lastVerified = lastResult.rows?.[0]?.LAST_AT ?? null;

				return { valid: verified >= rowCount, rowCount, lastVerified };
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				// ORA-05715 = tampered row detected
				if (message.includes('ORA-05715')) {
					log.error({ err }, 'Blockchain table integrity violation detected');
					return { valid: false, rowCount, lastVerified: null };
				}
				throw err;
			}
		});
	},

	/**
	 * Query audit entries by user (for compliance reporting).
	 */
	async getByUser(userId: string, limit = 100): Promise<BlockchainAuditRecord[]> {
		return withConnection(async (conn) => {
			const result = await conn.execute<BlockchainAuditRow>(
				`SELECT id, user_id, org_id, action, tool_name, resource_type,
				        resource_id, detail, ip_address, request_id, created_at
				 FROM audit_blockchain
				 WHERE user_id = :userId
				 ORDER BY created_at DESC
				 FETCH FIRST :limit ROWS ONLY`,
				{ userId, limit }
			);
			if (!result.rows) return [];
			return result.rows.map(auditRowToRecord);
		});
	},

	/**
	 * Query audit entries by date range (for compliance reporting).
	 */
	async getByDateRange(
		start: Date,
		end: Date,
		options?: { action?: string; toolName?: string; orgId?: string }
	): Promise<BlockchainAuditRecord[]> {
		return withConnection(async (conn) => {
			const conditions = ['created_at >= :startDate', 'created_at <= :endDate'];
			const binds: Record<string, unknown> = { startDate: start, endDate: end };

			if (options?.action) {
				conditions.push('action = :action');
				binds.action = options.action;
			}
			if (options?.toolName) {
				conditions.push('tool_name = :toolName');
				binds.toolName = options.toolName;
			}
			if (options?.orgId) {
				conditions.push('org_id = :orgId');
				binds.orgId = options.orgId;
			}

			const result = await conn.execute<BlockchainAuditRow>(
				`SELECT id, user_id, org_id, action, tool_name, resource_type,
				        resource_id, detail, ip_address, request_id, created_at
				 FROM audit_blockchain
				 WHERE ${conditions.join(' AND ')}
				 ORDER BY created_at DESC
				 FETCH FIRST 1000 ROWS ONLY`,
				binds
			);
			if (!result.rows) return [];
			return result.rows.map(auditRowToRecord);
		});
	}
};
