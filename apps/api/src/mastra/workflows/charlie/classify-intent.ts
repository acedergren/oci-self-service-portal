/**
 * Classify-Intent Workflow — lightweight intent classifier for Charlie.
 *
 * Classifies the user's latest message into one of five intents before
 * the main workflow dispatch. Uses a fast model (gemini-flash) with
 * structured JSON output to minimise latency.
 *
 * Output intents:
 *   query        — read-only OCI question (list, describe, search)
 *   action       — write/destructive OCI operation
 *   approval     — user is approving a pending action run
 *   correction   — user is correcting Charlie's previous response
 *   clarification — question that needs clarification before proceeding
 */

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { generateText } from 'ai';
import { selectModel } from '../../providers.js';
import { emitWorkflowStep, emitWorkflowStatus } from '../../events.js';

// ── Schemas ──────────────────────────────────────────────────────────────────

const InputSchema = z.object({
	conversationId: z.string(),
	message: z.string(),
	history: z.array(z.record(z.string(), z.unknown()))
});

const OutputSchema = z.object({
	intent: z.enum(['query', 'action', 'approval', 'correction', 'clarification']),
	confidence: z.number().min(0).max(1),
	summary: z.string(),
	targetRunId: z.string().optional()
});

// ── Step ─────────────────────────────────────────────────────────────────────

const classifyStep = createStep({
	id: 'classify',
	description: 'Classify user intent from the latest message',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'classify', 'classify-intent');

		const model = await selectModel('google.gemini-2.5-flash');

		// If model is unavailable (no providers configured), default to clarification
		if (!model) {
			const fallback = {
				intent: 'clarification' as const,
				confidence: 0.5,
				summary: 'Model unavailable — defaulting to clarification',
				targetRunId: undefined
			};
			emitWorkflowStep(runId, 'complete', 'classify', 'classify-intent', fallback);
			return fallback;
		}

		const systemPrompt = `You are an intent classifier for Charlie, an AI cloud operations advisor.

Classify the user's message into exactly one of these intents:
- "query": Read-only requests (list resources, describe, get details, search, explain)
- "action": Write/destructive operations (create, delete, update, terminate, launch, attach, scale)
- "approval": User is approving a pending action (look for "yes", "approve", "go ahead", "confirm", "proceed", "ok do it", or references to a run ID)
- "correction": User is correcting a previous response (look for "that's wrong", "actually", "no that's not right", "you made a mistake")
- "clarification": Ambiguous requests that need more information before proceeding

Also extract a targetRunId (UUID) from the message if the intent is "approval" or "correction" and a run ID is mentioned.

Respond with ONLY a JSON object matching this schema:
{
  "intent": "<one of the five intents>",
  "confidence": <0.0-1.0 float>,
  "summary": "<one sentence describing what the user wants>",
  "targetRunId": "<UUID string or null>"
}`;

		const { text } = await generateText({
			model,
			system: systemPrompt,
			prompt: `Latest message: "${inputData.message}"\n\nConversation context: ${inputData.history.length} prior messages.`
		});

		// Parse the JSON response — strip markdown fences if present
		let parsed: z.infer<typeof OutputSchema>;
		try {
			const cleaned = text
				.replace(/^```json\s*/i, '')
				.replace(/```\s*$/i, '')
				.trim();
			const raw = JSON.parse(cleaned) as Record<string, unknown>;
			parsed = {
				intent: OutputSchema.shape.intent.parse(raw['intent'] ?? 'clarification'),
				confidence: typeof raw['confidence'] === 'number' ? raw['confidence'] : 0.7,
				summary: typeof raw['summary'] === 'string' ? raw['summary'] : inputData.message,
				targetRunId:
					typeof raw['targetRunId'] === 'string' && raw['targetRunId'] !== 'null'
						? raw['targetRunId']
						: undefined
			};
		} catch {
			// Fallback: keyword-based classification if JSON parsing fails
			const msg = inputData.message.toLowerCase();
			const isAction =
				/\b(create|delete|terminate|launch|update|patch|scale|stop|start|reboot|attach|detach|remove)\b/.test(
					msg
				);
			parsed = {
				intent: isAction ? 'action' : 'query',
				confidence: 0.6,
				summary: inputData.message,
				targetRunId: undefined
			};
		}

		emitWorkflowStep(runId, 'complete', 'classify', 'classify-intent', { intent: parsed.intent });
		emitWorkflowStatus(runId, 'completed', { output: parsed });

		return parsed;
	}
});

// ── Workflow ──────────────────────────────────────────────────────────────────

export const classifyIntentWorkflow = createWorkflow({
	id: 'classify-intent',
	description: 'Classify user intent before routing to the appropriate Charlie workflow',
	inputSchema: InputSchema,
	outputSchema: OutputSchema
})
	.then(classifyStep)
	.commit();
