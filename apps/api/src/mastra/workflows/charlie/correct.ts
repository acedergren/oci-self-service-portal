/**
 * Charlie Correction Workflow — handles user corrections to previous responses.
 *
 * Two-step pipeline:
 *   understand → respond_or_retry
 *
 * When a user says "that's wrong" or "actually, it should be...", this workflow
 * extracts what was incorrect and either:
 * - Returns an acknowledgment with a revised intent (actionable=true), letting
 *   the client re-send with corrected context.
 * - Asks a single focused clarifying question (actionable=false) when the
 *   correction is too vague to act on.
 */

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { generateText } from 'ai';
import { selectModel } from '../../providers.js';
import { emitWorkflowStep, emitWorkflowStatus } from '../../events.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

const InputSchema = z.object({
	conversationId: z.string(),
	message: z.string(),
	previousOutput: z.string(),
	history: z.array(z.record(z.string(), z.unknown()))
});

const UnderstandOutputSchema = z.object({
	wasWrong: z.string(),
	shouldBe: z.string(),
	actionable: z.boolean(),
	correctedIntent: z.enum(['query', 'action']),
	_message: z.string(),
	_previousOutput: z.string(),
	_conversationId: z.string()
});

const OutputSchema = z.object({
	response: z.string()
});

// ── Step 1: Understand ────────────────────────────────────────────────────────

const understandStep = createStep({
	id: 'understand',
	description: 'Extract what was wrong and what the user expects instead',
	inputSchema: InputSchema,
	outputSchema: UnderstandOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'understand', 'correction');

		const model = await selectModel('google.gemini-2.5-flash');

		let wasWrong = 'the previous response';
		let shouldBe = 'something else';
		let actionable = false;
		let correctedIntent: 'query' | 'action' = 'query';

		if (model) {
			const { text } = await generateText({
				model,
				system: `You are analysing a user correction to an AI response. Extract the key details.

Respond with ONLY a JSON object:
{
  "wasWrong": "what the previous response got wrong (be specific)",
  "shouldBe": "what the correct answer or action should be",
  "actionable": true|false,  // true if you have enough information to retry with a corrected approach; false if you need more details
  "correctedIntent": "query"|"action"  // whether the corrected request is a read or write operation
}`,
				prompt: `Previous response from Charlie:\n${inputData.previousOutput}\n\nUser correction:\n${inputData.message}`
			});

			try {
				const cleaned = text
					.replace(/^```json\s*/i, '')
					.replace(/```\s*$/i, '')
					.trim();
				const raw = JSON.parse(cleaned) as {
					wasWrong?: string;
					shouldBe?: string;
					actionable?: boolean;
					correctedIntent?: string;
				};
				wasWrong = typeof raw['wasWrong'] === 'string' ? raw['wasWrong'] : wasWrong;
				shouldBe = typeof raw['shouldBe'] === 'string' ? raw['shouldBe'] : shouldBe;
				actionable = raw['actionable'] === true;
				correctedIntent = raw['correctedIntent'] === 'action' ? 'action' : 'query';
			} catch {
				// Use defaults
			}
		}

		emitWorkflowStep(runId, 'complete', 'understand', 'correction', { actionable });

		return {
			wasWrong,
			shouldBe,
			actionable,
			correctedIntent,
			_message: inputData.message,
			_previousOutput: inputData.previousOutput,
			_conversationId: inputData.conversationId
		};
	}
});

// ── Step 2: Respond or Retry ──────────────────────────────────────────────────

const respondOrRetryStep = createStep({
	id: 'respond_or_retry',
	description: 'Acknowledge the correction and guide the user, or ask a single clarifying question',
	inputSchema: UnderstandOutputSchema,
	outputSchema: OutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'respond_or_retry', 'correction');

		const model = await selectModel('google.gemini-2.5-flash');
		let response = '';

		if (inputData.actionable) {
			// Actionable correction — acknowledge and invite re-send
			// We return a message that tells the user to re-ask with the corrected framing.
			// The client should then re-send the conversation, which will route to query/action.
			if (model) {
				const { text } = await generateText({
					model,
					system: `You are Charlie, a friendly OCI cloud advisor. A user has corrected your previous response.
Acknowledge the correction warmly, briefly explain what you'll do differently, and invite them to re-send their request.
Keep it to 2-3 sentences. Start with "Got it —"`,
					prompt: `What was wrong: ${inputData.wasWrong}\nWhat it should be: ${inputData.shouldBe}`
				});
				response = text;
			} else {
				response = `Got it — ${inputData.wasWrong}. Let me ${inputData.shouldBe} instead. Please re-send your request and I'll try again with the correct approach.`;
			}
		} else {
			// Not enough information — ask ONE focused clarifying question
			if (model) {
				const { text } = await generateText({
					model,
					system: `You are Charlie, a friendly OCI cloud advisor. A user has corrected your response but the correction is unclear.
Ask exactly ONE short, focused clarifying question to understand what they need.
Do NOT ask multiple questions. Do NOT apologise excessively.`,
					prompt: `User said: "${inputData._message}"\nPrevious response: "${inputData._previousOutput}"`
				});
				response = text;
			} else {
				response = `Could you clarify what you'd like me to do differently? ${inputData.wasWrong}`;
			}
		}

		emitWorkflowStep(runId, 'complete', 'respond_or_retry', 'correction', {
			actionable: inputData.actionable
		});
		emitWorkflowStatus(runId, 'completed', { output: { response } });

		return { response };
	}
});

// ── Workflow ──────────────────────────────────────────────────────────────────

export const correctWorkflow = createWorkflow({
	id: 'charlie-correct',
	description: 'Handle user corrections to previous Charlie responses',
	inputSchema: InputSchema,
	outputSchema: OutputSchema
})
	.then(understandStep)
	.then(respondOrRetryStep)
	.commit();
