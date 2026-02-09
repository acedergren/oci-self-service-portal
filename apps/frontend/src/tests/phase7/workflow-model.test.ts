/**
 * Phase 7 TDD: Workflow Data Model
 *
 * Defines the workflow definition, run, and step entities for the
 * visual workflow designer. Stored in Oracle ADB.
 *
 * Expected module: $lib/server/workflows/types.ts
 * Expected schemas:
 *   - WorkflowDefinitionSchema (id, name, description, nodes, edges, userId, orgId, ...)
 *   - WorkflowRunSchema (id, definitionId, status, startedAt, completedAt, ...)
 *   - WorkflowStepSchema (id, runId, nodeId, status, input, output, startedAt, ...)
 *
 * Expected module: $lib/server/workflows/repository.ts
 * Expected exports:
 *   - workflowRepository.create(input): Promise<WorkflowDefinition>
 *   - workflowRepository.getById(id): Promise<WorkflowDefinition | null>
 *   - workflowRepository.list(options): Promise<WorkflowDefinition[]>
 *   - workflowRepository.update(id, input): Promise<WorkflowDefinition | null>
 *   - workflowRepository.delete(id): Promise<void>
 *   - workflowRepository.createRun(defId): Promise<WorkflowRun>
 *   - workflowRepository.updateStep(stepId, input): Promise<WorkflowStep>
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

let typesModule: Record<string, unknown> | null = null;
let repoModule: Record<string, unknown> | null = null;
let typesError: string | null = null;
let repoError: string | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		typesModule = await import('$lib/server/workflows/types.js');
	} catch (err) {
		typesError = (err as Error).message;
	}
	try {
		repoModule = await import('$lib/server/workflows/repository.js');
	} catch (err) {
		repoError = (err as Error).message;
	}
});

describe('Workflow Data Model (Phase 7.2)', () => {
	describe('module availability', () => {
		it('workflow types module should be importable', () => {
			if (typesError) {
				expect.fail(
					`workflows/types not yet available: ${typesError}. ` +
						'Implement $lib/server/workflows/types.ts per Phase 7.2.'
				);
			}
			expect(typesModule).not.toBeNull();
		});

		it('workflow repository module should be importable', () => {
			if (repoError) {
				expect.fail(
					`workflows/repository not yet available: ${repoError}. ` +
						'Implement $lib/server/workflows/repository.ts per Phase 7.4.'
				);
			}
			expect(repoModule).not.toBeNull();
		});
	});

	describe('WorkflowDefinition schema', () => {
		it('exports WorkflowDefinitionSchema', () => {
			if (!typesModule) return;
			expect(typesModule.WorkflowDefinitionSchema).toBeDefined();
		});

		it('validates a complete workflow definition', () => {
			if (!typesModule) return;
			const schema = typesModule.WorkflowDefinitionSchema as { parse: (v: unknown) => unknown };

			const validDef = {
				id: 'wf-123',
				name: 'Provision Web Server',
				description: 'Deploy a compute instance',
				nodes: [
					{ id: 'n1', type: 'tool', data: { toolName: 'listImages' }, position: { x: 0, y: 0 } },
					{
						id: 'n2',
						type: 'tool',
						data: { toolName: 'launchInstance' },
						position: { x: 200, y: 0 }
					}
				],
				edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
				userId: 'user-1',
				orgId: 'org-1',
				createdAt: new Date(),
				updatedAt: new Date()
			};

			expect(() => schema.parse(validDef)).not.toThrow();
		});

		it('requires name and at least describes nodes/edges structure', () => {
			if (!typesModule) return;
			const schema = typesModule.WorkflowDefinitionSchema as { parse: (v: unknown) => unknown };

			// Missing name should fail
			expect(() =>
				schema.parse({
					id: 'wf-123',
					nodes: [],
					edges: [],
					createdAt: new Date(),
					updatedAt: new Date()
				})
			).toThrow();
		});
	});

	describe('WorkflowRun schema', () => {
		it('exports WorkflowRunSchema', () => {
			if (!typesModule) return;
			expect(typesModule.WorkflowRunSchema).toBeDefined();
		});

		it('validates a workflow run', () => {
			if (!typesModule) return;
			const schema = typesModule.WorkflowRunSchema as { parse: (v: unknown) => unknown };

			const validRun = {
				id: 'run-456',
				definitionId: 'wf-123',
				status: 'running',
				startedAt: new Date(),
				userId: 'user-1'
			};

			expect(() => schema.parse(validRun)).not.toThrow();
		});

		it('status must be one of pending, running, completed, failed, cancelled', () => {
			if (!typesModule) return;
			const schema = typesModule.WorkflowRunSchema as { parse: (v: unknown) => unknown };

			expect(() =>
				schema.parse({
					id: 'run-1',
					definitionId: 'wf-1',
					status: 'invalid_status',
					startedAt: new Date()
				})
			).toThrow();
		});
	});

	describe('WorkflowStep schema', () => {
		it('exports WorkflowStepSchema', () => {
			if (!typesModule) return;
			expect(typesModule.WorkflowStepSchema).toBeDefined();
		});

		it('validates a workflow step', () => {
			if (!typesModule) return;
			const schema = typesModule.WorkflowStepSchema as { parse: (v: unknown) => unknown };

			const validStep = {
				id: 'step-789',
				runId: 'run-456',
				nodeId: 'n1',
				status: 'completed',
				input: { compartmentId: 'ocid1...' },
				output: { data: [{ id: 'instance-1' }] },
				startedAt: new Date(),
				completedAt: new Date()
			};

			expect(() => schema.parse(validStep)).not.toThrow();
		});
	});
});

describe('Workflow Repository (Phase 7.4)', () => {
	describe('CRUD operations', () => {
		it('create inserts a workflow definition and returns it', async () => {
			if (!repoModule) return;
			const repo = repoModule.workflowRepository as {
				create: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
			};

			mockExecute
				.mockResolvedValueOnce({ rows: [] }) // insert
				.mockResolvedValueOnce({
					rows: [
						{
							ID: 'wf-new',
							NAME: 'Test Workflow',
							DESCRIPTION: 'A test',
							NODES: '[]',
							EDGES: '[]',
							USER_ID: 'u1',
							ORG_ID: 'o1',
							CREATED_AT: new Date(),
							UPDATED_AT: new Date()
						}
					]
				});

			const wf = await repo.create({
				name: 'Test Workflow',
				description: 'A test',
				nodes: [],
				edges: [],
				userId: 'u1',
				orgId: 'o1'
			});

			expect(wf).toBeDefined();
			expect(wf.name).toBe('Test Workflow');
		});

		it('getById returns null for non-existent workflow', async () => {
			if (!repoModule) return;
			const repo = repoModule.workflowRepository as {
				getById: (id: string) => Promise<Record<string, unknown> | null>;
			};

			mockExecute.mockResolvedValueOnce({ rows: [] });

			const wf = await repo.getById('non-existent');
			expect(wf).toBeNull();
		});

		it('list returns workflows filtered by userId', async () => {
			if (!repoModule) return;
			const repo = repoModule.workflowRepository as {
				list: (options?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
			};

			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'wf-1',
						NAME: 'WF 1',
						DESCRIPTION: '',
						NODES: '[]',
						EDGES: '[]',
						USER_ID: 'u1',
						ORG_ID: null,
						CREATED_AT: new Date(),
						UPDATED_AT: new Date()
					}
				]
			});

			const workflows = await repo.list({ userId: 'u1' });
			expect(workflows).toHaveLength(1);
		});

		it('update modifies workflow and returns updated version', async () => {
			if (!repoModule) return;
			const repo = repoModule.workflowRepository as {
				update: (
					id: string,
					input: Record<string, unknown>
				) => Promise<Record<string, unknown> | null>;
			};

			mockExecute
				.mockResolvedValueOnce({ rows: [] }) // update
				.mockResolvedValueOnce({
					rows: [
						{
							ID: 'wf-1',
							NAME: 'Updated Name',
							DESCRIPTION: 'new desc',
							NODES: '[]',
							EDGES: '[]',
							USER_ID: 'u1',
							ORG_ID: null,
							CREATED_AT: new Date(),
							UPDATED_AT: new Date()
						}
					]
				});

			const wf = await repo.update('wf-1', { name: 'Updated Name' });
			expect(wf).not.toBeNull();
			expect(wf!.name).toBe('Updated Name');
		});

		it('delete removes a workflow', async () => {
			if (!repoModule) return;
			const repo = repoModule.workflowRepository as {
				delete: (id: string) => Promise<void>;
			};

			mockExecute.mockResolvedValueOnce({ rows: [] });

			await expect(repo.delete('wf-1')).resolves.not.toThrow();
			expect(mockExecute).toHaveBeenCalled();
		});
	});

	describe('run tracking', () => {
		it('createRun starts a new workflow execution', async () => {
			if (!repoModule) return;
			const repo = repoModule.workflowRepository as {
				createRun: (defId: string, userId?: string) => Promise<Record<string, unknown>>;
			};

			mockExecute
				.mockResolvedValueOnce({ rows: [] }) // insert
				.mockResolvedValueOnce({
					rows: [
						{
							ID: 'run-1',
							DEFINITION_ID: 'wf-1',
							STATUS: 'pending',
							STARTED_AT: new Date(),
							USER_ID: 'u1'
						}
					]
				});

			const run = await repo.createRun('wf-1', 'u1');
			expect(run).toBeDefined();
			expect(run.status || run.STATUS).toMatch(/pending|running/);
		});

		it('updateStep records step completion with output', async () => {
			if (!repoModule) return;
			const repo = repoModule.workflowRepository as {
				updateStep: (
					stepId: string,
					input: Record<string, unknown>
				) => Promise<Record<string, unknown>>;
			};

			mockExecute
				.mockResolvedValueOnce({ rows: [] }) // update
				.mockResolvedValueOnce({
					rows: [
						{
							ID: 'step-1',
							RUN_ID: 'run-1',
							NODE_ID: 'n1',
							STATUS: 'completed',
							OUTPUT: '{"result":"ok"}',
							STARTED_AT: new Date(),
							COMPLETED_AT: new Date()
						}
					]
				});

			const step = await repo.updateStep('step-1', {
				status: 'completed',
				output: { result: 'ok' }
			});
			expect(step).toBeDefined();
		});
	});
});
