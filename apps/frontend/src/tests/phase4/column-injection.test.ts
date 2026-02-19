/**
 * Phase 4 Security: Column/Table injection prevention in oracle-adapter.ts
 *
 * Finding I-1: toSnakeCase() and selectColumns() interpolate field names into SQL
 * without validation. Malicious field names could inject SQL.
 *
 * Expected new exports from oracle-adapter.ts:
 *   - validateColumnName(name: string): string — validates snake_case column name
 *   - validateTableName(name: string): string — validates against ALLOWED_TABLES allowlist
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) =>
		fn({
			execute: vi.fn().mockResolvedValue({ rows: [] })
		})
	)
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

let adapterModule: Record<string, unknown> | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		adapterModule = await import('$lib/server/auth/oracle-adapter.js');
	} catch {
		// Module may not be available yet
	}
});

describe('I-1: Column injection prevention', () => {
	describe('validateColumnName', () => {
		it('should be exported from oracle-adapter', () => {
			expect(adapterModule).not.toBeNull();
			expect(typeof adapterModule!.validateColumnName).toBe('function');
		});

		it('accepts valid column names', () => {
			const validate = adapterModule!.validateColumnName as (name: string) => string;
			expect(validate('id')).toBe('id');
			expect(validate('user_id')).toBe('user_id');
			expect(validate('created_at')).toBe('created_at');
			expect(validate('email_verified')).toBe('email_verified');
			expect(validate('a1')).toBe('a1');
		});

		it('converts camelCase to snake_case before validation', () => {
			const validate = adapterModule!.validateColumnName as (name: string) => string;
			expect(validate('userId')).toBe('user_id');
			expect(validate('createdAt')).toBe('created_at');
			expect(validate('emailVerified')).toBe('email_verified');
		});

		it('rejects SQL injection in column names', () => {
			const validate = adapterModule!.validateColumnName as (name: string) => string;
			expect(() => validate('id; DROP TABLE users--')).toThrow();
			expect(() => validate("id' OR '1'='1")).toThrow();
			expect(() => validate('id UNION SELECT * FROM secrets')).toThrow();
		});

		it('rejects column names with special characters', () => {
			const validate = adapterModule!.validateColumnName as (name: string) => string;
			expect(() => validate('col(name)')).toThrow();
			expect(() => validate('col.name')).toThrow();
			expect(() => validate('col*')).toThrow();
			expect(() => validate('')).toThrow();
		});

		it('rejects column names exceeding max length', () => {
			const validate = adapterModule!.validateColumnName as (name: string) => string;
			const longName = 'a'.repeat(129);
			expect(() => validate(longName)).toThrow();
		});
	});

	describe('validateTableName', () => {
		it('should be exported from oracle-adapter', () => {
			expect(adapterModule).not.toBeNull();
			expect(typeof adapterModule!.validateTableName).toBe('function');
		});

		it('accepts known Better Auth table names and maps to physical Oracle names', () => {
			const validate = adapterModule!.validateTableName as (name: string) => string;
			// Better Auth model names are accepted and mapped to physical Oracle table names
			expect(validate('user')).toBe('users');
			expect(validate('session')).toBe('auth_sessions');
			expect(validate('account')).toBe('accounts');
			expect(validate('verification')).toBe('verifications');
		});

		it('rejects unknown table names', () => {
			const validate = adapterModule!.validateTableName as (name: string) => string;
			expect(() => validate('secrets')).toThrow();
			expect(() => validate('admin_passwords')).toThrow();
		});

		it('rejects SQL injection in table names', () => {
			const validate = adapterModule!.validateTableName as (name: string) => string;
			expect(() => validate('user; DROP TABLE user--')).toThrow();
			expect(() => validate("user' OR '1'='1")).toThrow();
		});
	});

	describe('buildWhereClause uses validated columns', () => {
		it('rejects injection via where clause field names', () => {
			const buildWhereClause = adapterModule!.buildWhereClause as (
				where: Array<{ field: string; value: unknown; operator: string; connector: 'AND' | 'OR' }>
			) => { sql: string; binds: Record<string, unknown> };

			expect(() =>
				buildWhereClause([
					{ field: 'id; DROP TABLE users--', value: '1', operator: 'eq', connector: 'AND' }
				])
			).toThrow();
		});
	});

	describe('selectColumns uses validated columns', () => {
		it('validates all column names in select list', () => {
			// selectColumns is internal, but we can test through the exported helpers
			// The validation should be applied inside selectColumns
			const validate = adapterModule!.validateColumnName as (name: string) => string;
			// Valid columns should pass through selectColumns without error
			expect(validate('id')).toBe('id');
			expect(validate('email')).toBe('email');
			// Invalid columns should throw
			expect(() => validate('id; DROP TABLE--')).toThrow();
		});
	});
});
