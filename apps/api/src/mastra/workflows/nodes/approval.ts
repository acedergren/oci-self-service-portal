/**
 * Approval Node - Suspend workflow execution pending manual approval
 *
 * This node enables human-in-the-loop workflows by pausing execution and
 * waiting for approvers to review and approve the workflow. The workflow
 * can be resumed with approval data passed back through the resume endpoint.
 *
 * Key features:
 * - Configurable approval message and approver list
 * - Timeout support for auto-expiry if not approved
 * - Resume with approval data (approved flag + metadata)
 * - Engine state preservation across suspend/resume cycle
 * - Zod schema validation for suspend/resume payloads
 */

import { z } from 'zod';
import type { WorkflowNode } from '@portal/shared/workflows';

// ============================================================================
// Suspend/Resume Schemas
// ============================================================================

/**
 * Schema for suspending workflow at an approval node.
 * Contains the approval request context that will be persisted.
 */
export const ApprovalSuspendPayloadSchema = z.object({
	message: z.string().min(1).max(2000),
	approvers: z.array(z.string()).min(1).optional(),
	timeoutMinutes: z.number().int().positive().optional(),
	context: z.record(z.string(), z.unknown()).optional()
});
export type ApprovalSuspendPayload = z.infer<typeof ApprovalSuspendPayloadSchema>;

/**
 * Schema for resuming workflow after approval decision.
 * This payload contains the approval result and any metadata from the approver.
 */
export const ApprovalResumePayloadSchema = z.object({
	approved: z.boolean(),
	approvedBy: z.string().optional(),
	approvedAt: z.string().datetime().optional(),
	approvalReason: z.string().max(2000).optional(),
	approvalData: z.record(z.string(), z.unknown()).optional()
});
export type ApprovalResumePayload = z.infer<typeof ApprovalResumePayloadSchema>;

// ============================================================================
// Approval Node Configuration
// ============================================================================

/**
 * Configuration for an approval node
 */
export interface ApprovalNodeConfig {
	/**
	 * Message shown to approvers requesting approval.
	 * Example: "Review and approve the infrastructure changes below."
	 */
	message: string;
	/**
	 * List of user IDs authorized to approve this request.
	 * If empty, any user can approve.
	 */
	approvers?: string[];
	/**
	 * Minutes before approval request auto-expires.
	 * If not specified, no timeout is enforced.
	 */
	timeoutMinutes?: number;
	/**
	 * Additional context data to pass to the approval interface.
	 * This is typically workflow output or metadata needed by approvers.
	 */
	context?: Record<string, unknown>;
}

/**
 * Create an approval node that suspends workflow execution.
 *
 * The executor's executeApprovalNode() method processes this node by:
 * 1. Creating an approval request with the configured message and approvers
 * 2. Suspending the workflow engine state
 * 3. Awaiting approval via the resume endpoint
 * 4. Resuming execution once the approval decision is received
 *
 * Example:
 * ```typescript
 * const node = createApprovalNode('cost-review-1', {
 *   message: 'Please review the estimated cost of $5,432 and approve or reject.',
 *   approvers: ['finance-team@example.com'],
 *   timeoutMinutes: 60,
 *   context: {
 *     estimatedCost: 5432,
 *     resourceCount: 12,
 *     region: 'us-phoenix-1'
 *   }
 * });
 * ```
 */
export function createApprovalNode(
	id: string,
	config: ApprovalNodeConfig,
	position: { x: number; y: number } = { x: 0, y: 0 }
): WorkflowNode {
	return {
		id,
		type: 'approval',
		position,
		data: {
			message: config.message,
			approvers: config.approvers,
			timeoutMinutes: config.timeoutMinutes,
			context: config.context
		}
	};
}

/**
 * Type guard: check if a result from an approval node is a suspend event
 * (indicating the workflow paused waiting for approval)
 */
export function isApprovalSuspend(
	result: unknown
): result is { suspended: true; requestId: string } {
	return (
		typeof result === 'object' &&
		result !== null &&
		'suspended' in result &&
		(result as Record<string, unknown>).suspended === true &&
		'requestId' in result &&
		typeof (result as Record<string, unknown>).requestId === 'string'
	);
}

/**
 * Type guard: check if a result from an approval node is an approval decision
 */
export function isApprovalDecision(
	result: unknown
): result is { approved: boolean; approvedBy?: string; approvalReason?: string } {
	return (
		typeof result === 'object' &&
		result !== null &&
		'approved' in result &&
		typeof (result as Record<string, unknown>).approved === 'boolean'
	);
}
