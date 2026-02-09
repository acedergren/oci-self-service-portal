/**
 * Workflow repository — Oracle ADB CRUD for workflow definitions, runs, and steps.
 *
 * Migrated from apps/frontend with factory pattern:
 * instead of a module-level `withConnection` import,
 * each repository is created via a factory function that
 * receives the Fastify oracle plugin's `withConnection`.
 */
import type {
	WorkflowDefinition,
	WorkflowRun,
	WorkflowStep,
	WorkflowStatus,
	WorkflowRunStatus,
	WorkflowStepStatus,
	NodeType
} from '@portal/shared/workflows/types.js';
import type { OracleConnection } from '@portal/shared/server/oracle/connection';

// ============================================================================
// WithConnection type
// ============================================================================

type WithConnectionFn = <T>(fn: (conn: OracleConnection) => Promise<T>) => Promise<T>;

// ============================================================================
// Oracle Row Interfaces (UPPERCASE keys from OUT_FORMAT_OBJECT)
// ============================================================================

interface WorkflowDefinitionRow {
	ID: string;
	USER_ID: string | null;
	ORG_ID: string | null;
	NAME: string;
	DESCRIPTION: string | null;
	STATUS: string;
	VERSION: number;
	TAGS: string | null;
	NODES: string;
	EDGES: string;
	INPUT_SCHEMA: string | null;
	CREATED_AT: Date;
	UPDATED_AT: Date;
}

interface WorkflowRunRow {
	ID: string;
	WORKFLOW_ID: string;
	WORKFLOW_VERSION: number;
	USER_ID: string | null;
	ORG_ID: string | null;
	STATUS: string;
	INPUT: string | null;
	OUTPUT: string | null;
	ERROR: string | null;
	ENGINE_STATE: string | null;
	STARTED_AT: Date | null;
	COMPLETED_AT: Date | null;
	SUSPENDED_AT: Date | null;
	RESUMED_AT: Date | null;
	CREATED_AT: Date;
	UPDATED_AT: Date;
}

interface WorkflowRunStepRow {
	ID: string;
	RUN_ID: string;
	NODE_ID: string;
	NODE_TYPE: string;
	STEP_NUMBER: number;
	STATUS: string;
	INPUT: string | null;
	OUTPUT: string | null;
	ERROR: string | null;
	STARTED_AT: Date | null;
	COMPLETED_AT: Date | null;
	DURATION_MS: number | null;
	TOOL_EXECUTION_ID: string | null;
	CREATED_AT: Date;
	UPDATED_AT: Date;
}

// ============================================================================
// Row-to-Entity Converters
// ============================================================================

function rowToDefinition(row: WorkflowDefinitionRow): WorkflowDefinition {
	return {
		id: row.ID,
		userId: row.USER_ID ?? undefined,
		orgId: row.ORG_ID ?? undefined,
		name: row.NAME,
		description: row.DESCRIPTION ?? undefined,
		status: row.STATUS as WorkflowStatus,
		version: row.VERSION,
		tags: row.TAGS ? JSON.parse(row.TAGS) : undefined,
		nodes: JSON.parse(row.NODES),
		edges: JSON.parse(row.EDGES),
		inputSchema: row.INPUT_SCHEMA ? JSON.parse(row.INPUT_SCHEMA) : undefined,
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT
	};
}

function rowToRun(row: WorkflowRunRow): WorkflowRun {
	return {
		id: row.ID,
		definitionId: row.WORKFLOW_ID,
		workflowVersion: row.WORKFLOW_VERSION,
		userId: row.USER_ID ?? undefined,
		orgId: row.ORG_ID ?? undefined,
		status: row.STATUS as WorkflowRunStatus,
		input: row.INPUT ? JSON.parse(row.INPUT) : undefined,
		output: row.OUTPUT ? JSON.parse(row.OUTPUT) : undefined,
		error: row.ERROR ? JSON.parse(row.ERROR) : undefined,
		engineState: row.ENGINE_STATE ? JSON.parse(row.ENGINE_STATE) : undefined,
		startedAt: row.STARTED_AT ?? undefined,
		completedAt: row.COMPLETED_AT ?? undefined,
		suspendedAt: row.SUSPENDED_AT ?? undefined,
		resumedAt: row.RESUMED_AT ?? undefined,
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT
	};
}

function rowToStep(row: WorkflowRunStepRow): WorkflowStep {
	return {
		id: row.ID,
		runId: row.RUN_ID,
		nodeId: row.NODE_ID,
		nodeType: row.NODE_TYPE as NodeType,
		stepNumber: row.STEP_NUMBER,
		status: row.STATUS as WorkflowStepStatus,
		input: row.INPUT ? JSON.parse(row.INPUT) : undefined,
		output: row.OUTPUT ? JSON.parse(row.OUTPUT) : undefined,
		error: row.ERROR ?? undefined,
		startedAt: row.STARTED_AT ?? undefined,
		completedAt: row.COMPLETED_AT ?? undefined,
		durationMs: row.DURATION_MS ?? undefined,
		toolExecutionId: row.TOOL_EXECUTION_ID ?? undefined,
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT
	};
}

/** Escape % and _ in user input for LIKE queries. */
function escapeLike(input: string): string {
	return input.replace(/[%_\\]/g, '\\$&');
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateWorkflowInput {
	name: string;
	description?: string;
	status?: WorkflowStatus;
	version?: number;
	tags?: string[];
	nodes: unknown[];
	edges: unknown[];
	inputSchema?: Record<string, unknown>;
	userId?: string;
	orgId?: string;
}

export interface UpdateWorkflowInput {
	name?: string;
	description?: string;
	status?: WorkflowStatus;
	version?: number;
	tags?: string[];
	nodes?: unknown[];
	edges?: unknown[];
	inputSchema?: Record<string, unknown>;
}

export interface ListWorkflowsOptions {
	limit?: number;
	offset?: number;
	status?: WorkflowStatus;
	userId?: string;
	orgId?: string;
	search?: string;
}

export interface CreateRunInput {
	definitionId?: string;
	workflowId?: string;
	workflowVersion?: number;
	userId?: string;
	orgId?: string;
	input?: Record<string, unknown>;
}

export interface UpdateRunInput {
	status?: WorkflowRunStatus;
	output?: Record<string, unknown>;
	error?: Record<string, unknown>;
	engineState?: Record<string, unknown>;
}

export interface CreateStepInput {
	runId: string;
	nodeId: string;
	nodeType: string;
	stepNumber: number;
	input?: Record<string, unknown>;
}

export interface UpdateStepInput {
	status?: WorkflowStepStatus;
	input?: Record<string, unknown>;
	output?: Record<string, unknown>;
	error?: string;
	durationMs?: number;
	toolExecutionId?: string;
}

// ============================================================================
// Repository interfaces
// ============================================================================

export interface WorkflowDefinitionRepo {
	create(input: CreateWorkflowInput): Promise<WorkflowDefinition>;
	getById(id: string): Promise<WorkflowDefinition | null>;
	getByIdForOrg(id: string, orgId: string): Promise<WorkflowDefinition | null>;
	getByIdForUser(id: string, userId: string, orgId?: string): Promise<WorkflowDefinition | null>;
	list(orgIdOrOptions?: string | ListWorkflowsOptions): Promise<WorkflowDefinition[]>;
	update(id: string, input: UpdateWorkflowInput): Promise<WorkflowDefinition | null>;
	updateForUser(
		id: string,
		input: UpdateWorkflowInput,
		userId: string
	): Promise<WorkflowDefinition | null>;
	delete(id: string, userId?: string, orgId?: string): Promise<boolean>;
	count(options?: ListWorkflowsOptions): Promise<number>;
}

export interface WorkflowRunRepo {
	create(input: CreateRunInput): Promise<WorkflowRun>;
	getById(id: string): Promise<WorkflowRun | null>;
	getByIdForOrg(id: string, orgId: string): Promise<WorkflowRun | null>;
	getByIdForUser(id: string, userId: string, orgId?: string): Promise<WorkflowRun | null>;
	updateStatus(id: string, input: UpdateRunInput): Promise<WorkflowRun | null>;
	listByWorkflow(workflowId: string, limit?: number): Promise<WorkflowRun[]>;
	listByUser(userId: string, limit?: number): Promise<WorkflowRun[]>;
}

export interface WorkflowRunStepRepo {
	create(input: CreateStepInput): Promise<WorkflowStep>;
	getById(id: string): Promise<WorkflowStep | null>;
	updateStatus(id: string, input: UpdateStepInput): Promise<WorkflowStep | null>;
	listByRun(runId: string): Promise<WorkflowStep[]>;
}

// ============================================================================
// Factory: Workflow Definition Repository
// ============================================================================

export function createWorkflowRepository(withConnection: WithConnectionFn): WorkflowDefinitionRepo {
	const repo: WorkflowDefinitionRepo = {
		async create(input: CreateWorkflowInput): Promise<WorkflowDefinition> {
			const id = crypto.randomUUID();

			await withConnection(async (conn) => {
				await conn.execute(
					`INSERT INTO workflow_definitions
             (id, user_id, org_id, name, description, status, version, tags, nodes, edges, input_schema)
           VALUES
             (:id, :userId, :orgId, :name, :description, :status, :version, :tags, :nodes, :edges, :inputSchema)`,
					{
						id,
						userId: input.userId ?? null,
						orgId: input.orgId ?? null,
						name: input.name,
						description: input.description ?? null,
						status: input.status ?? 'draft',
						version: input.version ?? 1,
						tags: input.tags ? JSON.stringify(input.tags) : null,
						nodes: JSON.stringify(input.nodes),
						edges: JSON.stringify(input.edges),
						inputSchema: input.inputSchema ? JSON.stringify(input.inputSchema) : null
					}
				);
			});

			return (await repo.getById(id))!;
		},

		async getById(id: string): Promise<WorkflowDefinition | null> {
			return withConnection(async (conn) => {
				const result = await conn.execute<WorkflowDefinitionRow>(
					'SELECT * FROM workflow_definitions WHERE id = :id',
					{ id }
				);
				if (!result.rows || result.rows.length === 0) return null;
				return rowToDefinition(result.rows[0]);
			});
		},

		async getByIdForOrg(id: string, orgId: string): Promise<WorkflowDefinition | null> {
			return withConnection(async (conn) => {
				const result = await conn.execute<WorkflowDefinitionRow>(
					'SELECT * FROM workflow_definitions WHERE id = :id AND org_id = :orgId',
					{ id, orgId }
				);
				if (!result.rows || result.rows.length === 0) return null;
				return rowToDefinition(result.rows[0]);
			});
		},

		async getByIdForUser(
			id: string,
			userId: string,
			orgId?: string
		): Promise<WorkflowDefinition | null> {
			return withConnection(async (conn) => {
				const sql = orgId
					? 'SELECT * FROM workflow_definitions WHERE id = :id AND user_id = :userId AND org_id = :orgId'
					: 'SELECT * FROM workflow_definitions WHERE id = :id AND user_id = :userId';
				const binds = orgId ? { id, userId, orgId } : { id, userId };
				const result = await conn.execute<WorkflowDefinitionRow>(sql, binds);
				if (!result.rows || result.rows.length === 0) return null;
				return rowToDefinition(result.rows[0]);
			});
		},

		async list(orgIdOrOptions?: string | ListWorkflowsOptions): Promise<WorkflowDefinition[]> {
			const options: ListWorkflowsOptions | undefined =
				typeof orgIdOrOptions === 'string' ? { orgId: orgIdOrOptions } : orgIdOrOptions;

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
				if (options?.search) {
					conditions.push(`LOWER(name) LIKE LOWER(:search) ESCAPE '\\'`);
					binds.search = `%${escapeLike(options.search)}%`;
				}

				const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
				const limit = options?.limit ?? 50;
				const offset = options?.offset ?? 0;

				const result = await conn.execute<WorkflowDefinitionRow>(
					`SELECT * FROM workflow_definitions ${where}
           ORDER BY updated_at DESC
           OFFSET :offset ROWS FETCH NEXT :maxRows ROWS ONLY`,
					{ ...binds, offset, maxRows: limit }
				);

				if (!result.rows) return [];
				return result.rows.map(rowToDefinition);
			});
		},

		async update(id: string, input: UpdateWorkflowInput): Promise<WorkflowDefinition | null> {
			return withConnection(async (conn) => {
				const sets: string[] = ['updated_at = SYSTIMESTAMP'];
				const binds: Record<string, unknown> = { id };

				if (input.name !== undefined) {
					sets.push('name = :name');
					binds.name = input.name;
				}
				if (input.description !== undefined) {
					sets.push('description = :description');
					binds.description = input.description;
				}
				if (input.status !== undefined) {
					sets.push('status = :status');
					binds.status = input.status;
				}
				if (input.version !== undefined) {
					sets.push('version = :version');
					binds.version = input.version;
				}
				if (input.tags !== undefined) {
					sets.push('tags = :tags');
					binds.tags = JSON.stringify(input.tags);
				}
				if (input.nodes !== undefined) {
					sets.push('nodes = :nodes');
					binds.nodes = JSON.stringify(input.nodes);
				}
				if (input.edges !== undefined) {
					sets.push('edges = :edges');
					binds.edges = JSON.stringify(input.edges);
				}
				if (input.inputSchema !== undefined) {
					sets.push('input_schema = :inputSchema');
					binds.inputSchema = JSON.stringify(input.inputSchema);
				}

				await conn.execute(
					`UPDATE workflow_definitions SET ${sets.join(', ')} WHERE id = :id`,
					binds
				);

				return repo.getById(id);
			});
		},

		async updateForUser(
			id: string,
			input: UpdateWorkflowInput,
			userId: string
		): Promise<WorkflowDefinition | null> {
			return withConnection(async (conn) => {
				const sets: string[] = ['updated_at = SYSTIMESTAMP'];
				const binds: Record<string, unknown> = { id, userId };

				if (input.name !== undefined) {
					sets.push('name = :name');
					binds.name = input.name;
				}
				if (input.description !== undefined) {
					sets.push('description = :description');
					binds.description = input.description;
				}
				if (input.status !== undefined) {
					sets.push('status = :status');
					binds.status = input.status;
				}
				if (input.version !== undefined) {
					sets.push('version = :version');
					binds.version = input.version;
				}
				if (input.tags !== undefined) {
					sets.push('tags = :tags');
					binds.tags = JSON.stringify(input.tags);
				}
				if (input.nodes !== undefined) {
					sets.push('nodes = :nodes');
					binds.nodes = JSON.stringify(input.nodes);
				}
				if (input.edges !== undefined) {
					sets.push('edges = :edges');
					binds.edges = JSON.stringify(input.edges);
				}
				if (input.inputSchema !== undefined) {
					sets.push('input_schema = :inputSchema');
					binds.inputSchema = JSON.stringify(input.inputSchema);
				}

				await conn.execute(
					`UPDATE workflow_definitions SET ${sets.join(', ')} WHERE id = :id AND user_id = :userId`,
					binds
				);

				return repo.getByIdForUser(id, userId);
			});
		},

		async delete(id: string, userId?: string, orgId?: string): Promise<boolean> {
			return withConnection(async (conn) => {
				const conditions = ['id = :id'];
				const binds: Record<string, string> = { id };

				if (userId) {
					conditions.push('user_id = :userId');
					binds.userId = userId;
				}
				if (orgId) {
					conditions.push('org_id = :orgId');
					binds.orgId = orgId;
				}

				const sql = `DELETE FROM workflow_definitions WHERE ${conditions.join(' AND ')}`;
				const result = await conn.execute(sql, binds);
				return (result as { rowsAffected?: number }).rowsAffected === 1;
			});
		},

		async count(options?: ListWorkflowsOptions): Promise<number> {
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
				if (options?.search) {
					conditions.push(`LOWER(name) LIKE LOWER(:search) ESCAPE '\\'`);
					binds.search = `%${escapeLike(options.search)}%`;
				}

				const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

				const result = await conn.execute<{ CNT: number }>(
					`SELECT COUNT(*) AS "CNT" FROM workflow_definitions ${where}`,
					binds
				);

				return result.rows?.[0]?.CNT ?? 0;
			});
		}
	};

	return repo;
}

// ============================================================================
// Factory: Workflow Run Repository
// ============================================================================

export function createWorkflowRunRepository(withConnection: WithConnectionFn): WorkflowRunRepo {
	const repo: WorkflowRunRepo = {
		async create(input: CreateRunInput): Promise<WorkflowRun> {
			const id = crypto.randomUUID();
			const workflowId = input.definitionId ?? input.workflowId ?? '';

			await withConnection(async (conn) => {
				await conn.execute(
					`INSERT INTO workflow_runs
             (id, workflow_id, workflow_version, user_id, org_id, status, input)
           VALUES
             (:id, :workflowId, :workflowVersion, :userId, :orgId, 'pending', :input)`,
					{
						id,
						workflowId,
						workflowVersion: input.workflowVersion ?? 1,
						userId: input.userId ?? null,
						orgId: input.orgId ?? null,
						input: input.input ? JSON.stringify(input.input) : null
					}
				);
			});

			return (await repo.getById(id))!;
		},

		async getById(id: string): Promise<WorkflowRun | null> {
			return withConnection(async (conn) => {
				const result = await conn.execute<WorkflowRunRow>(
					'SELECT * FROM workflow_runs WHERE id = :id',
					{ id }
				);
				if (!result.rows || result.rows.length === 0) return null;
				return rowToRun(result.rows[0]);
			});
		},

		async getByIdForOrg(id: string, orgId: string): Promise<WorkflowRun | null> {
			return withConnection(async (conn) => {
				const result = await conn.execute<WorkflowRunRow>(
					'SELECT * FROM workflow_runs WHERE id = :id AND org_id = :orgId',
					{ id, orgId }
				);
				if (!result.rows || result.rows.length === 0) return null;
				return rowToRun(result.rows[0]);
			});
		},

		async getByIdForUser(id: string, userId: string, orgId?: string): Promise<WorkflowRun | null> {
			return withConnection(async (conn) => {
				const sql = orgId
					? 'SELECT * FROM workflow_runs WHERE id = :id AND user_id = :userId AND org_id = :orgId'
					: 'SELECT * FROM workflow_runs WHERE id = :id AND user_id = :userId';
				const binds = orgId ? { id, userId, orgId } : { id, userId };
				const result = await conn.execute<WorkflowRunRow>(sql, binds);
				if (!result.rows || result.rows.length === 0) return null;
				return rowToRun(result.rows[0]);
			});
		},

		async updateStatus(id: string, input: UpdateRunInput): Promise<WorkflowRun | null> {
			return withConnection(async (conn) => {
				const sets: string[] = ['updated_at = SYSTIMESTAMP'];
				const binds: Record<string, unknown> = { id };

				if (input.status !== undefined) {
					sets.push('status = :status');
					binds.status = input.status;

					if (input.status === 'running') {
						sets.push('started_at = SYSTIMESTAMP');
					} else if (
						input.status === 'completed' ||
						input.status === 'failed' ||
						input.status === 'cancelled'
					) {
						sets.push('completed_at = SYSTIMESTAMP');
					} else if (input.status === 'suspended') {
						sets.push('suspended_at = SYSTIMESTAMP');
					}
				}
				if (input.output !== undefined) {
					sets.push('output = :output');
					binds.output = JSON.stringify(input.output);
				}
				if (input.error !== undefined) {
					sets.push('error = :error');
					binds.error = JSON.stringify(input.error);
				}
				if (input.engineState !== undefined) {
					sets.push('engine_state = :engineState');
					binds.engineState = JSON.stringify(input.engineState);
				}

				await conn.execute(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE id = :id`, binds);

				return repo.getById(id);
			});
		},

		async listByWorkflow(workflowId: string, limit = 50): Promise<WorkflowRun[]> {
			return withConnection(async (conn) => {
				const result = await conn.execute<WorkflowRunRow>(
					`SELECT * FROM workflow_runs
           WHERE workflow_id = :workflowId
           ORDER BY created_at DESC
           FETCH FIRST :maxRows ROWS ONLY`,
					{ workflowId, maxRows: limit }
				);
				if (!result.rows) return [];
				return result.rows.map(rowToRun);
			});
		},

		async listByUser(userId: string, limit = 50): Promise<WorkflowRun[]> {
			return withConnection(async (conn) => {
				const result = await conn.execute<WorkflowRunRow>(
					`SELECT * FROM workflow_runs
           WHERE user_id = :userId
           ORDER BY created_at DESC
           FETCH FIRST :maxRows ROWS ONLY`,
					{ userId, maxRows: limit }
				);
				if (!result.rows) return [];
				return result.rows.map(rowToRun);
			});
		}
	};

	return repo;
}

// ============================================================================
// Factory: Workflow Run Step Repository
// ============================================================================

export function createWorkflowRunStepRepository(
	withConnection: WithConnectionFn
): WorkflowRunStepRepo {
	const repo: WorkflowRunStepRepo = {
		async create(input: CreateStepInput): Promise<WorkflowStep> {
			const id = crypto.randomUUID();

			await withConnection(async (conn) => {
				await conn.execute(
					`INSERT INTO workflow_run_steps
             (id, run_id, node_id, node_type, step_number, status, input)
           VALUES
             (:id, :runId, :nodeId, :nodeType, :stepNumber, 'pending', :input)`,
					{
						id,
						runId: input.runId,
						nodeId: input.nodeId,
						nodeType: input.nodeType,
						stepNumber: input.stepNumber,
						input: input.input ? JSON.stringify(input.input) : null
					}
				);
			});

			return (await repo.getById(id))!;
		},

		async getById(id: string): Promise<WorkflowStep | null> {
			return withConnection(async (conn) => {
				const result = await conn.execute<WorkflowRunStepRow>(
					'SELECT * FROM workflow_run_steps WHERE id = :id',
					{ id }
				);
				if (!result.rows || result.rows.length === 0) return null;
				return rowToStep(result.rows[0]);
			});
		},

		async updateStatus(id: string, input: UpdateStepInput): Promise<WorkflowStep | null> {
			return withConnection(async (conn) => {
				const sets: string[] = ['updated_at = SYSTIMESTAMP'];
				const binds: Record<string, unknown> = { id };

				if (input.status !== undefined) {
					sets.push('status = :status');
					binds.status = input.status;

					if (input.status === 'running') {
						sets.push('started_at = SYSTIMESTAMP');
					} else if (
						input.status === 'completed' ||
						input.status === 'failed' ||
						input.status === 'skipped'
					) {
						sets.push('completed_at = SYSTIMESTAMP');
					}
				}
				if (input.input !== undefined) {
					sets.push('input = :input');
					binds.input = JSON.stringify(input.input);
				}
				if (input.output !== undefined) {
					sets.push('output = :output');
					binds.output = JSON.stringify(input.output);
				}
				if (input.error !== undefined) {
					sets.push('error = :error');
					binds.error = input.error;
				}
				if (input.durationMs !== undefined) {
					sets.push('duration_ms = :durationMs');
					binds.durationMs = input.durationMs;
				}
				if (input.toolExecutionId !== undefined) {
					sets.push('tool_execution_id = :toolExecutionId');
					binds.toolExecutionId = input.toolExecutionId;
				}

				await conn.execute(
					`UPDATE workflow_run_steps SET ${sets.join(', ')} WHERE id = :id`,
					binds
				);

				return repo.getById(id);
			});
		},

		async listByRun(runId: string): Promise<WorkflowStep[]> {
			return withConnection(async (conn) => {
				const result = await conn.execute<WorkflowRunStepRow>(
					`SELECT * FROM workflow_run_steps
           WHERE run_id = :runId
           ORDER BY step_number ASC`,
					{ runId }
				);
				if (!result.rows) return [];
				return result.rows.map(rowToStep);
			});
		}
	};

	return repo;
}
