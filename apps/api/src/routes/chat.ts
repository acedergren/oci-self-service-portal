/**
 * Chat route — streams AI responses via Mastra CloudAdvisor agent.
 *
 * POST /api/chat
 *   Body: { messages: ChatMessage[], model?: string, threadId?: string }
 *   Returns: SSE stream (text chunks)
 *
 * Replaces the 387 LOC SvelteKit chat endpoint with a clean Fastify route
 * that delegates to the Mastra agent for tool execution and conversation memory.
 */

import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ValidationError } from '@portal/shared/server/errors.js';
import { FALLBACK_MODEL_ALLOWLIST, DEFAULT_MODEL } from '../mastra/agents/cloud-advisor.js';
import { getProviderRegistry, getEnabledModelIds } from '../mastra/models/index.js';
import { requireAuth } from '../plugins/rbac.js';

// ── Constants ────────────────────────────────────────────────────────────

/** Abort streaming after 2 minutes to prevent DoS from hung connections. */
const STREAM_TIMEOUT_MS = 120_000;

/** Max tool-call round-trips per chat request (prevents runaway loops). */
const MAX_AGENT_STEPS = 5;

// ── Request schema ───────────────────────────────────────────────────────

const ChatMessageSchema = z.object({
	role: z.enum(['user', 'assistant', 'system']),
	content: z.string()
});

const ChatRequestSchema = z.object({
	messages: z.array(ChatMessageSchema).min(1).max(100, 'Too many messages in request'),
	model: z.string().optional(),
	threadId: z.string().uuid().optional()
});

// ── Route ────────────────────────────────────────────────────────────────

const chatRoutes: FastifyPluginAsync = async (fastify) => {
	fastify.withTypeProvider<ZodTypeProvider>().post(
		'/api/chat',
		{
			schema: {
				body: ChatRequestSchema
			},
			preHandler: requireAuth('tools:execute')
		},
		async (request, reply) => {
			const { messages, model: requestedModel, threadId } = request.body;

			// ── Validate model against allowlist ───────────────────────────────
			let enabledModels: string[] = [];
			let useFallback = false;

			try {
				await getProviderRegistry();
				enabledModels = await getEnabledModelIds();
				if (enabledModels.length === 0) {
					request.log.warn('No AI providers in database — using fallback');
					useFallback = true;
				}
			} catch (err) {
				request.log.error({ err }, 'Failed to load AI provider registry — using fallback');
				useFallback = true;
			}

			const allowlist = useFallback ? FALLBACK_MODEL_ALLOWLIST : enabledModels;
			const effectiveDefault = allowlist.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : allowlist[0];
			const model =
				requestedModel && allowlist.includes(requestedModel) ? requestedModel : effectiveDefault;

			if (!model) {
				throw new ValidationError('No AI models available');
			}

			// ── Get CloudAdvisor agent ──────────────────────────────────────
			const agent = fastify.mastra.getAgent('cloud-advisor');

			// ── Stream response ─────────────────────────────────────────────
			// Use per-request UUID for anonymous users to prevent memory sharing (S-8)
			const userId = request.user?.id ?? `anon-${randomUUID()}`;
			const effectiveThreadId = threadId ?? randomUUID();

			// Create abort controller for streaming timeout (DoS prevention)
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

			try {
				request.log.info(
					{ model, messageCount: messages.length, threadId: effectiveThreadId },
					'chat request'
				);

				// Mastra's MessageListInput accepts { role, content }[] (MessageInput[])
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const result = await agent.stream(messages as any, {
					memory: {
						thread: effectiveThreadId,
						resource: userId
					},
					maxSteps: MAX_AGENT_STEPS,
					abortSignal: controller.signal
				});

				// Set SSE headers for streaming
				reply.raw.writeHead(200, {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive'
				});

				// Pipe the text stream to response
				const reader = result.textStream.getReader();
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						reply.raw.write(`data: ${JSON.stringify({ text: value })}\n\n`);
					}
				} finally {
					reader.releaseLock();
				}

				reply.raw.write('data: [DONE]\n\n');
				reply.raw.end();
			} finally {
				clearTimeout(timeout);
			}
		}
	);
};

export { chatRoutes };
export default chatRoutes;
