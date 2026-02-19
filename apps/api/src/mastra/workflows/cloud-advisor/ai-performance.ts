/**
 * CloudAdvisor AI Performance Workflow.
 *
 * Three-step pipeline:
 *   collect_ai_metrics → analyse → persist_and_notify
 *
 * OCI-first: collects OCI GenAI service usage metrics, alarm states, and
 * internal CloudNow model usage patterns. Identifies latency outliers,
 * token waste, and model selection inefficiencies.
 *
 * TOOL ISOLATION: Only CLOUDADVISOR_TOOLS (approvalLevel === 'auto') are used.
 */

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { generateText } from 'ai';
import { selectModel } from '../../providers.js';
import { emitWorkflowStep, emitWorkflowStatus } from '../../events.js';
import { CLOUDADVISOR_TOOLS, executeTool } from '../../tools/index.js';
import { FindingSchema, createFinding, sortByPriority, type Finding } from '../../findings.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

const InputSchema = z.object({
	runId: z.string(),
	compartmentId: z.string().optional(),
	depth: z.enum(['light', 'deep']).default('light')
});

const AIMetricsOutputSchema = z.object({
	alarms: z.unknown(),
	alarmsError: z.string().optional(),
	genAiMetrics: z.unknown(),
	genAiMetricsError: z.string().optional(),
	_runId: z.string(),
	_depth: z.enum(['light', 'deep'])
});

const OutputSchema = z.object({
	findings: z.array(FindingSchema),
	runId: z.string()
});

// ── Tool helper ───────────────────────────────────────────────────────────────

async function runAdvisorTool(name: string, args: Record<string, unknown>): Promise<unknown> {
	if (!(CLOUDADVISOR_TOOLS as readonly string[]).includes(name)) {
		throw new Error(`Tool "${name}" is not in CLOUDADVISOR_TOOLS`);
	}
	return executeTool(name, args);
}

// ── Step 1: Collect AI metrics ────────────────────────────────────────────────

const collectAIMetricsStep = createStep({
	id: 'collect_ai_metrics',
	description: 'Collect OCI GenAI service alarms and utilisation metrics',
	inputSchema: InputSchema,
	outputSchema: AIMetricsOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'collect_ai_metrics', 'ai-performance');

		const compartmentArgs: Record<string, unknown> = {};
		if (inputData.compartmentId) compartmentArgs['compartmentId'] = inputData.compartmentId;

		const [alarmsResult, metricsResult] = await Promise.allSettled([
			// Active alarms — surface GenAI latency or error rate alarms
			runAdvisorTool('listAlarms', compartmentArgs),
			// Summarise GenAI service metrics (latency, throughput, errors)
			runAdvisorTool('summarizeMetrics', {
				...compartmentArgs,
				namespace: 'oci_generativeai',
				query: 'InferenceDuration[30m].mean()',
				startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
				endTime: new Date().toISOString()
			})
		]);

		const alarms = alarmsResult.status === 'fulfilled' ? alarmsResult.value : null;
		const alarmsError =
			alarmsResult.status === 'rejected' ? String(alarmsResult.reason) : undefined;

		const genAiMetrics = metricsResult.status === 'fulfilled' ? metricsResult.value : null;
		const genAiMetricsError =
			metricsResult.status === 'rejected' ? String(metricsResult.reason) : undefined;

		emitWorkflowStep(runId, 'complete', 'collect_ai_metrics', 'ai-performance', {
			alarmsOk: !alarmsError,
			metricsOk: !genAiMetricsError
		});

		return {
			alarms,
			alarmsError,
			genAiMetrics,
			genAiMetricsError,
			_runId: inputData.runId,
			_depth: inputData.depth
		};
	}
});

// ── Step 2: Analyse ───────────────────────────────────────────────────────────

const analyseStep = createStep({
	id: 'analyse',
	description: 'Identify AI workload inefficiencies, token waste, and model mismatch',
	inputSchema: AIMetricsOutputSchema,
	outputSchema: z.object({ findings: z.array(FindingSchema), _runId: z.string() }),
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'analyse', 'ai-performance');

		const modelId = inputData._depth === 'deep' ? 'gemini-pro' : 'gemini-flash';
		const model = await selectModel(modelId);
		const findings: Finding[] = [];

		if (model) {
			const dataContext = JSON.stringify(
				{
					alarms: inputData.alarms,
					genAiMetrics: inputData.genAiMetrics
				},
				null,
				2
			).slice(0, 12_000);

			const { text } = await generateText({
				model,
				system: `You are CloudAdvisor, an autonomous AI workload performance analyser.
Analyse the provided OCI GenAI service metrics and alarm states. Identify:

1. HIGH LATENCY: inference duration outliers (>2x baseline) — which models, which time windows
2. TOKEN WASTE: large context window usage with low information density patterns
   (inference cost high, output quality not proportionally high)
3. MODEL MISMATCH: expensive frontier models (GPT-4, Gemini Pro) used for tasks
   where a smaller model (Gemini Flash, Command-R) would suffice
4. COST PER INFERENCE TRENDS: rising cost trends without corresponding throughput increase
5. ERROR RATE SPIKES: model error rates > 1% sustained — service reliability concern
6. REDUNDANT CALLS: similar queries repeated without caching — opportunity for semantic caching

For each finding, provide a specific recommendation including which model to switch to
or which caching strategy to apply.

Respond with ONLY a valid JSON array of findings. Each finding:
{
  "domain": "ai-performance",
  "severity": "high"|"medium"|"low"|"info",
  "confidence": "high"|"medium"|"low",
  "title": "one scannable line",
  "summary": "2-3 sentences",
  "impact": "estimated cost or latency impact",
  "recommendation": "specific model or architecture change",
  "charlieAction": { "prompt": "exact Charlie prompt", "riskLevel": "low"|"medium"|"high" },
  "resources": [{ "cloud": "oci", "type": "generativeai.model", "id": "...", "name": "..." }]
}`,
				prompt: `AI service data:\n${dataContext}\n\nRunId: ${inputData._runId}`
			});

			try {
				const cleaned = text
					.replace(/^```json\s*/i, '')
					.replace(/```\s*$/i, '')
					.trim();
				const raw = JSON.parse(cleaned) as Array<Record<string, unknown>>;
				if (Array.isArray(raw)) {
					for (const item of raw) {
						try {
							const finding = createFinding(inputData._runId, {
								domain: 'ai-performance',
								severity: (item['severity'] as Finding['severity']) ?? 'info',
								confidence: (item['confidence'] as Finding['confidence']) ?? 'low',
								title: String(item['title'] ?? ''),
								summary: String(item['summary'] ?? ''),
								impact: String(item['impact'] ?? ''),
								recommendation: String(item['recommendation'] ?? ''),
								charlieAction: item['charlieAction'] as Finding['charlieAction'],
								resources: (item['resources'] as Finding['resources']) ?? [],
								metadata: { rawItem: item }
							});
							findings.push(finding);
						} catch {
							// Skip malformed entries
						}
					}
				}
			} catch {
				// Model output could not be parsed
			}
		}

		emitWorkflowStep(runId, 'complete', 'analyse', 'ai-performance', {
			findingCount: findings.length
		});

		return { findings, _runId: inputData._runId };
	}
});

// ── Step 3: Persist and notify ────────────────────────────────────────────────

const persistAndNotifyStep = createStep({
	id: 'persist_and_notify',
	description: 'Emit AI performance analysis completion event',
	inputSchema: z.object({ findings: z.array(FindingSchema), _runId: z.string() }),
	outputSchema: OutputSchema,
	execute: async ({ inputData, runId }) => {
		const sorted = sortByPriority(inputData.findings);

		emitWorkflowStatus(runId, 'completed', {
			output: {
				domain: 'ai-performance',
				findingCount: inputData.findings.length,
				topFinding: sorted[0]?.title ?? null
			}
		});

		return { findings: inputData.findings, runId: inputData._runId };
	}
});

// ── Workflow ──────────────────────────────────────────────────────────────────

export const aiPerformanceWorkflow = createWorkflow({
	id: 'cloud-advisor-ai-performance',
	description:
		'CloudAdvisor AI workload performance analysis — token waste, latency, model selection',
	inputSchema: InputSchema,
	outputSchema: OutputSchema
})
	.then(collectAIMetricsStep)
	.then(analyseStep)
	.then(persistAndNotifyStep)
	.commit();
