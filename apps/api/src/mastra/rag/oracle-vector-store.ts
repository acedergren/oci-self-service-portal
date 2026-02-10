/**
 * Oracle 26AI Vector Store — MastraVector implementation.
 *
 * Maps Mastra "indexes" to Oracle tables prefixed with MASTRA_VECTOR_.
 * The legacy `conversation_embeddings` table is treated as a read-only index.
 *
 * Uses Oracle 26AI VECTOR(dim, FLOAT32) columns with COSINE similarity search.
 */

import { MastraVector } from '@mastra/core/vector';
import type {
	QueryResult,
	IndexStats,
	CreateIndexParams,
	QueryVectorParams,
	UpsertVectorParams,
	DescribeIndexParams,
	DeleteIndexParams,
	UpdateVectorParams,
	DeleteVectorParams,
	DeleteVectorsParams
} from '@mastra/core/vector';
import { DB_TYPE_VECTOR, type OracleConnection } from '@portal/shared/server/oracle/connection';

type WithConnectionFn = <T>(fn: (conn: OracleConnection) => Promise<T>) => Promise<T>;

/** Table prefix for dynamically created vector indexes */
const TABLE_PREFIX = 'MASTRA_VECTOR_';

/** Legacy table from migration 002-vector.sql */
const LEGACY_TABLE = 'CONVERSATION_EMBEDDINGS';

/** Only [A-Z0-9_] allowed in Oracle identifiers (SQL injection prevention) */
const SAFE_IDENTIFIER = /^[A-Z0-9_]+$/;

/** Resolve an index name to an Oracle table name */
function resolveTableName(indexName: string): string {
	const upper = indexName.toUpperCase();
	// Legacy table — referenced directly
	if (upper === LEGACY_TABLE || upper === 'CONVERSATION_EMBEDDINGS') {
		return LEGACY_TABLE;
	}
	// Already prefixed
	if (upper.startsWith(TABLE_PREFIX)) {
		return upper;
	}
	return TABLE_PREFIX + upper;
}

/** Validate that a table name contains only safe characters */
function validateTableName(name: string): void {
	if (!SAFE_IDENTIFIER.test(name)) {
		throw new Error(`Invalid vector index name: "${name}". Only A-Z, 0-9, and _ are allowed.`);
	}
	if (name.length > 128) {
		throw new Error(`Vector index name too long: ${name.length} chars (max 128).`);
	}
}

/**
 * Build a simple metadata filter clause using JSON_VALUE.
 * Supports flat key-value equality filters only.
 * Returns [whereClause, binds] — empty string if no filter.
 */
function buildMetadataFilter(
	filter: Record<string, unknown> | undefined,
	bindPrefix: string
): { clause: string; binds: Record<string, unknown> } {
	if (!filter || Object.keys(filter).length === 0) {
		return { clause: '', binds: {} };
	}

	const conditions: string[] = [];
	const binds: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(filter)) {
		// Validate key to prevent injection in JSON path
		if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
			throw new Error(`Invalid metadata filter key: "${key}"`);
		}
		const bindName = `${bindPrefix}_${key}`;
		conditions.push(`JSON_VALUE(metadata, '$.${key}') = :${bindName}`);
		binds[bindName] = String(value);
	}

	return {
		clause: conditions.join(' AND '),
		binds
	};
}

export class OracleVectorStore extends MastraVector {
	private withConnection: WithConnectionFn;

	constructor(opts: { withConnection: WithConnectionFn }) {
		super({ id: 'oracle-26ai' });
		this.withConnection = opts.withConnection;
	}

	async createIndex(params: CreateIndexParams): Promise<void> {
		const tableName = resolveTableName(params.indexName);
		validateTableName(tableName);

		const dimension = params.dimension;
		const metric = (params.metric ?? 'cosine').toUpperCase();

		await this.withConnection(async (conn) => {
			// Check if table already exists
			const exists = await conn.execute<{ CNT: number }>(
				`SELECT COUNT(*) AS "CNT" FROM user_tables WHERE table_name = :tbl`,
				{ tbl: tableName }
			);

			if (exists.rows?.[0]?.CNT && exists.rows[0].CNT > 0) {
				// Validate dimension matches
				const colInfo = await conn.execute<{ DATA_LENGTH: number | null }>(
					`SELECT data_precision AS "DATA_LENGTH" FROM user_tab_columns
           WHERE table_name = :tbl AND column_name = 'EMBEDDING'`,
					{ tbl: tableName }
				);
				// Oracle stores vector dimension info — just log if we can't verify
				if (colInfo.rows?.[0]?.DATA_LENGTH) {
					const existingDim = colInfo.rows[0].DATA_LENGTH;
					if (existingDim !== dimension) {
						throw new Error(
							`Index "${params.indexName}" exists with dimension ${existingDim}, ` +
								`but ${dimension} was requested.`
						);
					}
				}
				return; // Table already exists with matching (or unverifiable) dimension
			}

			// Create the table — DDL cannot use bind variables
			await conn.execute(
				`CREATE TABLE ${tableName} (
           id        VARCHAR2(255) PRIMARY KEY,
           metadata  CLOB,
           embedding VECTOR(${dimension}, FLOAT32),
           document  CLOB,
           created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
           CONSTRAINT chk_${tableName.toLowerCase()}_meta CHECK (metadata IS JSON OR metadata IS NULL)
         )`
			);

			// Create the vector index
			await conn.execute(
				`CREATE VECTOR INDEX idx_${tableName.toLowerCase()}_vec ON ${tableName}(embedding)
           ORGANIZATION INMEMORY NEIGHBOR GRAPH
           DISTANCE ${metric}
           WITH TARGET ACCURACY 95`
			);

			await conn.commit();
		});
	}

	async upsert(params: UpsertVectorParams): Promise<string[]> {
		const tableName = resolveTableName(params.indexName);
		validateTableName(tableName);

		const { vectors, metadata, ids } = params;
		const generatedIds: string[] = ids?.length ? [...ids] : vectors.map(() => crypto.randomUUID());

		await this.withConnection(async (conn) => {
			// Handle deleteFilter atomically before insert (only flat key-value filters supported)
			const df = params.deleteFilter as Record<string, unknown> | null | undefined;
			if (df && Object.keys(df).length > 0) {
				const { clause, binds } = buildMetadataFilter(df, 'df');
				if (clause) {
					await conn.execute(`DELETE FROM ${tableName} WHERE ${clause}`, binds);
				}
			}

			for (let i = 0; i < vectors.length; i++) {
				const vecBuf = new Float32Array(vectors[i]);
				const meta = metadata?.[i] ? JSON.stringify(metadata[i]) : null;

				await conn.execute(
					`MERGE INTO ${tableName} t
           USING (SELECT :id AS id FROM DUAL) s
           ON (t.id = s.id)
           WHEN MATCHED THEN UPDATE SET
             t.embedding = :vec,
             t.metadata = :meta
           WHEN NOT MATCHED THEN INSERT (id, embedding, metadata, created_at)
             VALUES (:id, :vec, :meta, SYSTIMESTAMP)`,
					{
						id: generatedIds[i],
						vec: { val: vecBuf, type: DB_TYPE_VECTOR },
						meta
					}
				);
			}

			await conn.commit();
		});

		return generatedIds;
	}

	async query(params: QueryVectorParams): Promise<QueryResult[]> {
		const tableName = resolveTableName(params.indexName);
		validateTableName(tableName);

		const topK = params.topK ?? 10;
		const queryVecBuf = new Float32Array(params.queryVector);

		return this.withConnection(async (conn) => {
			const binds: Record<string, unknown> = {
				queryVec: { val: queryVecBuf, type: DB_TYPE_VECTOR },
				topK
			};

			let filterClause = '';
			if (params.filter) {
				const { clause, binds: filterBinds } = buildMetadataFilter(
					params.filter as Record<string, unknown>,
					'qf'
				);
				if (clause) {
					filterClause = `WHERE ${clause}`;
					Object.assign(binds, filterBinds);
				}
			}

			const includeVec = params.includeVector ? ', t.embedding' : '';

			const result = await conn.execute<{
				ID: string;
				SCORE: number;
				METADATA: string | null;
				DOCUMENT: string | null;
				EMBEDDING?: unknown;
			}>(
				`SELECT t.id AS "ID",
                (1 - VECTOR_DISTANCE(t.embedding, :queryVec, COSINE)) AS "SCORE",
                t.metadata AS "METADATA",
                t.document AS "DOCUMENT"
                ${includeVec ? `, t.embedding AS "EMBEDDING"` : ''}
         FROM ${tableName} t
         ${filterClause}
         ORDER BY VECTOR_DISTANCE(t.embedding, :queryVec, COSINE) ASC
         FETCH FIRST :topK ROWS ONLY`,
				binds
			);

			if (!result.rows) return [];

			return result.rows.map((row) => {
				const qr: QueryResult = {
					id: row.ID,
					score: row.SCORE
				};
				if (row.METADATA) {
					try {
						qr.metadata = JSON.parse(row.METADATA);
					} catch {
						// Ignore malformed metadata
					}
				}
				if (row.DOCUMENT) {
					qr.document = row.DOCUMENT;
				}
				return qr;
			});
		});
	}

	async listIndexes(): Promise<string[]> {
		return this.withConnection(async (conn) => {
			const result = await conn.execute<{ TABLE_NAME: string }>(
				`SELECT table_name AS "TABLE_NAME" FROM user_tables
         WHERE table_name LIKE :prefix
         ORDER BY table_name`,
				{ prefix: TABLE_PREFIX + '%' }
			);

			const names = (result.rows ?? []).map((r) => r.TABLE_NAME);

			// Include legacy table if it exists
			const legacy = await conn.execute<{ CNT: number }>(
				`SELECT COUNT(*) AS "CNT" FROM user_tables WHERE table_name = :tbl`,
				{ tbl: LEGACY_TABLE }
			);
			if (legacy.rows?.[0]?.CNT && legacy.rows[0].CNT > 0) {
				names.push(LEGACY_TABLE);
			}

			return names;
		});
	}

	async describeIndex(params: DescribeIndexParams): Promise<IndexStats> {
		const tableName = resolveTableName(params.indexName);
		validateTableName(tableName);

		return this.withConnection(async (conn) => {
			const countResult = await conn.execute<{ CNT: number }>(
				`SELECT COUNT(*) AS "CNT" FROM ${tableName}`
			);
			const count = countResult.rows?.[0]?.CNT ?? 0;

			// Try to get dimension from the first row's embedding
			let dimension = 0;
			const dimResult = await conn.execute<{ DIM: number | null }>(
				`SELECT VECTOR_DIMENSION_COUNT(embedding) AS "DIM"
         FROM ${tableName} WHERE ROWNUM = 1`
			);
			if (dimResult.rows?.[0]?.DIM) {
				dimension = dimResult.rows[0].DIM;
			}

			return { dimension, count, metric: 'cosine' };
		});
	}

	async deleteIndex(params: DeleteIndexParams): Promise<void> {
		const tableName = resolveTableName(params.indexName);
		validateTableName(tableName);

		// Refuse to drop legacy tables
		if (tableName === LEGACY_TABLE) {
			throw new Error(
				`Cannot delete legacy index "${LEGACY_TABLE}". Use migration scripts instead.`
			);
		}
		if (!tableName.startsWith(TABLE_PREFIX)) {
			throw new Error(
				`Cannot delete non-Mastra index "${tableName}". Only ${TABLE_PREFIX}* indexes can be deleted.`
			);
		}

		await this.withConnection(async (conn) => {
			await conn.execute(`DROP TABLE ${tableName} PURGE`);
			await conn.commit();
		});
	}

	async updateVector(params: UpdateVectorParams): Promise<void> {
		const tableName = resolveTableName(params.indexName);
		validateTableName(tableName);

		await this.withConnection(async (conn) => {
			const setClauses: string[] = [];
			const binds: Record<string, unknown> = {};

			if (params.update.vector) {
				const vecBuf = new Float32Array(params.update.vector);
				setClauses.push(`embedding = :newVec`);
				binds.newVec = { val: vecBuf, type: DB_TYPE_VECTOR };
			}

			if (params.update.metadata) {
				setClauses.push(`metadata = :newMeta`);
				binds.newMeta = JSON.stringify(params.update.metadata);
			}

			if (setClauses.length === 0) return;

			if (params.id) {
				// Update by ID
				binds.updateId = params.id;
				await conn.execute(
					`UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = :updateId`,
					binds
				);
			} else if (params.filter) {
				// Update by metadata filter
				const { clause, binds: filterBinds } = buildMetadataFilter(
					params.filter as Record<string, unknown>,
					'uf'
				);
				if (clause) {
					Object.assign(binds, filterBinds);
					await conn.execute(
						`UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE ${clause}`,
						binds
					);
				}
			}

			await conn.commit();
		});
	}

	async deleteVector(params: DeleteVectorParams): Promise<void> {
		const tableName = resolveTableName(params.indexName);
		validateTableName(tableName);

		await this.withConnection(async (conn) => {
			await conn.execute(`DELETE FROM ${tableName} WHERE id = :id`, {
				id: params.id
			});
			await conn.commit();
		});
	}

	async deleteVectors(params: DeleteVectorsParams): Promise<void> {
		const tableName = resolveTableName(params.indexName);
		validateTableName(tableName);

		await this.withConnection(async (conn) => {
			if (params.ids && params.ids.length > 0) {
				// Batch delete by IDs — Oracle supports up to 1000 IN list items
				for (let i = 0; i < params.ids.length; i += 1000) {
					const batch = params.ids.slice(i, i + 1000);
					const placeholders = batch.map((_, idx) => `:id${idx}`).join(',');
					const binds: Record<string, string> = {};
					batch.forEach((id, idx) => {
						binds[`id${idx}`] = id;
					});
					await conn.execute(`DELETE FROM ${tableName} WHERE id IN (${placeholders})`, binds);
				}
			} else if (params.filter) {
				const { clause, binds } = buildMetadataFilter(
					params.filter as Record<string, unknown>,
					'dvf'
				);
				if (clause) {
					await conn.execute(`DELETE FROM ${tableName} WHERE ${clause}`, binds);
				}
			}

			await conn.commit();
		});
	}
}
