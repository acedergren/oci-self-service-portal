/**
 * Oracle 26AI Vector Embedding Repository.
 *
 * Stores and retrieves embeddings in the conversation_embeddings table
 * using Oracle 26AI VECTOR(1536, FLOAT32) columns with COSINE similarity search.
 *
 * Uses the existing conversation_embeddings schema (002-vector.sql):
 *   - session_id maps to refId for chat-related references
 *   - content_type maps to refType
 *   - org_id filtering via JOIN with chat_sessions
 *
 * Reference types:
 *   - 'user_message'      : User chat message
 *   - 'assistant_response' : Assistant reply
 *   - 'tool_result'        : Tool execution result
 *   - 'summary'            : Conversation summary
 *   - 'tool_execution'     : Standalone tool execution record
 */

// @ts-expect-error oracledb ships no type declarations
import oracledb from 'oracledb';
import { withConnection, type OracleConnection } from '../connection';
import { createLogger } from '../../logger';
import { DatabaseError } from '../../errors';

const log = createLogger('embedding-repo');

/** Shape returned by similaritySearch */
export interface EmbeddingSearchResult {
	id: string;
	refType: string;
	refId: string;
	content: string;
	score: number;
}

/** Oracle row shape from similarity search query */
interface SearchResultRow {
	ID: string;
	REF_TYPE: string;
	REF_ID: string;
	CONTENT: string;
	SCORE: number;
}

/** Oracle row shape for conversation_embeddings */
interface EmbeddingRow {
	ID: string;
	SESSION_ID: string | null;
	TURN_ID: string | null;
	CONTENT_TYPE: string;
	TEXT_CONTENT: string;
	CREATED_AT: Date;
}

export const embeddingRepository = {
	/**
	 * Insert an embedding with reference metadata.
	 *
	 * Maps the flexible refType/refId model to the underlying
	 * conversation_embeddings table columns.
	 */
	async insert(params: {
		refType: string;
		refId: string;
		orgId: string;
		content: string;
		embedding: Float32Array;
		turnId?: string;
	}): Promise<{ id: string }> {
		const id = crypto.randomUUID();

		try {
			await withConnection(async (conn: OracleConnection) => {
				await conn.execute(
					`INSERT INTO conversation_embeddings
					   (id, session_id, turn_id, content_type, text_content, embedding)
					 VALUES
					   (:id, :ref_id, :turn_id, :ref_type, :textContent, :embedding)`,
					{
						id,
						ref_id: params.refId,
						turn_id: params.turnId ?? null,
						ref_type: params.refType,
						textContent: params.content,
						embedding: { val: params.embedding, type: oracledb.DB_TYPE_VECTOR }
					}
				);
			});
		} catch (err) {
			log.error(
				{ err, refType: params.refType, refId: params.refId },
				'failed to insert embedding'
			);
			throw new DatabaseError(
				'Failed to insert embedding',
				{
					refType: params.refType,
					refId: params.refId
				},
				err instanceof Error ? err : undefined
			);
		}

		return { id };
	},

	/**
	 * Search for similar embeddings using Oracle 26AI VECTOR_DISTANCE.
	 *
	 * Filters by org_id to prevent cross-tenant data leakage.
	 * Results are ranked by cosine similarity (higher = more similar).
	 */
	async similaritySearch(params: {
		embedding: Float32Array;
		orgId: string;
		limit?: number;
		refType?: string;
	}): Promise<EmbeddingSearchResult[]> {
		const limit = params.limit ?? 10;

		try {
			return await withConnection(async (conn: OracleConnection) => {
				const conditions = ['s.org_id = :org_id'];
				const binds: Record<string, unknown> = {
					queryVec: { val: params.embedding, type: oracledb.DB_TYPE_VECTOR },
					org_id: params.orgId,
					maxRows: limit
				};

				if (params.refType) {
					conditions.push('e.content_type = :refType');
					binds.refType = params.refType;
				}

				const whereClause = conditions.join(' AND ');

				const result = await conn.execute<SearchResultRow>(
					`SELECT
					   e.id AS "ID",
					   e.content_type AS "REF_TYPE",
					   e.session_id AS "REF_ID",
					   e.text_content AS "CONTENT",
					   (1 - VECTOR_DISTANCE(e.embedding, :queryVec, COSINE)) AS "SCORE"
					 FROM conversation_embeddings e
					 JOIN chat_sessions s ON s.id = e.session_id
					 WHERE ${whereClause}
					 ORDER BY VECTOR_DISTANCE(e.embedding, :queryVec, COSINE) ASC
					 FETCH FIRST :maxRows ROWS ONLY`,
					binds
				);

				if (!result.rows) return [];

				return result.rows.map((row) => ({
					id: row.ID,
					refType: row.REF_TYPE,
					refId: row.REF_ID,
					content: row.CONTENT,
					score: row.SCORE
				}));
			});
		} catch (err) {
			log.error({ err, orgId: params.orgId }, 'similarity search failed');
			throw new DatabaseError(
				'Similarity search failed',
				{
					orgId: params.orgId
				},
				err instanceof Error ? err : undefined
			);
		}
	},

	/**
	 * Delete embeddings by reference type and id.
	 * Used for cleanup when source records are deleted.
	 */
	async deleteByRef(refType: string, refId: string, orgId: string): Promise<void> {
		try {
			await withConnection(async (conn: OracleConnection) => {
				await conn.execute(
					`DELETE FROM conversation_embeddings e
					 WHERE e.content_type = :ref_type AND e.session_id = :ref_id
					   AND EXISTS (
					     SELECT 1 FROM chat_sessions s
					     WHERE s.id = e.session_id AND s.org_id = :org_id
					   )`,
					{ ref_type: refType, ref_id: refId, org_id: orgId }
				);
			});
		} catch (err) {
			log.error({ err, refType, refId }, 'failed to delete embeddings by ref');
			throw new DatabaseError(
				'Failed to delete embeddings',
				{
					refType,
					refId
				},
				err instanceof Error ? err : undefined
			);
		}
	},

	/**
	 * Get embedding by ID.
	 */
	async getById(
		id: string
	): Promise<{ id: string; refType: string; refId: string; content: string } | null> {
		return withConnection(async (conn: OracleConnection) => {
			const result = await conn.execute<EmbeddingRow>(
				`SELECT id AS "ID", session_id AS "SESSION_ID", turn_id AS "TURN_ID",
				        content_type AS "CONTENT_TYPE", text_content AS "TEXT_CONTENT",
				        created_at AS "CREATED_AT"
				 FROM conversation_embeddings WHERE id = :id`,
				{ id }
			);

			if (!result.rows || result.rows.length === 0) return null;
			const row = result.rows[0];
			return {
				id: row.ID,
				refType: row.CONTENT_TYPE,
				refId: row.SESSION_ID ?? '',
				content: row.TEXT_CONTENT
			};
		});
	}
};
