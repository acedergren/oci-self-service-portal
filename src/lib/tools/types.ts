import { z } from 'zod';

/**
 * Tool categories for OCI operations
 */
export type ToolCategory =
  | 'compute'
  | 'networking'
  | 'storage'
  | 'database'
  | 'identity'
  | 'observability'
  | 'pricing'
  | 'search'
  | 'billing'
  | 'logging';

/**
 * Approval level for tool execution
 * - auto: Execute immediately (read-only operations)
 * - confirm: Require user confirmation (create operations)
 * - danger: Require explicit confirmation with warning (destructive operations)
 */
export type ApprovalLevel = 'auto' | 'confirm' | 'danger';

/**
 * Tool execution status
 */
export type ToolStatus = 'pending' | 'awaiting_approval' | 'approved' | 'rejected' | 'running' | 'streaming' | 'completed' | 'error';

/**
 * Tool call representation
 */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  result?: unknown;
  error?: string;
  startedAt: number;
  completedAt?: number;
  approvalLevel?: ApprovalLevel;
}

/**
 * Tool definition for registration
 */
export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  approvalLevel: ApprovalLevel;
  parameters: z.ZodTypeAny;
}

/**
 * A tool entry pairs a definition with its executor (sync or async).
 * Category files export arrays of these.
 */
export interface ToolEntry extends ToolDefinition {
  execute?: (args: Record<string, unknown>) => unknown;
  executeAsync?: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Pending approval request sent to client
 */
export interface PendingApproval {
  toolCallId: string;
  toolName: string;
  category: ToolCategory;
  approvalLevel: ApprovalLevel;
  args: Record<string, unknown>;
  description: string;
  warningMessage?: string;
  estimatedImpact?: string;
  createdAt: number;
}

/**
 * Approval decision from client
 */
export interface ApprovalDecision {
  toolCallId: string;
  approved: boolean;
  reason?: string;
  approvedBy?: string;
  approvedAt: number;
}

/**
 * Tool result for streaming
 */
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
}

/**
 * Check if a tool name indicates a read-only operation
 */
export function isReadOnlyOperation(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name.startsWith('list') || name.startsWith('get') || name.startsWith('describe');
}

/**
 * Check if a tool name indicates a destructive operation
 */
export function isDestructiveOperation(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name.startsWith('delete') || name.startsWith('terminate') || name.startsWith('stop');
}

/**
 * Infer approval level from tool name
 */
export function inferApprovalLevel(toolName: string): ApprovalLevel {
  if (isReadOnlyOperation(toolName)) return 'auto';
  if (isDestructiveOperation(toolName)) return 'danger';
  return 'confirm';
}

/**
 * Human-readable descriptions for destructive operations
 */
export const DESTRUCTIVE_TOOL_WARNINGS: Record<string, { warning: string; impact: string }> = {
  terminateInstance: {
    warning: 'This will permanently delete the compute instance and all its data.',
    impact: 'Instance will be unrecoverable. Boot volume may be preserved if specified.',
  },
  stopInstance: {
    warning: 'This will stop the compute instance.',
    impact: 'Instance will be unavailable. You can restart it later.',
  },
  deleteVcn: {
    warning: 'This will delete the Virtual Cloud Network and all associated resources.',
    impact: 'All subnets, route tables, and security lists in this VCN will be deleted.',
  },
  deleteBucket: {
    warning: 'This will permanently delete the Object Storage bucket.',
    impact: 'All objects in the bucket will be deleted. This action is irreversible.',
  },
  terminateAutonomousDatabase: {
    warning: 'This will permanently terminate the Autonomous Database.',
    impact: 'All data in the database will be lost. Backups may still be available.',
  },
};

/**
 * Get warning message for a tool
 */
export function getToolWarning(toolName: string): { warning: string; impact: string } | undefined {
  return DESTRUCTIVE_TOOL_WARNINGS[toolName];
}

/**
 * Check if a tool requires human approval
 */
export function requiresApproval(approvalLevel: ApprovalLevel): boolean {
  return approvalLevel === 'confirm' || approvalLevel === 'danger';
}
