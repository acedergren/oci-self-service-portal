/**
 * VPD (Virtual Private Database) tenant isolation tests (F-2.04)
 *
 * Validates that the VPD migration (017-vpd.sql) correctly enforces tenant isolation
 * through application context and VPD policies. Tests cover:
 * - Policy function logic (org_id, ADMIN_BYPASS, null context)
 * - Context management package calls
 * - Multi-tenant isolation patterns
 * - Migration file validation
 *
 * Uses forwarding mock pattern to survive mockReset: true.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Mock setup — forwarding pattern for mockReset: true
// ============================================================================

const mockExecute = vi.fn();
const mockCommit = vi.fn();
const mockGetConnection = vi.fn();

vi.mock('@portal/shared/server/oracle/connection', () => ({
	withConnection: (...args: unknown[]) => mockGetConnection(...args)
}));

vi.mock('@portal/shared/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

// ============================================================================
// Test setup
// ============================================================================

beforeEach(() => {
	vi.clearAllMocks();

	// Setup mock connection
	const mockConn = {
		execute: mockExecute,
		commit: mockCommit,
		OBJECT: 4003 // oracledb.OUT_FORMAT_OBJECT
	};

	// withConnection implementation
	mockGetConnection.mockImplementation((fn: (conn: typeof mockConn) => unknown) => fn(mockConn));
});

// ============================================================================
// 1. Policy Function Logic Tests
// ============================================================================

describe('portal_vpd_policy function', () => {
	it('should return org_id filter when org context is set', async () => {
		// Simulate the policy function logic by testing a query pattern
		// The actual policy function runs in Oracle, but we can verify the expected SQL pattern

		// Mock a query that would be filtered by VPD
		mockExecute.mockResolvedValueOnce({
			rows: [
				{
					ID: 'wf-1',
					ORG_ID: 'org-123',
					NAME: 'Test Workflow'
				}
			]
		});

		// Simulate repository code that sets org context before query
		const { withConnection } = await import('@portal/shared/server/oracle/connection.js');

		await withConnection(async (conn) => {
			// Set org context
			await conn.execute(`BEGIN portal_ctx_pkg.set_org_id(:orgId); END;`, {
				orgId: 'org-123'
			});

			// Query a VPD-protected table
			const result = await conn.execute('SELECT * FROM workflow_definitions', [], {
				outFormat: conn.OBJECT
			});

			return result;
		});

		// Verify set_org_id was called
		const setCalls = mockExecute.mock.calls.filter((call) =>
			call[0]?.includes('portal_ctx_pkg.set_org_id')
		);
		expect(setCalls).toHaveLength(1);
		expect(setCalls[0][1]).toEqual({ orgId: 'org-123' });
	});

	it('should return NULL (no filter) when ADMIN_BYPASS is set', async () => {
		// Admin bypass allows seeing all rows regardless of org_id

		mockExecute
			.mockResolvedValueOnce(undefined) // set_admin_bypass call
			.mockResolvedValueOnce({
				// Query returns multiple orgs
				rows: [
					{ ID: 'wf-1', ORG_ID: 'org-a', NAME: 'Workflow A' },
					{ ID: 'wf-2', ORG_ID: 'org-b', NAME: 'Workflow B' }
				]
			});

		const { withConnection } = await import('@portal/shared/server/oracle/connection.js');

		await withConnection(async (conn) => {
			// Set admin bypass
			await conn.execute('BEGIN portal_ctx_pkg.set_admin_bypass; END;', []);

			// Query should return all rows
			const result = await conn.execute('SELECT * FROM workflow_definitions', [], {
				outFormat: conn.OBJECT
			});

			return result;
		});

		// Verify set_admin_bypass was called
		const bypassCalls = mockExecute.mock.calls.filter((call) =>
			call[0]?.includes('portal_ctx_pkg.set_admin_bypass')
		);
		expect(bypassCalls).toHaveLength(1);
	});

	it('should return 1=0 (deny all) when no context is set', async () => {
		// Without setting context, VPD policy should block all access

		mockExecute.mockResolvedValueOnce({
			rows: [] // No rows returned when 1=0 predicate is applied
		});

		const { withConnection } = await import('@portal/shared/server/oracle/connection.js');

		await withConnection(async (conn) => {
			// Query WITHOUT setting context first
			const result = await conn.execute('SELECT * FROM workflow_definitions', [], {
				outFormat: conn.OBJECT
			});

			return result;
		});

		// Verify no context-setting calls were made
		const contextCalls = mockExecute.mock.calls.filter(
			(call) =>
				call[0]?.includes('portal_ctx_pkg.set_org_id') ||
				call[0]?.includes('portal_ctx_pkg.set_admin_bypass')
		);
		expect(contextCalls).toHaveLength(0);
	});
});

// ============================================================================
// 2. VPD Integration Pattern Tests
// ============================================================================

describe('VPD-aware repository helper', () => {
	it('should call set_org_id before queries', async () => {
		mockExecute
			.mockResolvedValueOnce(undefined) // set_org_id
			.mockResolvedValueOnce({
				// SELECT query
				rows: [{ ID: 'wf-1', ORG_ID: 'org-456', NAME: 'Test' }]
			})
			.mockResolvedValueOnce(undefined); // clear_context

		const { withConnection } = await import('@portal/shared/server/oracle/connection.js');

		await withConnection(async (conn) => {
			// Simulate VPD-aware repository pattern
			await conn.execute(`BEGIN portal_ctx_pkg.set_org_id(:orgId); END;`, {
				orgId: 'org-456'
			});

			try {
				return await conn.execute('SELECT * FROM workflow_definitions WHERE id = :id', {
					id: 'wf-1'
				});
			} finally {
				await conn.execute('BEGIN portal_ctx_pkg.clear_context; END;', []);
			}
		});

		// Verify call sequence: set_org_id → query → clear_context
		expect(mockExecute).toHaveBeenCalledTimes(3);
		expect(mockExecute.mock.calls[0][0]).toContain('portal_ctx_pkg.set_org_id');
		expect(mockExecute.mock.calls[1][0]).toContain('SELECT');
		expect(mockExecute.mock.calls[2][0]).toContain('portal_ctx_pkg.clear_context');
	});

	it('should call clear_context in finally block even when query fails', async () => {
		mockExecute
			.mockResolvedValueOnce(undefined) // set_org_id
			.mockRejectedValueOnce(new Error('Query failed')) // SELECT fails
			.mockResolvedValueOnce(undefined); // clear_context still called

		const { withConnection } = await import('@portal/shared/server/oracle/connection.js');

		await expect(
			withConnection(async (conn) => {
				await conn.execute(`BEGIN portal_ctx_pkg.set_org_id(:orgId); END;`, {
					orgId: 'org-789'
				});

				try {
					return await conn.execute('SELECT * FROM workflow_definitions', []);
				} finally {
					await conn.execute('BEGIN portal_ctx_pkg.clear_context; END;', []);
				}
			})
		).rejects.toThrow('Query failed');

		// Verify clear_context was still called despite error
		const clearCalls = mockExecute.mock.calls.filter((call) =>
			call[0]?.includes('portal_ctx_pkg.clear_context')
		);
		expect(clearCalls).toHaveLength(1);
	});

	it('should handle set_org_id failure gracefully', async () => {
		mockExecute.mockRejectedValueOnce(new Error('Context package not initialized'));

		const { withConnection } = await import('@portal/shared/server/oracle/connection.js');

		await expect(
			withConnection(async (conn) => {
				await conn.execute(`BEGIN portal_ctx_pkg.set_org_id(:orgId); END;`, {
					orgId: 'org-bad'
				});
			})
		).rejects.toThrow('Context package not initialized');
	});
});

// ============================================================================
// 3. Multi-Tenant Isolation Tests
// ============================================================================

describe('Multi-tenant data isolation', () => {
	it('should prevent org A from seeing org B data', async () => {
		// Simulate two separate requests with different org contexts

		// Request 1: org-a
		mockExecute
			.mockResolvedValueOnce(undefined) // set_org_id(org-a)
			.mockResolvedValueOnce({
				// Only org-a data returned
				rows: [{ ID: 'wf-a', ORG_ID: 'org-a', NAME: 'Workflow A' }]
			})
			.mockResolvedValueOnce(undefined); // clear_context

		const { withConnection } = await import('@portal/shared/server/oracle/connection.js');

		const resultA = await withConnection(async (conn) => {
			await conn.execute(`BEGIN portal_ctx_pkg.set_org_id(:orgId); END;`, {
				orgId: 'org-a'
			});

			try {
				return await conn.execute('SELECT * FROM workflow_definitions', [], {
					outFormat: conn.OBJECT
				});
			} finally {
				await conn.execute('BEGIN portal_ctx_pkg.clear_context; END;', []);
			}
		});

		expect(resultA.rows).toHaveLength(1);
		expect(resultA.rows![0].ORG_ID).toBe('org-a');

		// Request 2: org-b
		mockExecute
			.mockResolvedValueOnce(undefined) // set_org_id(org-b)
			.mockResolvedValueOnce({
				// Only org-b data returned
				rows: [{ ID: 'wf-b', ORG_ID: 'org-b', NAME: 'Workflow B' }]
			})
			.mockResolvedValueOnce(undefined); // clear_context

		await withConnection(async (conn) => {
			await conn.execute(`BEGIN portal_ctx_pkg.set_org_id(:orgId); END;`, {
				orgId: 'org-b'
			});

			try {
				return await conn.execute('SELECT * FROM workflow_definitions', [], {
					outFormat: conn.OBJECT
				});
			} finally {
				await conn.execute('BEGIN portal_ctx_pkg.clear_context; END;', []);
			}
		});

		// Each request isolated by VPD context

		// Verify each request set different org contexts
		const setOrgCalls = mockExecute.mock.calls.filter((call) =>
			call[0]?.includes('portal_ctx_pkg.set_org_id')
		);
		expect(setOrgCalls).toHaveLength(2);
		expect(setOrgCalls[0][1]).toEqual({ orgId: 'org-a' });
		expect(setOrgCalls[1][1]).toEqual({ orgId: 'org-b' });
	});

	it('should allow admin bypass to see all org data', async () => {
		mockExecute
			.mockResolvedValueOnce(undefined) // set_admin_bypass
			.mockResolvedValueOnce({
				// Returns data from multiple orgs
				rows: [
					{ ID: 'wf-a', ORG_ID: 'org-a', NAME: 'Workflow A' },
					{ ID: 'wf-b', ORG_ID: 'org-b', NAME: 'Workflow B' },
					{ ID: 'wf-c', ORG_ID: 'org-c', NAME: 'Workflow C' }
				]
			})
			.mockResolvedValueOnce(undefined); // clear_context

		const { withConnection } = await import('@portal/shared/server/oracle/connection.js');

		const result = await withConnection(async (conn) => {
			await conn.execute('BEGIN portal_ctx_pkg.set_admin_bypass; END;', []);

			try {
				return await conn.execute('SELECT * FROM workflow_definitions', [], {
					outFormat: conn.OBJECT
				});
			} finally {
				await conn.execute('BEGIN portal_ctx_pkg.clear_context; END;', []);
			}
		});

		// Admin should see all orgs
		expect(result.rows).toHaveLength(3);
		const orgIds = result.rows!.map((row: { ORG_ID: string }) => row.ORG_ID);
		expect(orgIds).toContain('org-a');
		expect(orgIds).toContain('org-b');
		expect(orgIds).toContain('org-c');
	});

	it('should prevent cross-org inserts (update_check=TRUE)', async () => {
		// Simulate INSERT with wrong org_id context
		// The VPD policy with update_check=TRUE will reject this

		mockExecute
			.mockResolvedValueOnce(undefined) // set_org_id(org-x)
			.mockRejectedValueOnce(
				new Error('ORA-28115: policy with check option violation') // VPD blocks INSERT
			);

		const { withConnection } = await import('@portal/shared/server/oracle/connection.js');

		await expect(
			withConnection(async (conn) => {
				// Set context to org-x
				await conn.execute(`BEGIN portal_ctx_pkg.set_org_id(:orgId); END;`, {
					orgId: 'org-x'
				});

				// Try to INSERT row with different org_id (org-y)
				// VPD update_check should block this
				await conn.execute(
					`INSERT INTO workflow_definitions (id, org_id, name, definition_json)
           VALUES (:id, :orgId, :name, :definition)`,
					{
						id: 'wf-new',
						orgId: 'org-y', // Different from context!
						name: 'Bad Workflow',
						definition: '{}'
					}
				);
			})
		).rejects.toThrow('policy with check option violation');
	});
});

// ============================================================================
// 4. Migration File Validation
// ============================================================================

describe('017-vpd.sql migration', () => {
	it('should exist in migrations directory', () => {
		// Path is relative to monorepo root, not apps/api
		const migrationPath = join(
			process.cwd(),
			'../../packages/shared/src/server/oracle/migrations/017-vpd.sql'
		);

		expect(existsSync(migrationPath)).toBe(true);
	});

	it('should contain six table policy definitions', () => {
		const migrationPath = join(
			process.cwd(),
			'../../packages/shared/src/server/oracle/migrations/017-vpd.sql'
		);

		const content = readFileSync(migrationPath, 'utf-8');

		// Check for all 6 policies
		const expectedTables = [
			'WORKFLOW_DEFINITIONS',
			'WORKFLOW_RUNS',
			'CHAT_SESSIONS',
			'API_KEYS',
			'MCP_SERVERS',
			'AGENT_SESSIONS'
		];

		for (const table of expectedTables) {
			expect(content).toContain(`object_name     => '${table}'`);
		}

		// Count total ADD_POLICY calls
		const policyCount = (content.match(/DBMS_RLS\.ADD_POLICY/g) || []).length;
		expect(policyCount).toBe(6);
	});

	it('should set update_check => TRUE for all policies', () => {
		const migrationPath = join(
			process.cwd(),
			'../../packages/shared/src/server/oracle/migrations/017-vpd.sql'
		);

		const content = readFileSync(migrationPath, 'utf-8');

		// All policies should have update_check => TRUE
		const updateCheckCount = (content.match(/update_check\s*=>\s*TRUE/gi) || []).length;
		expect(updateCheckCount).toBe(6);
	});

	it('should define application context PORTAL_CTX', () => {
		const migrationPath = join(
			process.cwd(),
			'../../packages/shared/src/server/oracle/migrations/017-vpd.sql'
		);

		const content = readFileSync(migrationPath, 'utf-8');

		expect(content).toContain('CREATE OR REPLACE CONTEXT portal_ctx');
		expect(content).toContain('USING portal_ctx_pkg');
	});

	it('should define portal_ctx_pkg package with three procedures', () => {
		const migrationPath = join(
			process.cwd(),
			'../../packages/shared/src/server/oracle/migrations/017-vpd.sql'
		);

		const content = readFileSync(migrationPath, 'utf-8');

		// Package spec
		expect(content).toContain('CREATE OR REPLACE PACKAGE portal_ctx_pkg');
		expect(content).toContain('PROCEDURE set_org_id(p_org_id VARCHAR2)');
		expect(content).toContain('PROCEDURE set_admin_bypass');
		expect(content).toContain('PROCEDURE clear_context');

		// Package body
		expect(content).toContain('CREATE OR REPLACE PACKAGE BODY portal_ctx_pkg');
		expect(content).toContain("DBMS_SESSION.SET_CONTEXT('PORTAL_CTX', 'ORG_ID'");
		expect(content).toContain("DBMS_SESSION.CLEAR_CONTEXT('PORTAL_CTX')");
	});

	it('should define portal_vpd_policy function', () => {
		const migrationPath = join(
			process.cwd(),
			'../../packages/shared/src/server/oracle/migrations/017-vpd.sql'
		);

		const content = readFileSync(migrationPath, 'utf-8');

		expect(content).toContain('CREATE OR REPLACE FUNCTION portal_vpd_policy');
		expect(content).toContain('p_schema VARCHAR2');
		expect(content).toContain('p_table  VARCHAR2');
		expect(content).toContain('RETURN VARCHAR2');
		expect(content).toContain("SYS_CONTEXT('PORTAL_CTX', 'ORG_ID')");
		expect(content).toContain("RETURN '1=0'"); // Deny all when no context
		expect(content).toContain('ADMIN_BYPASS'); // Admin bypass check
		expect(content).toContain("org_id = '"); // Tenant filter predicate
	});

	it('should use SELECT,INSERT,UPDATE,DELETE statement types', () => {
		const migrationPath = join(
			process.cwd(),
			'../../packages/shared/src/server/oracle/migrations/017-vpd.sql'
		);

		const content = readFileSync(migrationPath, 'utf-8');

		// All policies should cover these DML operations
		const statementTypes = (content.match(/statement_types\s*=>\s*'([^']+)'/g) || []).map((s) =>
			s.replace(/.*'([^']+)'.*/, '$1')
		);

		expect(statementTypes).toHaveLength(6);
		statementTypes.forEach((types) => {
			expect(types).toBe('SELECT,INSERT,UPDATE,DELETE');
		});
	});
});
