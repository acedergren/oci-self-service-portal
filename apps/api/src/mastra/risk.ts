/**
 * Risk assessment bridge between tool approval levels and configurable thresholds.
 *
 * Maps ApprovalLevel → RiskLevel and exposes requiresApproval(toolName) for
 * human-in-the-loop gating at the workflow executor level.
 *
 * Threshold is configurable via MASTRA_APPROVAL_THRESHOLD env var:
 *   'low'    — require approval for ALL tools including auto ones (most restrictive)
 *   'medium' — require approval for confirm + danger tools (default)
 *   'high'   — require approval for danger tools only (least restrictive)
 *
 * Unknown tool names default to 'high' risk (fail-safe / deny-by-default).
 */

import type { ApprovalLevel } from './tools/types.js';
import { toolDefinitions } from './tools/registry.js';

export type RiskLevel = 'low' | 'medium' | 'high';

const APPROVAL_LEVEL_TO_RISK: Record<ApprovalLevel, RiskLevel> = {
	auto: 'low',
	confirm: 'medium',
	danger: 'high'
} as const;

const RISK_ORDER: readonly RiskLevel[] = ['low', 'medium', 'high'] as const;

const raw = process.env.MASTRA_APPROVAL_THRESHOLD;

/** Risk level at or above which a tool requires human approval. Default: 'medium'. */
export const APPROVAL_THRESHOLD: RiskLevel =
	raw === 'low' || raw === 'medium' || raw === 'high' ? raw : 'medium';

/**
 * Returns the risk level for a named tool.
 * Unknown tools default to 'high' (fail-safe).
 */
export function getRiskLevel(toolName: string): RiskLevel {
	const def = toolDefinitions.get(toolName);
	return def ? APPROVAL_LEVEL_TO_RISK[def.approvalLevel] : 'high';
}

/**
 * Returns true if calling the named tool requires human approval
 * given the current APPROVAL_THRESHOLD.
 *
 * Unknown tools always return true (fail-safe).
 */
export function requiresApproval(toolName: string): boolean {
	const riskLevel = getRiskLevel(toolName);
	return RISK_ORDER.indexOf(riskLevel) >= RISK_ORDER.indexOf(APPROVAL_THRESHOLD);
}
