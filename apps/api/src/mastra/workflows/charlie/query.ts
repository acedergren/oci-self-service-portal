/**
 * Charlie Query Workflow — read-only OCI question answering.
 *
 * Four-step pipeline for handling user queries:
 *   plan → execute → synthesise → persist
 *
 * No approval gate. Runs OCI tool calls in parallel or sequentially based
 * on the planner's assessment, then synthesises a response.
 */

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { generateText } from 'ai';
import { randomUUID } from 'node:crypto';
import { selectModel } from '../../providers.js';
import { emitWorkflowStep, emitWorkflowStatus } from '../../events.js';
import { CHARLIE_TOOLS, executeTool } from '../../tools/index.js';

// ── Shared schemas ────────────────────────────────────────────────────────────

const BaseInputSchema = z.object({
	conversationId: z.string(),
	message: z.string(),
	history: z.array(z.record(z.string(), z.unknown())),
	intent: z.string().optional(),
	mcpToolsets: z.record(z.string(), z.unknown()).default({})
});

const PlanOutputSchema = z.object({
	tools: z.array(z.string()),
	reasoning: z.string(),
	parallel: z.boolean(),
	// Pass-through original input for downstream steps
	_conversationId: z.string(),
	_message: z.string(),
	_history: z.array(z.record(z.string(), z.unknown())),
	_mcpToolsets: z.record(z.string(), z.unknown())
});

const ExecuteOutputSchema = z.object({
	toolResults: z.array(
		z.object({
			tool: z.string(),
			result: z.unknown(),
			error: z.string().optional(),
			success: z.boolean()
		})
	),
	_message: z.string(),
	_history: z.array(z.record(z.string(), z.unknown())),
	_conversationId: z.string()
});

const SynthesiseOutputSchema = z.object({
	response: z.string(),
	sources: z.array(z.string()),
	confidence: z.number().min(0).max(1),
	_conversationId: z.string(),
	_message: z.string()
});

// ── Tool runner ───────────────────────────────────────────────────────────────

async function runTool(
	name: string,
	args: Record<string, unknown>,
	mcpToolsets: Record<string, unknown>
): Promise<unknown> {
	if (CHARLIE_TOOLS.includes(name)) {
		return executeTool(name, args);
	}
	// MCP tool — delegate to MCP toolset execute
	const mcpTool = mcpToolsets[name] as
		| { execute: (args: unknown, ctx: unknown) => Promise<unknown> }
		| undefined;
	if (!mcpTool?.execute) {
		throw new Error(`Tool "${name}" not found in OCI registry or MCP toolsets`);
	}
	return mcpTool.execute(args, { messages: [], toolCallId: randomUUID() });
}

// ── Step 1: Plan ─────────────────────────────────────────────────────────────

const planStep = createStep({
	id: 'plan',
	description: 'Determine which tools to call and in what order',
	inputSchema: BaseInputSchema,
	outputSchema: PlanOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'plan', 'query');

		const model = await selectModel('google.gemini-2.5-flash');
		const mcpToolNames = Object.keys(inputData.mcpToolsets);
		const allTools = [...CHARLIE_TOOLS, ...mcpToolNames];

		let tools: string[] = [];
		let reasoning = '';
		let parallel = false;

		if (model) {
			const { text } = await generateText({
				model,
				system: `You are a planner for an OCI cloud operations assistant. Given a user question, identify which OCI tools to call.

Available tools: ${allTools.join(', ')}

Respond with ONLY a JSON object:
{
  "tools": ["toolName1", "toolName2"],
  "reasoning": "one sentence explaining why these tools answer the question",
  "parallel": true|false  // true if tools are independent and can run at the same time
}

Select only the tools needed. For simple queries, one tool is usually enough.`,
				prompt: inputData.message
			});

			try {
				const cleaned = text
					.replace(/^```json\s*/i, '')
					.replace(/```\s*$/i, '')
					.trim();
				const raw = JSON.parse(cleaned) as {
					tools?: string[];
					reasoning?: string;
					parallel?: boolean;
				};
				tools = Array.isArray(raw['tools']) ? raw['tools'].filter((t) => allTools.includes(t)) : [];
				reasoning = typeof raw['reasoning'] === 'string' ? raw['reasoning'] : '';
				parallel = raw['parallel'] === true;
			} catch {
				// If parse fails, proceed with no tools (synthesise will answer from context)
			}
		}

		emitWorkflowStep(runId, 'complete', 'plan', 'query', { tools, parallel });

		return {
			tools,
			reasoning,
			parallel,
			_conversationId: inputData.conversationId,
			_message: inputData.message,
			_history: inputData.history,
			_mcpToolsets: inputData.mcpToolsets
		};
	}
});

// ── Step 2: Execute ───────────────────────────────────────────────────────────

const executeStep = createStep({
	id: 'execute',
	description: 'Run the planned tools',
	inputSchema: PlanOutputSchema,
	outputSchema: ExecuteOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'execute', 'query');

		const { tools, parallel, _message, _history, _conversationId, _mcpToolsets } = inputData;

		const toolResults: z.infer<typeof ExecuteOutputSchema>['toolResults'] = [];

		if (tools.length === 0) {
			emitWorkflowStep(runId, 'complete', 'execute', 'query', { toolCount: 0 });
			return { toolResults: [], _message, _history, _conversationId };
		}

		if (parallel) {
			const settled = await Promise.allSettled(
				tools.map(async (tool) => {
					emitWorkflowStep(runId, 'start', `execute:${tool}`, 'tool-call');
					const result = await runTool(tool, {}, _mcpToolsets);
					emitWorkflowStep(runId, 'complete', `execute:${tool}`, 'tool-call');
					return { tool, result, success: true as const };
				})
			);

			for (const outcome of settled) {
				if (outcome.status === 'fulfilled') {
					toolResults.push(outcome.value);
				} else {
					const err = outcome.reason as Error;
					emitWorkflowStep(runId, 'error', 'execute', 'tool-call', { error: err.message });
					toolResults.push({
						tool: 'unknown',
						result: null,
						error: err.message,
						success: false
					});
				}
			}
		} else {
			for (const tool of tools) {
				emitWorkflowStep(runId, 'start', `execute:${tool}`, 'tool-call');
				try {
					const result = await runTool(tool, {}, _mcpToolsets);
					toolResults.push({ tool, result, success: true });
					emitWorkflowStep(runId, 'complete', `execute:${tool}`, 'tool-call');
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					toolResults.push({ tool, result: null, error: msg, success: false });
					emitWorkflowStep(runId, 'error', `execute:${tool}`, 'tool-call', { error: msg });
					// Continue — partial results are better than no results
				}
			}
		}

		emitWorkflowStep(runId, 'complete', 'execute', 'query', {
			succeeded: toolResults.filter((r) => r.success).length,
			failed: toolResults.filter((r) => !r.success).length
		});

		return { toolResults, _message, _history, _conversationId };
	}
});

// ── Step 3: Synthesise ────────────────────────────────────────────────────────

const synthesiseStep = createStep({
	id: 'synthesise',
	description: 'Synthesise tool results into a natural language response',
	inputSchema: ExecuteOutputSchema,
	outputSchema: SynthesiseOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'synthesise', 'query');

		const model = await selectModel('google.gemini-2.5-flash');

		const toolSummary =
			inputData.toolResults.length > 0
				? inputData.toolResults
						.map((r) =>
							r.success ? `${r.tool}: ${JSON.stringify(r.result)}` : `${r.tool}: ERROR — ${r.error}`
						)
						.join('\n\n')
				: 'No tools were called.';

		let response = '';
		if (model) {
			const { text } = await generateText({
				model,
				system: `You are Charlie, a warm and knowledgeable OCI cloud advisor. Answer the user's question based on the tool results provided.
Be concise, accurate, and collegial. If tools returned errors, acknowledge them honestly. If no tools were called, answer from your general cloud knowledge.`,
				prompt: `User question: ${inputData._message}\n\nTool results:\n${toolSummary}`
			});
			response = text;
		} else {
			response = toolSummary || 'I was unable to retrieve the information at this time.';
		}

		const sources = inputData.toolResults.filter((r) => r.success).map((r) => r.tool);
		const result = {
			response,
			sources,
			confidence: 0.85,
			_conversationId: inputData._conversationId,
			_message: inputData._message
		};

		emitWorkflowStep(runId, 'complete', 'synthesise', 'query');
		return result;
	}
});

// ── Step 4: Persist ───────────────────────────────────────────────────────────

const persistStep = createStep({
	id: 'persist',
	description: 'Save conversation turn to Mastra memory',
	inputSchema: SynthesiseOutputSchema,
	outputSchema: z.object({
		response: z.string(),
		sources: z.array(z.string()),
		confidence: z.number()
	}),
	execute: async ({ inputData, runId, mastra }) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const memory = (mastra as any)?.memory?.charlie;
		if (memory?.saveMessages) {
			try {
				await memory.saveMessages([
					{
						id: randomUUID(),
						content: inputData._message,
						role: 'user',
						threadId: inputData._conversationId,
						resourceId: inputData._conversationId,
						createdAt: new Date()
					},
					{
						id: randomUUID(),
						content: inputData.response,
						role: 'assistant',
						threadId: inputData._conversationId,
						resourceId: inputData._conversationId,
						createdAt: new Date()
					}
				]);
			} catch {
				// Non-fatal — memory persistence failure should not fail the workflow
			}
		}

		emitWorkflowStatus(runId, 'completed', {
			output: { response: inputData.response, sources: inputData.sources }
		});

		return {
			response: inputData.response,
			sources: inputData.sources,
			confidence: inputData.confidence
		};
	}
});

// ── Workflow ──────────────────────────────────────────────────────────────────

export const queryWorkflow = createWorkflow({
	id: 'charlie-query',
	description: 'Handle read-only OCI queries: plan → execute → synthesise → persist',
	inputSchema: BaseInputSchema,
	outputSchema: z.object({
		response: z.string(),
		sources: z.array(z.string()),
		confidence: z.number()
	})
})
	.then(planStep)
	.then(executeStep)
	.then(synthesiseStep)
	.then(persistStep)
	.commit();
