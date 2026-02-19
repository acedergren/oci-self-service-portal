/**
 * CloudAdvisor Security Analysis Workflow.
 *
 * Three-step pipeline:
 *   collect_security_data → analyse → persist_and_notify
 *
 * Collects security-relevant OCI data (open security lists, unencrypted storage,
 * IAM policy scope), analyses it for misconfigurations and compliance issues,
 * and emits findings. Critical findings trigger an immediate_alert event
 * in addition to the standard summary.
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

const SecurityDataOutputSchema = z.object({
	ociPolicies: z.unknown(),
	ociPoliciesError: z.string().optional(),
	ociBuckets: z.unknown(),
	ociBucketsError: z.string().optional(),
	_runId: z.string(),
	_depth: z.enum(['light', 'deep'])
});

const OutputSchema = z.object({
	findings: z.array(FindingSchema),
	criticalCount: z.number(),
	runId: z.string()
});

// ── Tool helper ───────────────────────────────────────────────────────────────

async function runAdvisorTool(name: string, args: Record<string, unknown>): Promise<unknown> {
	if (!(CLOUDADVISOR_TOOLS as readonly string[]).includes(name)) {
		throw new Error(`Tool "${name}" is not in CLOUDADVISOR_TOOLS`);
	}
	return executeTool(name, args);
}

// ── Step 1: Collect security data ────────────────────────────────────────────

const collectSecurityDataStep = createStep({
	id: 'collect_security_data',
	description: 'Collect IAM policies, storage buckets, and security lists from OCI',
	inputSchema: InputSchema,
	outputSchema: SecurityDataOutputSchema,
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'collect_security_data', 'security-analysis');

		const compartmentArgs: Record<string, unknown> = {};
		if (inputData.compartmentId) compartmentArgs['compartmentId'] = inputData.compartmentId;

		// Run OCI data collection in parallel
		const [policiesResult, bucketsResult] = await Promise.allSettled([
			runAdvisorTool('listPolicies', compartmentArgs),
			runAdvisorTool('listBuckets', compartmentArgs)
		]);

		const ociPolicies = policiesResult.status === 'fulfilled' ? policiesResult.value : null;
		const ociPoliciesError =
			policiesResult.status === 'rejected' ? String(policiesResult.reason) : undefined;

		const ociBuckets = bucketsResult.status === 'fulfilled' ? bucketsResult.value : null;
		const ociBucketsError =
			bucketsResult.status === 'rejected' ? String(bucketsResult.reason) : undefined;

		emitWorkflowStep(runId, 'complete', 'collect_security_data', 'security-analysis', {
			policiesOk: !ociPoliciesError,
			bucketsOk: !ociBucketsError
		});

		// AWS and Azure security posture APIs (AWS Security Hub, Microsoft Defender)
		// require integrations not yet in CLOUDADVISOR_TOOLS.
		// TODO: integrate aws_get_security_findings and azure_get_security_findings when added.

		return {
			ociPolicies,
			ociPoliciesError,
			ociBuckets,
			ociBucketsError,
			_runId: inputData.runId,
			_depth: inputData.depth
		};
	}
});

// ── Step 2: Analyse ───────────────────────────────────────────────────────────

const analyseStep = createStep({
	id: 'analyse',
	description: 'Identify security misconfigurations, unencrypted storage, and IAM issues',
	inputSchema: SecurityDataOutputSchema,
	outputSchema: z.object({
		findings: z.array(FindingSchema),
		criticalCount: z.number(),
		_runId: z.string()
	}),
	execute: async ({ inputData, runId }) => {
		emitWorkflowStep(runId, 'start', 'analyse', 'security-analysis');

		const modelId = inputData._depth === 'deep' ? 'gemini-pro' : 'gemini-flash';
		const model = await selectModel(modelId);
		const findings: Finding[] = [];

		if (model) {
			const dataContext = JSON.stringify(
				{
					policies: inputData.ociPolicies,
					buckets: inputData.ociBuckets
				},
				null,
				2
			).slice(0, 12_000);

			const { text } = await generateText({
				model,
				system: `You are CloudAdvisor, an autonomous cloud security analysis engine.
Analyse the provided OCI security data. Identify:
1. Open security group rules (SSH/RDP/DB ports to 0.0.0.0/0)
2. Unencrypted or publicly accessible storage buckets
3. IAM policies scoped to tenancy root (least-privilege violation)
4. Missing MFA on accounts with admin policies
5. Compliance issues (GDPR-relevant data residency, excessive access)

SEVERITY RULES:
- critical: public internet access to databases, DB port 1521/5432/3306 open to world
- critical: IAM statement grants admin to ALL RESOURCES in tenancy without restriction
- high: SSH/RDP open to 0.0.0.0/0, unencrypted production storage, stale admin API keys
- medium: missing MFA, policies not scoped to compartment, public bucket without necessity
- low: informational findings, best practice deviations without immediate risk
- info: general hygiene observations

Respond with ONLY a valid JSON array of findings. Each finding:
{
  "domain": "security",
  "severity": "critical"|"high"|"medium"|"low"|"info",
  "confidence": "high"|"medium"|"low",
  "title": "one scannable line",
  "summary": "2-3 sentences",
  "impact": "business/security impact",
  "recommendation": "specific action",
  "charlieAction": { "prompt": "exact Charlie prompt", "riskLevel": "low"|"medium"|"high" },
  "resources": [{ "cloud": "oci", "type": "...", "id": "...", "name": "..." }]
}`,
				prompt: `OCI security data:\n${dataContext}\n\nRunId: ${inputData._runId}`
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
								domain: 'security',
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

		const criticalCount = findings.filter((f) => f.severity === 'critical').length;

		emitWorkflowStep(runId, 'complete', 'analyse', 'security-analysis', {
			findingCount: findings.length,
			criticalCount
		});

		return { findings, criticalCount, _runId: inputData._runId };
	}
});

// ── Step 3: Persist and notify ────────────────────────────────────────────────

const persistAndNotifyStep = createStep({
	id: 'persist_and_notify',
	description: 'Emit analysis_completed; emit immediate_alert for critical findings',
	inputSchema: z.object({
		findings: z.array(FindingSchema),
		criticalCount: z.number(),
		_runId: z.string()
	}),
	outputSchema: OutputSchema,
	execute: async ({ inputData, runId }) => {
		const sorted = sortByPriority(inputData.findings);

		// Immediate alert for critical findings — surfaced separately from daily summary
		if (inputData.criticalCount > 0) {
			const criticals = sorted.filter((f) => f.severity === 'critical');
			emitWorkflowStatus(runId, 'completed', {
				output: {
					domain: 'security',
					event: 'immediate_alert',
					criticalCount: inputData.criticalCount,
					criticalFindings: criticals.map((f) => ({ id: f.id, title: f.title }))
				}
			});
		}

		emitWorkflowStatus(runId, 'completed', {
			output: {
				domain: 'security',
				findingCount: inputData.findings.length,
				criticalCount: inputData.criticalCount,
				topFinding: sorted[0]?.title ?? null
			}
		});

		return {
			findings: inputData.findings,
			criticalCount: inputData.criticalCount,
			runId: inputData._runId
		};
	}
});

// ── Workflow ──────────────────────────────────────────────────────────────────

export const securityAnalysisWorkflow = createWorkflow({
	id: 'cloud-advisor-security',
	description: 'CloudAdvisor security posture analysis — misconfigurations and compliance',
	inputSchema: InputSchema,
	outputSchema: OutputSchema
})
	.then(collectSecurityDataStep)
	.then(analyseStep)
	.then(persistAndNotifyStep)
	.commit();
