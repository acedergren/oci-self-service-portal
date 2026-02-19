/**
 * Charlie Action Workflow — write/destructive OCI operations with approval gate.
 *
 * Five-step pipeline:
 *   plan → pre_execution_summary → execute → completion_summary → persist
 *
 * The `pre_execution_summary` step uses Mastra's native suspend/resume:
 * - If any planned step requires approval, the workflow suspends and emits
 *   an `approval_required` event to the frontend via the stream bus.
 * - On resume, `resumeData.approved` determines whether execution proceeds
 *   or is rejected.
 *
 * Register as 'charlieActionWorkflow' to avoid collision with the existing
 * 'actionWorkflow' (action-workflow.ts) which is a lower-level tool executor.
 */

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { generateText } from 'ai';
import { randomUUID } from 'node:crypto';
import { selectModel } from '../../providers.js';
import { emitWorkflowStep, emitWorkflowStatus } from '../../events.js';
import { requiresApproval, getRiskLevel, type RiskLevel } from '../../risk.js';
import { CompensationPlan, runCompensations } from '../compensation.js';
import { CHARLIE_TOOLS, executeTool } from '../../tools/index.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

const BaseInputSchema = z.object({
	conversationId: z.string(),
	message: z.string(),
	history: z.array(z.record(z.string(), z.unknown())),
	mcpToolsets: z.record(z.string(), z.unknown()).default({}),
	userId: z.string()
});

const PlannedStepSchema = z.object({
	tool: z.string(),
	input: z.record(z.string(), z.unknown()).default({}),
	description: z.string()
});

const PlanOutputSchema = z.object({
	steps: z.array(PlannedStepSchema),
	requiresApproval: z.boolean(),
	riskLevel: z.string(),
	summary: z.string(),
	// Pass-through original input
	_conversationId: z.string(),
	_message: z.string(),
	_history: z.array(z.record(z.string(), z.unknown())),
	_mcpToolsets: z.record(z.string(), z.unknown()),
	_userId: z.string()
});

const PreExecOutputSchema = z.object({
	message: z.string(),
	suspended: z.boolean(),
	// Pass-through from plan
	steps: z.array(PlannedStepSchema),
	_conversationId: z.string(),
	_message: z.string(),
	_mcpToolsets: z.record(z.string(), z.unknown()),
	_userId: z.string()
});

const ExecuteOutputSchema = z.object({
	results: z.array(
		z.object({
			step: z.string(),
			tool: z.string(),
			result: z.unknown(),
			error: z.string().optional(),
			success: z.boolean()
		})
	),
	anyFailed: z.boolean(),
	_conversationId: z.string(),
	_message: z.string(),
	_userId: z.string()
});

const SummaryOutputSchema = z.object({
	response: z.string(),
	_conversationId: z.string(),
	_message: z.string()
});

// ── Tool runner ───────────────────────────────────────────────────────────────

async function runTool(
	name: string,
	args: Record<string, unknown>,
	mcpToolsets: Record<string, unknown>
): Promise<unknown> {
	// Explicit allowlist check — reject names not in either registry before execution.
	// This prevents LLM-fabricated tool names from reaching any execution path.
	const inOciRegistry = CHARLIE_TOOLS.includes(name);
	const inMcpToolsets = Object.prototype.hasOwnProperty.call(mcpToolsets, name);
	if (!inOciRegistry && !inMcpToolsets) {
		throw new Error(`Tool "${name}" not found in OCI registry or MCP toolsets`);
	}
	if (inOciRegistry) {
		return executeTool(name, args);
	}
	const mcpTool = mcpToolsets[name] as
		| { execute: (args: unknown, ctx: unknown) => Promise<unknown> }
		| undefined;
	if (!mcpTool?.execute) {
		throw new Error(`Tool "${name}" is registered but has no execute function`);
	}
	return mcpTool.execute(args, { messages: [], toolCallId: randomUUID() });
}

// ── Step 1: Plan ──────────────────────────────────────────────────────────────

const planStep = createStep({
	id: 'plan',
	description: 'Plan the sequence of OCI actions needed to fulfil the request',
	inputSchema: BaseInputSchema,
	outputSchema: PlanOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'plan', 'action');

		const model = await selectModel('google.gemini-2.5-flash');
		const allTools = [...CHARLIE_TOOLS, ...Object.keys(inputData.mcpToolsets)];

		let steps: z.infer<typeof PlannedStepSchema>[] = [];
		let summary = inputData.message;

		if (model) {
			const { text } = await generateText({
				model,
				system: `You are an OCI cloud operations planner. Given a user's request, produce a precise, ordered list of OCI tool calls to fulfil it.

Available tools: ${allTools.join(', ')}

Respond with ONLY a JSON object:
{
  "steps": [
    { "tool": "toolName", "input": { "key": "value" }, "description": "what this step does" }
  ],
  "summary": "one sentence summarising all the actions that will be taken"
}

Be explicit about tool inputs. If you're unsure about a required field's value, use a placeholder like "{{compartmentId}}" rather than omitting it.`,
				prompt: inputData.message
			});

			try {
				const cleaned = text
					.replace(/^```json\s*/i, '')
					.replace(/```\s*$/i, '')
					.trim();
				const raw = JSON.parse(cleaned) as {
					steps?: Array<{ tool?: string; input?: Record<string, unknown>; description?: string }>;
					summary?: string;
				};
				if (Array.isArray(raw['steps'])) {
					steps = raw['steps']
						.filter((s) => typeof s.tool === 'string')
						.map((s) => ({
							tool: s.tool as string,
							input: s.input ?? {},
							description: s.description ?? (s.tool as string)
						}));
				}
				if (typeof raw['summary'] === 'string') {
					summary = raw['summary'];
				}
			} catch {
				// Fall back to treating the entire message as a single-step prompt
			}
		}

		// Assess risk across all steps
		const toolRequiresApproval = steps.some((s) => requiresApproval(s.tool));
		const riskLevels = steps.map((s) => getRiskLevel(s.tool));
		const riskOrder: RiskLevel[] = ['low', 'medium', 'high'];
		const highestRisk: RiskLevel = riskLevels.reduce(
			(acc, r) => (riskOrder.indexOf(r) > riskOrder.indexOf(acc) ? r : acc),
			'low' as RiskLevel
		);

		emitWorkflowStep(runId, 'complete', 'plan', 'action', {
			stepCount: steps.length,
			requiresApproval: toolRequiresApproval,
			riskLevel: highestRisk
		});

		return {
			steps,
			requiresApproval: toolRequiresApproval,
			riskLevel: highestRisk,
			summary,
			_conversationId: inputData.conversationId,
			_message: inputData.message,
			_history: inputData.history,
			_mcpToolsets: inputData.mcpToolsets,
			_userId: inputData.userId
		};
	}
});

// ── Step 2: Pre-execution summary (with optional suspend) ─────────────────────

const preExecStep = createStep({
	id: 'pre_execution_summary',
	description: 'Request approval for high-risk actions or proceed immediately for safe ones',
	inputSchema: PlanOutputSchema,
	outputSchema: PreExecOutputSchema,
	suspendSchema: z.object({
		message: z.string(),
		steps: z.array(PlannedStepSchema),
		riskLevel: z.string(),
		summary: z.string()
	}),
	resumeSchema: z.object({
		approved: z.boolean(),
		reason: z.string().optional()
	}),
	execute: async ({ inputData, suspend, resumeData, runId }) => {
		// Destructure pass-through fields
		const { steps, _conversationId, _message, _mcpToolsets, _userId } = inputData;

		if (inputData.requiresApproval) {
			if (!resumeData) {
				// First execution — suspend and wait for approval
				emitWorkflowStep(runId, 'start', 'pre_execution_summary', 'action');
				emitWorkflowStatus(runId, 'suspended', {
					output: {
						requiresApproval: true,
						riskLevel: inputData.riskLevel,
						summary: inputData.summary,
						steps
					}
				});

				// Suspend: serialises state to DB, emits suspension event.
				// Execution resumes here (second call) when run.resume() is called.
				return await suspend({
					message: `Action requires approval: ${inputData.summary}`,
					steps,
					riskLevel: inputData.riskLevel,
					summary: inputData.summary
				});
			}

			// Second execution (after resume) — check approval decision
			emitWorkflowStep(runId, 'start', 'pre_execution_summary', 'action');
			if (!resumeData.approved) {
				emitWorkflowStatus(runId, 'cancelled', {
					error: resumeData.reason ?? 'Action rejected by user'
				});
				throw new Error(`Action rejected: ${resumeData.reason ?? 'no reason given'}`);
			}

			emitWorkflowStep(runId, 'complete', 'pre_execution_summary', 'action', {
				approved: true
			});
			emitWorkflowStatus(runId, 'running');

			return {
				message: 'Approval received. Executing now.',
				suspended: true,
				steps,
				_conversationId,
				_message,
				_mcpToolsets,
				_userId
			};
		}

		// No approval needed — proceed immediately
		emitWorkflowStep(runId, 'complete', 'pre_execution_summary', 'action', { autoApproved: true });

		return {
			message: `I'll ${inputData.summary}. Starting now.`,
			suspended: false,
			steps,
			_conversationId,
			_message,
			_mcpToolsets,
			_userId
		};
	}
});

// ── Step 3: Execute ───────────────────────────────────────────────────────────

const executeStep = createStep({
	id: 'execute',
	description: 'Execute the planned OCI actions with saga compensation',
	inputSchema: PreExecOutputSchema,
	outputSchema: ExecuteOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'execute', 'action');

		const { steps, _mcpToolsets, _conversationId, _message, _userId } = inputData;
		const plan = new CompensationPlan();
		const results: z.infer<typeof ExecuteOutputSchema>['results'] = [];
		let anyFailed = false;

		for (let i = 0; i < steps.length; i++) {
			const step = steps[i];
			const stepId = `step-${i}`;
			emitWorkflowStep(runId, 'start', `execute:${step.tool}`, 'tool-call');

			try {
				const result = await runTool(step.tool, step.input, _mcpToolsets);

				// Track compensation entry for saga rollback.
				// Validate the auto-generated compensate action name against the tool registry
				// before registering it — prevents LLM-fabricated names from reaching rollback.
				const compensateAction = `delete${step.tool.charAt(0).toUpperCase()}${step.tool.slice(1)}`;
				if (CHARLIE_TOOLS.includes(compensateAction)) {
					plan.add({
						nodeId: stepId,
						toolName: step.tool,
						compensateAction,
						compensateArgs: step.input
					});
				} else {
					console.warn(
						`No compensation action found for tool "${step.tool}" (tried "${compensateAction}") — step will not be rolled back`
					);
				}

				results.push({ step: stepId, tool: step.tool, result, success: true });
				emitWorkflowStep(runId, 'complete', `execute:${step.tool}`, 'tool-call');
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				results.push({ step: stepId, tool: step.tool, result: null, error: msg, success: false });
				anyFailed = true;

				emitWorkflowStep(runId, 'error', `execute:${step.tool}`, 'tool-call', { error: msg });

				// Run saga rollback in reverse order
				if (plan.hasCompensations) {
					try {
						await runCompensations(plan.entries(), async (action, args) => {
							await executeTool(action, args);
						});
					} catch {
						// Compensation itself failed — log but don't re-throw
					}
				}

				emitWorkflowStatus(runId, 'failed', { error: msg });
				// Stop further execution after first failure
				break;
			}
		}

		emitWorkflowStep(runId, 'complete', 'execute', 'action', {
			succeeded: results.filter((r) => r.success).length,
			failed: results.filter((r) => !r.success).length
		});

		return { results, anyFailed, _conversationId, _message, _userId };
	}
});

// ── Step 4: Completion summary ─────────────────────────────────────────────────

const completionSummaryStep = createStep({
	id: 'completion_summary',
	description: 'Generate a natural language summary of what was executed',
	inputSchema: ExecuteOutputSchema,
	outputSchema: SummaryOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'completion_summary', 'action');

		const model = await selectModel('google.gemini-2.5-flash');

		const resultSummary = inputData.results
			.map((r) =>
				r.success ? `✓ ${r.tool}: completed successfully` : `✗ ${r.tool}: failed — ${r.error}`
			)
			.join('\n');

		let response = '';
		if (model) {
			const { text } = await generateText({
				model,
				system: `You are Charlie, a friendly OCI cloud advisor. Summarise what actions were taken.
Be concise and honest. If any action failed, acknowledge it clearly and suggest next steps if applicable.`,
				prompt: `User request: ${inputData._message}\n\nResults:\n${resultSummary}`
			});
			response = text;
		} else {
			response = inputData.anyFailed
				? `Some actions encountered errors:\n${resultSummary}`
				: `All actions completed successfully:\n${resultSummary}`;
		}

		emitWorkflowStep(runId, 'complete', 'completion_summary', 'action');

		return { response, _conversationId: inputData._conversationId, _message: inputData._message };
	}
});

// ── Step 5: Persist ───────────────────────────────────────────────────────────

const persistStep = createStep({
	id: 'persist',
	description: 'Save action run result to Mastra memory',
	inputSchema: SummaryOutputSchema,
	outputSchema: z.object({ response: z.string() }),
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
				// Non-fatal
			}
		}

		emitWorkflowStatus(runId, 'completed', { output: { response: inputData.response } });
		return { response: inputData.response };
	}
});

// ── Workflow ──────────────────────────────────────────────────────────────────

export const charlieActionWorkflow = createWorkflow({
	id: 'charlie-action-workflow',
	description:
		'Execute write/destructive OCI actions with optional approval gate and saga compensation',
	inputSchema: BaseInputSchema,
	outputSchema: z.object({ response: z.string() })
})
	.then(planStep)
	.then(preExecStep)
	.then(executeStep)
	.then(completionSummaryStep)
	.then(persistStep)
	.commit();
