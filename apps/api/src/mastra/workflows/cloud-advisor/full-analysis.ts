/**
 * CloudAdvisor Full Analysis Workflow (orchestrator).
 *
 * Four-step pipeline:
 *   start → run_domains → cross_domain_synthesis → summary
 *
 * Runs all four domain analyses in parallel (cost, security, right-sizing,
 * ai-performance), synthesises cross-domain patterns, and produces a
 * consolidated RunSummary.
 *
 * Domain analyses are run as direct async functions inside run_domains
 * rather than as Mastra sub-workflows (Mastra 1.2.0 does not support
 * sub-workflow invocation from within workflow steps).
 */

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { generateText } from 'ai';
import { selectModel } from '../../providers.js';
import { emitWorkflowStep, emitWorkflowStatus } from '../../events.js';
import { CLOUDADVISOR_TOOLS, executeTool } from '../../tools/index.js';
import {
	FindingSchema,
	RunSummarySchema,
	createFinding,
	sortByPriority,
	type Finding,
	type RunSummary
} from '../../findings.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

const InputSchema = z.object({
	runId: z.string(),
	compartmentId: z.string().optional(),
	/** 'light' for scheduled full runs (gemini-flash), 'deep' for on-demand */
	depth: z.enum(['light', 'deep']).default('light')
});

const DomainsOutputSchema = z.object({
	allFindings: z.array(FindingSchema),
	estimatedSavings: z.number(),
	domainErrors: z.record(z.string(), z.string()),
	_runId: z.string(),
	_depth: z.enum(['light', 'deep']),
	_startedAt: z.number()
});

const SynthesisOutputSchema = z.object({
	allFindings: z.array(FindingSchema),
	estimatedSavings: z.number(),
	_runId: z.string(),
	_startedAt: z.number()
});

const OutputSchema = z.object({
	summary: RunSummarySchema,
	findings: z.array(FindingSchema)
});

// ── Tool helper ───────────────────────────────────────────────────────────────

async function runAdvisorTool(name: string, args: Record<string, unknown>): Promise<unknown> {
	if (!(CLOUDADVISOR_TOOLS as readonly string[]).includes(name)) {
		throw new Error(`Tool "${name}" is not in CLOUDADVISOR_TOOLS`);
	}
	return executeTool(name, args);
}

// ── Domain runner helpers ────────────────────────────────────────────────────
// These run the core analysis logic directly (not via Mastra sub-workflow).

async function runCostAnalysis(
	runId: string,
	compartmentId: string | undefined,
	depth: 'light' | 'deep'
): Promise<{ findings: Finding[]; estimatedSavings: number }> {
	let ociCostData: unknown = null;
	let ociInstances: unknown = null;

	const [costResult, instancesResult] = await Promise.allSettled([
		runAdvisorTool('getUsageCost', { period: 'last30days', groupBy: 'service' }),
		runAdvisorTool('listInstances', compartmentId ? { compartmentId } : {})
	]);

	if (costResult.status === 'fulfilled') ociCostData = costResult.value;
	if (instancesResult.status === 'fulfilled') ociInstances = instancesResult.value;

	const modelId = depth === 'deep' ? 'gemini-pro' : 'gemini-flash';
	const model = await selectModel(modelId);
	const findings: Finding[] = [];
	let estimatedSavings = 0;

	if (model) {
		const ctx = JSON.stringify({ ociCost: ociCostData, ociInstances }, null, 2).slice(0, 8_000);
		const { text } = await generateText({
			model,
			system: buildAnalysisSystemPrompt('cost'),
			prompt: ctx
		});
		const parsed = parseFindings(text, 'cost', runId);
		findings.push(...parsed);

		for (const f of parsed) {
			const m = String(f.impact).match(/\$([0-9,]+)/);
			if (m) estimatedSavings += parseInt(m[1].replace(/,/g, ''), 10);
		}
	}

	return { findings, estimatedSavings };
}

async function runSecurityAnalysis(
	runId: string,
	compartmentId: string | undefined,
	depth: 'light' | 'deep'
): Promise<{ findings: Finding[] }> {
	const args = compartmentId ? { compartmentId } : {};
	const [policiesResult, bucketsResult] = await Promise.allSettled([
		runAdvisorTool('listPolicies', args),
		runAdvisorTool('listBuckets', args)
	]);

	const model = await selectModel(depth === 'deep' ? 'gemini-pro' : 'gemini-flash');
	if (!model) return { findings: [] };

	const ctx = JSON.stringify(
		{
			policies: policiesResult.status === 'fulfilled' ? policiesResult.value : null,
			buckets: bucketsResult.status === 'fulfilled' ? bucketsResult.value : null
		},
		null,
		2
	).slice(0, 8_000);

	const { text } = await generateText({
		model,
		system: buildAnalysisSystemPrompt('security'),
		prompt: ctx
	});

	return { findings: parseFindings(text, 'security', runId) };
}

async function runRightSizingAnalysis(
	runId: string,
	compartmentId: string | undefined,
	depth: 'light' | 'deep'
): Promise<{ findings: Finding[] }> {
	const args = compartmentId ? { compartmentId } : {};
	const [instancesResult, metricsResult] = await Promise.allSettled([
		runAdvisorTool('listInstances', args),
		runAdvisorTool('getComputeMetrics', { ...args, metricName: 'CpuUtilization', period: '14d' })
	]);

	const model = await selectModel(depth === 'deep' ? 'gemini-pro' : 'gemini-flash');
	if (!model) return { findings: [] };

	const ctx = JSON.stringify(
		{
			instances: instancesResult.status === 'fulfilled' ? instancesResult.value : null,
			cpuMetrics: metricsResult.status === 'fulfilled' ? metricsResult.value : null
		},
		null,
		2
	).slice(0, 8_000);

	const { text } = await generateText({
		model,
		system: buildAnalysisSystemPrompt('right-sizing'),
		prompt: ctx
	});

	return { findings: parseFindings(text, 'right-sizing', runId) };
}

async function runAIPerformanceAnalysis(
	runId: string,
	compartmentId: string | undefined,
	depth: 'light' | 'deep'
): Promise<{ findings: Finding[] }> {
	const args = compartmentId ? { compartmentId } : {};
	const [alarmsResult, metricsResult] = await Promise.allSettled([
		runAdvisorTool('listAlarms', args),
		runAdvisorTool('summarizeMetrics', {
			...args,
			namespace: 'oci_generativeai',
			query: 'InferenceDuration[30m].mean()',
			startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
			endTime: new Date().toISOString()
		})
	]);

	const model = await selectModel(depth === 'deep' ? 'gemini-pro' : 'gemini-flash');
	if (!model) return { findings: [] };

	const ctx = JSON.stringify(
		{
			alarms: alarmsResult.status === 'fulfilled' ? alarmsResult.value : null,
			genAiMetrics: metricsResult.status === 'fulfilled' ? metricsResult.value : null
		},
		null,
		2
	).slice(0, 8_000);

	const { text } = await generateText({
		model,
		system: buildAnalysisSystemPrompt('ai-performance'),
		prompt: ctx
	});

	return { findings: parseFindings(text, 'ai-performance', runId) };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function buildAnalysisSystemPrompt(domain: string): string {
	return `You are CloudAdvisor, analysing "${domain}" for a cloud infrastructure audit.
Respond with ONLY a valid JSON array of findings. Each finding must have:
{
  "domain": "${domain}",
  "severity": "critical"|"high"|"medium"|"low"|"info",
  "confidence": "high"|"medium"|"low",
  "title": "one scannable line",
  "summary": "2-3 sentences",
  "impact": "quantified impact",
  "recommendation": "specific action",
  "charlieAction": { "prompt": "exact Charlie prompt", "riskLevel": "low"|"medium"|"high" },
  "resources": [{ "cloud": "oci", "type": "...", "id": "...", "name": "..." }]
}
Return [] if no findings are warranted. Be concise and data-driven.`;
}

function parseFindings(text: string, domain: Finding['domain'], runId: string): Finding[] {
	const findings: Finding[] = [];
	try {
		const cleaned = text
			.replace(/^```json\s*/i, '')
			.replace(/```\s*$/i, '')
			.trim();
		const raw = JSON.parse(cleaned) as Array<Record<string, unknown>>;
		if (Array.isArray(raw)) {
			for (const item of raw) {
				try {
					findings.push(
						createFinding(runId, {
							domain,
							severity: (item['severity'] as Finding['severity']) ?? 'info',
							confidence: (item['confidence'] as Finding['confidence']) ?? 'low',
							title: String(item['title'] ?? ''),
							summary: String(item['summary'] ?? ''),
							impact: String(item['impact'] ?? ''),
							recommendation: String(item['recommendation'] ?? ''),
							charlieAction: item['charlieAction'] as Finding['charlieAction'],
							resources: (item['resources'] as Finding['resources']) ?? [],
							metadata: { rawItem: item }
						})
					);
				} catch {
					/* skip */
				}
			}
		}
	} catch {
		/* model output unparseable */
	}
	return findings;
}

// ── Step 1: Start ─────────────────────────────────────────────────────────────

const startStep = createStep({
	id: 'start',
	description: 'Initialise full analysis run and emit analysis_started event',
	inputSchema: InputSchema,
	outputSchema: InputSchema.extend({ _startedAt: z.number() }),
	execute: async ({ inputData, runId }) => {
		emitWorkflowStatus(runId, 'running', {
			output: { event: 'analysis_started', runId: inputData.runId }
		});
		emitWorkflowStep(runId, 'start', 'start', 'full-analysis');
		emitWorkflowStep(runId, 'complete', 'start', 'full-analysis');

		return { ...inputData, _startedAt: Date.now() };
	}
});

// ── Step 2: Run all domain analyses in parallel ───────────────────────────────

const runDomainsStep = createStep({
	id: 'run_domains',
	description: 'Run cost, security, right-sizing, and AI performance analyses in parallel',
	inputSchema: InputSchema.extend({ _startedAt: z.number() }),
	outputSchema: DomainsOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'run_domains', 'full-analysis');

		const { runId: analysisRunId, compartmentId, depth } = inputData;
		const domainErrors: Record<string, string> = {};

		const [costResult, securityResult, rightSizingResult, aiResult] = await Promise.allSettled([
			runCostAnalysis(analysisRunId, compartmentId, depth),
			runSecurityAnalysis(analysisRunId, compartmentId, depth),
			runRightSizingAnalysis(analysisRunId, compartmentId, depth),
			runAIPerformanceAnalysis(analysisRunId, compartmentId, depth)
		]);

		const allFindings: Finding[] = [];
		let estimatedSavings = 0;

		if (costResult.status === 'fulfilled') {
			allFindings.push(...costResult.value.findings);
			estimatedSavings += costResult.value.estimatedSavings;
		} else {
			domainErrors['cost'] = String(costResult.reason);
		}
		if (securityResult.status === 'fulfilled') {
			allFindings.push(...securityResult.value.findings);
		} else {
			domainErrors['security'] = String(securityResult.reason);
		}
		if (rightSizingResult.status === 'fulfilled') {
			allFindings.push(...rightSizingResult.value.findings);
		} else {
			domainErrors['right-sizing'] = String(rightSizingResult.reason);
		}
		if (aiResult.status === 'fulfilled') {
			allFindings.push(...aiResult.value.findings);
		} else {
			domainErrors['ai-performance'] = String(aiResult.reason);
		}

		emitWorkflowStep(runId, 'complete', 'run_domains', 'full-analysis', {
			totalFindings: allFindings.length,
			domainErrors: Object.keys(domainErrors)
		});

		return {
			allFindings,
			estimatedSavings,
			domainErrors,
			_runId: inputData.runId,
			_depth: depth,
			_startedAt: inputData._startedAt
		};
	}
});

// ── Step 3: Cross-domain synthesis ───────────────────────────────────────────

const crossDomainSynthesisStep = createStep({
	id: 'cross_domain_synthesis',
	description: 'Identify cross-domain patterns and produce priority ordering',
	inputSchema: DomainsOutputSchema,
	outputSchema: SynthesisOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'cross_domain_synthesis', 'full-analysis');

		const { allFindings, _runId, _depth } = inputData;
		const enrichedFindings = [...allFindings];

		if (allFindings.length > 0) {
			const model = await selectModel(_depth === 'deep' ? 'gemini-pro' : 'gemini-flash');

			if (model) {
				// Summarise existing findings for the cross-domain prompt (don't re-embed full data)
				const findingSummary = sortByPriority(allFindings)
					.slice(0, 20)
					.map((f) => `[${f.severity}] ${f.domain}: ${f.title}`)
					.join('\n');

				const { text } = await generateText({
					model,
					system: `You are CloudAdvisor. Given a list of findings across multiple domains,
identify resources that appear in multiple findings (e.g. an instance that is both
oversized AND has a security misconfiguration). These cross-domain findings represent
higher-priority items since addressing them fixes multiple issues at once.

Also identify the top 3 highest-priority items the team should act on today.

Respond with ONLY a valid JSON array of NEW cross-domain meta-findings (not duplicates
of existing ones). Return [] if no cross-domain patterns exist.

Each finding:
{
  "domain": "cost",
  "severity": "critical"|"high"|"medium"|"low"|"info",
  "confidence": "high"|"medium"|"low",
  "title": "Cross-domain: [brief description]",
  "summary": "2-3 sentences explaining why this spans domains",
  "impact": "combined impact of addressing both issues",
  "recommendation": "single action that resolves both",
  "charlieAction": { "prompt": "exact Charlie prompt", "riskLevel": "low"|"medium"|"high" },
  "resources": [{ "cloud": "oci", "type": "...", "id": "...", "name": "..." }]
}`,
					prompt: `Existing findings (${allFindings.length} total):\n${findingSummary}`
				});

				const crossFindings = parseFindings(text, 'cost', _runId);
				// Tag cross-domain findings in metadata
				for (const f of crossFindings) {
					if (f.metadata) {
						f.metadata['crossDomain'] = true;
					}
					enrichedFindings.push(f);
				}
			}
		}

		emitWorkflowStep(runId, 'complete', 'cross_domain_synthesis', 'full-analysis', {
			crossDomainFindings: enrichedFindings.length - allFindings.length
		});

		return {
			allFindings: enrichedFindings,
			estimatedSavings: inputData.estimatedSavings,
			_runId,
			_startedAt: inputData._startedAt
		};
	}
});

// ── Step 4: Summary ───────────────────────────────────────────────────────────

const summaryStep = createStep({
	id: 'summary',
	description: 'Produce RunSummary and emit analysis_completed event',
	inputSchema: SynthesisOutputSchema,
	outputSchema: OutputSchema,
	execute: async ({ inputData, runId }) => {
		const { allFindings, estimatedSavings, _runId, _startedAt } = inputData;

		const completedAt = new Date();
		const durationMs = Date.now() - _startedAt;

		const sorted = sortByPriority(allFindings);

		const findingCounts = {
			critical: allFindings.filter((f) => f.severity === 'critical').length,
			high: allFindings.filter((f) => f.severity === 'high').length,
			medium: allFindings.filter((f) => f.severity === 'medium').length,
			low: allFindings.filter((f) => f.severity === 'low').length,
			info: allFindings.filter((f) => f.severity === 'info').length
		};

		const domainCounts = {
			cost: allFindings.filter((f) => f.domain === 'cost').length,
			security: allFindings.filter((f) => f.domain === 'security').length,
			rightSizing: allFindings.filter((f) => f.domain === 'right-sizing').length,
			aiPerformance: allFindings.filter((f) => f.domain === 'ai-performance').length
		};

		const summary: RunSummary = {
			runId: _runId,
			completedAt,
			durationMs,
			findingCounts,
			domainCounts,
			topFindings: sorted.slice(0, 3),
			estimatedSavings
		};

		emitWorkflowStatus(runId, 'completed', {
			output: {
				event: 'analysis_completed',
				runId: _runId,
				totalFindings: allFindings.length,
				criticalCount: findingCounts.critical,
				estimatedSavings,
				durationMs
			}
		});

		emitWorkflowStep(runId, 'complete', 'summary', 'full-analysis');

		return { summary, findings: allFindings };
	}
});

// ── Workflow ──────────────────────────────────────────────────────────────────

export const fullAnalysisWorkflow = createWorkflow({
	id: 'cloud-advisor-full',
	description:
		'CloudAdvisor full analysis — all four domains in parallel with cross-domain synthesis',
	inputSchema: InputSchema,
	outputSchema: OutputSchema
})
	.then(startStep)
	.then(runDomainsStep)
	.then(crossDomainSynthesisStep)
	.then(summaryStep)
	.commit();
