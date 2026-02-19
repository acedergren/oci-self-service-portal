/**
 * Chat route — streams AI responses via Mastra Charlie agent.
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
import { ValidationError } from '@portal/server/errors.js';
import { FALLBACK_MODEL_ALLOWLIST, DEFAULT_MODEL } from '../mastra/agents/charlie.js';
import { getProviderRegistry, getEnabledModelIds } from '../mastra/models/index.js';
import { requireAuth, resolveOrgId } from '../plugins/rbac.js';

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

			// ── Get Charlie agent ──────────────────────────────────────────
			const agent = fastify.mastra.getAgent('charlie');

			// ── Load MCP toolsets for org (non-blocking — chat works without them)
			let mcpToolsets: Record<string, unknown> | undefined;
			const orgId = resolveOrgId(request);
			if (orgId && fastify.mcpConnectionManager) {
				try {
					const toolsets = await fastify.mcpConnectionManager.getToolsets(orgId);
					if (Object.keys(toolsets).length > 0) {
						mcpToolsets = toolsets;
					}
				} catch (err) {
					request.log.warn({ err, orgId }, 'Failed to load MCP toolsets, continuing without');
				}
			}

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

				// ── Intent classification ─────────────────────────────────────────────
				// Run classify-intent first (fast, structured output) to route the message.
				const lastMessage = messages[messages.length - 1]?.content ?? '';
				try {
					const ciRun = await fastify.mastra.getWorkflow('classifyIntentWorkflow').createRun();
					const ciResult = await ciRun.start({
						inputData: {
							conversationId: effectiveThreadId,
							message: lastMessage,
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							history: messages as any
						}
					});
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const classifyOutput = (ciResult as any)?.results?.classify?.output as
						| { intent: string; targetRunId?: string }
						| undefined;
					const intent = classifyOutput?.intent ?? 'clarification';
					const targetRunId = classifyOutput?.targetRunId;

					request.log.info({ intent, targetRunId }, 'intent classified');

					if (intent === 'action') {
						const actionRun = await fastify.mastra.getWorkflow('charlieActionWorkflow').createRun();
						const runId = actionRun.runId;
						// Fire-and-forget — frontend subscribes via SSE stream for progress
						void actionRun.start({
							inputData: {
								conversationId: effectiveThreadId,
								message: lastMessage,
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								history: messages as any,
								mcpToolsets: (mcpToolsets as Record<string, unknown>) ?? {},
								userId
							}
						});
						clearTimeout(timeout);
						reply.raw.writeHead(200, {
							'Content-Type': 'text/event-stream',
							'Cache-Control': 'no-cache',
							Connection: 'keep-alive'
						});
						reply.raw.write(
							`data: ${JSON.stringify({ runId, intent: 'action', message: "I'm planning your request..." })}\n\n`
						);
						reply.raw.write('data: [DONE]\n\n');
						reply.raw.end();
						return;
					}

					if (intent === 'approval' && targetRunId) {
						const resumeRun = await fastify.mastra
							.getWorkflow('charlieActionWorkflow')
							.createRun({ runId: targetRunId });
						await resumeRun.resume({
							step: 'pre_execution_summary',
							resumeData: { approved: true }
						});
						clearTimeout(timeout);
						reply.raw.writeHead(200, {
							'Content-Type': 'text/event-stream',
							'Cache-Control': 'no-cache',
							Connection: 'keep-alive'
						});
						reply.raw.write(
							`data: ${JSON.stringify({ status: 'resumed', runId: targetRunId })}\n\n`
						);
						reply.raw.write('data: [DONE]\n\n');
						reply.raw.end();
						return;
					}

					if (intent === 'query') {
						const qRun = await fastify.mastra.getWorkflow('queryWorkflow').createRun();
						const qResult = await qRun.start({
							inputData: {
								conversationId: effectiveThreadId,
								message: lastMessage,
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								history: messages as any,
								mcpToolsets: (mcpToolsets as Record<string, unknown>) ?? {}
							}
						});
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const qOut = qResult as any;
						const qResponse: string =
							qOut?.results?.persist?.output?.response ??
							qOut?.results?.synthesise?.output?.response ??
							'';
						clearTimeout(timeout);
						reply.raw.writeHead(200, {
							'Content-Type': 'text/event-stream',
							'Cache-Control': 'no-cache',
							Connection: 'keep-alive'
						});
						reply.raw.write(`data: ${JSON.stringify({ text: qResponse })}\n\n`);
						reply.raw.write('data: [DONE]\n\n');
						reply.raw.end();
						return;
					}

					if (intent === 'correction') {
						const cRun = await fastify.mastra.getWorkflow('correctWorkflow').createRun();
						const cResult = await cRun.start({
							inputData: {
								conversationId: effectiveThreadId,
								message: lastMessage,
								previousOutput:
									typeof messages[messages.length - 2]?.content === 'string'
										? String(messages[messages.length - 2]!.content)
										: '',
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								history: messages as any
							}
						});
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const cOut = cResult as any;
						const cResponse: string = cOut?.results?.respond_or_retry?.output?.response ?? '';
						clearTimeout(timeout);
						reply.raw.writeHead(200, {
							'Content-Type': 'text/event-stream',
							'Cache-Control': 'no-cache',
							Connection: 'keep-alive'
						});
						reply.raw.write(`data: ${JSON.stringify({ text: cResponse })}\n\n`);
						reply.raw.write('data: [DONE]\n\n');
						reply.raw.end();
						return;
					}
					// 'clarification' falls through to existing agent.stream() below
				} catch (intentErr) {
					// Intent classification failure is non-fatal — fall through to agent.stream()
					request.log.warn(
						{ err: intentErr },
						'Intent classification failed, falling back to agent.stream()'
					);
				}
				// ── End intent routing ─────────────────────────────────────────────

				// Mastra's MessageListInput accepts { role, content }[] (MessageInput[])
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const result = await agent.stream(messages as any, {
					memory: {
						thread: effectiveThreadId,
						resource: userId
					},
					maxSteps: MAX_AGENT_STEPS,
					abortSignal: controller.signal,
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					toolsets: mcpToolsets as any
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
