/**
 * Oracle ADB 26AI storage adapter for Mastra.
 *
 * Implements all 3 required Mastra storage domains (Memory, Workflows, Scores)
 * backed by Oracle Autonomous Database tables created in migration 010.
 *
 * Phase 9.4 implements WorkflowsOracle fully.
 * Phase 9.6 implements MemoryOracle. Phase 9.7 implements ScoresOracle.
 */

import {
	MastraCompositeStore,
	type MastraCompositeStoreConfig,
	type WorkflowRun,
	type WorkflowRuns,
	type StorageListWorkflowRunsInput,
	type UpdateWorkflowStateOptions,
	normalizePerPage,
	calculatePagination
} from '@mastra/core/storage';
import { WorkflowsStorage } from '@mastra/core/storage';
import { MemoryStorage } from '@mastra/core/storage';
import { ScoresStorage } from '@mastra/core/storage';
import type { WorkflowRunState, StepResult } from '@mastra/core/workflows';
import type {
	ScoreRowData,
	SaveScorePayload,
	ListScoresResponse,
	ScoringSource
} from '@mastra/core/evals';
import type { StoragePagination } from '@mastra/core/storage';
import type { OracleConnection } from '@portal/shared/server/oracle/connection';

// ── Helpers ───────────────────────────────────────────────────────────────

type WithConnectionFn = <T>(fn: (conn: OracleConnection) => Promise<T>) => Promise<T>;

/** Convert Oracle UPPERCASE row keys to camelCase object. */
function _fromOracleRow<T>(row: Record<string, unknown>): T {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(row)) {
		const camel = key.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
		result[camel] = value;
	}
	return result as T;
}

/** Parse a CLOB/string JSON field, returning null on failure. */
function parseJSON<T>(value: unknown): T | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'object') return value as T;
	if (typeof value === 'string') {
		try {
			return JSON.parse(value) as T;
		} catch {
			return null;
		}
	}
	return null;
}

/** Convert Oracle TIMESTAMP to JS Date. */
function toDate(value: unknown): Date {
	if (value instanceof Date) return value;
	if (typeof value === 'string') return new Date(value);
	return new Date();
}

// ── WorkflowsOracle ──────────────────────────────────────────────────────

interface OracleWorkflowRow {
	WORKFLOW_NAME: string;
	RUN_ID: string;
	RESOURCE_ID: string | null;
	SNAPSHOT: string;
	CREATED_AT: Date | string;
	UPDATED_AT: Date | string;
}

/** Mastra workflow storage backed by Oracle ADB 26AI `mastra_workflow_snapshots` table. */
export class WorkflowsOracle extends WorkflowsStorage {
	private withConnection: WithConnectionFn;

	constructor(withConnection: WithConnectionFn) {
		super();
		this.withConnection = withConnection;
	}

	async dangerouslyClearAll(): Promise<void> {
		await this.withConnection(async (conn) => {
			await conn.execute('DELETE FROM mastra_workflow_snapshots');
			await conn.commit();
		});
	}

	async persistWorkflowSnapshot(args: {
		workflowName: string;
		runId: string;
		resourceId?: string;
		snapshot: WorkflowRunState;
		createdAt?: Date;
		updatedAt?: Date;
	}): Promise<void> {
		const now = new Date();
		await this.withConnection(async (conn) => {
			await conn.execute(
				`MERGE INTO mastra_workflow_snapshots t
         USING (SELECT :workflowName AS workflow_name, :runId AS run_id FROM DUAL) s
         ON (t.workflow_name = s.workflow_name AND t.run_id = s.run_id)
         WHEN MATCHED THEN UPDATE SET
           t.snapshot = :snapshot,
           t.resource_id = :resourceId,
           t.updated_at = :updatedAt
         WHEN NOT MATCHED THEN INSERT (workflow_name, run_id, resource_id, snapshot, created_at, updated_at)
         VALUES (:workflowName, :runId, :resourceId, :snapshot, :createdAt, :updatedAt)`,
				{
					workflowName: args.workflowName,
					runId: args.runId,
					resourceId: args.resourceId ?? null,
					snapshot: JSON.stringify(args.snapshot),
					createdAt: args.createdAt ?? now,
					updatedAt: args.updatedAt ?? now
				}
			);
			await conn.commit();
		});
	}

	async loadWorkflowSnapshot(args: {
		workflowName: string;
		runId: string;
	}): Promise<WorkflowRunState | null> {
		return this.withConnection(async (conn) => {
			const result = await conn.execute<OracleWorkflowRow>(
				`SELECT snapshot FROM mastra_workflow_snapshots
         WHERE workflow_name = :workflowName AND run_id = :runId`,
				{ workflowName: args.workflowName, runId: args.runId }
			);
			const row = result.rows?.[0];
			if (!row) return null;
			return parseJSON<WorkflowRunState>(row.SNAPSHOT);
		});
	}

	async getWorkflowRunById(args: {
		runId: string;
		workflowName?: string;
	}): Promise<WorkflowRun | null> {
		return this.withConnection(async (conn) => {
			let sql = `SELECT workflow_name, run_id, resource_id, snapshot, created_at, updated_at
                 FROM mastra_workflow_snapshots WHERE run_id = :runId`;
			const binds: Record<string, unknown> = { runId: args.runId };

			if (args.workflowName) {
				sql += ' AND workflow_name = :workflowName';
				binds.workflowName = args.workflowName;
			}

			const result = await conn.execute<OracleWorkflowRow>(sql, binds);
			const row = result.rows?.[0];
			if (!row) return null;
			return this.rowToWorkflowRun(row);
		});
	}

	async listWorkflowRuns(args?: StorageListWorkflowRunsInput): Promise<WorkflowRuns> {
		return this.withConnection(async (conn) => {
			const conditions: string[] = [];
			const binds: Record<string, unknown> = {};

			if (args?.workflowName) {
				conditions.push('workflow_name = :workflowName');
				binds.workflowName = args.workflowName;
			}
			if (args?.resourceId) {
				conditions.push('resource_id = :resourceId');
				binds.resourceId = args.resourceId;
			}
			if (args?.fromDate) {
				conditions.push('created_at >= :fromDate');
				binds.fromDate = args.fromDate;
			}
			if (args?.toDate) {
				conditions.push('created_at <= :toDate');
				binds.toDate = args.toDate;
			}
			// Status filter requires parsing snapshot JSON — use JSON_VALUE
			if (args?.status) {
				conditions.push("JSON_VALUE(snapshot, '$.status') = :status");
				binds.status = args.status;
			}

			const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

			// Count total
			const countResult = await conn.execute<{ CNT: number }>(
				`SELECT COUNT(*) AS CNT FROM mastra_workflow_snapshots ${where}`,
				binds
			);
			const total = countResult.rows?.[0]?.CNT ?? 0;

			// Paginated query
			let dataSql = `SELECT workflow_name, run_id, resource_id, snapshot, created_at, updated_at
                     FROM mastra_workflow_snapshots ${where}
                     ORDER BY created_at DESC`;

			if (args?.perPage !== undefined && args?.page !== undefined) {
				const normalizedPerPage = normalizePerPage(args.perPage, 100);
				const { offset } = calculatePagination(args.page, args.perPage, normalizedPerPage);
				dataSql += ` OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`;
				binds.offset = offset;
				binds.limit = normalizedPerPage;
			}

			const result = await conn.execute<OracleWorkflowRow>(dataSql, binds);
			const runs = (result.rows ?? []).map((row) => this.rowToWorkflowRun(row));

			return { runs, total };
		});
	}

	async deleteWorkflowRunById(args: { runId: string; workflowName: string }): Promise<void> {
		await this.withConnection(async (conn) => {
			await conn.execute(
				`DELETE FROM mastra_workflow_snapshots
         WHERE workflow_name = :workflowName AND run_id = :runId`,
				{ workflowName: args.workflowName, runId: args.runId }
			);
			await conn.commit();
		});
	}

	async updateWorkflowResults(args: {
		workflowName: string;
		runId: string;
		stepId: string;
		result: StepResult<unknown, unknown, unknown, unknown>;
		requestContext: Record<string, unknown>;
	}): Promise<Record<string, StepResult<unknown, unknown, unknown, unknown>>> {
		return this.withConnection(async (conn) => {
			// Load current snapshot
			const snapshot = await this.loadWorkflowSnapshot({
				workflowName: args.workflowName,
				runId: args.runId
			});

			if (!snapshot) {
				throw new Error(`Workflow snapshot not found: ${args.workflowName}/${args.runId}`);
			}

			// Merge step result into context
			snapshot.context = snapshot.context ?? {};
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(snapshot.context as Record<string, any>)[args.stepId] = args.result;

			// Update requestContext
			snapshot.requestContext = {
				...snapshot.requestContext,
				...args.requestContext
			};

			// Persist
			await conn.execute(
				`UPDATE mastra_workflow_snapshots
         SET snapshot = :snapshot, updated_at = :updatedAt
         WHERE workflow_name = :workflowName AND run_id = :runId`,
				{
					snapshot: JSON.stringify(snapshot),
					updatedAt: new Date(),
					workflowName: args.workflowName,
					runId: args.runId
				}
			);
			await conn.commit();

			return snapshot.context as Record<string, StepResult<unknown, unknown, unknown, unknown>>;
		});
	}

	async updateWorkflowState(args: {
		workflowName: string;
		runId: string;
		opts: UpdateWorkflowStateOptions;
	}): Promise<WorkflowRunState | undefined> {
		return this.withConnection(async (conn) => {
			const snapshot = await this.loadWorkflowSnapshot({
				workflowName: args.workflowName,
				runId: args.runId
			});

			if (!snapshot) return undefined;

			// Apply state updates
			snapshot.status = args.opts.status;
			if (args.opts.error !== undefined) snapshot.error = args.opts.error;
			if (args.opts.result !== undefined) {
				snapshot.result = snapshot.result ?? {};
				Object.assign(snapshot.result, args.opts.result);
			}
			if (args.opts.suspendedPaths !== undefined)
				snapshot.suspendedPaths = args.opts.suspendedPaths;
			if (args.opts.waitingPaths !== undefined) snapshot.waitingPaths = args.opts.waitingPaths;
			if (args.opts.resumeLabels !== undefined) snapshot.resumeLabels = args.opts.resumeLabels;
			snapshot.timestamp = Date.now();

			await conn.execute(
				`UPDATE mastra_workflow_snapshots
         SET snapshot = :snapshot, updated_at = :updatedAt
         WHERE workflow_name = :workflowName AND run_id = :runId`,
				{
					snapshot: JSON.stringify(snapshot),
					updatedAt: new Date(),
					workflowName: args.workflowName,
					runId: args.runId
				}
			);
			await conn.commit();

			return snapshot;
		});
	}

	private rowToWorkflowRun(row: OracleWorkflowRow): WorkflowRun {
		return {
			workflowName: row.WORKFLOW_NAME,
			runId: row.RUN_ID,
			resourceId: row.RESOURCE_ID ?? undefined,
			snapshot: parseJSON<WorkflowRunState>(row.SNAPSHOT) ?? row.SNAPSHOT,
			createdAt: toDate(row.CREATED_AT),
			updatedAt: toDate(row.UPDATED_AT)
		};
	}
}

// ── MemoryOracle ─────────────────────────────────────────────────────────

import type {
	StorageListThreadsInput,
	StorageListThreadsOutput,
	StorageListMessagesInput,
	StorageListMessagesOutput,
	StorageListMessagesByResourceIdInput,
	StorageResourceType
} from '@mastra/core/storage';
import type { StorageThreadType } from '@mastra/core/memory';
import type { MastraDBMessage, MastraMessageContentV2 } from '@mastra/core/agent';

interface OracleThreadRow {
	ID: string;
	RESOURCE_ID: string;
	TITLE: string | null;
	METADATA: string | null;
	CREATED_AT: Date | string;
	UPDATED_AT: Date | string;
}

interface OracleMessageRow {
	ID: string;
	THREAD_ID: string;
	ROLE: string;
	TYPE: string | null;
	CONTENT: string;
	RESOURCE_ID: string | null;
	CREATED_AT: Date | string;
}

interface OracleResourceRow {
	ID: string;
	WORKING_MEMORY: string | null;
	METADATA: string | null;
	CREATED_AT: Date | string;
	UPDATED_AT: Date | string;
}

/** Mastra memory storage (threads, messages, resources) backed by Oracle ADB 26AI. */
export class MemoryOracle extends MemoryStorage {
	private withConnection: WithConnectionFn;

	constructor(withConnection: WithConnectionFn) {
		super();
		this.withConnection = withConnection;
	}

	async dangerouslyClearAll(): Promise<void> {
		await this.withConnection(async (conn) => {
			await conn.execute('DELETE FROM mastra_messages');
			await conn.execute('DELETE FROM mastra_threads');
			await conn.execute('DELETE FROM mastra_resources');
			await conn.commit();
		});
	}

	// ── Thread Methods ────────────────────────────────────────────────────

	async getThreadById(args: { threadId: string }): Promise<StorageThreadType | null> {
		return this.withConnection(async (conn) => {
			const result = await conn.execute<OracleThreadRow>(
				`SELECT id, resource_id, title, metadata, created_at, updated_at
         FROM mastra_threads WHERE id = :threadId`,
				{ threadId: args.threadId }
			);
			const row = result.rows?.[0];
			if (!row) return null;
			return this.rowToThread(row);
		});
	}

	async saveThread(args: { thread: StorageThreadType }): Promise<StorageThreadType> {
		return this.withConnection(async (conn) => {
			const now = new Date();
			await conn.execute(
				`INSERT INTO mastra_threads (id, resource_id, title, metadata, created_at, updated_at)
         VALUES (:id, :resourceId, :title, :metadata, :createdAt, :updatedAt)`,
				{
					id: args.thread.id,
					resourceId: args.thread.resourceId ?? null,
					title: args.thread.title ?? null,
					metadata: args.thread.metadata ? JSON.stringify(args.thread.metadata) : null,
					createdAt: args.thread.createdAt ?? now,
					updatedAt: args.thread.updatedAt ?? now
				}
			);
			await conn.commit();
			return args.thread;
		});
	}

	async updateThread(args: {
		id: string;
		title: string;
		metadata: Record<string, unknown>;
	}): Promise<StorageThreadType> {
		return this.withConnection(async (conn) => {
			const now = new Date();
			await conn.execute(
				`UPDATE mastra_threads
         SET title = :title, metadata = :metadata, updated_at = :updatedAt
         WHERE id = :id`,
				{
					id: args.id,
					title: args.title,
					metadata: JSON.stringify(args.metadata),
					updatedAt: now
				}
			);
			await conn.commit();

			// Return updated thread
			const result = await conn.execute<OracleThreadRow>(
				`SELECT id, resource_id, title, metadata, created_at, updated_at
         FROM mastra_threads WHERE id = :id`,
				{ id: args.id }
			);
			const row = result.rows?.[0];
			if (!row) {
				throw new Error(`Thread not found after update: ${args.id}`);
			}
			return this.rowToThread(row);
		});
	}

	async deleteThread(args: { threadId: string }): Promise<void> {
		await this.withConnection(async (conn) => {
			await conn.execute(`DELETE FROM mastra_threads WHERE id = :threadId`, {
				threadId: args.threadId
			});
			await conn.commit();
		});
	}

	async listThreads(args: StorageListThreadsInput): Promise<StorageListThreadsOutput> {
		return this.withConnection(async (conn) => {
			const conditions: string[] = [];
			const binds: Record<string, unknown> = {};

			// Filter by resourceId
			if (args.filter?.resourceId) {
				conditions.push('resource_id = :resourceId');
				binds.resourceId = args.filter.resourceId;
			}

			// Filter by metadata (JSON exact match on each key)
			if (args.filter?.metadata) {
				Object.entries(args.filter.metadata).forEach(([key, value], i) => {
					// Validate key to prevent JSON path injection (S-3)
					if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
						throw new Error(`Invalid metadata key: ${key}`);
					}
					conditions.push(`JSON_VALUE(metadata, '$.${key}') = :metaValue${i}`);
					binds[`metaValue${i}`] = JSON.stringify(value);
				});
			}

			const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

			// Count total
			const countResult = await conn.execute<{ CNT: number }>(
				`SELECT COUNT(*) AS CNT FROM mastra_threads ${where}`,
				binds
			);
			const total = countResult.rows?.[0]?.CNT ?? 0;

			// Ordering
			const { field, direction } = this.parseOrderBy(args.orderBy, 'DESC' as const);
			const orderByClause = `ORDER BY ${field === 'createdAt' ? 'created_at' : 'updated_at'} ${direction}`;

			// Paginated query
			let dataSql = `SELECT id, resource_id, title, metadata, created_at, updated_at
                     FROM mastra_threads ${where} ${orderByClause}`;

			const rawPerPage = args.perPage === false ? false : (args.perPage ?? 100);
			const page = args.page ?? 0;
			let effectivePerPage = rawPerPage;

			if (rawPerPage !== false) {
				const normalizedPerPage = normalizePerPage(rawPerPage, 100);
				effectivePerPage = normalizedPerPage;
				const { offset } = calculatePagination(page, rawPerPage, normalizedPerPage);
				dataSql += ` OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`;
				binds.offset = offset;
				binds.limit = normalizedPerPage;
			}

			const result = await conn.execute<OracleThreadRow>(dataSql, binds);
			const threads = (result.rows ?? []).map((row) => this.rowToThread(row));

			return {
				threads,
				total,
				page,
				perPage: effectivePerPage,
				hasMore:
					effectivePerPage === false ? false : page * effectivePerPage + threads.length < total
			};
		});
	}

	// ── Message Methods ───────────────────────────────────────────────────

	async listMessages(args: StorageListMessagesInput): Promise<StorageListMessagesOutput> {
		return this.withConnection(async (conn) => {
			const conditions: string[] = [];
			const binds: Record<string, unknown> = {};

			// Thread filter
			if (typeof args.threadId === 'string') {
				conditions.push('thread_id = :threadId');
				binds.threadId = args.threadId;
			} else if (Array.isArray(args.threadId)) {
				const threadConditions = args.threadId.map((_, i) => `:threadId${i}`);
				conditions.push(`thread_id IN (${threadConditions.join(', ')})`);
				args.threadId.forEach((tid, i) => {
					binds[`threadId${i}`] = tid;
				});
			}

			// Resource filter
			if (args.resourceId) {
				conditions.push('resource_id = :resourceId');
				binds.resourceId = args.resourceId;
			}

			// Date range
			if (args.filter?.dateRange?.start) {
				const op = args.filter.dateRange.startExclusive ? '>' : '>=';
				conditions.push(`created_at ${op} :startDate`);
				binds.startDate = args.filter.dateRange.start;
			}
			if (args.filter?.dateRange?.end) {
				const op = args.filter.dateRange.endExclusive ? '<' : '<=';
				conditions.push(`created_at ${op} :endDate`);
				binds.endDate = args.filter.dateRange.end;
			}

			const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

			// Count total
			const countResult = await conn.execute<{ CNT: number }>(
				`SELECT COUNT(*) AS CNT FROM mastra_messages ${where}`,
				binds
			);
			const total = countResult.rows?.[0]?.CNT ?? 0;

			// Ordering
			const direction = args.orderBy?.direction ?? 'ASC';
			const orderByClause = `ORDER BY created_at ${direction}`;

			// Paginated query
			let dataSql = `SELECT id, thread_id, role, type, content, resource_id, created_at
                     FROM mastra_messages ${where} ${orderByClause}`;

			const rawPerPage = args.perPage === false ? false : (args.perPage ?? 40);
			const page = args.page ?? 0;
			let effectivePerPage = rawPerPage;

			if (rawPerPage !== false) {
				const normalizedPerPage = normalizePerPage(rawPerPage, 100);
				effectivePerPage = normalizedPerPage;
				const { offset } = calculatePagination(page, rawPerPage, normalizedPerPage);
				dataSql += ` OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`;
				binds.offset = offset;
				binds.limit = normalizedPerPage;
			}

			const result = await conn.execute<OracleMessageRow>(dataSql, binds);
			const messages = (result.rows ?? []).map((row) => this.rowToMessage(row));

			return {
				messages,
				total,
				page,
				perPage: effectivePerPage,
				hasMore:
					effectivePerPage === false ? false : page * effectivePerPage + messages.length < total
			};
		});
	}

	async listMessagesByResourceId(
		args: StorageListMessagesByResourceIdInput
	): Promise<StorageListMessagesOutput> {
		return this.withConnection(async (conn) => {
			const conditions: string[] = ['resource_id = :resourceId'];
			const binds: Record<string, unknown> = { resourceId: args.resourceId };

			// Date range
			if (args.filter?.dateRange?.start) {
				const op = args.filter.dateRange.startExclusive ? '>' : '>=';
				conditions.push(`created_at ${op} :startDate`);
				binds.startDate = args.filter.dateRange.start;
			}
			if (args.filter?.dateRange?.end) {
				const op = args.filter.dateRange.endExclusive ? '<' : '<=';
				conditions.push(`created_at ${op} :endDate`);
				binds.endDate = args.filter.dateRange.end;
			}

			const where = `WHERE ${conditions.join(' AND ')}`;

			// Count total
			const countResult = await conn.execute<{ CNT: number }>(
				`SELECT COUNT(*) AS CNT FROM mastra_messages ${where}`,
				binds
			);
			const total = countResult.rows?.[0]?.CNT ?? 0;

			// Ordering
			const direction = args.orderBy?.direction ?? 'ASC';
			const orderByClause = `ORDER BY created_at ${direction}`;

			// Paginated query
			let dataSql = `SELECT id, thread_id, role, type, content, resource_id, created_at
                     FROM mastra_messages ${where} ${orderByClause}`;

			const rawPerPage = args.perPage === false ? false : (args.perPage ?? 40);
			const page = args.page ?? 0;
			let effectivePerPage = rawPerPage;

			if (rawPerPage !== false) {
				const normalizedPerPage = normalizePerPage(rawPerPage, 100);
				effectivePerPage = normalizedPerPage;
				const { offset } = calculatePagination(page, rawPerPage, normalizedPerPage);
				dataSql += ` OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`;
				binds.offset = offset;
				binds.limit = normalizedPerPage;
			}

			const result = await conn.execute<OracleMessageRow>(dataSql, binds);
			const messages = (result.rows ?? []).map((row) => this.rowToMessage(row));

			return {
				messages,
				total,
				page,
				perPage: effectivePerPage,
				hasMore:
					effectivePerPage === false ? false : page * effectivePerPage + messages.length < total
			};
		});
	}

	async listMessagesById(args: { messageIds: string[] }): Promise<{ messages: MastraDBMessage[] }> {
		return this.withConnection(async (conn) => {
			if (args.messageIds.length === 0) {
				return { messages: [] };
			}

			// Oracle doesn't support array bind variables — use numbered binds
			// Limit to 1000 IDs for reasonable batch size
			const ids = args.messageIds.slice(0, 1000);
			const binds: Record<string, unknown> = {};
			const idPlaceholders = ids.map((id, i) => {
				binds[`id${i}`] = id;
				return `:id${i}`;
			});

			const sql = `SELECT id, thread_id, role, type, content, resource_id, created_at
                   FROM mastra_messages
                   WHERE id IN (${idPlaceholders.join(', ')})
                   ORDER BY created_at ASC`;

			const result = await conn.execute<OracleMessageRow>(sql, binds);
			const messages = (result.rows ?? []).map((row) => this.rowToMessage(row));

			return { messages };
		});
	}

	async saveMessages(args: {
		messages: MastraDBMessage[];
	}): Promise<{ messages: MastraDBMessage[] }> {
		await this.withConnection(async (conn) => {
			if (args.messages.length === 0) return;

			// Insert each message individually (Oracle doesn't have nice multi-row INSERT syntax)
			for (const msg of args.messages) {
				await conn.execute(
					`INSERT INTO mastra_messages (id, thread_id, role, type, content, resource_id, created_at)
           VALUES (:id, :threadId, :role, :type, :content, :resourceId, :createdAt)`,
					{
						id: msg.id,
						threadId: msg.threadId ?? null,
						role: msg.role,
						type: msg.type ?? null,
						content: JSON.stringify(msg.content),
						resourceId: msg.resourceId ?? null,
						createdAt: msg.createdAt ?? new Date()
					}
				);
			}
			await conn.commit();
		});

		return { messages: args.messages };
	}

	async updateMessages(args: {
		messages: (Partial<Omit<MastraDBMessage, 'createdAt'>> & {
			id: string;
			content?: {
				metadata?: MastraMessageContentV2['metadata'];
				content?: MastraMessageContentV2['content'];
			};
		})[];
	}): Promise<MastraDBMessage[]> {
		return this.withConnection(async (conn) => {
			const updatedMessages: MastraDBMessage[] = [];

			for (const update of args.messages) {
				// Load current message
				const currentResult = await conn.execute<OracleMessageRow>(
					`SELECT id, thread_id, role, type, content, resource_id, created_at
           FROM mastra_messages WHERE id = :id`,
					{ id: update.id }
				);
				const currentRow = currentResult.rows?.[0];
				if (!currentRow) {
					throw new Error(`Message not found for update: ${update.id}`);
				}

				const current = this.rowToMessage(currentRow);

				// Merge updates
				const updated: MastraDBMessage = {
					...current,
					role: update.role ?? current.role,
					type: update.type ?? current.type,
					threadId: update.threadId ?? current.threadId,
					resourceId: update.resourceId ?? current.resourceId
				};

				// Merge content updates if provided
				if (update.content) {
					updated.content = {
						...current.content,
						metadata: update.content.metadata ?? current.content.metadata,
						content: update.content.content ?? current.content.content
					};
				}

				// Update in DB
				await conn.execute(
					`UPDATE mastra_messages
           SET role = :role, type = :type, content = :content,
               thread_id = :threadId, resource_id = :resourceId
           WHERE id = :id`,
					{
						id: updated.id,
						role: updated.role,
						type: updated.type,
						content: JSON.stringify(updated.content),
						threadId: updated.threadId ?? null,
						resourceId: updated.resourceId ?? null
					}
				);

				updatedMessages.push(updated);
			}

			await conn.commit();
			return updatedMessages;
		});
	}

	// ── Resource Methods ──────────────────────────────────────────────────

	async getResourceById(args: { resourceId: string }): Promise<StorageResourceType | null> {
		return this.withConnection(async (conn) => {
			const result = await conn.execute<OracleResourceRow>(
				`SELECT id, working_memory, metadata, created_at, updated_at
         FROM mastra_resources WHERE id = :resourceId`,
				{ resourceId: args.resourceId }
			);
			const row = result.rows?.[0];
			if (!row) return null;
			return this.rowToResource(row);
		});
	}

	async saveResource(args: { resource: StorageResourceType }): Promise<StorageResourceType> {
		return this.withConnection(async (conn) => {
			const now = new Date();
			await conn.execute(
				`MERGE INTO mastra_resources t
         USING (SELECT :id AS id FROM DUAL) s
         ON (t.id = s.id)
         WHEN MATCHED THEN UPDATE SET
           t.working_memory = :workingMemory,
           t.metadata = :metadata,
           t.updated_at = :updatedAt
         WHEN NOT MATCHED THEN INSERT (id, working_memory, metadata, created_at, updated_at)
         VALUES (:id, :workingMemory, :metadata, :createdAt, :updatedAt)`,
				{
					id: args.resource.id,
					workingMemory: args.resource.workingMemory ?? null,
					metadata: args.resource.metadata ? JSON.stringify(args.resource.metadata) : null,
					createdAt: args.resource.createdAt ?? now,
					updatedAt: args.resource.updatedAt ?? now
				}
			);
			await conn.commit();
			return args.resource;
		});
	}

	async updateResource(args: {
		resourceId: string;
		workingMemory?: string;
		metadata?: Record<string, unknown>;
	}): Promise<StorageResourceType> {
		return this.withConnection(async (conn) => {
			const now = new Date();

			// Build update SET clause dynamically
			const setClauses: string[] = ['updated_at = :updatedAt'];
			const binds: Record<string, unknown> = {
				resourceId: args.resourceId,
				updatedAt: now
			};

			if (args.workingMemory !== undefined) {
				setClauses.push('working_memory = :workingMemory');
				binds.workingMemory = args.workingMemory;
			}
			if (args.metadata !== undefined) {
				setClauses.push('metadata = :metadata');
				binds.metadata = JSON.stringify(args.metadata);
			}

			await conn.execute(
				`UPDATE mastra_resources SET ${setClauses.join(', ')} WHERE id = :resourceId`,
				binds
			);
			await conn.commit();

			// Return updated resource
			const result = await conn.execute<OracleResourceRow>(
				`SELECT id, working_memory, metadata, created_at, updated_at
         FROM mastra_resources WHERE id = :resourceId`,
				{ resourceId: args.resourceId }
			);
			const row = result.rows?.[0];
			if (!row) {
				throw new Error(`Resource not found after update: ${args.resourceId}`);
			}
			return this.rowToResource(row);
		});
	}

	// ── Row Converters ────────────────────────────────────────────────────

	private rowToThread(row: OracleThreadRow): StorageThreadType {
		return {
			id: row.ID,
			resourceId: row.RESOURCE_ID,
			title: row.TITLE ?? undefined,
			metadata: parseJSON<Record<string, unknown>>(row.METADATA) ?? undefined,
			createdAt: toDate(row.CREATED_AT),
			updatedAt: toDate(row.UPDATED_AT)
		};
	}

	private rowToMessage(row: OracleMessageRow): MastraDBMessage {
		return {
			id: row.ID,
			threadId: row.THREAD_ID,
			role: row.ROLE as 'user' | 'assistant' | 'system',
			type: row.TYPE ?? undefined,
			content:
				parseJSON<MastraMessageContentV2>(row.CONTENT) ??
				({ format: 2, parts: [] } as MastraMessageContentV2),
			resourceId: row.RESOURCE_ID ?? undefined,
			createdAt: toDate(row.CREATED_AT)
		};
	}

	private rowToResource(row: OracleResourceRow): StorageResourceType {
		return {
			id: row.ID,
			workingMemory: row.WORKING_MEMORY ?? undefined,
			metadata: parseJSON<Record<string, unknown>>(row.METADATA) ?? undefined,
			createdAt: toDate(row.CREATED_AT),
			updatedAt: toDate(row.UPDATED_AT)
		};
	}
}

// ── ScoresOracle ──────────────────────────────────────────────────────────

/** Oracle row shape for mastra_scores table */
interface OracleScoreRow {
	ID: string;
	SCORER_ID: string;
	ENTITY_ID: string;
	ENTITY_TYPE: string | null;
	SOURCE: string;
	RUN_ID: string;
	SCORE: number;
	REASON: string | null;
	INPUT: string | null;
	OUTPUT: string | null;
	EXTRACT_STEP_RESULT: string | null;
	ANALYZE_STEP_RESULT: string | null;
	PREPROCESS_STEP_RESULT: string | null;
	ANALYZE_PROMPT: string | null;
	PREPROCESS_PROMPT: string | null;
	GENERATE_REASON_PROMPT: string | null;
	SCORER: string | null;
	ENTITY: string | null;
	ADDITIONAL_CONTEXT: string | null;
	REQUEST_CONTEXT: string | null;
	METADATA: string | null;
	TRACE_ID: string | null;
	SPAN_ID: string | null;
	RESOURCE_ID: string | null;
	THREAD_ID: string | null;
	CREATED_AT: Date | string;
	UPDATED_AT: Date | string | null;
	// Extra columns from 011
	STRUCTURED_OUTPUT: number | null;
	EXTRACT_PROMPT: string | null;
	REASON_PROMPT: string | null;
	GENERATE_SCORE_PROMPT: string | null;
}

/** All columns for SELECT queries */
const SCORE_COLUMNS = `id, scorer_id, entity_id, entity_type, source, run_id,
  score, reason, input, output, extract_step_result, analyze_step_result,
  preprocess_step_result, analyze_prompt, preprocess_prompt, generate_reason_prompt,
  scorer, entity, additional_context, request_context, metadata,
  trace_id, span_id, resource_id, thread_id, created_at, updated_at,
  structured_output, extract_prompt, reason_prompt, generate_score_prompt`;

/** Mastra evaluation scores storage backed by Oracle ADB 26AI `mastra_scores` table. */
export class ScoresOracle extends ScoresStorage {
	private withConnection: WithConnectionFn;

	constructor(withConnection: WithConnectionFn) {
		super();
		this.withConnection = withConnection;
	}

	override async dangerouslyClearAll(): Promise<void> {
		await this.withConnection(async (conn) => {
			await conn.execute('DELETE FROM mastra_scores');
			await conn.commit();
		});
	}

	async getScoreById(args: { id: string }): Promise<ScoreRowData | null> {
		return this.withConnection(async (conn) => {
			const result = await conn.execute<OracleScoreRow>(
				`SELECT ${SCORE_COLUMNS} FROM mastra_scores WHERE id = :id`,
				{ id: args.id }
			);
			const row = result.rows?.[0];
			if (!row) return null;
			return this.rowToScore(row);
		});
	}

	async saveScore(score: SaveScorePayload): Promise<{ score: ScoreRowData }> {
		const id = crypto.randomUUID();
		const now = new Date();

		await this.withConnection(async (conn) => {
			await conn.execute(
				`INSERT INTO mastra_scores (
           id, scorer_id, entity_id, entity_type, source, run_id,
           score, reason, input, output, extract_step_result, analyze_step_result,
           preprocess_step_result, analyze_prompt, preprocess_prompt, generate_reason_prompt,
           scorer, entity, additional_context, request_context, metadata,
           trace_id, span_id, resource_id, thread_id, created_at, updated_at,
           structured_output, extract_prompt, reason_prompt, generate_score_prompt
         ) VALUES (
           :id, :scorerId, :entityId, :entityType, :source, :runId,
           :score, :reason, :input, :output, :extractStepResult, :analyzeStepResult,
           :preprocessStepResult, :analyzePrompt, :preprocessPrompt, :generateReasonPrompt,
           :scorer, :entity, :additionalContext, :requestContext, :metadata,
           :traceId, :spanId, :resourceId, :threadId, :createdAt, :updatedAt,
           :structuredOutput, :extractPrompt, :reasonPrompt, :generateScorePrompt
         )`,
				{
					id,
					scorerId: score.scorerId,
					entityId: score.entityId,
					entityType: score.entityType ?? null,
					source: score.source,
					runId: score.runId,
					score: score.score,
					reason: score.reason ?? null,
					input: score.input != null ? JSON.stringify(score.input) : null,
					output: score.output != null ? JSON.stringify(score.output) : null,
					extractStepResult: score.extractStepResult
						? JSON.stringify(score.extractStepResult)
						: null,
					analyzeStepResult: score.analyzeStepResult
						? JSON.stringify(score.analyzeStepResult)
						: null,
					preprocessStepResult: score.preprocessStepResult
						? JSON.stringify(score.preprocessStepResult)
						: null,
					analyzePrompt: score.analyzePrompt ?? null,
					preprocessPrompt: score.preprocessPrompt ?? null,
					generateReasonPrompt: score.generateReasonPrompt ?? null,
					scorer: JSON.stringify(score.scorer),
					entity: JSON.stringify(score.entity),
					additionalContext: score.additionalContext
						? JSON.stringify(score.additionalContext)
						: null,
					requestContext: score.requestContext ? JSON.stringify(score.requestContext) : null,
					metadata: score.metadata ? JSON.stringify(score.metadata) : null,
					traceId: score.traceId ?? null,
					spanId: score.spanId ?? null,
					resourceId: score.resourceId ?? null,
					threadId: score.threadId ?? null,
					createdAt: now,
					updatedAt: now,
					structuredOutput: score.structuredOutput ? 1 : 0,
					extractPrompt: score.extractPrompt ?? null,
					reasonPrompt: score.reasonPrompt ?? null,
					generateScorePrompt: score.generateScorePrompt ?? null
				}
			);
			await conn.commit();
		});

		const saved = await this.getScoreById({ id });
		return { score: saved! };
	}

	async listScoresByScorerId(args: {
		scorerId: string;
		pagination: StoragePagination;
		entityId?: string;
		entityType?: string;
		source?: ScoringSource;
	}): Promise<ListScoresResponse> {
		const conditions = ['scorer_id = :scorerId'];
		const binds: Record<string, unknown> = { scorerId: args.scorerId };

		if (args.entityId) {
			conditions.push('entity_id = :entityId');
			binds.entityId = args.entityId;
		}
		if (args.entityType) {
			conditions.push('entity_type = :entityType');
			binds.entityType = args.entityType;
		}
		if (args.source) {
			conditions.push('source = :source');
			binds.source = args.source;
		}

		return this.paginatedScoreQuery(conditions, binds, args.pagination);
	}

	async listScoresByRunId(args: {
		runId: string;
		pagination: StoragePagination;
	}): Promise<ListScoresResponse> {
		return this.paginatedScoreQuery(['run_id = :runId'], { runId: args.runId }, args.pagination);
	}

	async listScoresByEntityId(args: {
		entityId: string;
		entityType: string;
		pagination: StoragePagination;
	}): Promise<ListScoresResponse> {
		return this.paginatedScoreQuery(
			['entity_id = :entityId', 'entity_type = :entityType'],
			{ entityId: args.entityId, entityType: args.entityType },
			args.pagination
		);
	}

	override async listScoresBySpan(args: {
		traceId: string;
		spanId: string;
		pagination: StoragePagination;
	}): Promise<ListScoresResponse> {
		return this.paginatedScoreQuery(
			['trace_id = :traceId', 'span_id = :spanId'],
			{ traceId: args.traceId, spanId: args.spanId },
			args.pagination
		);
	}

	// ── Private helpers ──────────────────────────────────────────────────

	private async paginatedScoreQuery(
		conditions: string[],
		binds: Record<string, unknown>,
		pagination: StoragePagination
	): Promise<ListScoresResponse> {
		return this.withConnection(async (conn) => {
			const where = `WHERE ${conditions.join(' AND ')}`;

			// Count total
			const countResult = await conn.execute<{ CNT: number }>(
				`SELECT COUNT(*) AS CNT FROM mastra_scores ${where}`,
				binds
			);
			const total = countResult.rows?.[0]?.CNT ?? 0;

			// Paginated data query
			let dataSql = `SELECT ${SCORE_COLUMNS} FROM mastra_scores ${where}
                     ORDER BY created_at DESC`;

			const page = pagination.page;
			const rawPerPage = pagination.perPage;
			let effectivePerPage = rawPerPage;

			if (rawPerPage !== false) {
				const normalizedPerPage = normalizePerPage(rawPerPage, 100);
				effectivePerPage = normalizedPerPage;
				const { offset } = calculatePagination(page, rawPerPage, normalizedPerPage);
				dataSql += ` OFFSET :pgOffset ROWS FETCH NEXT :pgLimit ROWS ONLY`;
				binds.pgOffset = offset;
				binds.pgLimit = normalizedPerPage;
			}

			const result = await conn.execute<OracleScoreRow>(dataSql, binds);
			const scores = (result.rows ?? []).map((row) => this.rowToScore(row));

			return {
				scores,
				pagination: {
					total,
					page,
					perPage: effectivePerPage,
					hasMore:
						effectivePerPage === false ? false : page * effectivePerPage + scores.length < total
				}
			};
		});
	}

	private rowToScore(row: OracleScoreRow): ScoreRowData {
		return {
			id: row.ID,
			scorerId: row.SCORER_ID,
			entityId: row.ENTITY_ID,
			entityType: row.ENTITY_TYPE ?? undefined,
			source: row.SOURCE as 'LIVE' | 'TEST',
			runId: row.RUN_ID,
			score: row.SCORE,
			reason: row.REASON ?? undefined,
			input: parseJSON(row.INPUT),
			output: parseJSON(row.OUTPUT),
			extractStepResult: parseJSON<Record<string, unknown>>(row.EXTRACT_STEP_RESULT) ?? undefined,
			analyzeStepResult: parseJSON<Record<string, unknown>>(row.ANALYZE_STEP_RESULT) ?? undefined,
			preprocessStepResult:
				parseJSON<Record<string, unknown>>(row.PREPROCESS_STEP_RESULT) ?? undefined,
			analyzePrompt: row.ANALYZE_PROMPT ?? undefined,
			preprocessPrompt: row.PREPROCESS_PROMPT ?? undefined,
			generateReasonPrompt: row.GENERATE_REASON_PROMPT ?? undefined,
			scorer: parseJSON<Record<string, unknown>>(row.SCORER) ?? {},
			entity: parseJSON<Record<string, unknown>>(row.ENTITY) ?? {},
			additionalContext: parseJSON<Record<string, unknown>>(row.ADDITIONAL_CONTEXT) ?? undefined,
			requestContext: parseJSON<Record<string, unknown>>(row.REQUEST_CONTEXT) ?? undefined,
			metadata: parseJSON<Record<string, unknown>>(row.METADATA) ?? undefined,
			traceId: row.TRACE_ID ?? undefined,
			spanId: row.SPAN_ID ?? undefined,
			resourceId: row.RESOURCE_ID ?? undefined,
			threadId: row.THREAD_ID ?? undefined,
			createdAt: toDate(row.CREATED_AT),
			updatedAt: row.UPDATED_AT ? toDate(row.UPDATED_AT) : null,
			structuredOutput: row.STRUCTURED_OUTPUT === 1 ? true : undefined,
			extractPrompt: row.EXTRACT_PROMPT ?? undefined,
			reasonPrompt: row.REASON_PROMPT ?? undefined,
			generateScorePrompt: row.GENERATE_SCORE_PROMPT ?? undefined
		};
	}
}

// ── OracleStore (Composite) ──────────────────────────────────────────────

export interface OracleStoreConfig {
	withConnection: WithConnectionFn;
	/** Skip automatic init (tables managed by migrations). Default: true */
	disableInit?: boolean;
}

/** Composite Mastra storage adapter combining workflows, memory, and scores on Oracle ADB 26AI. */
export class OracleStore extends MastraCompositeStore {
	constructor(config: OracleStoreConfig) {
		const workflows = new WorkflowsOracle(config.withConnection);
		const memory = new MemoryOracle(config.withConnection);
		const scores = new ScoresOracle(config.withConnection);

		const compositeConfig: MastraCompositeStoreConfig = {
			id: 'oracle-adb-26ai',
			name: 'OracleStore',
			disableInit: config.disableInit ?? true // migrations handle DDL
		};

		super(compositeConfig);

		// Set domain stores directly (same pattern as @mastra/pg)
		this.stores = { workflows, memory, scores };
	}
}
