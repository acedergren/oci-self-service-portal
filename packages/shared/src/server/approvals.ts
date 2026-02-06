/**
 * Pending tool approval state
 *
 * Uses Oracle DB for persistence with in-memory Map fallback.
 * The in-memory approach is kept as fallback for when DB is unavailable.
 */

import { createLogger } from './logger';
import { withConnection } from './oracle/connection';
import { approvalRepository } from './oracle/repositories/approval-repository';

const log = createLogger('approvals');

export interface PendingApprovalEntry {
	toolName: string;
	args: Record<string, unknown>;
	sessionId?: string;
	createdAt: number;
	resolve: (approved: boolean) => void;
}

/** In-memory fallback store */
export const pendingApprovals = new Map<string, PendingApprovalEntry>();

/**
 * Server-side record of approved toolCallIds.
 * Used by the execute endpoint to verify approval without trusting client input.
 * Entries are auto-cleaned after 5 minutes.
 */
export const approvedToolCalls = new Map<string, { toolName: string; approvedAt: number }>();

const APPROVAL_TTL_MS = 5 * 60 * 1000;

/**
 * Record that a tool call has been approved server-side.
 * Tries Oracle DB first; falls back to in-memory Map.
 */
export async function recordApproval(toolCallId: string, toolName: string): Promise<void> {
	try {
		await withConnection(async (conn) => {
			await conn.execute(
				`INSERT INTO approved_tool_calls (tool_call_id, tool_name, approved_at)
         VALUES (:toolCallId, :toolName, SYSTIMESTAMP)`,
				{ toolCallId, toolName }
			);
		});
	} catch (err) {
		log.warn({ err, toolCallId }, 'Oracle approval insert failed, falling back to in-memory');
		approvedToolCalls.set(toolCallId, { toolName, approvedAt: Date.now() });
	}

	// Clean up expired in-memory entries
	const now = Date.now();
	for (const [id, entry] of approvedToolCalls) {
		if (now - entry.approvedAt > APPROVAL_TTL_MS) {
			approvedToolCalls.delete(id);
		}
	}
}

/**
 * Check and consume a server-side approval for a tool call.
 * Returns true if the toolCallId was approved for the given toolName.
 * The approval is consumed (deleted) to prevent replay.
 * Tries Oracle DB first; falls back to in-memory Map.
 */
export async function consumeApproval(toolCallId: string, toolName: string): Promise<boolean> {
	try {
		return await withConnection(async (conn) => {
			// Atomic DELETE — no TOCTOU race. Single statement checks tool_call_id,
			// tool_name match, and 5-minute expiry. rowsAffected === 1 means consumed.
			const result = await conn.execute(
				`DELETE FROM approved_tool_calls
          WHERE tool_call_id = :toolCallId
            AND tool_name = :toolName
            AND approved_at > SYSTIMESTAMP - INTERVAL '5' MINUTE`,
				{ toolCallId, toolName }
			);

			return (result as { rowsAffected?: number }).rowsAffected === 1;
		});
	} catch (err) {
		log.warn({ err, toolCallId }, 'Oracle approval consume failed, falling back to in-memory');
		// Fall back to in-memory
		const entry = approvedToolCalls.get(toolCallId);
		if (!entry) return false;

		if (entry.toolName !== toolName || Date.now() - entry.approvedAt > APPROVAL_TTL_MS) {
			approvedToolCalls.delete(toolCallId);
			return false;
		}

		approvedToolCalls.delete(toolCallId);
		return true;
	}
}

/**
 * Poll the Oracle DB for an approval resolution.
 * Returns true if approved, false if rejected/expired/timeout.
 */
async function pollForResolution(approvalId: string, timeoutMs: number): Promise<boolean> {
	const pollIntervalMs = 1000;
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const record = await approvalRepository.getById(approvalId);
		if (!record) return false;

		if (record.status === 'approved') return true;
		if (record.status === 'rejected' || record.status === 'expired') return false;

		await new Promise((r) => setTimeout(r, pollIntervalMs));
	}

	// Timed out — mark as expired
	try {
		await approvalRepository.resolve(approvalId, 'rejected');
	} catch {
		// best-effort cleanup
	}
	return false;
}

/**
 * Register a pending approval using in-memory Map (fallback).
 */
function registerPendingApprovalInMemory(
	toolCallId: string,
	toolName: string,
	args: Record<string, unknown>,
	sessionId?: string
): Promise<boolean> {
	return new Promise((resolve) => {
		pendingApprovals.set(toolCallId, {
			toolName,
			args,
			sessionId,
			createdAt: Date.now(),
			resolve
		});

		// Auto-timeout after 5 minutes
		setTimeout(
			() => {
				if (pendingApprovals.has(toolCallId)) {
					pendingApprovals.delete(toolCallId);
					resolve(false);
				}
			},
			5 * 60 * 1000
		);
	});
}

/**
 * Register a pending approval (called from chat stream).
 * Tries Oracle DB first; falls back to in-memory if DB is unavailable.
 */
export function registerPendingApproval(
	toolCallId: string,
	toolName: string,
	args: Record<string, unknown>,
	sessionId?: string
): Promise<boolean> {
	return approvalRepository
		.create({
			toolName,
			toolCategory: 'unknown', // caller can override if needed
			approvalLevel: 'confirm',
			args,
			status: 'pending',
			sessionId,
			expiresAt: new Date(Date.now() + 5 * 60 * 1000)
		})
		.then((approval) => {
			// Store locally so the approve endpoint can resolve by toolCallId
			pendingApprovals.set(toolCallId, {
				toolName,
				args,
				sessionId,
				createdAt: Date.now(),
				resolve: (approved: boolean) => {
					// When resolved via the approve endpoint, also update Oracle
					approvalRepository
						.resolve(approval.id, approved ? 'approved' : 'rejected')
						.catch((err) => log.warn({ err }, 'Failed to update approval status in Oracle'));
				}
			});

			return pollForResolution(approval.id, 5 * 60 * 1000);
		})
		.catch((err) => {
			log.warn({ err }, 'Oracle approval create failed, falling back to in-memory');
			return registerPendingApprovalInMemory(toolCallId, toolName, args, sessionId);
		});
}
