/**
 * CloudAdvisor Cost Analysis Workflow.
 *
 * Five-step pipeline:
 *   collect_cost_data → collect_usage_data → analyse → persist_findings → notify
 *
 * Collects OCI cost and utilisation data, identifies waste (idle resources,
 * oversized instances, reserved instance opportunities), and persists findings.
 * AWS and Azure cost data is collected where tools are available.
 *
 * TOOL ISOLATION: Only CLOUDADVISOR_TOOLS (approvalLevel === 'auto') are used.
 */

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { generateText } from 'ai';
import { randomUUID } from 'node:crypto';
import { selectModel } from '../../providers.js';
import { emitWorkflowStep, emitWorkflowStatus } from '../../events.js';
import { CLOUDADVISOR_TOOLS, executeTool } from '../../tools/index.js';
import { FindingSchema, createFinding, sortByPriority, type Finding } from '../../findings.js';

// ── Schema ────────────────────────────────────────────────────────────────────

const InputSchema = z.object({
	runId: z.string(),
	compartmentId: z.string().optional(),
	/** 'light' for scheduled runs (gemini-flash), 'deep' for on-demand (gemini-pro) */
	depth: z.enum(['light', 'deep']).default('light')
});

const CostDataOutputSchema = z.object({
	ociCostData: z.unknown(),
	ociCostError: z.string().optional(),
	_runId: z.string(),
	_compartmentId: z.string().optional(),
	_depth: z.enum(['light', 'deep'])
});

const UsageDataOutputSchema = z.object({
	ociInstances: z.unknown(),
	ociInstancesError: z.string().optional(),
	costData: z.unknown(),
	_runId: z.string(),
	_depth: z.enum(['light', 'deep'])
});

const AnalyseOutputSchema = z.object({
	findings: z.array(FindingSchema),
	estimatedSavings: z.number(),
	_runId: z.string()
});

const OutputSchema = z.object({
	findings: z.array(FindingSchema),
	estimatedSavings: z.number(),
	runId: z.string()
});

// ── Tool helper ───────────────────────────────────────────────────────────────

async function runAdvisorTool(name: string, args: Record<string, unknown>): Promise<unknown> {
	if (!(CLOUDADVISOR_TOOLS as readonly string[]).includes(name)) {
		throw new Error(
			`Tool "${name}" is not in CLOUDADVISOR_TOOLS — CloudAdvisor cannot call mutating tools`
		);
	}
	return executeTool(name, args);
}

// ── Step 1: Collect cost data ─────────────────────────────────────────────────

const collectCostDataStep = createStep({
	id: 'collect_cost_data',
	description: 'Collect cost data from OCI (parallel where available)',
	inputSchema: InputSchema,
	outputSchema: CostDataOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'collect_cost_data', 'cost-analysis');

		let ociCostData: unknown = null;
		let ociCostError: string | undefined;

		// OCI cost data
		emitWorkflowStep(runId, 'start', 'collect_cost_data:oci', 'tool-call');
		try {
			ociCostData = await runAdvisorTool('getUsageCost', {
				period: 'last30days',
				groupBy: 'service'
			});
			emitWorkflowStep(runId, 'complete', 'collect_cost_data:oci', 'tool-call');
		} catch (err) {
			ociCostError = err instanceof Error ? err.message : String(err);
			emitWorkflowStep(runId, 'error', 'collect_cost_data:oci', 'tool-call', {
				error: ociCostError
			});
		}

		// AWS and Azure cost data requires external integrations not yet available in
		// CLOUDADVISOR_TOOLS. Pricing comparison tools (getAWSPricing, getAzurePricing)
		// provide rate cards but not actual spend data.
		// TODO: integrate aws_get_cost_explorer and azure_get_cost_management when added.

		emitWorkflowStep(runId, 'complete', 'collect_cost_data', 'cost-analysis', {
			ociOk: !ociCostError
		});

		return {
			ociCostData,
			ociCostError,
			_runId: inputData.runId,
			_compartmentId: inputData.compartmentId,
			_depth: inputData.depth
		};
	}
});

// ── Step 2: Collect usage data ────────────────────────────────────────────────

const collectUsageDataStep = createStep({
	id: 'collect_usage_data',
	description: 'Collect compute instance list and utilisation metrics',
	inputSchema: CostDataOutputSchema,
	outputSchema: UsageDataOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'collect_usage_data', 'cost-analysis');

		let ociInstances: unknown = null;
		let ociInstancesError: string | undefined;

		emitWorkflowStep(runId, 'start', 'collect_usage_data:instances', 'tool-call');
		try {
			const listArgs: Record<string, unknown> = {};
			if (inputData._compartmentId) listArgs['compartmentId'] = inputData._compartmentId;
			ociInstances = await runAdvisorTool('listInstances', listArgs);
			emitWorkflowStep(runId, 'complete', 'collect_usage_data:instances', 'tool-call');
		} catch (err) {
			ociInstancesError = err instanceof Error ? err.message : String(err);
			emitWorkflowStep(runId, 'error', 'collect_usage_data:instances', 'tool-call', {
				error: ociInstancesError
			});
		}

		emitWorkflowStep(runId, 'complete', 'collect_usage_data', 'cost-analysis');

		return {
			ociInstances,
			ociInstancesError,
			costData: inputData.ociCostData,
			_runId: inputData._runId,
			_depth: inputData._depth
		};
	}
});

// ── Step 3: Analyse ───────────────────────────────────────────────────────────

const analyseStep = createStep({
	id: 'analyse',
	description: 'Identify cost waste, right-sizing opportunities, and cross-cloud arbitrage',
	inputSchema: UsageDataOutputSchema,
	outputSchema: AnalyseOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'analyse', 'cost-analysis');

		const modelId = inputData._depth === 'deep' ? 'gemini-pro' : 'gemini-flash';
		const model = await selectModel(modelId);
		const findings: Finding[] = [];
		let estimatedSavings = 0;

		if (model) {
			const dataContext = JSON.stringify(
				{
					ociCost: inputData.costData,
					ociInstances: inputData.ociInstances
				},
				null,
				2
			).slice(0, 12_000); // stay within context window

			const { text } = await generateText({
				model,
				system: `You are CloudAdvisor, an autonomous cloud cost analysis engine.
Analyse the provided OCI cost and compute data. Identify:
1. Idle or underutilised resources (cost > $0, CPU utilisation < 20%)
2. Oversized instances (allocated >> actual usage patterns)
3. Reserved instance opportunities (on-demand instances running >720h/month)
4. Cross-cloud arbitrage (OCI alternatives for expensive Azure/AWS workloads)

Respond with ONLY a valid JSON array of findings. Each finding:
{
  "domain": "cost",
  "severity": "critical"|"high"|"medium"|"low"|"info",
  "confidence": "high"|"medium"|"low",
  "title": "one scannable line",
  "summary": "2-3 sentences",
  "impact": "quantified $impact",
  "recommendation": "specific action",
  "charlieAction": { "prompt": "exact Charlie prompt to act on this", "riskLevel": "low"|"medium"|"high" },
  "resources": [{ "cloud": "oci", "type": "compute.instance", "id": "ocid...", "name": "..." }]
}

If data is insufficient for a finding, set confidence to "low" and say so in the summary.
Return [] if no findings are warranted.`,
				prompt: `OCI infrastructure data:\n${dataContext}\n\nRunId: ${inputData._runId}`
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
								domain: 'cost',
								severity: (item['severity'] as Finding['severity']) ?? 'info',
								confidence: (item['confidence'] as Finding['confidence']) ?? 'low',
								title: String(item['title'] ?? 'Unnamed finding'),
								summary: String(item['summary'] ?? ''),
								impact: String(item['impact'] ?? 'Unknown'),
								recommendation: String(item['recommendation'] ?? ''),
								charlieAction: item['charlieAction'] as Finding['charlieAction'],
								resources: (item['resources'] as Finding['resources']) ?? [],
								metadata: { rawItem: item }
							});
							findings.push(finding);

							// Extract estimated savings from impact text
							const savingsMatch = String(item['impact'] ?? '').match(/\$([0-9,]+)/);
							if (savingsMatch) {
								estimatedSavings += parseInt(savingsMatch[1].replace(/,/g, ''), 10);
							}
						} catch {
							// Skip malformed finding entries
						}
					}
				}
			} catch {
				// Model output could not be parsed — no findings this run
			}
		}

		emitWorkflowStep(runId, 'complete', 'analyse', 'cost-analysis', {
			findingCount: findings.length,
			estimatedSavings
		});

		return { findings, estimatedSavings, _runId: inputData._runId };
	}
});

// ── Step 4: Persist findings ──────────────────────────────────────────────────

const persistFindingsStep = createStep({
	id: 'persist_findings',
	description: 'Emit findings for caller persistence (findings are returned in workflow output)',
	inputSchema: AnalyseOutputSchema,
	outputSchema: AnalyseOutputSchema,
	execute: async ({ inputData, runId }) => {
		// Persistence is handled by the caller (scheduler or API route) via
		// findingsRepository.upsertFindings(). The workflow returns findings as data
		// so the caller has full access and can batch-persist with proper DB access.
		emitWorkflowStep(runId, 'complete', 'persist_findings', 'cost-analysis', {
			findingCount: inputData.findings.length
		});
		return inputData;
	}
});

// ── Step 5: Notify ────────────────────────────────────────────────────────────

const notifyStep = createStep({
	id: 'notify',
	description: 'Emit analysis_completed event with cost analysis summary',
	inputSchema: AnalyseOutputSchema,
	outputSchema: OutputSchema,
	execute: async ({ inputData, runId }) => {
		const sorted = sortByPriority(inputData.findings);

		emitWorkflowStatus(runId, 'completed', {
			output: {
				domain: 'cost',
				findingCount: inputData.findings.length,
				estimatedSavings: inputData.estimatedSavings,
				topFinding: sorted[0]?.title ?? null
			}
		});

		return {
			findings: inputData.findings,
			estimatedSavings: inputData.estimatedSavings,
			runId: inputData._runId
		};
	}
});

// ── Workflow ──────────────────────────────────────────────────────────────────

export const costAnalysisWorkflow = createWorkflow({
	id: 'cloud-advisor-cost',
	description:
		'CloudAdvisor cost optimisation analysis — identifies waste and savings opportunities',
	inputSchema: InputSchema,
	outputSchema: OutputSchema
})
	.then(collectCostDataStep)
	.then(collectUsageDataStep)
	.then(analyseStep)
	.then(persistFindingsStep)
	.then(notifyStep)
	.commit();
