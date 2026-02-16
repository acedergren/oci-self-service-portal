/**
 * Oracle-backed agent state repository.
 *
 * Implements the same interface as StateRepository but with async methods
 * and multi-tenant support via org_id/thread_id columns.
 *
 * Key differences from SQLite version:
 * - All methods are async (return Promise<T>)
 * - Extended CreateSessionInput with orgId/threadId fields
 * - UPPERCASE Oracle row keys → camelCase domain types
 * - Oracle Date → .getTime() for epoch ms timestamps
 * - Named bind parameters (:paramName) instead of positional (?)
 * - FETCH FIRST N ROWS ONLY instead of LIMIT
 */

import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
	type Session,
	SessionSchema,
	SessionConfigSchema,
	type Turn,
	TurnSchema,
	MessageSchema,
	ToolCallSchema,
	type CreateSessionInput,
	type UpdateSessionInput,
	type AddTurnInput,
	type UpdateTurnInput,
	type ListSessionsOptions
} from './types';
import { withConnection } from '../oracle/connection';
import { DatabaseError } from '../errors';
import { createLogger } from '../logger';

const logger = createLogger('oracle-agent-state');

// ============================================================================
// Oracle Row Types (UPPERCASE database representation)
// ============================================================================

/** Raw session row from Oracle */
interface OracleSessionRow {
	ID: string;
	ORG_ID: string | null;
	THREAD_ID: string | null;
	CREATED_AT: Date;
	UPDATED_AT: Date;
	TITLE: string | null;
	MODEL: string;
	REGION: string;
	STATUS: string;
	CONFIG: string | null;
}

/** Raw turn row from Oracle */
interface OracleTurnRow {
	ID: string;
	SESSION_ID: string;
	TURN_NUMBER: number;
	CREATED_AT: Date;
	USER_MESSAGE: string;
	ASSISTANT_RESPONSE: string | null;
	TOOL_CALLS: string | null;
	TOKENS_USED: number | null;
	COST_USD: number | null;
	ERROR: string | null;
}

// ============================================================================
// JSON Parse Helpers (with Zod validation)
// ============================================================================

/**
 * Parse JSON string with Zod schema validation.
 * Provides runtime type safety instead of unsafe type assertions.
 */
function parseJson<T>(json: string, schema: z.ZodSchema<T>): T {
	return schema.parse(JSON.parse(json));
}

/**
 * Parse optional JSON string with Zod schema validation.
 * Returns undefined if json is null/undefined.
 */
function parseJsonOrUndefined<T>(json: string | null, schema: z.ZodSchema<T>): T | undefined {
	if (!json) return undefined;
	return schema.parse(JSON.parse(json));
}

/**
 * Parse JSON string with Zod schema validation, returning default value if null.
 * Useful for arrays that should default to empty rather than undefined.
 */
function parseJsonOrDefault<T>(json: string | null, schema: z.ZodSchema<T>, defaultValue: T): T {
	if (!json) return defaultValue;
	return schema.parse(JSON.parse(json));
}

// ============================================================================
// Generic Update Builder (Oracle version with named bind params)
// ============================================================================

interface UpdateField<T> {
	column: string;
	value: T | undefined;
	serialize?: (v: T) => string | number | null;
}

/**
 * Build SQL UPDATE clause from a list of optional fields.
 * Returns null if no fields need updating.
 * Uses Oracle named bind parameters (:paramName).
 */
function buildOracleUpdateQuery(
	table: string,
	id: string,
	fields: UpdateField<unknown>[],
	baseUpdates: { column: string; paramName: string; value: string | number | Date }[] = []
): { sql: string; binds: Record<string, string | number | Date | null> } | null {
	const updates: string[] = baseUpdates.map((u) => `${u.column} = :${u.paramName}`);
	const binds: Record<string, string | number | Date | null> = {};

	// Add base updates to binds
	for (const base of baseUpdates) {
		binds[base.paramName] = base.value;
	}

	// Add field updates
	for (const field of fields) {
		if (field.value !== undefined) {
			// Convert column name to camelCase for bind parameter name
			const paramName = field.column.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
			updates.push(`${field.column} = :${paramName}`);
			const serialized = field.serialize ? field.serialize(field.value as never) : field.value;
			binds[paramName] = serialized as string | number | null;
		}
	}

	if (updates.length === 0) return null;

	binds.id = id;
	return {
		sql: `UPDATE ${table} SET ${updates.join(', ')} WHERE id = :id`,
		binds
	};
}

// ============================================================================
// Extended Input Types (Oracle-specific with org/thread support)
// ============================================================================

/** Oracle CreateSessionInput: extends base with orgId/threadId for multi-tenancy */
export interface OracleCreateSessionInput extends CreateSessionInput {
	orgId?: string;
	threadId?: string;
}

/** Oracle ListSessionsOptions: extends base with orgId for multi-tenancy filtering */
export interface OracleListSessionsOptions extends ListSessionsOptions {
	orgId?: string;
}

export class OracleAgentStateRepository {
	// ============================================================================
	// Private Row Mapping Helpers
	// ============================================================================

	/**
	 * Map an Oracle UPPERCASE row to a validated Session domain object.
	 * Uses Zod schema for runtime validation of parsed JSON.
	 * Converts Oracle Date to epoch ms timestamps.
	 */
	private mapRowToSession(row: OracleSessionRow): Session {
		return SessionSchema.parse({
			id: row.ID,
			createdAt: row.CREATED_AT.getTime(),
			updatedAt: row.UPDATED_AT.getTime(),
			title: row.TITLE ?? undefined,
			model: row.MODEL,
			region: row.REGION,
			status: row.STATUS,
			config: parseJsonOrUndefined(row.CONFIG, SessionConfigSchema)
		});
	}

	/**
	 * Map an Oracle UPPERCASE row to a validated Turn domain object.
	 * Uses Zod schema for runtime validation of parsed JSON.
	 * Converts Oracle Date to epoch ms timestamps.
	 */
	private mapRowToTurn(row: OracleTurnRow): Turn {
		return TurnSchema.parse({
			id: row.ID,
			sessionId: row.SESSION_ID,
			turnNumber: row.TURN_NUMBER,
			createdAt: row.CREATED_AT.getTime(),
			userMessage: parseJson(row.USER_MESSAGE, MessageSchema),
			assistantResponse: parseJsonOrUndefined(row.ASSISTANT_RESPONSE, MessageSchema),
			toolCalls: parseJsonOrDefault(row.TOOL_CALLS, z.array(ToolCallSchema), []),
			tokensUsed: row.TOKENS_USED ?? undefined,
			costUsd: row.COST_USD ?? undefined,
			error: row.ERROR
		});
	}

	// ============================================================================
	// Session Methods
	// ============================================================================

	async createSession(input: OracleCreateSessionInput): Promise<Session> {
		try {
			const now = new Date();
			const id = input.id ?? uuidv4();

			await withConnection(async (conn) => {
				await conn.execute(
					`INSERT INTO agent_sessions (id, org_id, thread_id, created_at, updated_at, title, model, region, status, config)
           VALUES (:id, :orgId, :threadId, :createdAt, :updatedAt, :title, :model, :region, :status, :config)`,
					{
						id,
						orgId: input.orgId ?? null,
						threadId: input.threadId ?? null,
						createdAt: now,
						updatedAt: now,
						title: input.title ?? null,
						model: input.model,
						region: input.region,
						status: input.status ?? 'active',
						config: input.config ? JSON.stringify(input.config) : null
					}
				);
				await conn.commit();
			});

			const session = await this.getSession(id);
			if (!session) {
				throw new DatabaseError('Failed to retrieve created session', {
					code: 'CREATE_SESSION_FAILED'
				});
			}

			return session;
		} catch (error) {
			logger.error({ error, input }, 'Failed to create session');
			if (error instanceof DatabaseError) throw error;
			throw new DatabaseError(
				error instanceof Error ? error.message : 'Unknown error',
				{ code: 'CREATE_SESSION_FAILED' },
				error instanceof Error ? error : undefined
			);
		}
	}

	async getSession(id: string): Promise<Session | null> {
		try {
			return await withConnection(async (conn) => {
				const result = await conn.execute<OracleSessionRow>(
					'SELECT id, org_id, thread_id, created_at, updated_at, title, model, region, status, config FROM agent_sessions WHERE id = :id',
					{ id }
				);

				const row = result.rows?.[0];
				return row ? this.mapRowToSession(row) : null;
			});
		} catch (error) {
			logger.error({ error, id }, 'Failed to get session');
			throw new DatabaseError(
				error instanceof Error ? error.message : 'Unknown error',
				{ code: 'GET_SESSION_FAILED' },
				error instanceof Error ? error : undefined
			);
		}
	}

	async listSessions(options: OracleListSessionsOptions = {}): Promise<Session[]> {
		try {
			const limit = options.limit ?? 50;
			const conditions: string[] = [];
			const binds: Record<string, string | number> = { limit };

			if (options.status) {
				conditions.push('status = :status');
				binds.status = options.status;
			}

			if (options.orgId) {
				conditions.push('org_id = :orgId');
				binds.orgId = options.orgId;
			}

			const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

			return await withConnection(async (conn) => {
				const result = await conn.execute<OracleSessionRow>(
					`SELECT id, org_id, thread_id, created_at, updated_at, title, model, region, status, config
           FROM agent_sessions ${whereClause}
           ORDER BY updated_at DESC
           FETCH FIRST :limit ROWS ONLY`,
					binds
				);

				return (result.rows ?? []).map((row) => this.mapRowToSession(row));
			});
		} catch (error) {
			logger.error({ error, options }, 'Failed to list sessions');
			throw new DatabaseError(
				error instanceof Error ? error.message : 'Unknown error',
				{ code: 'LIST_SESSIONS_FAILED' },
				error instanceof Error ? error : undefined
			);
		}
	}

	async updateSession(id: string, input: UpdateSessionInput): Promise<Session | null> {
		try {
			const query = buildOracleUpdateQuery(
				'agent_sessions',
				id,
				[
					{ column: 'title', value: input.title },
					{ column: 'status', value: input.status },
					{
						column: 'config',
						value: input.config,
						serialize: (v): string => JSON.stringify(v)
					}
				],
				[{ column: 'updated_at', paramName: 'updatedAt', value: new Date() }]
			);

			if (query) {
				await withConnection(async (conn) => {
					await conn.execute(query.sql, query.binds);
					await conn.commit();
				});
			}

			return await this.getSession(id);
		} catch (error) {
			logger.error({ error, id, input }, 'Failed to update session');
			throw new DatabaseError(
				error instanceof Error ? error.message : 'Unknown error',
				{ code: 'UPDATE_SESSION_FAILED' },
				error instanceof Error ? error : undefined
			);
		}
	}

	// ============================================================================
	// Turn Methods
	// ============================================================================

	async addTurn(sessionId: string, input: AddTurnInput): Promise<Turn> {
		try {
			const id = `turn_${uuidv4().slice(0, 8)}`;
			const now = new Date();

			await withConnection(async (conn) => {
				// Insert turn
				await conn.execute(
					`INSERT INTO agent_turns (id, session_id, turn_number, created_at, user_message, tool_calls, error)
           VALUES (:id, :sessionId, :turnNumber, :createdAt, :userMessage, :toolCalls, :error)`,
					{
						id,
						sessionId,
						turnNumber: input.turnNumber,
						createdAt: now,
						userMessage: JSON.stringify(input.userMessage),
						toolCalls: '[]',
						error: null
					}
				);

				// Update parent session timestamp
				await conn.execute(
					'UPDATE agent_sessions SET updated_at = :updatedAt WHERE id = :sessionId',
					{ updatedAt: now, sessionId }
				);

				await conn.commit();
			});

			const turn = await this.getTurn(id);
			if (!turn) {
				throw new DatabaseError('Failed to retrieve created turn', { code: 'ADD_TURN_FAILED' });
			}

			return turn;
		} catch (error) {
			logger.error({ error, sessionId, input }, 'Failed to add turn');
			if (error instanceof DatabaseError) throw error;
			throw new DatabaseError(
				error instanceof Error ? error.message : 'Unknown error',
				{ code: 'ADD_TURN_FAILED' },
				error instanceof Error ? error : undefined
			);
		}
	}

	async getTurn(id: string): Promise<Turn | null> {
		try {
			return await withConnection(async (conn) => {
				const result = await conn.execute<OracleTurnRow>(
					`SELECT id, session_id, turn_number, created_at, user_message, assistant_response, tool_calls, tokens_used, cost_usd, error
           FROM agent_turns WHERE id = :id`,
					{ id }
				);

				const row = result.rows?.[0];
				return row ? this.mapRowToTurn(row) : null;
			});
		} catch (error) {
			logger.error({ error, id }, 'Failed to get turn');
			throw new DatabaseError(
				error instanceof Error ? error.message : 'Unknown error',
				{ code: 'GET_TURN_FAILED' },
				error instanceof Error ? error : undefined
			);
		}
	}

	async updateTurn(id: string, input: UpdateTurnInput): Promise<Turn | null> {
		try {
			const query = buildOracleUpdateQuery('agent_turns', id, [
				{
					column: 'assistant_response',
					value: input.assistantResponse,
					serialize: (v): string => JSON.stringify(v)
				},
				{
					column: 'tool_calls',
					value: input.toolCalls,
					serialize: (v): string => JSON.stringify(v)
				},
				{ column: 'tokens_used', value: input.tokensUsed },
				{ column: 'cost_usd', value: input.costUsd },
				{ column: 'error', value: input.error }
			]);

			if (query) {
				await withConnection(async (conn) => {
					await conn.execute(query.sql, query.binds);
					await conn.commit();
				});
			}

			return await this.getTurn(id);
		} catch (error) {
			logger.error({ error, id, input }, 'Failed to update turn');
			throw new DatabaseError(
				error instanceof Error ? error.message : 'Unknown error',
				{ code: 'UPDATE_TURN_FAILED' },
				error instanceof Error ? error : undefined
			);
		}
	}

	async getSessionTurns(sessionId: string): Promise<Turn[]> {
		try {
			return await withConnection(async (conn) => {
				const result = await conn.execute<OracleTurnRow>(
					`SELECT id, session_id, turn_number, created_at, user_message, assistant_response, tool_calls, tokens_used, cost_usd, error
           FROM agent_turns
           WHERE session_id = :sessionId
           ORDER BY turn_number ASC`,
					{ sessionId }
				);

				return (result.rows ?? []).map((row) => this.mapRowToTurn(row));
			});
		} catch (error) {
			logger.error({ error, sessionId }, 'Failed to get session turns');
			throw new DatabaseError(
				error instanceof Error ? error.message : 'Unknown error',
				{ code: 'GET_SESSION_TURNS_FAILED' },
				error instanceof Error ? error : undefined
			);
		}
	}

	// ============================================================================
	// Session Resume Methods
	// ============================================================================

	/**
	 * Get the most recent active session for a given org.
	 * Used for `--continue` flag functionality.
	 */
	async getMostRecentSession(orgId?: string): Promise<Session | null> {
		try {
			return await withConnection(async (conn) => {
				const conditions = ["status = 'active'"];
				const binds: Record<string, string> = {};

				if (orgId) {
					conditions.push('org_id = :orgId');
					binds.orgId = orgId;
				}

				const whereClause = `WHERE ${conditions.join(' AND ')}`;

				const result = await conn.execute<OracleSessionRow>(
					`SELECT id, org_id, thread_id, created_at, updated_at, title, model, region, status, config
           FROM agent_sessions ${whereClause}
           ORDER BY updated_at DESC
           FETCH FIRST 1 ROWS ONLY`,
					binds
				);

				const row = result.rows?.[0];
				return row ? this.mapRowToSession(row) : null;
			});
		} catch (error) {
			logger.error({ error, orgId }, 'Failed to get most recent session');
			throw new DatabaseError(
				error instanceof Error ? error.message : 'Unknown error',
				{ code: 'GET_MOST_RECENT_SESSION_FAILED' },
				error instanceof Error ? error : undefined
			);
		}
	}

	/**
	 * Restore a complete session with all its turns.
	 * Returns session + turns for full context restoration.
	 */
	async restoreSession(id: string): Promise<{ session: Session; turns: Turn[] } | null> {
		try {
			const session = await this.getSession(id);
			if (!session) return null;

			const turns = await this.getSessionTurns(id);
			return { session, turns };
		} catch (error) {
			logger.error({ error, id }, 'Failed to restore session');
			throw new DatabaseError(
				error instanceof Error ? error.message : 'Unknown error',
				{ code: 'RESTORE_SESSION_FAILED' },
				error instanceof Error ? error : undefined
			);
		}
	}
}
