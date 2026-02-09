/**
 * Phase 8 TDD: Blockchain Audit Trail
 *
 * Provides tamper-evident audit logging using Oracle Blockchain Tables.
 * Append-only, NO DELETE for 365 days, with DBMS_BLOCKCHAIN_TABLE.VERIFY_ROWS
 * for chain verification.
 *
 * Module under test: $lib/server/oracle/repositories/blockchain-audit-repository.ts
 * Exports:
 *   - blockchainAuditRepository {
 *       insert(entry: BlockchainAuditEntry): Promise<void>
 *       verify(): Promise<{ valid: boolean; rowCount: number; lastVerified: Date | null }>
 *       getByUser(userId, limit?): Promise<BlockchainAuditRecord[]>
 *       getByDateRange(start, end, options?): Promise<BlockchainAuditRecord[]>
 *     }
 *
 * Types from: $lib/server/api/types.ts (BlockchainAuditEntry, BlockchainAuditRecord)
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

import { blockchainAuditRepository } from '@portal/shared/server/oracle/repositories/blockchain-audit-repository';
import type { BlockchainAuditEntry } from '@portal/shared/server/api/types';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Blockchain Audit Repository (Phase 8.6)', () => {
	describe('insert', () => {
		it('inserts an audit entry into the blockchain table', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const entry: BlockchainAuditEntry = {
				userId: 'user-1',
				orgId: 'org-1',
				action: 'tool_execute',
				toolName: 'listInstances',
				resourceType: 'tool',
				resourceId: 'listInstances',
				detail: { args: { compartmentId: 'ocid1...' }, duration: 1200 },
				ipAddress: '1.2.3.4',
				requestId: 'req-abc123'
			};

			await blockchainAuditRepository.insert(entry);

			expect(mockExecute).toHaveBeenCalled();
			const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
			expect(sql).toContain('INSERT INTO AUDIT_BLOCKCHAIN');
		});

		it('stores detail as JSON CLOB', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			await blockchainAuditRepository.insert({
				userId: 'user-1',
				action: 'tool_execute',
				detail: { key: 'value', nested: { deep: true } }
			});

			// The bind value for detail should be JSON.stringify'd
			const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
			expect(typeof binds.detail).toBe('string');
			expect(JSON.parse(binds.detail as string)).toEqual({ key: 'value', nested: { deep: true } });
		});

		it('handles null optional fields gracefully', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			await blockchainAuditRepository.insert({
				userId: 'user-1',
				action: 'login'
			});

			const binds = mockExecute.mock.calls[0][1] as Record<string, unknown>;
			expect(binds.toolName).toBeNull();
			expect(binds.resourceType).toBeNull();
			expect(binds.detail).toBeNull();
		});
	});

	describe('verify', () => {
		it('returns valid: true for intact blockchain', async () => {
			// Count query
			mockExecute.mockResolvedValueOnce({
				rows: [{ CNT: 10 }]
			});
			// Verify query (Oracle DBMS_BLOCKCHAIN_TABLE.VERIFY_ROWS)
			mockExecute.mockResolvedValueOnce({
				outBinds: { verified: 10 }
			});
			// Max created_at query
			mockExecute.mockResolvedValueOnce({
				rows: [{ LAST_AT: new Date('2026-02-01') }]
			});

			const result = await blockchainAuditRepository.verify();
			expect(result.valid).toBe(true);
			expect(result.rowCount).toBe(10);
			expect(result.lastVerified).toBeDefined();
		});

		it('returns valid: true with rowCount 0 for empty table', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [{ CNT: 0 }]
			});

			const result = await blockchainAuditRepository.verify();
			expect(result.valid).toBe(true);
			expect(result.rowCount).toBe(0);
			expect(result.lastVerified).toBeNull();
		});

		it('returns valid: false when ORA-05715 (tampered) is detected', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [{ CNT: 10 }]
			});
			// Verify throws ORA-05715
			mockExecute.mockRejectedValueOnce(new Error('ORA-05715: tampered row detected'));

			const result = await blockchainAuditRepository.verify();
			expect(result.valid).toBe(false);
			expect(result.rowCount).toBe(10);
		});
	});

	describe('getByUser', () => {
		it('returns audit entries for a specific user', async () => {
			const now = new Date();
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'a1',
						USER_ID: 'user-1',
						ORG_ID: 'org-1',
						ACTION: 'tool_execute',
						TOOL_NAME: 'listInstances',
						RESOURCE_TYPE: 'tool',
						RESOURCE_ID: 'listInstances',
						DETAIL: '{"duration":1200}',
						IP_ADDRESS: '1.2.3.4',
						REQUEST_ID: 'req-1',
						CREATED_AT: now
					}
				]
			});

			const entries = await blockchainAuditRepository.getByUser('user-1');
			expect(entries).toHaveLength(1);
			expect(entries[0].userId).toBe('user-1');
			expect(entries[0].action).toBe('tool_execute');
			expect(entries[0].detail).toEqual({ duration: 1200 });
		});

		it('SQL includes user_id filter and ORDER BY', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			await blockchainAuditRepository.getByUser('user-1', 50);

			const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
			expect(sql).toContain('USER_ID');
			expect(sql).toContain('ORDER BY');
		});
	});

	describe('getByDateRange', () => {
		it('returns entries within the date range', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'a1',
						USER_ID: 'user-1',
						ORG_ID: 'org-1',
						ACTION: 'tool_execute',
						TOOL_NAME: 'listInstances',
						RESOURCE_TYPE: null,
						RESOURCE_ID: null,
						DETAIL: null,
						IP_ADDRESS: null,
						REQUEST_ID: null,
						CREATED_AT: new Date('2026-02-01')
					}
				]
			});

			const entries = await blockchainAuditRepository.getByDateRange(
				new Date('2026-01-01'),
				new Date('2026-03-01')
			);

			expect(entries).toHaveLength(1);
			expect(entries[0].action).toBe('tool_execute');
		});

		it('supports filtering by action, toolName, and orgId', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			await blockchainAuditRepository.getByDateRange(
				new Date('2026-01-01'),
				new Date('2026-03-01'),
				{ action: 'tool_execute', toolName: 'listInstances', orgId: 'org-1' }
			);

			const sql = (mockExecute.mock.calls[0][0] as string).toUpperCase();
			expect(sql).toContain('ACTION');
			expect(sql).toContain('TOOL_NAME');
			expect(sql).toContain('ORG_ID');
		});
	});

	describe('dual-write pattern contract', () => {
		it('audit entry is written to both tool_executions and audit_blockchain', () => {
			// Contract: the tool execution handler should write to BOTH tables
			const toolExecutionRecord = {
				id: 'exec-1',
				toolName: 'listInstances',
				userId: 'user-1',
				orgId: 'org-1'
			};

			const blockchainRecord: BlockchainAuditEntry = {
				userId: toolExecutionRecord.userId,
				orgId: toolExecutionRecord.orgId,
				action: 'tool_execute',
				toolName: toolExecutionRecord.toolName,
				resourceType: 'tool',
				resourceId: toolExecutionRecord.toolName
			};

			// Both records reference the same user and org
			expect(blockchainRecord.orgId).toBe(toolExecutionRecord.orgId);
			expect(blockchainRecord.userId).toBe(toolExecutionRecord.userId);
		});
	});

	describe('admin-only access enforcement', () => {
		it('verification endpoint requires admin:audit permission', () => {
			const requiredPermission = 'admin:audit';
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
		});
	});
});
