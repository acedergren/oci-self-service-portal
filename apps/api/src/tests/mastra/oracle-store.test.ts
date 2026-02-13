import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OracleConnection } from '@portal/server/oracle/connection.js';
import { WorkflowsOracle, MemoryOracle, ScoresOracle } from '../../mastra/storage/oracle-store.js';

/**
 * Mock connection factory with counter-based sequencing
 * Handles mockReset: true by using mockImplementation instead of chaining
 */
function createMockConnection() {
	const mocks = {
		execute: vi.fn<[sql: string, params?: Record<string, unknown>], Promise<unknown>>(),
		commit: vi.fn<[], Promise<void>>(),
		rollback: vi.fn<[], Promise<void>>(),
		close: vi.fn<[], Promise<void>>()
	};

	return {
		execute: mocks.execute,
		commit: mocks.commit,
		rollback: mocks.rollback,
		close: mocks.close,
		mocks
	} as OracleConnection & { mocks: typeof mocks };
}

/**
 * Mock withConnection implementation
 * Returns a function that takes a callback and executes it with the mock connection
 */
function createMockWithConnection(mockConn: OracleConnection & { mocks: Record<string, vi.Mock> }) {
	return async function withConnection<T>(fn: (conn: OracleConnection) => Promise<T>): Promise<T> {
		return fn(mockConn);
	};
}

describe('OracleStore Integration Tests', () => {
	let mockConn: OracleConnection & { mocks: Record<string, vi.Mock> };
	let mockWithConnection: (fn: (conn: OracleConnection) => Promise<unknown>) => Promise<unknown>;

	beforeEach(() => {
		mockConn = createMockConnection();
		mockWithConnection = createMockWithConnection(mockConn);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('WorkflowsOracle', () => {
		describe('getWorkflowRunById', () => {
			it('should return workflow run by id', async () => {
				const workflowRow = {
					WORKFLOW_NAME: 'test-workflow',
					RUN_ID: '12345678-1234-4123-8123-123456789012',
					RESOURCE_ID: '87654321-4321-3214-3214-210987654321',
					SNAPSHOT: JSON.stringify({ status: 'COMPLETED' }),
					CREATED_AT: new Date('2026-02-13T10:00:00Z'),
					UPDATED_AT: new Date('2026-02-13T10:00:00Z')
				};
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [workflowRow] });

				const workflows = new WorkflowsOracle(mockWithConnection);
				const result = await workflows.getWorkflowRunById({
					workflowRunId: '12345678-1234-4123-8123-123456789012'
				});

				expect(result).toBeDefined();
				expect(result?.runId).toBe('12345678-1234-4123-8123-123456789012');
				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('WHERE run_id = :workflowRunId'),
					expect.objectContaining({ workflowRunId: '12345678-1234-4123-8123-123456789012' })
				);
			});

			it('should return null when workflow run not found', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [] });

				const workflows = new WorkflowsOracle(mockWithConnection);
				const result = await workflows.getWorkflowRunById({
					workflowRunId: 'nonexistent-id'
				});

				expect(result).toBeNull();
			});
		});

		describe('listWorkflowRuns', () => {
			it('should list workflow runs with pagination', async () => {
				const workflowRows = [
					{
						WORKFLOW_NAME: 'workflow-1',
						RUN_ID: '11111111-1111-1111-1111-111111111111',
						RESOURCE_ID: '87654321-4321-3214-3214-210987654321',
						SNAPSHOT: JSON.stringify({ status: 'RUNNING' }),
						CREATED_AT: new Date('2026-02-13T10:00:00Z'),
						UPDATED_AT: new Date('2026-02-13T10:00:00Z')
					},
					{
						WORKFLOW_NAME: 'workflow-2',
						RUN_ID: '22222222-2222-2222-2222-222222222222',
						RESOURCE_ID: '87654321-4321-3214-3214-210987654321',
						SNAPSHOT: JSON.stringify({ status: 'COMPLETED' }),
						CREATED_AT: new Date('2026-02-13T11:00:00Z'),
						UPDATED_AT: new Date('2026-02-13T11:00:00Z')
					}
				];
				// Count query first
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [{ CNT: 2 }] });
				// Then data query
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: workflowRows });

				const workflows = new WorkflowsOracle(mockWithConnection);
				const result = await workflows.listWorkflowRuns({ page: 1, perPage: 10 });

				expect(result.runs).toHaveLength(2);
				expect(result.total).toBe(2);
			});

			it('should return empty list when no workflow runs exist', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [{ CNT: 0 }] });
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [] });

				const workflows = new WorkflowsOracle(mockWithConnection);
				const result = await workflows.listWorkflowRuns({});

				expect(result.runs).toHaveLength(0);
				expect(result.total).toBe(0);
			});
		});

		describe('updateWorkflowResults', () => {
			it('should update workflow run results', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({});
				mockConn.mocks.commit.mockResolvedValueOnce(undefined);

				const workflows = new WorkflowsOracle(mockWithConnection);
				await workflows.updateWorkflowResults({
					workflowRunId: '12345678-1234-4123-8123-123456789012',
					results: { success: true }
				});

				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('UPDATE'),
					expect.objectContaining({
						workflowRunId: '12345678-1234-4123-8123-123456789012'
					})
				);
				expect(mockConn.mocks.commit).toHaveBeenCalled();
			});
		});

		describe('updateWorkflowState', () => {
			it('should update workflow state', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({});
				mockConn.mocks.commit.mockResolvedValueOnce(undefined);

				const workflows = new WorkflowsOracle(mockWithConnection);
				await workflows.updateWorkflowState({
					workflowRunId: '12345678-1234-4123-8123-123456789012',
					status: 'COMPLETED'
				});

				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('UPDATE'),
					expect.objectContaining({
						workflowRunId: '12345678-1234-4123-8123-123456789012',
						status: 'COMPLETED'
					})
				);
				expect(mockConn.mocks.commit).toHaveBeenCalled();
			});
		});
	});

	describe('MemoryOracle - Threads', () => {
		describe('getThreadById', () => {
			it('should return thread by id', async () => {
				const threadRow = {
					ID: '22222222-2222-2222-2222-222222222222',
					RESOURCE_ID: '87654321-4321-3214-3214-210987654321',
					TITLE: 'Test Thread',
					METADATA: JSON.stringify({ info: 'test' }),
					CREATED_AT: new Date('2026-02-13T10:00:00Z'),
					UPDATED_AT: new Date('2026-02-13T10:00:00Z')
				};
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [threadRow] });

				const memory = new MemoryOracle(mockWithConnection);
				const result = await memory.getThreadById({
					threadId: '22222222-2222-2222-2222-222222222222'
				});

				expect(result).toBeDefined();
				expect(result?.id).toBe('22222222-2222-2222-2222-222222222222');
				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('WHERE id = :threadId'),
					expect.objectContaining({ threadId: '22222222-2222-2222-2222-222222222222' })
				);
			});

			it('should return null when thread not found', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [] });

				const memory = new MemoryOracle(mockWithConnection);
				const result = await memory.getThreadById({ threadId: 'nonexistent-thread' });

				expect(result).toBeNull();
			});
		});

		describe('listThreads', () => {
			it('should list threads with pagination', async () => {
				const threadRows = [
					{
						ID: '11111111-1111-1111-1111-111111111111',
						RESOURCE_ID: '87654321-4321-3214-3214-210987654321',
						TITLE: 'Thread 1',
						METADATA: JSON.stringify({}),
						CREATED_AT: new Date('2026-02-13T10:00:00Z'),
						UPDATED_AT: new Date('2026-02-13T10:00:00Z')
					}
				];
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [{ CNT: 1 }] });
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: threadRows });

				const memory = new MemoryOracle(mockWithConnection);
				const result = await memory.listThreads({ page: 1, perPage: 10 });

				expect(result.data).toHaveLength(1);
				expect(mockConn.mocks.execute).toHaveBeenCalled();
			});
		});
	});

	describe('MemoryOracle - Messages', () => {
		describe('listMessages', () => {
			it('should list messages ordered by creation date', async () => {
				const messageRows = [
					{
						ID: '44444444-4444-4444-4444-444444444444',
						THREAD_ID: '22222222-2222-2222-2222-222222222222',
						ROLE: 'user',
						TYPE: 'text',
						CONTENT: 'test message 1',
						RESOURCE_ID: null,
						CREATED_AT: new Date('2026-02-13T10:00:00Z')
					},
					{
						ID: '55555555-5555-5555-5555-555555555555',
						THREAD_ID: '22222222-2222-2222-2222-222222222222',
						ROLE: 'assistant',
						TYPE: 'text',
						CONTENT: 'test message 2',
						RESOURCE_ID: null,
						CREATED_AT: new Date('2026-02-13T11:00:00Z')
					}
				];
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: messageRows });

				const memory = new MemoryOracle(mockWithConnection);
				const result = await memory.listMessages({
					threadId: '22222222-2222-2222-2222-222222222222'
				});

				expect(result.data).toHaveLength(2);
				expect(result.data[0].createdAt).toBeBefore(result.data[1].createdAt);
				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('ORDER BY'),
					expect.any(Object)
				);
			});

			it('should return empty list when no messages exist', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [] });

				const memory = new MemoryOracle(mockWithConnection);
				const result = await memory.listMessages({
					threadId: '22222222-2222-2222-2222-222222222222'
				});

				expect(result.data).toHaveLength(0);
			});
		});

		describe('updateMessages', () => {
			it('should update messages with large payloads', async () => {
				const largeContent = 'x'.repeat(10000); // > 10KB
				mockConn.mocks.execute.mockResolvedValueOnce({});
				mockConn.mocks.commit.mockResolvedValueOnce(undefined);

				const memory = new MemoryOracle(mockWithConnection);
				await memory.updateMessages({
					messages: [
						{
							id: '44444444-4444-4444-4444-444444444444',
							threadId: '22222222-2222-2222-2222-222222222222',
							role: 'assistant',
							type: 'text',
							content: largeContent,
							createdAt: new Date(),
							updatedAt: new Date(),
							resourceId: null,
							metadata: {}
						}
					]
				});

				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('MERGE INTO'),
					expect.any(Object)
				);
				expect(mockConn.mocks.commit).toHaveBeenCalled();
			});
		});

		describe('listMessagesByResourceId', () => {
			it('should list messages filtered by resource id', async () => {
				const messageRows = [
					{
						ID: '44444444-4444-4444-4444-444444444444',
						THREAD_ID: '22222222-2222-2222-2222-222222222222',
						ROLE: 'user',
						TYPE: 'text',
						CONTENT: 'test message',
						RESOURCE_ID: 'resource-123',
						CREATED_AT: new Date('2026-02-13T10:00:00Z')
					}
				];
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: messageRows });

				const memory = new MemoryOracle(mockWithConnection);
				const result = await memory.listMessagesByResourceId({
					resourceId: 'resource-123'
				});

				expect(result.data).toHaveLength(1);
				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('WHERE'),
					expect.objectContaining({ resourceId: 'resource-123' })
				);
			});
		});
	});

	describe('MemoryOracle - Resources', () => {
		describe('getResourceById', () => {
			it('should return resource by id', async () => {
				const resourceRow = {
					ID: '66666666-6666-6666-6666-666666666666',
					RESOURCE_ID: 'doc-123',
					RESOURCE_TYPE: 'document',
					WORKING_MEMORY: JSON.stringify({ key: 'value' }),
					CREATED_AT: new Date('2026-02-13T10:00:00Z'),
					UPDATED_AT: new Date('2026-02-13T10:00:00Z')
				};
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [resourceRow] });

				const memory = new MemoryOracle(mockWithConnection);
				const result = await memory.getResourceById({
					resourceId: 'doc-123',
					resourceType: 'document'
				});

				expect(result).toBeDefined();
				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('WHERE'),
					expect.objectContaining({
						resourceId: 'doc-123',
						resourceType: 'document'
					})
				);
			});

			it('should return null when resource not found', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [] });

				const memory = new MemoryOracle(mockWithConnection);
				const result = await memory.getResourceById({
					resourceId: 'nonexistent',
					resourceType: 'document'
				});

				expect(result).toBeNull();
			});
		});

		describe('saveResource', () => {
			it('should save resource', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({});
				mockConn.mocks.commit.mockResolvedValueOnce(undefined);

				const memory = new MemoryOracle(mockWithConnection);
				await memory.saveResource({
					resourceId: 'doc-123',
					resourceType: 'document',
					workingMemory: { key: 'value' }
				});

				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('MERGE INTO'),
					expect.any(Object)
				);
				expect(mockConn.mocks.commit).toHaveBeenCalled();
			});
		});

		describe('updateResource', () => {
			it('should update resource metadata', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({});
				mockConn.mocks.commit.mockResolvedValueOnce(undefined);

				const memory = new MemoryOracle(mockWithConnection);
				await memory.updateResource({
					resourceId: 'resource-123',
					resourceType: 'document',
					workingMemory: { updated: true }
				});

				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('UPDATE'),
					expect.any(Object)
				);
				expect(mockConn.mocks.commit).toHaveBeenCalled();
			});
		});

		describe('saveThread', () => {
			it('should save thread', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({});
				mockConn.mocks.commit.mockResolvedValueOnce(undefined);

				const memory = new MemoryOracle(mockWithConnection);
				const thread = {
					id: '22222222-2222-2222-2222-222222222222',
					resourceId: 'resource-123',
					title: 'Test Thread',
					metadata: { info: 'test' },
					createdAt: new Date(),
					updatedAt: new Date()
				};
				await memory.saveThread({ thread });

				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('INSERT INTO'),
					expect.any(Object)
				);
				expect(mockConn.mocks.commit).toHaveBeenCalled();
			});
		});

		describe('updateThread', () => {
			it('should update thread with title and metadata', async () => {
				const updatedThreadRow = {
					ID: '22222222-2222-2222-2222-222222222222',
					RESOURCE_ID: 'resource-123',
					TITLE: 'Updated Title',
					METADATA: JSON.stringify({ updated: true }),
					CREATED_AT: new Date('2026-02-13T10:00:00Z'),
					UPDATED_AT: new Date('2026-02-13T11:00:00Z')
				};
				mockConn.mocks.execute.mockResolvedValueOnce({});
				mockConn.mocks.commit.mockResolvedValueOnce(undefined);
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [updatedThreadRow] });

				const memory = new MemoryOracle(mockWithConnection);
				await memory.updateThread({
					id: '22222222-2222-2222-2222-222222222222',
					title: 'Updated Title',
					metadata: { updated: true }
				});

				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('UPDATE'),
					expect.any(Object)
				);
				expect(mockConn.mocks.commit).toHaveBeenCalled();
			});
		});

		describe('deleteThread', () => {
			it('should delete thread', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({});
				mockConn.mocks.commit.mockResolvedValueOnce(undefined);

				const memory = new MemoryOracle(mockWithConnection);
				await memory.deleteThread({
					threadId: '22222222-2222-2222-2222-222222222222'
				});

				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('DELETE'),
					expect.objectContaining({
						threadId: '22222222-2222-2222-2222-222222222222'
					})
				);
				expect(mockConn.mocks.commit).toHaveBeenCalled();
			});
		});

		describe('listMessagesById', () => {
			it('should list messages by specific ids', async () => {
				const messageRows = [
					{
						ID: '44444444-4444-4444-4444-444444444444',
						THREAD_ID: '22222222-2222-2222-2222-222222222222',
						ROLE: 'user',
						TYPE: 'text',
						CONTENT: 'test message',
						RESOURCE_ID: null,
						CREATED_AT: new Date('2026-02-13T10:00:00Z')
					}
				];
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: messageRows });

				const memory = new MemoryOracle(mockWithConnection);
				const result = await memory.listMessagesById({
					messageIds: ['44444444-4444-4444-4444-444444444444']
				});

				expect(result.messages).toHaveLength(1);
				expect(result.messages[0].id).toBe('44444444-4444-4444-4444-444444444444');
			});
		});
	});

	describe('ScoresOracle', () => {
		describe('getScoreById', () => {
			it('should return score by id', async () => {
				const scoreRow = {
					ID: '55555555-5555-5555-5555-555555555555',
					RUN_ID: '12345678-1234-4123-8123-123456789012',
					SPAN_ID: null,
					SCORER_ID: 'scorer-1',
					ENTITY_ID: 'entity-1',
					ENTITY_TYPE: 'span',
					SCORE: 0.85,
					REASON: 'good quality',
					CREATED_AT: new Date('2026-02-13T10:00:00Z'),
					METADATA: JSON.stringify({})
				};
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [scoreRow] });

				const scores = new ScoresOracle(mockWithConnection);
				const result = await scores.getScoreById({
					scoreId: '55555555-5555-5555-5555-555555555555'
				});

				expect(result).toBeDefined();
				expect(result?.id).toBe('55555555-5555-5555-5555-555555555555');
			});

			it('should return null when score not found', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [] });

				const scores = new ScoresOracle(mockWithConnection);
				const result = await scores.getScoreById({ scoreId: 'nonexistent-id' });

				expect(result).toBeNull();
			});
		});

		describe('listScoresByRunId', () => {
			it('should list scores filtered by run id', async () => {
				const scoreRows = [
					{
						ID: '55555555-5555-5555-5555-555555555555',
						RUN_ID: '12345678-1234-4123-8123-123456789012',
						SPAN_ID: null,
						SCORER_ID: 'scorer-1',
						ENTITY_ID: 'entity-1',
						ENTITY_TYPE: 'span',
						SCORE: 0.85,
						REASON: 'good quality',
						CREATED_AT: new Date('2026-02-13T10:00:00Z'),
						METADATA: JSON.stringify({})
					}
				];
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [{ CNT: 1 }] });
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: scoreRows });

				const scores = new ScoresOracle(mockWithConnection);
				const result = await scores.listScoresByRunId({
					runId: '12345678-1234-4123-8123-123456789012',
					page: 1,
					perPage: 10
				});

				expect(result.data).toHaveLength(1);
			});
		});

		describe('listScoresBySpan', () => {
			it('should list scores filtered by span id', async () => {
				const scoreRows = [
					{
						ID: '55555555-5555-5555-5555-555555555555',
						RUN_ID: '12345678-1234-4123-8123-123456789012',
						SPAN_ID: 'span-123',
						SCORER_ID: 'scorer-1',
						ENTITY_ID: 'span-123',
						ENTITY_TYPE: 'span',
						SCORE: 0.85,
						REASON: 'good quality',
						CREATED_AT: new Date('2026-02-13T10:00:00Z'),
						METADATA: JSON.stringify({})
					}
				];
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [{ CNT: 1 }] });
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: scoreRows });

				const scores = new ScoresOracle(mockWithConnection);
				const result = await scores.listScoresBySpan({
					spanId: 'span-123',
					page: 1,
					perPage: 10
				});

				expect(result.data).toHaveLength(1);
			});

			it('should return empty list for missing span', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [{ CNT: 0 }] });
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [] });

				const scores = new ScoresOracle(mockWithConnection);
				const result = await scores.listScoresBySpan({
					spanId: 'nonexistent-span',
					page: 1,
					perPage: 10
				});

				expect(result.data).toHaveLength(0);
			});
		});

		describe('listScoresByScorerId', () => {
			it('should list scores by scorer id', async () => {
				const scoreRows = [
					{
						ID: '55555555-5555-5555-5555-555555555555',
						RUN_ID: '12345678-1234-4123-8123-123456789012',
						SPAN_ID: null,
						SCORER_ID: 'scorer-1',
						ENTITY_ID: 'entity-1',
						ENTITY_TYPE: 'span',
						SCORE: 0.85,
						REASON: 'good quality',
						CREATED_AT: new Date('2026-02-13T10:00:00Z'),
						METADATA: JSON.stringify({})
					}
				];
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [{ CNT: 1 }] });
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: scoreRows });

				const scores = new ScoresOracle(mockWithConnection);
				const result = await scores.listScoresByScorerId({
					scorerId: 'scorer-1',
					page: 1,
					perPage: 10
				});

				expect(result.data).toHaveLength(1);
			});
		});

		describe('listScoresByEntityId', () => {
			it('should list scores by entity id', async () => {
				const scoreRows = [
					{
						ID: '55555555-5555-5555-5555-555555555555',
						RUN_ID: '12345678-1234-4123-8123-123456789012',
						SPAN_ID: null,
						SCORER_ID: 'scorer-1',
						ENTITY_ID: 'entity-123',
						ENTITY_TYPE: 'span',
						SCORE: 0.85,
						REASON: 'good quality',
						CREATED_AT: new Date('2026-02-13T10:00:00Z'),
						METADATA: JSON.stringify({})
					}
				];
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [{ CNT: 1 }] });
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: scoreRows });

				const scores = new ScoresOracle(mockWithConnection);
				const result = await scores.listScoresByEntityId({
					entityId: 'entity-123',
					page: 1,
					perPage: 10
				});

				expect(result.data).toHaveLength(1);
			});
		});

		describe('saveScore', () => {
			it('should save score using upsert', async () => {
				mockConn.mocks.execute.mockResolvedValueOnce({});
				mockConn.mocks.commit.mockResolvedValueOnce(undefined);
				mockConn.mocks.execute.mockResolvedValueOnce({ rows: [] }); // Return for getScoreById

				const scores = new ScoresOracle(mockWithConnection);
				await scores.saveScore({
					runId: '12345678-1234-4123-8123-123456789012',
					scorerId: 'scorer-1',
					score: 0.95,
					metadata: { reason: 'excellent' }
				});

				expect(mockConn.mocks.execute).toHaveBeenCalledWith(
					expect.stringContaining('MERGE INTO'),
					expect.any(Object)
				);
				expect(mockConn.mocks.commit).toHaveBeenCalled();
			});
		});
	});
});
