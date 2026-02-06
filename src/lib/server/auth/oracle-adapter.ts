/**
 * Custom Oracle Database adapter for Better Auth.
 *
 * Bridges Better Auth's CRUD operations to Oracle via our connection pool.
 * Handles camelCase <-> snake_case conversion and Oracle's uppercase result keys.
 */
import { createAdapterFactory } from 'better-auth/adapters';
import type { AdapterFactory } from 'better-auth/adapters';
import { withConnection, type OracleConnection } from '$lib/server/oracle/connection.js';
import { createLogger } from '$lib/server/logger.js';
import crypto from 'crypto';

const log = createLogger('oracle-adapter');

// ============================================================================
// Helpers: case conversion
// ============================================================================

export function toSnakeCase(str: string): string {
	return str.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

export function toCamelCase(str: string): string {
	return str.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** Convert all keys of an object using `mapper`. */
function mapKeys<T extends Record<string, unknown>>(
	obj: Record<string, unknown>,
	mapper: (key: string) => string
): T {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		out[mapper(k)] = v;
	}
	return out as T;
}

/** Oracle OUT_FORMAT_OBJECT returns UPPERCASE keys. Map them to camelCase. */
function fromOracleRow<T>(row: Record<string, unknown>): T {
	return mapKeys<T & Record<string, unknown>>(row, toCamelCase);
}

/** Transform a row with snake_case (or UPPERCASE) keys to camelCase. */
export function transformRow(row: Record<string, unknown>): Record<string, unknown> {
	return fromOracleRow<Record<string, unknown>>(row);
}

// ============================================================================
// Where clause builder
// ============================================================================

export interface CleanedWhere {
	field: string;
	value: unknown;
	operator: string;
	connector: 'AND' | 'OR';
}

export function buildWhereClause(
	where: CleanedWhere[]
): { sql: string; binds: Record<string, unknown> } {
	if (!where.length) return { sql: '', binds: {} };

	const parts: string[] = [];
	const binds: Record<string, unknown> = {};
	let bindIdx = 0;

	for (let i = 0; i < where.length; i++) {
		const clause = where[i];
		const col = toSnakeCase(clause.field);
		const bindName = `w${bindIdx++}`;

		let condition: string;
		switch (clause.operator) {
			case 'eq':
				if (clause.value === null) {
					condition = `${col} IS NULL`;
				} else {
					condition = `${col} = :${bindName}`;
					binds[bindName] = clause.value;
				}
				break;
			case 'ne':
				if (clause.value === null) {
					condition = `${col} IS NOT NULL`;
				} else {
					condition = `${col} <> :${bindName}`;
					binds[bindName] = clause.value;
				}
				break;
			case 'gt':
				condition = `${col} > :${bindName}`;
				binds[bindName] = clause.value;
				break;
			case 'gte':
				condition = `${col} >= :${bindName}`;
				binds[bindName] = clause.value;
				break;
			case 'lt':
				condition = `${col} < :${bindName}`;
				binds[bindName] = clause.value;
				break;
			case 'lte':
				condition = `${col} <= :${bindName}`;
				binds[bindName] = clause.value;
				break;
			case 'in': {
				const vals = clause.value as unknown[];
				const inBinds = vals.map((_, j) => {
					const name = `w${bindIdx++}`;
					binds[name] = vals[j];
					return `:${name}`;
				});
				condition = `${col} IN (${inBinds.join(', ')})`;
				break;
			}
			case 'not_in': {
				const vals = clause.value as unknown[];
				const inBinds = vals.map((_, j) => {
					const name = `w${bindIdx++}`;
					binds[name] = vals[j];
					return `:${name}`;
				});
				condition = `${col} NOT IN (${inBinds.join(', ')})`;
				break;
			}
			case 'contains':
				condition = `${col} LIKE :${bindName}`;
				binds[bindName] = `%${clause.value}%`;
				break;
			case 'starts_with':
				condition = `${col} LIKE :${bindName}`;
				binds[bindName] = `${clause.value}%`;
				break;
			case 'ends_with':
				condition = `${col} LIKE :${bindName}`;
				binds[bindName] = `%${clause.value}`;
				break;
			default:
				condition = `${col} = :${bindName}`;
				binds[bindName] = clause.value;
		}

		if (i === 0) {
			parts.push(condition);
		} else {
			const connector = clause.connector === 'OR' ? 'OR' : 'AND';
			parts.push(`${connector} ${condition}`);
		}
	}

	return { sql: ' WHERE ' + parts.join(' '), binds };
}

// ============================================================================
// Row selection helper
// ============================================================================

function selectColumns(select: string[] | undefined): string {
	if (!select || select.length === 0) return '*';
	return select.map((f) => toSnakeCase(f)).join(', ');
}

/** Filter a row to only the selected fields (post-query, camelCase keys). */
function applySelect<T>(row: Record<string, unknown>, select?: string[]): T {
	if (!select || select.length === 0) return row as T;
	const out: Record<string, unknown> = {};
	for (const f of select) {
		if (f in row) out[f] = row[f];
	}
	return out as T;
}

// ============================================================================
// Adapter factory
// ============================================================================

export function oracleAdapter(): AdapterFactory {
	const factory = createAdapterFactory({
		config: {
			adapterId: 'oracle',
			adapterName: 'Oracle Database Adapter',
			usePlural: false,
			supportsBooleans: false,
			supportsDates: true,
			supportsJSON: false,
			supportsArrays: false,
			supportsNumericIds: false,
			supportsUUIDs: false,
			customIdGenerator: () => crypto.randomUUID(),
			transaction: false
		},
		adapter: ({
			getModelName,
			getFieldName: _getFieldName,
			getDefaultModelName: _getDefaultModelName,
			debugLog
		}) => {
			/** Execute a SQL query inside our pool and return rows. */
			async function query<T = Record<string, unknown>>(
				conn: OracleConnection,
				sql: string,
				binds: Record<string, unknown> = {}
			): Promise<T[]> {
				debugLog('[oracle]', sql, binds);
				const result = await conn.execute<Record<string, unknown>>(sql, binds);
				return (result.rows ?? []).map((r) => fromOracleRow<T>(r));
			}

			return {
				create: async <T extends Record<string, unknown>>({
					model,
					data,
					select
				}: {
					model: string;
					data: T;
					select?: string[];
				}) => {
					const table = getModelName(model);
					const entries = Object.entries(data);

					if (entries.length === 0) {
						throw new Error(`Cannot insert empty data into ${table}`);
					}

					const cols = entries.map(([k]) => toSnakeCase(k));
					const bindNames = entries.map(([k]) => `:${k}`);
					const binds: Record<string, unknown> = {};
					for (const [k, v] of entries) {
						binds[k] = v;
					}

					const returnCols = selectColumns(select);
					// Oracle RETURNING ... INTO requires OUT binds which are complex.
					// Instead, we insert then select back by id.
					const insertSql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${bindNames.join(', ')})`;

					return withConnection(async (conn) => {
						await conn.execute(insertSql, binds);

						// Read back the inserted row by id
						const id = data.id;
						const selectSql = `SELECT ${returnCols} FROM ${table} WHERE id = :id`;
						const rows = await query<T>(conn, selectSql, { id });

						if (!rows.length) {
							log.error({ model, table, id }, 'insert succeeded but select-back failed');
							return data;
						}

						return applySelect<T>(rows[0] as Record<string, unknown>, select);
					});
				},

				findOne: async <T>({
					model,
					where,
					select
				}: {
					model: string;
					where: CleanedWhere[];
					select?: string[];
				}) => {
					const table = getModelName(model);
					const cols = selectColumns(select);
					const { sql: whereSql, binds } = buildWhereClause(where);
					const selectSql = `SELECT ${cols} FROM ${table}${whereSql} FETCH FIRST 1 ROWS ONLY`;

					return withConnection(async (conn) => {
						const rows = await query<T>(conn, selectSql, binds);
						if (!rows.length) return null;
						return applySelect<T>(rows[0] as Record<string, unknown>, select);
					});
				},

				findMany: async <T>({
					model,
					where,
					limit,
					sortBy,
					offset
				}: {
					model: string;
					where?: CleanedWhere[];
					limit: number;
					sortBy?: { field: string; direction: 'asc' | 'desc' };
					offset?: number;
				}) => {
					const table = getModelName(model);
					const { sql: whereSql, binds } = buildWhereClause(where ?? []);

					let sql = `SELECT * FROM ${table}${whereSql}`;

					if (sortBy) {
						const dir = sortBy.direction === 'desc' ? 'DESC' : 'ASC';
						sql += ` ORDER BY ${toSnakeCase(sortBy.field)} ${dir}`;
					}

					if (offset !== undefined && offset > 0) {
						sql += ` OFFSET :_offset ROWS`;
						binds._offset = offset;
					}

					if (limit !== undefined) {
						sql += ` FETCH NEXT :_limit ROWS ONLY`;
						binds._limit = limit;
					}

					return withConnection(async (conn) => {
						return query<T>(conn, sql, binds);
					});
				},

				count: async ({
					model,
					where
				}: {
					model: string;
					where?: CleanedWhere[];
				}) => {
					const table = getModelName(model);
					const { sql: whereSql, binds } = buildWhereClause(where ?? []);
					const sql = `SELECT COUNT(*) AS cnt FROM ${table}${whereSql}`;

					return withConnection(async (conn) => {
						const rows = await query<{ cnt: number }>(conn, sql, binds);
						return rows[0]?.cnt ?? 0;
					});
				},

				update: async <T>({
					model,
					where,
					update
				}: {
					model: string;
					where: CleanedWhere[];
					update: T;
				}) => {
					const table = getModelName(model);

					const updateObj = update as Record<string, unknown>;
					const setEntries = Object.entries(updateObj);
					if (setEntries.length === 0) return null;

					const setClauses = setEntries.map(([k]) => `${toSnakeCase(k)} = :u_${k}`);
					const setBinds: Record<string, unknown> = {};
					for (const [k, v] of setEntries) {
						setBinds[`u_${k}`] = v;
					}

					const { sql: whereSql, binds: whereBinds } = buildWhereClause(where);
					const allBinds = { ...setBinds, ...whereBinds };
					const updateSql = `UPDATE ${table} SET ${setClauses.join(', ')}${whereSql}`;

					return withConnection(async (conn) => {
						await conn.execute(updateSql, allBinds);

						// Read back the updated row
						const selectSql = `SELECT * FROM ${table}${whereSql}`;
						const rows = await query<T>(conn, selectSql, whereBinds);
						return rows[0] ?? null;
					});
				},

				updateMany: async ({
					model,
					where,
					update
				}: {
					model: string;
					where: CleanedWhere[];
					update: Record<string, unknown>;
				}) => {
					const table = getModelName(model);

					const setEntries = Object.entries(update);
					if (setEntries.length === 0) return 0;

					const setClauses = setEntries.map(([k]) => `${toSnakeCase(k)} = :u_${k}`);
					const setBinds: Record<string, unknown> = {};
					for (const [k, v] of setEntries) {
						setBinds[`u_${k}`] = v;
					}

					const { sql: whereSql, binds: whereBinds } = buildWhereClause(where);
					const allBinds = { ...setBinds, ...whereBinds };
					const sql = `UPDATE ${table} SET ${setClauses.join(', ')}${whereSql}`;

					return withConnection(async (conn) => {
						const result = await conn.execute(sql, allBinds);
						return (result as unknown as { rowsAffected?: number }).rowsAffected ?? 0;
					});
				},

				delete: async ({
					model,
					where
				}: {
					model: string;
					where: CleanedWhere[];
				}) => {
					const table = getModelName(model);
					const { sql: whereSql, binds } = buildWhereClause(where);
					const sql = `DELETE FROM ${table}${whereSql}`;

					await withConnection(async (conn) => {
						await conn.execute(sql, binds);
					});
				},

				deleteMany: async ({
					model,
					where
				}: {
					model: string;
					where: CleanedWhere[];
				}) => {
					const table = getModelName(model);
					const { sql: whereSql, binds } = buildWhereClause(where);
					const sql = `DELETE FROM ${table}${whereSql}`;

					return withConnection(async (conn) => {
						const result = await conn.execute(sql, binds);
						return (result as unknown as { rowsAffected?: number }).rowsAffected ?? 0;
					});
				}
			};
		}
	});

	return factory;
}
