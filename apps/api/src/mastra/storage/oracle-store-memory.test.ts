import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryOracle } from './oracle-store.js';

// ── Mock Oracle connection ──────────────────────────────────────────────

function createMockConnection() {
	return {
		OBJECT: 4003,
	execute: vi.fn().mockResolvedValue({ rows: [] }),
		commit: vi.fn().mockResolvedValue(undefined),
		rollback: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined)
	};
}

function createMockWithConnection(mockConn = createMockConnection()) {
	const withConnection = vi.fn(async (fn: (conn: typeof mockConn) => unknown) => fn(mockConn));
	return { withConnection, mockConn };
}

// ── Thread Methods ──────────────────────────────────────────────────────

describe('MemoryOracle — Threads', () => {
	let mem: MemoryOracle;
	let mockConn: ReturnType<typeof createMockConnection>;

	beforeEach(() => {
		const mock = createMockWithConnection();
		mem = new MemoryOracle(mock.withConnection);
		mockConn = mock.mockConn;
	});

	describe('getThreadById', () => {
		it('returns thread when found', async () => {
			const now = new Date();
			mockConn.execute.mockResolvedValue({
				rows: [
					{
						ID: 't-1',
						RESOURCE_ID: 'user-1',
						TITLE: 'Test Thread',
						METADATA: JSON.stringify({ key: 'value' }),
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			const result = await mem.getThreadById({ threadId: 't-1' });

			expect(result).not.toBeNull();
			expect(result!.id).toBe('t-1');
			expect(result!.resourceId).toBe('user-1');
			expect(result!.title).toBe('Test Thread');
			expect(result!.metadata).toEqual({ key: 'value' });
		});

		it('returns null when not found', async () => {
			mockConn.execute.mockResolvedValue({ rows: [] });
			const result = await mem.getThreadById({ threadId: 'nonexistent' });
			expect(result).toBeNull();
		});

		it('uses correct bind variable', async () => {
			mockConn.execute.mockResolvedValue({ rows: [] });
			await mem.getThreadById({ threadId: 'my-thread' });

			const binds = mockConn.execute.mock.calls[0][1] as Record<string, unknown>;
			expect(binds.threadId).toBe('my-thread');
		});
	});

	describe('saveThread', () => {
		it('inserts thread and commits', async () => {
			const thread = {
				id: 't-new',
				resourceId: 'user-1',
				title: 'New Thread',
				metadata: { tag: 'test' },
				createdAt: new Date(),
				updatedAt: new Date()
			};

			const result = await mem.saveThread({ thread });

			expect(result).toEqual(thread);
			const sql = mockConn.execute.mock.calls[0][0] as string;
			expect(sql).toContain('INSERT INTO mastra_threads');
			expect(mockConn.commit).toHaveBeenCalled();
		});

		it('serializes metadata to JSON', async () => {
			await mem.saveThread({
				thread: {
					id: 't-1',
					resourceId: 'user-1',
					metadata: { nested: { deep: true } },
					createdAt: new Date(),
					updatedAt: new Date()
				}
			});

			const binds = mockConn.execute.mock.calls[0][1] as Record<string, unknown>;
			expect(JSON.parse(binds.metadata as string)).toEqual({
				nested: { deep: true }
			});
		});

		it('handles null metadata and title', async () => {
			await mem.saveThread({
				thread: {
					id: 't-1',
					resourceId: 'user-1',
					createdAt: new Date(),
					updatedAt: new Date()
				}
			});

			const binds = mockConn.execute.mock.calls[0][1] as Record<string, unknown>;
			expect(binds.title).toBeNull();
			expect(binds.metadata).toBeNull();
		});
	});

	describe('updateThread', () => {
		it('updates and re-fetches thread', async () => {
			const now = new Date();
			// First call: UPDATE, second call: SELECT
			mockConn.execute.mockResolvedValueOnce({ rowsAffected: 1 }).mockResolvedValueOnce({
				rows: [
					{
						ID: 't-1',
						RESOURCE_ID: 'user-1',
						TITLE: 'Updated Title',
						METADATA: JSON.stringify({ updated: true }),
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			const result = await mem.updateThread({
				id: 't-1',
				title: 'Updated Title',
				metadata: { updated: true }
			});

			expect(result.title).toBe('Updated Title');
			const updateSql = mockConn.execute.mock.calls[0][0] as string;
			expect(updateSql).toContain('UPDATE mastra_threads');
			expect(mockConn.commit).toHaveBeenCalled();
		});

		it('throws when thread not found after update', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rowsAffected: 0 }) // UPDATE
				.mockResolvedValueOnce({ rows: [] }); // SELECT returns empty

			await expect(mem.updateThread({ id: 'missing', title: 'T', metadata: {} })).rejects.toThrow(
				'Thread not found after update'
			);
		});
	});

	describe('deleteThread', () => {
		it('deletes by threadId and commits', async () => {
			await mem.deleteThread({ threadId: 't-del' });

			const sql = mockConn.execute.mock.calls[0][0] as string;
			expect(sql).toContain('DELETE FROM mastra_threads');
			expect(sql).toContain('id = :threadId');
			expect(mockConn.commit).toHaveBeenCalled();
		});
	});

	describe('listThreads', () => {
		it('returns empty list when no threads', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ CNT: 0 }] })
				.mockResolvedValueOnce({ rows: [] });

			const result = await mem.listThreads({});

			expect(result.threads).toEqual([]);
			expect(result.total).toBe(0);
		});

		it('filters by resourceId', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ CNT: 0 }] })
				.mockResolvedValueOnce({ rows: [] });

			await mem.listThreads({ filter: { resourceId: 'user-1' } });

			const countSql = mockConn.execute.mock.calls[0][0] as string;
			expect(countSql).toContain('resource_id = :resourceId');
		});

		it('uses OFFSET/FETCH pagination', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ CNT: 50 }] })
				.mockResolvedValueOnce({ rows: [] });

			await mem.listThreads({ page: 2, perPage: 10 });

			const dataSql = mockConn.execute.mock.calls[1][0] as string;
			expect(dataSql).toContain('OFFSET :offset ROWS FETCH NEXT :limit');
		});
	});
});

// ── Message Methods ─────────────────────────────────────────────────────

describe('MemoryOracle — Messages', () => {
	let mem: MemoryOracle;
	let mockConn: ReturnType<typeof createMockConnection>;

	beforeEach(() => {
		const mock = createMockWithConnection();
		mem = new MemoryOracle(mock.withConnection);
		mockConn = mock.mockConn;
	});

	describe('saveMessages', () => {
		it('inserts each message and commits', async () => {
			const messages = [
				{
					id: 'm-1',
					threadId: 't-1',
					role: 'user' as const,
					content: { format: 2 as const, parts: [] },
					createdAt: new Date()
				},
				{
					id: 'm-2',
					threadId: 't-1',
					role: 'assistant' as const,
					content: { format: 2 as const, parts: [] },
					createdAt: new Date()
				}
			];

			const result = await mem.saveMessages({ messages });

			expect(result.messages).toEqual(messages);
			// 2 INSERT calls + 1 commit
			expect(mockConn.execute).toHaveBeenCalledTimes(2);
			expect(mockConn.commit).toHaveBeenCalled();
		});

		it('skips insert for empty messages', async () => {
			await mem.saveMessages({ messages: [] });
			expect(mockConn.execute).not.toHaveBeenCalled();
		});

		it('serializes content to JSON', async () => {
			await mem.saveMessages({
				messages: [
					{
						id: 'm-1',
						role: 'user' as const,
						content: {
							format: 2 as const,
							parts: [{ type: 'text', text: 'Hello' }]
						},
						createdAt: new Date()
					}
				]
			});

			const binds = mockConn.execute.mock.calls[0][1] as Record<string, unknown>;
			const parsed = JSON.parse(binds.content as string);
			expect(parsed.parts[0].text).toBe('Hello');
		});
	});

	describe('listMessages', () => {
		it('filters by single threadId', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ CNT: 0 }] })
				.mockResolvedValueOnce({ rows: [] });

			await mem.listMessages({ threadId: 't-1' });

			const countSql = mockConn.execute.mock.calls[0][0] as string;
			expect(countSql).toContain('thread_id = :threadId');
		});

		it('filters by array of threadIds', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ CNT: 0 }] })
				.mockResolvedValueOnce({ rows: [] });

			await mem.listMessages({ threadId: ['t-1', 't-2'] });

			const countSql = mockConn.execute.mock.calls[0][0] as string;
			expect(countSql).toContain('thread_id IN');
			expect(countSql).toContain(':threadId0');
			expect(countSql).toContain(':threadId1');
		});

		it('orders by created_at ASC by default', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rows: [{ CNT: 0 }] })
				.mockResolvedValueOnce({ rows: [] });

			await mem.listMessages({});

			const dataSql = mockConn.execute.mock.calls[1][0] as string;
			expect(dataSql).toContain('ORDER BY created_at ASC');
		});
	});

	describe('listMessagesById', () => {
		it('returns empty for empty IDs', async () => {
			const result = await mem.listMessagesById({ messageIds: [] });
			expect(result.messages).toEqual([]);
		});

		it('uses numbered bind variables for IN clause', async () => {
			mockConn.execute.mockResolvedValue({ rows: [] });

			await mem.listMessagesById({ messageIds: ['m-1', 'm-2', 'm-3'] });

			const sql = mockConn.execute.mock.calls[0][0] as string;
			expect(sql).toContain(':id0');
			expect(sql).toContain(':id1');
			expect(sql).toContain(':id2');
		});
	});

	describe('updateMessages', () => {
		it('loads current message, merges, and updates', async () => {
			const now = new Date();
			// First: SELECT to load current message
			mockConn.execute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'm-1',
						THREAD_ID: 't-1',
						ROLE: 'user',
						TYPE: null,
						CONTENT: JSON.stringify({ format: 2, parts: [] }),
						RESOURCE_ID: 'user-1',
						CREATED_AT: now
					}
				]
			});
			// Second: UPDATE
			mockConn.execute.mockResolvedValueOnce({ rowsAffected: 1 });

			const result = await mem.updateMessages({
				messages: [{ id: 'm-1', role: 'assistant' }]
			});

			expect(result[0].role).toBe('assistant');
			expect(result[0].id).toBe('m-1');
			expect(mockConn.commit).toHaveBeenCalled();
		});

		it('throws when message not found', async () => {
			mockConn.execute.mockResolvedValue({ rows: [] });

			await expect(mem.updateMessages({ messages: [{ id: 'missing' }] })).rejects.toThrow(
				'Message not found for update'
			);
		});
	});
});

// ── Resource Methods ────────────────────────────────────────────────────

describe('MemoryOracle — Resources', () => {
	let mem: MemoryOracle;
	let mockConn: ReturnType<typeof createMockConnection>;

	beforeEach(() => {
		const mock = createMockWithConnection();
		mem = new MemoryOracle(mock.withConnection);
		mockConn = mock.mockConn;
	});

	describe('getResourceById', () => {
		it('returns resource when found', async () => {
			const now = new Date();
			mockConn.execute.mockResolvedValue({
				rows: [
					{
						ID: 'r-1',
						WORKING_MEMORY: 'some working memory',
						METADATA: JSON.stringify({ key: 'val' }),
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			const result = await mem.getResourceById({ resourceId: 'r-1' });

			expect(result).not.toBeNull();
			expect(result!.id).toBe('r-1');
			expect(result!.workingMemory).toBe('some working memory');
			expect(result!.metadata).toEqual({ key: 'val' });
		});

		it('returns null when not found', async () => {
			mockConn.execute.mockResolvedValue({ rows: [] });
			const result = await mem.getResourceById({ resourceId: 'missing' });
			expect(result).toBeNull();
		});
	});

	describe('saveResource', () => {
		it('uses MERGE INTO for upsert', async () => {
			await mem.saveResource({
				resource: {
					id: 'r-1',
					workingMemory: 'mem',
					metadata: { k: 1 },
					createdAt: new Date(),
					updatedAt: new Date()
				}
			});

			const sql = mockConn.execute.mock.calls[0][0] as string;
			expect(sql).toContain('MERGE INTO mastra_resources');
			expect(sql).toContain('WHEN MATCHED THEN UPDATE');
			expect(sql).toContain('WHEN NOT MATCHED THEN INSERT');
			expect(mockConn.commit).toHaveBeenCalled();
		});
	});

	describe('updateResource', () => {
		it('builds dynamic SET clause for workingMemory', async () => {
			const now = new Date();
			// UPDATE then SELECT
			mockConn.execute.mockResolvedValueOnce({ rowsAffected: 1 }).mockResolvedValueOnce({
				rows: [
					{
						ID: 'r-1',
						WORKING_MEMORY: 'updated',
						METADATA: null,
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			const result = await mem.updateResource({
				resourceId: 'r-1',
				workingMemory: 'updated'
			});

			const updateSql = mockConn.execute.mock.calls[0][0] as string;
			expect(updateSql).toContain('working_memory = :workingMemory');
			expect(result.workingMemory).toBe('updated');
		});

		it('builds dynamic SET clause for metadata', async () => {
			const now = new Date();
			mockConn.execute.mockResolvedValueOnce({ rowsAffected: 1 }).mockResolvedValueOnce({
				rows: [
					{
						ID: 'r-1',
						WORKING_MEMORY: null,
						METADATA: JSON.stringify({ updated: true }),
						CREATED_AT: now,
						UPDATED_AT: now
					}
				]
			});

			await mem.updateResource({
				resourceId: 'r-1',
				metadata: { updated: true }
			});

			const updateSql = mockConn.execute.mock.calls[0][0] as string;
			expect(updateSql).toContain('metadata = :metadata');
		});

		it('throws when resource not found after update', async () => {
			mockConn.execute
				.mockResolvedValueOnce({ rowsAffected: 0 })
				.mockResolvedValueOnce({ rows: [] });

			await expect(mem.updateResource({ resourceId: 'gone', workingMemory: 'x' })).rejects.toThrow(
				'Resource not found after update'
			);
		});
	});
});
