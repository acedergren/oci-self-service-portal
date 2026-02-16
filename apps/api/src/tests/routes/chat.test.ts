/**
 * Tests for Chat streaming route (Mastra agent-based).
 *
 * Tests the route at apps/api/src/routes/chat.ts:
 * - POST /api/chat — AI-powered chat via Mastra Charlie agent SSE streaming
 *
 * Security contract:
 * - Requires 'tools:execute' permission
 * - Returns 401 for unauthenticated requests
 * - Returns 403 when user lacks required permission
 * - Validates request body (messages required, non-empty)
 * - Model validated against allowlist (falls back to default)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, simulateSession } from './test-helpers.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetProviderRegistry = vi.fn();
const mockGetEnabledModelIds = vi.fn();

vi.mock('../../mastra/models/index.js', () => ({
	getProviderRegistry: (...args: unknown[]) => mockGetProviderRegistry(...args),
	getEnabledModelIds: (...args: unknown[]) => mockGetEnabledModelIds(...args)
}));

vi.mock('../../mastra/agents/charlie.js', () => ({
	FALLBACK_MODEL_ALLOWLIST: [
		'google.gemini-2.5-flash',
		'cohere.command-r-plus',
		'meta.llama-3.3-70b'
	],
	DEFAULT_MODEL: 'google.gemini-2.5-flash'
}));

vi.mock('@portal/server/errors.js', async () => {
	const actual = await vi.importActual<typeof import('@portal/server/errors.js')>(
		'@portal/server/errors.js'
	);
	return actual;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock Mastra agent with a `.stream()` that yields text chunks. */
function createMockAgent(chunks: string[] = ['Hello', ' world']) {
	const textStream = new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		}
	});

	return {
		stream: vi.fn().mockResolvedValue({ textStream })
	};
}

/** Build Fastify app with fake mastra decorator and chat route. */
async function buildApp(mockAgent?: ReturnType<typeof createMockAgent>): Promise<FastifyInstance> {
	const app = await buildTestApp({ withRbac: true });

	// Decorate with mock mastra (before registering routes)
	const agent = mockAgent ?? createMockAgent();
	app.decorate('mastra', {
		getAgent: vi.fn().mockReturnValue(agent)
	});

	const { chatRoutes } = await import('../../routes/chat.js');
	await app.register(chatRoutes);

	return app;
}

// ---------------------------------------------------------------------------
// Default mock setup
// ---------------------------------------------------------------------------

beforeEach(() => {
	// Default: fallback allowlist (provider registry throws)
	mockGetProviderRegistry.mockRejectedValue(new Error('No DB'));
	mockGetEnabledModelIds.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------

describe('POST /api/chat', () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) await app.close();
	});

	// ── Auth tests ──

	it('returns 401 for unauthenticated requests', async () => {
		app = await buildApp();
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', content: 'Hello' }]
			}
		});

		expect(res.statusCode).toBe(401);
	});

	it('returns 403 when user lacks tools:execute permission', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', content: 'Hello' }]
			}
		});

		expect(res.statusCode).toBe(403);
	});

	// ── Request validation tests ──

	it('returns 400 when messages is missing', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: { model: 'google.gemini-2.5-flash' }
		});

		expect(res.statusCode).toBe(400);
	});

	it('returns 400 when messages is empty array', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: { messages: [] }
		});

		expect(res.statusCode).toBe(400);
	});

	// ── Streaming tests ──

	it('streams SSE text chunks from Mastra agent', async () => {
		const mockAgent = createMockAgent(['chunk1', 'chunk2']);
		app = await buildApp(mockAgent);
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', content: 'Hello' }]
			}
		});

		// SSE streams return 200 via reply.raw.writeHead
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toContain('text/event-stream');

		// Verify body contains SSE-formatted chunks
		expect(res.body).toContain('data: ');
		expect(res.body).toContain('[DONE]');
	});

	it('calls agent.stream with messages and memory options', async () => {
		const mockAgent = createMockAgent();
		app = await buildApp(mockAgent);
		simulateSession(app, { id: 'user-1', userId: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', content: 'List instances' }]
			}
		});

		expect(mockAgent.stream).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ role: 'user', content: 'List instances' })
			]),
			expect.objectContaining({
				maxSteps: 5,
				memory: expect.objectContaining({
					resource: expect.any(String)
				})
			})
		);
	});

	it('passes threadId to agent memory options when provided', async () => {
		const mockAgent = createMockAgent();
		app = await buildApp(mockAgent);
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const threadId = '550e8400-e29b-41d4-a716-446655440000';

		await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', content: 'Hello' }],
				threadId
			}
		});

		expect(mockAgent.stream).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				memory: expect.objectContaining({
					thread: threadId
				})
			})
		);
	});

	// ── Model allowlist tests ──

	it('uses fallback allowlist when provider registry fails', async () => {
		mockGetProviderRegistry.mockRejectedValue(new Error('DB unavailable'));

		const mockAgent = createMockAgent();
		app = await buildApp(mockAgent);
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', content: 'Hello' }]
			}
		});

		// Should not fail — fallback allowlist is used
		expect(res.statusCode).toBe(200);
		expect(mockAgent.stream).toHaveBeenCalled();
	});

	it('uses fallback allowlist when no models returned from registry', async () => {
		mockGetProviderRegistry.mockResolvedValue({});
		mockGetEnabledModelIds.mockResolvedValue([]);

		const mockAgent = createMockAgent();
		app = await buildApp(mockAgent);
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', content: 'Hello' }]
			}
		});

		expect(res.statusCode).toBe(200);
	});

	it('falls back to default model when requested model is not in allowlist', async () => {
		const mockAgent = createMockAgent();
		app = await buildApp(mockAgent);
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', content: 'Hello' }],
				model: 'malicious.model-that-doesnt-exist'
			}
		});

		// Should succeed with default model, not the malicious one
		expect(res.statusCode).toBe(200);
	});

	// ── Error handling ──

	it('returns 500 when agent.stream throws', async () => {
		const mockAgent = createMockAgent();
		mockAgent.stream.mockRejectedValue(new Error('Agent failed'));
		app = await buildApp(mockAgent);
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', content: 'Hello' }]
			}
		});

		expect(res.statusCode).toBe(500);
	});
});
