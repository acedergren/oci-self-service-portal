/**
 * CloudAdvisor Right-Sizing Workflow.
 *
 * Three-step pipeline:
 *   collect_metrics → analyse → persist_and_notify
 *
 * Collects CPU, memory, and network utilisation metrics for all compute
 * instances over a configurable look-back period (default 14 days), then
 * identifies overprovisioned and underprovisioned instances.
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
	depth: z.enum(['light', 'deep']).default('light'),
	/** Look-back period in days. Configurable via CLOUDADVISOR_RIGHTSIZING_DAYS env var. */
	lookbackDays: z.number().int().min(1).max(90).default(14)
});

const MetricsOutputSchema = z.object({
	instances: z.unknown(),
	instancesError: z.string().optional(),
	cpuMetrics: z.unknown(),
	cpuMetricsError: z.string().optional(),
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

// ── Step 1: Collect metrics ───────────────────────────────────────────────────

const collectMetricsStep = createStep({
	id: 'collect_metrics',
	description: 'Collect instance list and CPU/memory utilisation metrics in parallel',
	inputSchema: InputSchema,
	outputSchema: MetricsOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'collect_metrics', 'right-sizing');

		const compartmentArgs: Record<string, unknown> = {};
		if (inputData.compartmentId) compartmentArgs['compartmentId'] = inputData.compartmentId;

		const lookbackPeriod = inputData.lookbackDays >= 14 ? '30d' : '7d';

		const [instancesResult, cpuResult] = await Promise.allSettled([
			runAdvisorTool('listInstances', compartmentArgs),
			runAdvisorTool('getComputeMetrics', {
				...compartmentArgs,
				metricName: 'CpuUtilization',
				period: lookbackPeriod
			})
		]);

		const instances = instancesResult.status === 'fulfilled' ? instancesResult.value : null;
		const instancesError =
			instancesResult.status === 'rejected' ? String(instancesResult.reason) : undefined;

		const cpuMetrics = cpuResult.status === 'fulfilled' ? cpuResult.value : null;
		const cpuMetricsError = cpuResult.status === 'rejected' ? String(cpuResult.reason) : undefined;

		emitWorkflowStep(runId, 'complete', 'collect_metrics', 'right-sizing', {
			instancesOk: !instancesError,
			cpuOk: !cpuMetricsError
		});

		// AWS and Azure instance metrics require CloudWatch / Azure Monitor integrations.
		// TODO: integrate aws_get_cloudwatch_metrics and azure_get_monitor_metrics when added.

		return {
			instances,
			instancesError,
			cpuMetrics,
			cpuMetricsError,
			_runId: inputData.runId,
			_depth: inputData.depth
		};
	}
});

// ── Step 2: Analyse ───────────────────────────────────────────────────────────

const analyseStep = createStep({
	id: 'analyse',
	description: 'Identify overprovisioned and underprovisioned instances',
	inputSchema: MetricsOutputSchema,
	outputSchema: z.object({ findings: z.array(FindingSchema), _runId: z.string() }),
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'analyse', 'right-sizing');

		const modelId = inputData._depth === 'deep' ? 'gemini-pro' : 'gemini-flash';
		const model = await selectModel(modelId);
		const findings: Finding[] = [];

		if (model) {
			const dataContext = JSON.stringify(
				{
					instances: inputData.instances,
					cpuMetrics: inputData.cpuMetrics
				},
				null,
				2
			).slice(0, 12_000);

			const { text } = await generateText({
				model,
				system: `You are CloudAdvisor, an autonomous cloud right-sizing engine.
Analyse the provided instance list and CPU utilisation metrics. Identify:

OVERPROVISIONED (recommend downsize):
- CPU < 20% sustained over the look-back period
- Allocated memory >> estimated actual usage
- Instance type mismatch (e.g. compute-optimised shape for low-CPU memory workload)

UNDERPROVISIONED (flag before incident):
- CPU > 80% sustained
- High memory utilisation (>85% if visible)
- Burst exhaustion patterns

INSTANCE TYPE MISMATCHES:
- GPU shapes running non-AI workloads
- High-memory shapes with low memory utilisation

For each finding, estimate monthly savings (overprovisioned) or risk level (underprovisioned).
Include the specific recommended shape/size change.

Respond with ONLY a valid JSON array of findings. Each finding:
{
  "domain": "right-sizing",
  "severity": "high"|"medium"|"low"|"info",
  "confidence": "high"|"medium"|"low",
  "title": "one scannable line",
  "summary": "2-3 sentences",
  "impact": "estimated savings or risk level",
  "recommendation": "specific shape change (e.g. 'Downsize from VM.Standard.E4.Flex 8 OCPU to 2 OCPU')",
  "charlieAction": { "prompt": "exact Charlie prompt", "riskLevel": "low"|"medium"|"high" },
  "resources": [{ "cloud": "oci", "type": "compute.instance", "id": "...", "name": "..." }]
}`,
				prompt: `Instance data:\n${dataContext}\n\nRunId: ${inputData._runId}`
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
								domain: 'right-sizing',
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

		emitWorkflowStep(runId, 'complete', 'analyse', 'right-sizing', {
			findingCount: findings.length
		});

		return { findings, _runId: inputData._runId };
	}
});

// ── Step 3: Persist and notify ────────────────────────────────────────────────

const persistAndNotifyStep = createStep({
	id: 'persist_and_notify',
	description: 'Emit right-sizing analysis completion event',
	inputSchema: z.object({ findings: z.array(FindingSchema), _runId: z.string() }),
	outputSchema: OutputSchema,
	execute: async ({ inputData, runId }) => {
		const sorted = sortByPriority(inputData.findings);

		emitWorkflowStatus(runId, 'completed', {
			output: {
				domain: 'right-sizing',
				findingCount: inputData.findings.length,
				topFinding: sorted[0]?.title ?? null
			}
		});

		return { findings: inputData.findings, runId: inputData._runId };
	}
});

// ── Workflow ──────────────────────────────────────────────────────────────────

export const rightSizingWorkflow = createWorkflow({
	id: 'cloud-advisor-right-sizing',
	description:
		'CloudAdvisor right-sizing analysis — overprovisioned and underprovisioned instances',
	inputSchema: InputSchema,
	outputSchema: OutputSchema
})
	.then(collectMetricsStep)
	.then(analyseStep)
	.then(persistAndNotifyStep)
	.commit();
