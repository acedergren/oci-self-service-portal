/**
 * CloudAdvisor finding schema and types.
 *
 * A Finding is a structured, persisted observation produced by CloudAdvisor
 * analysis workflows. It always describes: what was found, what the impact is,
 * and what action is recommended.
 *
 * Findings are read-only artefacts — CloudAdvisor never mutates infrastructure.
 * When a finding warrants remediation, `charlieAction` surfaces a prompt the
 * user can send to Charlie to trigger the actual change.
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';

// ── Sub-schemas ───────────────────────────────────────────────────────────────

export const FindingDomainSchema = z.enum(['cost', 'security', 'right-sizing', 'ai-performance']);

export const FindingSeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);

export const FindingConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const FindingStatusSchema = z.enum(['active', 'acknowledged', 'resolved', 'dismissed']);

export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);

export const AffectedResourceSchema = z.object({
	cloud: z.enum(['oci', 'aws', 'azure']),
	type: z.string(),
	id: z.string(),
	name: z.string().optional()
});

export const CharlieActionSchema = z.object({
	/** Natural language prompt the user can send Charlie to act on this finding. */
	prompt: z.string(),
	riskLevel: RiskLevelSchema
});

// ── Root finding schema ───────────────────────────────────────────────────────

export const FindingSchema = z.object({
	id: z.string().uuid(),
	runId: z.string(),
	domain: FindingDomainSchema,
	severity: FindingSeveritySchema,
	confidence: FindingConfidenceSchema,
	/** One-line, scannable headline. */
	title: z.string(),
	/** 2-3 sentences, plain language explanation. */
	summary: z.string(),
	/** Quantified business impact (e.g. "$380/month in idle compute"). */
	impact: z.string(),
	/** Specific recommended action. */
	recommendation: z.string(),
	/** Optional: how Charlie can act on this finding. */
	charlieAction: CharlieActionSchema.optional(),
	/** Cloud resources this finding is about. */
	resources: z.array(AffectedResourceSchema),
	/** Extra structured data from analysis (tool results, raw metrics, etc.). */
	metadata: z.record(z.string(), z.unknown()).optional(),
	createdAt: z.date(),
	expiresAt: z.date().optional(),
	status: FindingStatusSchema
});

export type Finding = z.infer<typeof FindingSchema>;
export type FindingDomain = z.infer<typeof FindingDomainSchema>;
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type FindingConfidence = z.infer<typeof FindingConfidenceSchema>;
export type FindingStatus = z.infer<typeof FindingStatusSchema>;
export type AffectedResource = z.infer<typeof AffectedResourceSchema>;

// ── Factory helper ────────────────────────────────────────────────────────────

export function createFinding(
	runId: string,
	partial: Omit<Finding, 'id' | 'runId' | 'createdAt' | 'status'>
): Finding {
	return {
		id: randomUUID(),
		runId,
		createdAt: new Date(),
		status: 'active',
		...partial
	};
}

// ── Run summary ───────────────────────────────────────────────────────────────

export const RunSummarySchema = z.object({
	runId: z.string(),
	completedAt: z.date(),
	durationMs: z.number(),
	findingCounts: z.object({
		critical: z.number(),
		high: z.number(),
		medium: z.number(),
		low: z.number(),
		info: z.number()
	}),
	domainCounts: z.object({
		cost: z.number(),
		security: z.number(),
		rightSizing: z.number(),
		aiPerformance: z.number()
	}),
	/** Three highest-priority findings for the summary widget. */
	topFindings: z.array(FindingSchema).max(3),
	/** Total estimated $ savings if all findings are actioned (0 if unknown). */
	estimatedSavings: z.number()
});

export type RunSummary = z.infer<typeof RunSummarySchema>;

// ── Severity ordering ─────────────────────────────────────────────────────────

const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

export function compareSeverity(a: FindingSeverity, b: FindingSeverity): number {
	return SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);
}

export function sortByPriority(findings: Finding[]): Finding[] {
	return [...findings].sort((a, b) => compareSeverity(a.severity, b.severity));
}
