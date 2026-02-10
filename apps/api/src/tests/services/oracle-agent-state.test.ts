/**
 * OracleAgentStateRepository tests using strict TDD.
 *
 * Testing agent session/turn storage with Oracle ADB 26AI backend.
 * Validates UPPERCASE→camelCase mapping, async operations, and org_id/thread_id support.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OracleConnection } from '@portal/shared/server/oracle/connection';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock logger
vi.mock('@portal/shared/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

// Mock Oracle connection with forwarding pattern
const mockExecute = vi.fn();
const mockConnection: OracleConnection = {
	execute: mockExecute,
	close: vi.fn().mockResolvedValue(undefined),
	commit: vi.fn().mockResolvedValue(undefined),
	rollback: vi.fn().mockResolvedValue(undefined)
};

vi.mock('@portal/shared/server/oracle/connection', () => ({
	withConnection: vi.fn(async (fn: (conn: OracleConnection) => Promise<unknown>) =>
		fn(mockConnection)
	)
}));

// ── Test Setup ───────────────────────────────────────────────────────────────

describe('OracleAgentStateRepository', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let repository: any;

	beforeEach(async () => {
		vi.clearAllMocks();
		const { OracleAgentStateRepository } = await import(
			'@portal/shared/server/agent-state/oracle-repository'
		);
		repository = new OracleAgentStateRepository();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	// ── createSession ────────────────────────────────────────────────────────

	describe('createSession', () => {
		it('should insert session with UUID and return Session with camelCase fields', async () => {
			const now = Date.now();
			const sessionId = 'test-session-id';

			// Mock INSERT (call 1) then SELECT (call 2)
			let callCount = 0;
			mockExecute.mockImplementation(async (sql: string) => {
				callCount++;
				if (callCount === 1) {
					// INSERT
					expect(sql).toContain('INSERT INTO agent_sessions');
					expect(sql).toContain(':id');
					expect(sql).toContain(':model');
					expect(sql).toContain(':region');
					return { rows: [] };
				}
				if (callCount === 2) {
					// SELECT
					expect(sql).toContain('SELECT');
					expect(sql).toContain('FROM agent_sessions');
					expect(sql).toContain('WHERE id = :id');
					return {
						rows: [
							{
								ID: sessionId,
								ORG_ID: null,
								THREAD_ID: null,
								CREATED_AT: new Date(now),
								UPDATED_AT: new Date(now),
								TITLE: null,
								MODEL: 'gpt-4',
								REGION: 'us-east-1',
								STATUS: 'active',
								CONFIG: null
							}
						]
					};
				}
				return { rows: [] };
			});

			const session = await repository.createSession({
				id: sessionId,
				model: 'gpt-4',
				region: 'us-east-1'
			});

			expect(session).toMatchObject({
				id: sessionId,
				model: 'gpt-4',
				region: 'us-east-1',
				status: 'active'
			});
			expect(session.createdAt).toBeTypeOf('number');
			expect(session.updatedAt).toBeTypeOf('number');
			expect(mockExecute).toHaveBeenCalledTimes(2);
		});

		it('should store config as JSON CLOB and include org_id/thread_id', async () => {
			const now = Date.now();
			const config = { temperature: 0.7, maxTokens: 1000 };

			let callCount = 0;
			mockExecute.mockImplementation(async (sql: string, binds?: Record<string, unknown>) => {
				callCount++;
				if (callCount === 1) {
					expect(binds?.config).toBe(JSON.stringify(config));
					expect(binds?.orgId).toBe('org-123');
					expect(binds?.threadId).toBe('thread-456');
					return { rows: [] };
				}
				if (callCount === 2) {
					return {
						rows: [
							{
								ID: 'sess-1',
								ORG_ID: 'org-123',
								THREAD_ID: 'thread-456',
								CREATED_AT: new Date(now),
								UPDATED_AT: new Date(now),
								TITLE: 'Test Session',
								MODEL: 'claude-3',
								REGION: 'us-west-2',
								STATUS: 'active',
								CONFIG: JSON.stringify(config)
							}
						]
					};
				}
				return { rows: [] };
			});

			const session = await repository.createSession({
				id: 'sess-1',
				model: 'claude-3',
				region: 'us-west-2',
				title: 'Test Session',
				orgId: 'org-123',
				threadId: 'thread-456',
				config
			});

			expect(session.config).toEqual(config);
		});
	});

	// ── getSession ───────────────────────────────────────────────────────────

	describe('getSession', () => {
		it('should return Session with camelCase fields or null', async () => {
			const now = Date.now();
			mockExecute.mockResolvedValue({
				rows: [
					{
						ID: 'sess-1',
						ORG_ID: 'org-1',
						THREAD_ID: 'thread-1',
						CREATED_AT: new Date(now),
						UPDATED_AT: new Date(now),
						TITLE: 'My Session',
						MODEL: 'gpt-4',
						REGION: 'us-east-1',
						STATUS: 'completed',
						CONFIG: JSON.stringify({ temperature: 0.5 })
					}
				]
			});

			const session = await repository.getSession('sess-1');

			expect(session).toMatchObject({
				id: 'sess-1',
				model: 'gpt-4',
				region: 'us-east-1',
				status: 'completed',
				title: 'My Session',
				config: { temperature: 0.5 }
			});
			expect(session.createdAt).toBeTypeOf('number');
			expect(session.updatedAt).toBeTypeOf('number');
		});

		it('should return null for non-existent session', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			const session = await repository.getSession('nonexistent');

			expect(session).toBeNull();
		});

		it('should parse config through SessionConfigSchema', async () => {
			const now = Date.now();
			mockExecute.mockResolvedValue({
				rows: [
					{
						ID: 'sess-1',
						ORG_ID: null,
						THREAD_ID: null,
						CREATED_AT: new Date(now),
						UPDATED_AT: new Date(now),
						TITLE: null,
						MODEL: 'gpt-4',
						REGION: 'us-east-1',
						STATUS: 'active',
						CONFIG: JSON.stringify({ temperature: 0.9, agentRole: 'assistant' })
					}
				]
			});

			const session = await repository.getSession('sess-1');

			expect(session.config).toEqual({ temperature: 0.9, agentRole: 'assistant' });
		});
	});

	// ── listSessions ─────────────────────────────────────────────────────────

	describe('listSessions', () => {
		it('should return sessions ordered by updated_at DESC', async () => {
			const now = Date.now();
			mockExecute.mockResolvedValue({
				rows: [
					{
						ID: 'sess-2',
						ORG_ID: null,
						THREAD_ID: null,
						CREATED_AT: new Date(now - 1000),
						UPDATED_AT: new Date(now),
						TITLE: 'Recent',
						MODEL: 'gpt-4',
						REGION: 'us-east-1',
						STATUS: 'active',
						CONFIG: null
					},
					{
						ID: 'sess-1',
						ORG_ID: null,
						THREAD_ID: null,
						CREATED_AT: new Date(now - 2000),
						UPDATED_AT: new Date(now - 500),
						TITLE: 'Older',
						MODEL: 'gpt-4',
						REGION: 'us-east-1',
						STATUS: 'active',
						CONFIG: null
					}
				]
			});

			const sessions = await repository.listSessions();

			expect(sessions).toHaveLength(2);
			expect(sessions[0].id).toBe('sess-2');
			expect(sessions[1].id).toBe('sess-1');
			expect(mockExecute).toHaveBeenCalledWith(
				expect.stringContaining('ORDER BY updated_at DESC'),
				expect.any(Object)
			);
		});

		it('should filter by status and org_id with FETCH FIRST', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			await repository.listSessions({ status: 'completed', orgId: 'org-123', limit: 10 });

			expect(mockExecute).toHaveBeenCalledWith(
				expect.stringContaining('WHERE status = :status AND org_id = :orgId'),
				expect.objectContaining({
					status: 'completed',
					orgId: 'org-123',
					limit: 10
				})
			);
			expect(mockExecute).toHaveBeenCalledWith(
				expect.stringContaining('FETCH FIRST :limit ROWS ONLY'),
				expect.any(Object)
			);
		});

		it('should return empty array for no matches', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			const sessions = await repository.listSessions({ status: 'error' });

			expect(sessions).toEqual([]);
		});
	});

	// ── updateSession ────────────────────────────────────────────────────────

	describe('updateSession', () => {
		it('should update title/status/updated_at and return updated Session', async () => {
			const now = Date.now();

			let callCount = 0;
			mockExecute.mockImplementation(async (sql: string) => {
				callCount++;
				if (callCount === 1) {
					// UPDATE
					expect(sql).toContain('UPDATE agent_sessions');
					expect(sql).toContain('SET');
					expect(sql).toContain('title = :title');
					expect(sql).toContain('status = :status');
					expect(sql).toContain('updated_at = :updatedAt');
					expect(sql).toContain('WHERE id = :id');
					return { rows: [] };
				}
				if (callCount === 2) {
					// SELECT
					return {
						rows: [
							{
								ID: 'sess-1',
								ORG_ID: null,
								THREAD_ID: null,
								CREATED_AT: new Date(now - 1000),
								UPDATED_AT: new Date(now),
								TITLE: 'Updated Title',
								MODEL: 'gpt-4',
								REGION: 'us-east-1',
								STATUS: 'completed',
								CONFIG: null
							}
						]
					};
				}
				return { rows: [] };
			});

			const session = await repository.updateSession('sess-1', {
				title: 'Updated Title',
				status: 'completed'
			});

			expect(session).toMatchObject({
				id: 'sess-1',
				title: 'Updated Title',
				status: 'completed'
			});
			expect(mockExecute).toHaveBeenCalledTimes(2);
		});

		it('should skip unset fields', async () => {
			const now = Date.now();

			let callCount = 0;
			mockExecute.mockImplementation(async (sql: string, binds?: Record<string, unknown>) => {
				callCount++;
				if (callCount === 1) {
					expect(sql).toContain('status = :status');
					expect(sql).not.toContain('title = :title');
					expect(binds?.status).toBe('error');
					return { rows: [] };
				}
				if (callCount === 2) {
					return {
						rows: [
							{
								ID: 'sess-1',
								ORG_ID: null,
								THREAD_ID: null,
								CREATED_AT: new Date(now),
								UPDATED_AT: new Date(now),
								TITLE: 'Original Title',
								MODEL: 'gpt-4',
								REGION: 'us-east-1',
								STATUS: 'error',
								CONFIG: null
							}
						]
					};
				}
				return { rows: [] };
			});

			const session = await repository.updateSession('sess-1', { status: 'error' });

			expect(session.status).toBe('error');
			expect(session.title).toBe('Original Title');
		});

		it('should return null for non-existent session', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			const session = await repository.updateSession('nonexistent', { status: 'completed' });

			expect(session).toBeNull();
		});
	});

	// ── addTurn ──────────────────────────────────────────────────────────────

	describe('addTurn', () => {
		it('should insert turn with session_id and update parent session updated_at', async () => {
			const now = Date.now();
			const userMessage = { role: 'user' as const, content: 'Hello' };

			let callCount = 0;
			mockExecute.mockImplementation(async (sql: string, binds?: Record<string, unknown>) => {
				callCount++;
				if (callCount === 1) {
					// INSERT turn
					expect(sql).toContain('INSERT INTO agent_turns');
					expect(sql).toContain(':sessionId');
					expect(sql).toContain(':turnNumber');
					expect(sql).toContain(':userMessage');
					expect(binds?.userMessage).toBe(JSON.stringify(userMessage));
					expect(binds?.toolCalls).toBe('[]');
					return { rows: [] };
				}
				if (callCount === 2) {
					// UPDATE parent session
					expect(sql).toContain('UPDATE agent_sessions');
					expect(sql).toContain('SET updated_at = :updatedAt');
					expect(sql).toContain('WHERE id = :sessionId');
					return { rows: [] };
				}
				if (callCount === 3) {
					// SELECT turn
					return {
						rows: [
							{
								ID: 'turn-1',
								SESSION_ID: 'sess-1',
								TURN_NUMBER: 1,
								CREATED_AT: new Date(now),
								USER_MESSAGE: JSON.stringify(userMessage),
								ASSISTANT_RESPONSE: null,
								TOOL_CALLS: '[]',
								TOKENS_USED: null,
								COST_USD: null,
								ERROR: null
							}
						]
					};
				}
				return { rows: [] };
			});

			const turn = await repository.addTurn('sess-1', {
				turnNumber: 1,
				userMessage
			});

			expect(turn).toMatchObject({
				sessionId: 'sess-1',
				turnNumber: 1,
				userMessage,
				toolCalls: []
			});
			expect(mockExecute).toHaveBeenCalledTimes(3);
		});

		it('should store userMessage as JSON CLOB', async () => {
			const now = Date.now();
			const userMessage = { role: 'user' as const, content: 'Test message' };

			let callCount = 0;
			mockExecute.mockImplementation(async (sql: string, binds?: Record<string, unknown>) => {
				callCount++;
				if (callCount === 1) {
					expect(binds?.userMessage).toBe(JSON.stringify(userMessage));
					return { rows: [] };
				}
				if (callCount === 2) {
					return { rows: [] };
				}
				if (callCount === 3) {
					return {
						rows: [
							{
								ID: 'turn-1',
								SESSION_ID: 'sess-1',
								TURN_NUMBER: 1,
								CREATED_AT: new Date(now),
								USER_MESSAGE: JSON.stringify(userMessage),
								ASSISTANT_RESPONSE: null,
								TOOL_CALLS: '[]',
								TOKENS_USED: null,
								COST_USD: null,
								ERROR: null
							}
						]
					};
				}
				return { rows: [] };
			});

			const turn = await repository.addTurn('sess-1', {
				turnNumber: 1,
				userMessage
			});

			expect(turn.userMessage).toEqual(userMessage);
		});
	});

	// ── getTurn/getSessionTurns ──────────────────────────────────────────────

	describe('getTurn/getSessionTurns', () => {
		it('getTurn should return Turn with parsed JSON fields or null', async () => {
			const now = Date.now();
			const userMessage = { role: 'user' as const, content: 'Hello' };
			const assistantResponse = { role: 'assistant' as const, content: 'Hi there' };
			const toolCalls = [
				{
					id: 'call-1',
					name: 'searchTool',
					args: { query: 'test' },
					status: 'completed' as const
				}
			];

			mockExecute.mockResolvedValue({
				rows: [
					{
						ID: 'turn-1',
						SESSION_ID: 'sess-1',
						TURN_NUMBER: 1,
						CREATED_AT: new Date(now),
						USER_MESSAGE: JSON.stringify(userMessage),
						ASSISTANT_RESPONSE: JSON.stringify(assistantResponse),
						TOOL_CALLS: JSON.stringify(toolCalls),
						TOKENS_USED: 150,
						COST_USD: 0.005,
						ERROR: null
					}
				]
			});

			const turn = await repository.getTurn('turn-1');

			expect(turn).toMatchObject({
				id: 'turn-1',
				sessionId: 'sess-1',
				turnNumber: 1,
				userMessage,
				assistantResponse,
				toolCalls,
				tokensUsed: 150,
				costUsd: 0.005,
				error: null
			});
			expect(turn.createdAt).toBeTypeOf('number');
		});

		it('getSessionTurns should return turns ordered by turn_number ASC', async () => {
			const now = Date.now();
			mockExecute.mockResolvedValue({
				rows: [
					{
						ID: 'turn-1',
						SESSION_ID: 'sess-1',
						TURN_NUMBER: 1,
						CREATED_AT: new Date(now),
						USER_MESSAGE: JSON.stringify({ role: 'user', content: 'First' }),
						ASSISTANT_RESPONSE: null,
						TOOL_CALLS: '[]',
						TOKENS_USED: null,
						COST_USD: null,
						ERROR: null
					},
					{
						ID: 'turn-2',
						SESSION_ID: 'sess-1',
						TURN_NUMBER: 2,
						CREATED_AT: new Date(now + 1000),
						USER_MESSAGE: JSON.stringify({ role: 'user', content: 'Second' }),
						ASSISTANT_RESPONSE: null,
						TOOL_CALLS: '[]',
						TOKENS_USED: null,
						COST_USD: null,
						ERROR: null
					}
				]
			});

			const turns = await repository.getSessionTurns('sess-1');

			expect(turns).toHaveLength(2);
			expect(turns[0].turnNumber).toBe(1);
			expect(turns[1].turnNumber).toBe(2);
			expect(mockExecute).toHaveBeenCalledWith(
				expect.stringContaining('ORDER BY turn_number ASC'),
				expect.any(Object)
			);
		});
	});

	// ── updateTurn ───────────────────────────────────────────────────────────

	describe('updateTurn', () => {
		it('should update assistantResponse, toolCalls, tokensUsed, costUsd, error', async () => {
			const now = Date.now();
			const assistantResponse = { role: 'assistant' as const, content: 'Response' };
			const toolCalls = [{ id: 'call-1', name: 'tool', status: 'completed' as const }];

			let callCount = 0;
			mockExecute.mockImplementation(async (sql: string, binds?: Record<string, unknown>) => {
				callCount++;
				if (callCount === 1) {
					// UPDATE
					expect(sql).toContain('UPDATE agent_turns');
					expect(sql).toContain('assistant_response = :assistantResponse');
					expect(sql).toContain('tool_calls = :toolCalls');
					expect(sql).toContain('tokens_used = :tokensUsed');
					expect(sql).toContain('cost_usd = :costUsd');
					expect(binds?.assistantResponse).toBe(JSON.stringify(assistantResponse));
					expect(binds?.toolCalls).toBe(JSON.stringify(toolCalls));
					expect(binds?.tokensUsed).toBe(200);
					expect(binds?.costUsd).toBe(0.01);
					return { rows: [] };
				}
				if (callCount === 2) {
					// SELECT
					return {
						rows: [
							{
								ID: 'turn-1',
								SESSION_ID: 'sess-1',
								TURN_NUMBER: 1,
								CREATED_AT: new Date(now),
								USER_MESSAGE: JSON.stringify({ role: 'user', content: 'Hi' }),
								ASSISTANT_RESPONSE: JSON.stringify(assistantResponse),
								TOOL_CALLS: JSON.stringify(toolCalls),
								TOKENS_USED: 200,
								COST_USD: 0.01,
								ERROR: null
							}
						]
					};
				}
				return { rows: [] };
			});

			const turn = await repository.updateTurn('turn-1', {
				assistantResponse,
				toolCalls,
				tokensUsed: 200,
				costUsd: 0.01
			});

			expect(turn).toMatchObject({
				assistantResponse,
				toolCalls,
				tokensUsed: 200,
				costUsd: 0.01
			});
		});

		it('should return null for non-existent turn', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			const turn = await repository.updateTurn('nonexistent', { tokensUsed: 100 });

			expect(turn).toBeNull();
		});
	});

	// ── getMostRecentSession ─────────────────────────────────────────────────

	describe('getMostRecentSession', () => {
		it('should return most recent active session filtered by org_id', async () => {
			const now = Date.now();
			mockExecute.mockResolvedValue({
				rows: [
					{
						ID: 'sess-latest',
						ORG_ID: 'org-123',
						THREAD_ID: null,
						CREATED_AT: new Date(now - 500),
						UPDATED_AT: new Date(now),
						TITLE: 'Latest',
						MODEL: 'gpt-4',
						REGION: 'us-east-1',
						STATUS: 'active',
						CONFIG: null
					}
				]
			});

			const session = await repository.getMostRecentSession('org-123');

			expect(session?.id).toBe('sess-latest');
			expect(mockExecute).toHaveBeenCalledWith(
				expect.stringContaining("WHERE status = 'active' AND org_id = :orgId"),
				expect.objectContaining({ orgId: 'org-123' })
			);
			expect(mockExecute).toHaveBeenCalledWith(
				expect.stringContaining('ORDER BY updated_at DESC'),
				expect.any(Object)
			);
			expect(mockExecute).toHaveBeenCalledWith(
				expect.stringContaining('FETCH FIRST 1 ROWS ONLY'),
				expect.any(Object)
			);
		});

		it('should return null if no active sessions for org', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			const session = await repository.getMostRecentSession('org-999');

			expect(session).toBeNull();
		});
	});

	// ── restoreSession ───────────────────────────────────────────────────────

	describe('restoreSession', () => {
		it('should return session + turns for full context restoration', async () => {
			const now = Date.now();

			let callCount = 0;
			mockExecute.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					// getSession
					return {
						rows: [
							{
								ID: 'sess-1',
								ORG_ID: 'org-1',
								THREAD_ID: 'thread-1',
								CREATED_AT: new Date(now),
								UPDATED_AT: new Date(now),
								TITLE: 'Restored',
								MODEL: 'gpt-4',
								REGION: 'us-east-1',
								STATUS: 'active',
								CONFIG: null
							}
						]
					};
				}
				if (callCount === 2) {
					// getSessionTurns
					return {
						rows: [
							{
								ID: 'turn-1',
								SESSION_ID: 'sess-1',
								TURN_NUMBER: 1,
								CREATED_AT: new Date(now),
								USER_MESSAGE: JSON.stringify({ role: 'user', content: 'Hello' }),
								ASSISTANT_RESPONSE: null,
								TOOL_CALLS: '[]',
								TOKENS_USED: null,
								COST_USD: null,
								ERROR: null
							}
						]
					};
				}
				return { rows: [] };
			});

			const restored = await repository.restoreSession('sess-1');

			expect(restored).not.toBeNull();
			expect(restored.session.id).toBe('sess-1');
			expect(restored.turns).toHaveLength(1);
			expect(restored.turns[0].turnNumber).toBe(1);
		});

		it('should return null for non-existent session', async () => {
			mockExecute.mockResolvedValue({ rows: [] });

			const restored = await repository.restoreSession('nonexistent');

			expect(restored).toBeNull();
		});
	});

	// ── Error Handling ───────────────────────────────────────────────────────

	describe('error handling', () => {
		it('should wrap Oracle errors in DatabaseError', async () => {
			mockExecute.mockRejectedValue(new Error('ORA-12345: Connection failed'));

			await expect(repository.getSession('sess-1')).rejects.toThrow();
		});
	});
});
