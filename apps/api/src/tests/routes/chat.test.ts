/**
 * TDD tests for Chat streaming route (Phase 9 task 34)
 *
 * Tests the route at apps/api/src/routes/chat.ts:
 * - POST /api/chat — AI-powered chat with OCI tools via SSE streaming
 *
 * Security contract:
 * - Requires 'tools:execute' permission
 * - Returns 401 for unauthenticated requests
 * - Returns 403 when user lacks required permission
 * - Validates model against allowlist
 * - Validates request body (messages required)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, simulateSession } from './test-helpers.js';

// ---------------------------------------------------------------------------
// Mocks — all with forwarding pattern for mockReset compatibility
// ---------------------------------------------------------------------------

const mockStreamText = vi.fn();
const mockConvertToModelMessages = vi.fn();
const mockStepCountIs = vi.fn();

vi.mock('ai', () => ({
	streamText: (...args: unknown[]) => mockStreamText(...args),
	convertToModelMessages: (...args: unknown[]) => mockConvertToModelMessages(...args),
	stepCountIs: (...args: unknown[]) => mockStepCountIs(...args)
}));

const mockCreateOCI = vi.fn();
const mockSupportsReasoning = vi.fn();

vi.mock('@acedergren/oci-genai-provider', () => ({
	createOCI: (...args: unknown[]) => mockCreateOCI(...args),
	supportsReasoning: (...args: unknown[]) => mockSupportsReasoning(...args)
}));

const mockCreateAISDKTools = vi.fn();

vi.mock('@portal/shared/tools/index', () => ({
	createAISDKTools: (...args: unknown[]) => mockCreateAISDKTools(...args)
}));

const mockChatRequestsInc = vi.fn();

vi.mock('@portal/shared/server/metrics', () => ({
	chatRequests: { inc: (...args: unknown[]) => mockChatRequestsInc(...args) }
}));

const mockGenerateEmbedding = vi.fn();
vi.mock('@portal/shared/server/embeddings', () => ({
	generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args)
}));

const mockEmbeddingInsert = vi.fn();
vi.mock('@portal/shared/server/oracle/repositories/embedding-repository', () => ({
	embeddingRepository: {
		insert: (...args: unknown[]) => mockEmbeddingInsert(...args)
	}
}));

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

const mockValidateApiKey = vi.fn();
vi.mock('@portal/shared/server/auth/api-keys', () => ({
	validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args)
}));

vi.mock('@portal/shared/server/auth/rbac', async () => {
	const actual = await vi.importActual<typeof import('@portal/shared/server/auth/rbac')>(
		'@portal/shared/server/auth/rbac'
	);
	return actual;
});

vi.mock('@portal/shared/server/auth/config', () => ({
	auth: {
		api: {
			getSession: vi.fn().mockResolvedValue(null)
		}
	}
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock streamText result that returns a fake Web API Response.
 * The response has a ReadableStream body that yields a single SSE chunk.
 */
function createMockStreamResult() {
	const encoder = new TextEncoder();
	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode('0:"Hello"\n'));
			controller.close();
		}
	});

	return {
		toUIMessageStreamResponse: vi.fn(
			() =>
				new Response(body, {
					status: 200,
					headers: { 'Content-Type': 'text/event-stream' }
				})
		)
	};
}

async function buildApp(): Promise<FastifyInstance> {
	const app = await buildTestApp({ withRbac: true });
	const { chatRoutes } = await import('../../routes/chat.js');
	await app.register(async (instance) => chatRoutes(instance));
	return app;
}

// ---------------------------------------------------------------------------
// Default mock setup for each test (to handle mockReset: true)
// ---------------------------------------------------------------------------

beforeEach(() => {
	// AI SDK mocks
	const mockResult = createMockStreamResult();
	mockStreamText.mockReturnValue(mockResult);
	mockConvertToModelMessages.mockResolvedValue([{ role: 'user', content: 'Hello' }]);
	mockStepCountIs.mockReturnValue(() => false);

	// OCI Provider mocks
	const mockLanguageModel = vi.fn().mockReturnValue({ modelId: 'google.gemini-2.5-flash' });
	mockCreateOCI.mockReturnValue({ languageModel: mockLanguageModel });
	mockSupportsReasoning.mockReturnValue(false);

	// Tools mock
	mockCreateAISDKTools.mockReturnValue({});

	// Metrics mock
	mockChatRequestsInc.mockReturnValue(undefined);

	// Embedding mocks (fire-and-forget — don't need to resolve for test)
	mockGenerateEmbedding.mockResolvedValue(null);
	mockEmbeddingInsert.mockResolvedValue(undefined);

	// API key mock
	mockValidateApiKey.mockResolvedValue(null);
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
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
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
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
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

	// ── Model allowlist tests ──

	it('uses requested model when it is in the allowlist', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
				model: 'cohere.command-r-plus'
			}
		});

		// Verify createOCI().languageModel was called with the requested model
		const ociInstance = mockCreateOCI.mock.results[0]?.value;
		expect(ociInstance.languageModel).toHaveBeenCalledWith('cohere.command-r-plus');
	});

	it('falls back to default model when requested model is not in allowlist', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
				model: 'malicious.model-that-doesnt-exist'
			}
		});

		const ociInstance = mockCreateOCI.mock.results[0]?.value;
		expect(ociInstance.languageModel).toHaveBeenCalledWith('google.gemini-2.5-flash');
	});

	it('uses default model when no model is specified', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
			}
		});

		const ociInstance = mockCreateOCI.mock.results[0]?.value;
		expect(ociInstance.languageModel).toHaveBeenCalledWith('google.gemini-2.5-flash');
	});

	// ── Streaming tests ──

	it('calls streamText with tools and system prompt', async () => {
		const mockTools = { listInstances: { execute: vi.fn() } };
		mockCreateAISDKTools.mockReturnValue(mockTools);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'List my instances' }] }]
			}
		});

		expect(mockStreamText).toHaveBeenCalledWith(
			expect.objectContaining({
				tools: mockTools,
				messages: expect.arrayContaining([
					expect.objectContaining({
						role: 'system',
						content: expect.stringContaining('CloudAdvisor')
					})
				])
			})
		);
	});

	it('calls toUIMessageStreamResponse on the stream result', async () => {
		const mockResult = createMockStreamResult();
		mockStreamText.mockReturnValue(mockResult);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
			}
		});

		expect(mockResult.toUIMessageStreamResponse).toHaveBeenCalled();
	});

	// ── Metrics tests ──

	it('increments chatRequests metric with model and started status', async () => {
		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
				model: 'meta.llama-3.3-70b'
			}
		});

		expect(mockChatRequestsInc).toHaveBeenCalledWith({
			model: 'meta.llama-3.3-70b',
			status: 'started'
		});
	});

	// ── Provider options tests ──

	it('passes reasoning options for models that support reasoning', async () => {
		mockSupportsReasoning.mockReturnValue(true);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
				model: 'google.gemini-2.5-flash'
			}
		});

		expect(mockStreamText).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					oci: expect.objectContaining({
						reasoningEffort: 'high'
					})
				})
			})
		);
	});

	it('does not pass reasoning options for non-reasoning models', async () => {
		mockSupportsReasoning.mockReturnValue(false);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
			}
		});

		expect(mockStreamText).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: undefined
			})
		);
	});

	// ── API key auth test ──

	it('allows access via valid API key with tools:execute permission', async () => {
		mockValidateApiKey.mockResolvedValue({
			keyId: 'key-1',
			orgId: 'org-1',
			permissions: ['tools:execute']
		});

		app = await buildApp();
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/chat',
			headers: {
				'x-api-key': 'portal_abc123'
			},
			payload: {
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
			}
		});

		// Should not be 401 or 403 — stream was initiated
		expect(res.statusCode).not.toBe(401);
		expect(res.statusCode).not.toBe(403);
	});

	// ── stepCountIs limit test ──

	it('uses stepCountIs(5) as stop condition', async () => {
		const mockStopCondition = () => false;
		mockStepCountIs.mockReturnValue(mockStopCondition);

		app = await buildApp();
		simulateSession(app, { id: 'user-1' }, ['tools:execute']);
		await app.ready();

		await app.inject({
			method: 'POST',
			url: '/api/chat',
			payload: {
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
			}
		});

		expect(mockStepCountIs).toHaveBeenCalledWith(5);
		expect(mockStreamText).toHaveBeenCalledWith(
			expect.objectContaining({
				stopWhen: mockStopCondition
			})
		);
	});
});
