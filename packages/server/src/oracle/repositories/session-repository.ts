import { withConnection } from '../connection';
import { ChatSessionSchema, type ChatSession, type SessionStatus } from '../types';

/** Oracle row shape for chat_sessions (OUT_FORMAT_OBJECT, uppercase keys). */
interface ChatSessionRow {
	ID: string;
	USER_ID: string | null;
	ORG_ID: string | null;
	TITLE: string | null;
	MODEL: string;
	REGION: string;
	STATUS: string;
	CONFIG: string | null;
	CREATED_AT: Date;
	UPDATED_AT: Date;
}

function rowToSession(row: ChatSessionRow): ChatSession {
	return ChatSessionSchema.parse({
		id: row.ID,
		userId: row.USER_ID ?? undefined,
		orgId: row.ORG_ID ?? undefined,
		title: row.TITLE ?? undefined,
		model: row.MODEL,
		region: row.REGION,
		status: row.STATUS,
		config: row.CONFIG ? JSON.parse(row.CONFIG) : undefined,
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT
	});
}

export interface CreateSessionInput {
	model: string;
	region: string;
	title?: string;
	status?: SessionStatus;
	userId?: string;
	orgId?: string;
	config?: Record<string, unknown>;
}

export interface UpdateSessionInput {
	title?: string;
	status?: SessionStatus;
	config?: Record<string, unknown>;
}

export interface ListSessionsOptions {
	limit?: number;
	offset?: number;
	status?: SessionStatus;
	userId?: string;
	orgId?: string;
	search?: string;
}

/** Enriched session with message_count and last_message from chat_turns. */
export interface EnrichedSession extends ChatSession {
	messageCount: number;
	lastMessage: string | null;
}

export const sessionRepository = {
	async create(input: CreateSessionInput): Promise<ChatSession> {
		const id = crypto.randomUUID();
		const configJson = input.config ? JSON.stringify(input.config) : null;

		await withConnection(async (conn) => {
			await conn.execute(
				`INSERT INTO chat_sessions (id, user_id, org_id, title, model, region, status, config)
				 VALUES (:id, :userId, :orgId, :title, :model, :region, :status, :config)`,
				{
					id,
					userId: input.userId ?? null,
					orgId: input.orgId ?? null,
					title: input.title ?? null,
					model: input.model,
					region: input.region,
					status: input.status ?? 'active',
					config: configJson
				}
			);
		});

		const created = await this.getById(id);
		if (!created) {
			throw new Error(`Failed to retrieve session after creation: ${id}`);
		}
		return created;
	},

	async getById(id: string): Promise<ChatSession | null> {
		return withConnection(async (conn) => {
			const result = await conn.execute<ChatSessionRow>(
				'SELECT * FROM chat_sessions WHERE id = :id',
				{ id }
			);

			if (!result.rows || result.rows.length === 0) return null;
			return rowToSession(result.rows[0]);
		});
	},

	async list(options?: ListSessionsOptions): Promise<ChatSession[]> {
		return withConnection(async (conn) => {
			const conditions: string[] = [];
			const binds: Record<string, unknown> = {};

			if (options?.status) {
				conditions.push('status = :status');
				binds.status = options.status;
			}
			if (options?.userId) {
				conditions.push('user_id = :userId');
				binds.userId = options.userId;
			}
			if (options?.orgId) {
				conditions.push('org_id = :orgId');
				binds.orgId = options.orgId;
			}

			const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
			const limit = options?.limit ?? 50;
			const offset = options?.offset ?? 0;

			const result = await conn.execute<ChatSessionRow>(
				`SELECT * FROM chat_sessions ${where}
				 ORDER BY updated_at DESC
				 OFFSET :offset ROWS FETCH FIRST :maxRows ROWS ONLY`,
				{ ...binds, offset, maxRows: limit }
			);

			if (!result.rows) return [];
			return result.rows.map(rowToSession);
		});
	},

	async update(id: string, input: UpdateSessionInput): Promise<ChatSession | null> {
		return withConnection(async (conn) => {
			const sets: string[] = ['updated_at = SYSTIMESTAMP'];
			const binds: Record<string, unknown> = { id };

			if (input.title !== undefined) {
				sets.push('title = :title');
				binds.title = input.title;
			}
			if (input.status !== undefined) {
				sets.push('status = :status');
				binds.status = input.status;
			}
			if (input.config !== undefined) {
				sets.push('config = :config');
				binds.config = JSON.stringify(input.config);
			}

			await conn.execute(`UPDATE chat_sessions SET ${sets.join(', ')} WHERE id = :id`, binds);

			return this.getById(id);
		});
	},

	async getMostRecent(userId?: string): Promise<ChatSession | null> {
		return withConnection(async (conn) => {
			const where = userId ? 'WHERE user_id = :userId' : '';
			const binds = userId ? { userId } : {};

			const result = await conn.execute<ChatSessionRow>(
				`SELECT * FROM chat_sessions ${where}
				 ORDER BY updated_at DESC
				 FETCH FIRST 1 ROWS ONLY`,
				binds
			);

			if (!result.rows || result.rows.length === 0) return null;
			return rowToSession(result.rows[0]);
		});
	}
};

// Standalone functions (cannot use `this` inside object literal for new methods easily,
// so we attach them to the exported object below).

/** Enriched row shape with JOIN data from chat_turns. */
interface EnrichedSessionRow extends ChatSessionRow {
	MESSAGE_COUNT: number;
	LAST_MESSAGE: string | null;
}

function rowToEnrichedSession(row: EnrichedSessionRow): EnrichedSession {
	const session = rowToSession(row as ChatSessionRow);
	return {
		...session,
		messageCount: row.MESSAGE_COUNT ?? 0,
		lastMessage: row.LAST_MESSAGE ?? null
	};
}

/**
 * List sessions with message_count and last_message from chat_turns.
 */
export async function listSessionsEnriched(
	options?: ListSessionsOptions
): Promise<{ sessions: EnrichedSession[]; total: number }> {
	return withConnection(async (conn) => {
		const conditions: string[] = [];
		const binds: Record<string, unknown> = {};

		if (options?.status) {
			conditions.push('s.status = :status');
			binds.status = options.status;
		}
		if (options?.userId) {
			conditions.push('s.user_id = :userId');
			binds.userId = options.userId;
		}
		if (options?.orgId) {
			conditions.push('s.org_id = :orgId');
			binds.orgId = options.orgId;
		}
		if (options?.search) {
			conditions.push("LOWER(s.title) LIKE LOWER(:search) ESCAPE '\\'");
			binds.search = `%${options.search.replace(/[%_\\]/g, '\\$&')}%`;
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = options?.limit ?? 50;
		const offset = options?.offset ?? 0;

		// Count total matching sessions
		const countResult = await conn.execute<{ CNT: number }>(
			`SELECT COUNT(*) AS "CNT" FROM chat_sessions s ${where}`,
			binds
		);
		const total = countResult.rows?.[0]?.CNT ?? 0;

		// Fetch enriched sessions with message count and last message
		const result = await conn.execute<EnrichedSessionRow>(
			`SELECT s.*,
			        NVL(t.msg_count, 0) AS "MESSAGE_COUNT",
			        t.last_msg AS "LAST_MESSAGE"
			   FROM chat_sessions s
			   LEFT JOIN (
			     SELECT session_id,
			            COUNT(*) AS msg_count,
			            MAX(user_message) KEEP (DENSE_RANK LAST ORDER BY turn_number) AS last_msg
			       FROM chat_turns
			      GROUP BY session_id
			   ) t ON t.session_id = s.id
			   ${where}
			   ORDER BY s.updated_at DESC
			   OFFSET :offset ROWS FETCH NEXT :maxRows ROWS ONLY`,
			{ ...binds, offset, maxRows: limit }
		);

		const sessions = (result.rows ?? []).map(rowToEnrichedSession);
		return { sessions, total };
	});
}

/**
 * Delete a session by ID, but only if it belongs to the specified user.
 * Returns true if a row was deleted, false otherwise.
 */
export async function deleteSession(id: string, userId: string): Promise<boolean> {
	return withConnection(async (conn) => {
		const result = await conn.execute(
			`DELETE FROM chat_sessions WHERE id = :id AND user_id = :userId`,
			{ id, userId }
		);
		return (result as { rowsAffected?: number }).rowsAffected === 1;
	});
}
