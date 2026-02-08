import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import { createOCI, supportsReasoning } from '@acedergren/oci-genai-provider';
import { createAISDKTools } from '@portal/shared/tools/index';
import { createLogger } from '@portal/shared/server/logger';
import { chatRequests } from '@portal/shared/server/metrics';
import { generateEmbedding } from '@portal/shared/server/embeddings';
import { embeddingRepository } from '@portal/shared/server/oracle/repositories/embedding-repository';
import { requireAuth, resolveOrgId } from '../plugins/rbac.js';

const log = createLogger('api-chat');

const DEFAULT_MODEL = 'google.gemini-2.5-flash';
const DEFAULT_REGION = 'eu-frankfurt-1';

/** Allowlist of models that may be requested via the API. */
export const MODEL_ALLOWLIST = [
	'google.gemini-2.5-flash',
	'google.gemini-2.5-pro',
	'google.gemini-2.0-flash',
	'cohere.command-r-plus',
	'cohere.command-r',
	'cohere.command-a',
	'meta.llama-3.3-70b',
	'meta.llama-3.1-405b',
	'meta.llama-3.1-70b'
];

// Zod schema for request body
const ChatBodySchema = z.object({
	messages: z.array(z.record(z.string(), z.unknown())).min(1),
	model: z.string().optional(),
	sessionId: z.string().optional()
});

function getSystemPrompt(compartmentId: string | undefined): string {
	const compartmentInfo = compartmentId
		? `\n\nDEFAULT COMPARTMENT: When a tool requires a compartmentId and the user doesn't specify one, use this default: ${compartmentId}`
		: `\n\nNOTE: No default compartment is configured. You should first call listCompartments to find available compartments and ask the user which one to use.`;

	return `You are **CloudAdvisor**, an expert Oracle Cloud Infrastructure (OCI) assistant and multi-cloud advisor embedded in a self-service portal.

## PERSONA & TONE
- Professional, proactive, and cost-conscious. Security-first mindset.
- Use "we" language ("Let's look at your instances" not "I will look at your instances").
- Adapt depth automatically: brief for power users, explanatory for newcomers.
- Lead with the answer, then provide supporting detail.
- Be opinionated — recommend the best option, don't just list choices.

## INTENT CLASSIFICATION

Classify every user message into one of these modes and respond accordingly:

### 1. KNOWLEDGE — Cloud concepts, best practices, explanations
- Answer directly from your expertise. **No tools needed.**

### 2. INQUIRY — "What do I have?", "Show me my resources"
- Call read-only tools, then present a formatted summary.

### 3. ACTION — Create, deploy, delete, modify infrastructure
- Follow the Provisioning Workflow. Always confirm before destructive operations.

### 4. ANALYSIS — Cost review, security audit, optimization, multi-cloud comparison
- Gather data with tools, then provide structured analysis.

### 5. EXPLORATION — "What can you do?", "Help me get started"
- Present capabilities organized by category.

## OUTPUT FORMATTING RULES
- **Tables** for comparisons, resource lists, and pricing data
- **Bold** for key metrics: costs, percentages, counts, recommendations
- **Fenced code blocks** with language tags
- **### Headers** for sections in longer responses

## ⛔ ABSOLUTE RULE: NO PARALLEL TOOL CALLS WHEN ASKING QUESTIONS
When you need to ask clarifying questions:
- ONLY output text with your questions
- DO NOT call ANY tools in the same response
- Wait for the user to answer BEFORE calling tools

## ERROR HANDLING
Never expose raw CLI errors to the user. Instead:
1. **Translate** to user-friendly language
2. **Diagnose** the likely cause
3. **Suggest** 1-3 recovery steps${compartmentInfo}`;
}

/**
 * Chat streaming route.
 *
 * POST /api/chat — AI-powered chat with OCI tools via Server-Sent Events streaming.
 */
export async function chatRoutes(app: FastifyInstance): Promise<void> {
	app.post(
		'/api/chat',
		{
			preHandler: requireAuth('tools:execute'),
			schema: {
				body: ChatBodySchema
			}
		},
		async (request, reply) => {
			const body = request.body as z.infer<typeof ChatBodySchema>;
			const messages = body.messages as unknown as UIMessage[];

			// Validate model against allowlist
			const requestedModel = body.model || DEFAULT_MODEL;
			const model = MODEL_ALLOWLIST.includes(requestedModel) ? requestedModel : DEFAULT_MODEL;
			const region = process.env.OCI_REGION || DEFAULT_REGION;

			const compartmentId = process.env.OCI_COMPARTMENT_ID;
			const authMethod = process.env.OCI_AUTH_METHOD || 'config_file';

			// Create OCI client
			const oci = createOCI({
				compartmentId,
				region,
				auth: authMethod as 'config_file' | 'instance_principal' | 'resource_principal'
			});

			// Convert messages for the model
			const modelMessages = await convertToModelMessages(messages);

			// Create AI SDK tools
			const tools = createAISDKTools();

			// Build messages with system prompt
			const messagesWithSystem = [
				{ role: 'system' as const, content: getSystemPrompt(compartmentId) },
				...modelMessages
			];

			// Build provider options for reasoning if model supports it
			const modelSupportsReasoning = supportsReasoning(model);
			const providerOptions = modelSupportsReasoning
				? {
						oci: {
							reasoningEffort: model.startsWith('google.') ? 'high' : undefined,
							thinking: model.startsWith('cohere.') ? true : undefined
						}
					}
				: undefined;

			log.info({ model, region, messageCount: messages.length }, 'chat request');
			chatRequests.inc({ model, status: 'started' });

			// Stream the response with tools
			const result = streamText({
				model: oci.languageModel(model),
				messages: messagesWithSystem,
				tools,
				providerOptions,
				stopWhen: stepCountIs(5)
			});

			// Get the Web API Response from AI SDK
			const webResponse = result.toUIMessageStreamResponse();

			// Fire-and-forget: embed the latest user message for vector search
			const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
			const lastUserText = lastUserMessage?.parts
				?.filter((p: { type: string }) => p.type === 'text')
				.map((p: { type: string; text?: string }) => p.text ?? '')
				.join(' ')
				.trim();
			if (lastUserText) {
				const sessionId = body.sessionId;
				const orgId = resolveOrgId(request);
				if (sessionId && orgId) {
					generateEmbedding(lastUserText)
						.then((embedding) => {
							if (embedding) {
								return embeddingRepository.insert({
									refType: 'user_message',
									refId: sessionId,
									orgId,
									content: lastUserText,
									embedding
								});
							}
						})
						.catch((err) => log.warn({ err }, 'fire-and-forget embedding failed'));
				}
			}

			// Hijack the response — we're writing directly to the raw socket
			reply.hijack();

			// Write the status and headers from the Web API Response
			const raw = reply.raw;
			raw.writeHead(webResponse.status, {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache, no-store, must-revalidate',
				Connection: 'keep-alive',
				'X-Accel-Buffering': 'no'
			});

			// Pipe the readable stream body to the raw response
			if (webResponse.body) {
				const reader = webResponse.body.getReader();
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						raw.write(value);
					}
				} catch (err) {
					log.error({ err }, 'chat stream error');
				} finally {
					raw.end();
				}
			} else {
				raw.end();
			}
		}
	);
}
