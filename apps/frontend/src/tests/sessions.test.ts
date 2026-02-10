import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConnection, StateRepository, resetConnection } from '@portal/server/agent-state';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Chat Demo Session Persistence', () => {
	let testDbPath: string;
	let repo: StateRepository;

	beforeEach(() => {
		testDbPath = path.join(os.tmpdir(), `test-chat-${Date.now()}.db`);
		process.env.AGENT_STATE_DB_PATH = testDbPath;
		resetConnection();
		const db = getConnection(testDbPath);
		repo = new StateRepository(db);
	});

	afterEach(() => {
		resetConnection();
		delete process.env.AGENT_STATE_DB_PATH;
		if (fs.existsSync(testDbPath)) {
			fs.unlinkSync(testDbPath);
		}
		// Clean up WAL files
		if (fs.existsSync(testDbPath + '-wal')) {
			fs.unlinkSync(testDbPath + '-wal');
		}
		if (fs.existsSync(testDbPath + '-shm')) {
			fs.unlinkSync(testDbPath + '-shm');
		}
	});

	describe('Session CRUD', () => {
		it('creates new session with model and region', () => {
			const session = repo.createSession({
				model: 'meta.llama-3.3-70b-instruct',
				region: 'eu-frankfurt-1'
			});

			expect(session.id).toBeDefined();
			expect(session.model).toBe('meta.llama-3.3-70b-instruct');
			expect(session.region).toBe('eu-frankfurt-1');
			expect(session.status).toBe('active');
		});

		it('retrieves session by id', () => {
			const created = repo.createSession({
				model: 'meta.llama-3.3-70b-instruct',
				region: 'eu-frankfurt-1',
				title: 'Test Chat Session'
			});

			const fetched = repo.getSession(created.id);
			expect(fetched).not.toBeNull();
			expect(fetched!.title).toBe('Test Chat Session');
			expect(fetched!.model).toBe('meta.llama-3.3-70b-instruct');
		});

		it('lists sessions ordered by updated_at desc', () => {
			const session1 = repo.createSession({ model: 'model-1', region: 'region-1' });
			const session2 = repo.createSession({ model: 'model-2', region: 'region-2' });

			// Add turn to session1 to make it more recent
			repo.addTurn(session1.id, {
				turnNumber: 1,
				userMessage: { role: 'user', content: 'Hello' }
			});

			const sessions = repo.listSessions();
			expect(sessions.length).toBe(2);
			expect(sessions[0].id).toBe(session1.id); // Most recently updated
		});

		it('marks session as completed', () => {
			const session = repo.createSession({
				model: 'meta.llama-3.3-70b-instruct',
				region: 'eu-frankfurt-1'
			});

			repo.updateSession(session.id, { status: 'completed' });

			const updated = repo.getSession(session.id);
			expect(updated!.status).toBe('completed');
		});
	});

	describe('Turn Persistence', () => {
		it('adds turn with user message', () => {
			const session = repo.createSession({
				model: 'meta.llama-3.3-70b-instruct',
				region: 'eu-frankfurt-1'
			});

			const turn = repo.addTurn(session.id, {
				turnNumber: 1,
				userMessage: { role: 'user', content: 'What is OCI?' }
			});

			expect(turn.id).toMatch(/^turn_/);
			expect(turn.turnNumber).toBe(1);
			expect(turn.userMessage.content).toBe('What is OCI?');
			expect(turn.assistantResponse).toBeUndefined();
		});

		it('updates turn with assistant response and tokens', () => {
			const session = repo.createSession({
				model: 'meta.llama-3.3-70b-instruct',
				region: 'eu-frankfurt-1'
			});

			const turn = repo.addTurn(session.id, {
				turnNumber: 1,
				userMessage: { role: 'user', content: 'What is OCI?' }
			});

			const updated = repo.updateTurn(turn.id, {
				assistantResponse: {
					role: 'assistant',
					content: 'OCI is Oracle Cloud Infrastructure.'
				},
				tokensUsed: 150,
				costUsd: 0.0003
			});

			expect(updated!.assistantResponse?.content).toBe('OCI is Oracle Cloud Infrastructure.');
			expect(updated!.tokensUsed).toBe(150);
			expect(updated!.costUsd).toBeCloseTo(0.0003, 5);
		});

		it('retrieves all turns for session in order', () => {
			const session = repo.createSession({
				model: 'meta.llama-3.3-70b-instruct',
				region: 'eu-frankfurt-1'
			});

			for (let i = 1; i <= 3; i++) {
				const turn = repo.addTurn(session.id, {
					turnNumber: i,
					userMessage: { role: 'user', content: `Question ${i}` }
				});
				repo.updateTurn(turn.id, {
					assistantResponse: { role: 'assistant', content: `Answer ${i}` }
				});
			}

			const turns = repo.getSessionTurns(session.id);
			expect(turns).toHaveLength(3);
			expect(turns[0].turnNumber).toBe(1);
			expect(turns[1].turnNumber).toBe(2);
			expect(turns[2].turnNumber).toBe(3);
			expect(turns[2].userMessage.content).toBe('Question 3');
		});
	});

	describe('Session Restoration', () => {
		it('restores session with full message history', () => {
			const session = repo.createSession({
				model: 'meta.llama-3.3-70b-instruct',
				region: 'eu-frankfurt-1'
			});

			// Simulate multi-turn conversation
			for (let i = 1; i <= 3; i++) {
				const turn = repo.addTurn(session.id, {
					turnNumber: i,
					userMessage: { role: 'user', content: `Question ${i}` }
				});
				repo.updateTurn(turn.id, {
					assistantResponse: { role: 'assistant', content: `Answer ${i}` }
				});
			}

			// Restore session
			const restored = repo.restoreSession(session.id);
			expect(restored).toBeDefined();
			expect(restored!.session.id).toBe(session.id);
			expect(restored!.turns).toHaveLength(3);
			expect(restored!.turns[2].userMessage.content).toBe('Question 3');
			expect(restored!.turns[2].assistantResponse?.content).toBe('Answer 3');
		});

		it('getMostRecentSession returns active session', () => {
			const session1 = repo.createSession({
				model: 'model-1',
				region: 'eu-frankfurt-1'
			});

			const session2 = repo.createSession({
				model: 'model-2',
				region: 'eu-frankfurt-1'
			});

			// Complete session2
			repo.updateSession(session2.id, { status: 'completed' });

			// session1 should be returned as most recent active
			const mostRecent = repo.getMostRecentSession();
			expect(mostRecent).not.toBeNull();
			expect(mostRecent!.id).toBe(session1.id);
		});

		it('converts turns to AI SDK message format', () => {
			const session = repo.createSession({
				model: 'meta.llama-3.3-70b-instruct',
				region: 'eu-frankfurt-1'
			});

			const turn = repo.addTurn(session.id, {
				turnNumber: 1,
				userMessage: { role: 'user', content: 'Hello' }
			});
			repo.updateTurn(turn.id, {
				assistantResponse: { role: 'assistant', content: 'Hi there!' }
			});

			const turns = repo.getSessionTurns(session.id);

			// Convert to AI SDK format (same logic as continue endpoint)
			const messages = turns.flatMap((t) => {
				const msgs: Array<{ role: string; content: string }> = [];
				if (t.userMessage) {
					msgs.push({ role: t.userMessage.role, content: t.userMessage.content });
				}
				if (t.assistantResponse) {
					msgs.push({ role: t.assistantResponse.role, content: t.assistantResponse.content });
				}
				return msgs;
			});

			expect(messages).toHaveLength(2);
			expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
			expect(messages[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
		});
	});

	describe('Cost Tracking', () => {
		it('calculates total cost across turns', () => {
			const session = repo.createSession({
				model: 'meta.llama-3.3-70b-instruct',
				region: 'eu-frankfurt-1'
			});

			for (let i = 1; i <= 3; i++) {
				const turn = repo.addTurn(session.id, {
					turnNumber: i,
					userMessage: { role: 'user', content: `Message ${i}` }
				});
				repo.updateTurn(turn.id, {
					assistantResponse: { role: 'assistant', content: `Response ${i}` },
					tokensUsed: 100 * i,
					costUsd: 0.001 * i
				});
			}

			const turns = repo.getSessionTurns(session.id);
			const totalCost = turns.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
			const totalTokens = turns.reduce((sum, t) => sum + (t.tokensUsed ?? 0), 0);

			expect(totalCost).toBeCloseTo(0.006, 5); // 0.001 + 0.002 + 0.003
			expect(totalTokens).toBe(600); // 100 + 200 + 300
		});
	});
});
