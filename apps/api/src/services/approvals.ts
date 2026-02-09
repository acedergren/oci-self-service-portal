/**
 * Approval service — manages pending tool approvals and server-side
 * approval records. Approval tokens are single-use with 5-min expiry.
 *
 * This is a lightweight port of packages/shared/src/server/approvals.ts
 * for the Fastify API. Uses in-memory storage only (no Oracle dependency).
 */

// ---------------------------------------------------------------------------
// Pending approvals — in-memory map of tool calls awaiting user decision
// ---------------------------------------------------------------------------

const PENDING_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // sweep every 60s
const MAX_PENDING = 1000; // cap to prevent DoS

interface PendingApproval {
	toolName: string;
	args: Record<string, unknown>;
	sessionId?: string;
	orgId?: string | null;
	createdAt: number;
	resolve: (approved: boolean) => void;
}

export const pendingApprovals = new Map<string, PendingApproval>();

export function addPendingApproval(
	toolCallId: string,
	toolName: string,
	args: Record<string, unknown>,
	sessionId: string | undefined,
	orgId: string | null | undefined,
	resolve: (approved: boolean) => void
) {
	// Evict stale entries before adding (R-6)
	sweepStale();

	// Cap map size to prevent memory exhaustion
	if (pendingApprovals.size >= MAX_PENDING) {
		resolve(false); // reject immediately if at capacity
		return;
	}

	pendingApprovals.set(toolCallId, {
		toolName,
		args,
		sessionId,
		orgId: orgId ?? null,
		createdAt: Date.now(),
		resolve
	});
}

// ---------------------------------------------------------------------------
// Server-side approval records — single-use, 5-min expiry
// ---------------------------------------------------------------------------

const APPROVAL_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

interface ApprovalRecord {
	toolName: string;
	createdAt: number;
}

const approvalRecords = new Map<string, ApprovalRecord>();

/** Record a server-side approval token (called when user approves). */
export async function recordApproval(toolCallId: string, toolName: string): Promise<void> {
	approvalRecords.set(toolCallId, { toolName, createdAt: Date.now() });
}

/** Consume a server-side approval token (single-use, 5-min expiry). */
export async function consumeApproval(toolCallId: string, toolName: string): Promise<boolean> {
	const record = approvalRecords.get(toolCallId);
	if (!record) return false;

	// Always delete (single-use)
	approvalRecords.delete(toolCallId);

	// Verify tool name matches
	if (record.toolName !== toolName) return false;

	// Verify not expired
	if (Date.now() - record.createdAt > APPROVAL_EXPIRY_MS) return false;

	return true;
}

// ---------------------------------------------------------------------------
// Periodic cleanup — evicts stale pending approvals and expired records (R-6)
// ---------------------------------------------------------------------------

function sweepStale() {
	const now = Date.now();

	// Evict expired pending approvals (auto-reject after TTL)
	for (const [id, entry] of pendingApprovals) {
		if (now - entry.createdAt > PENDING_EXPIRY_MS) {
			pendingApprovals.delete(id);
			entry.resolve(false); // auto-reject stale requests
		}
	}

	// Evict expired approval records
	for (const [id, record] of approvalRecords) {
		if (now - record.createdAt > APPROVAL_EXPIRY_MS) {
			approvalRecords.delete(id);
		}
	}
}

// Run cleanup on an interval so abandoned entries don't accumulate
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startCleanupTimer() {
	if (cleanupTimer) return;
	cleanupTimer = setInterval(sweepStale, CLEANUP_INTERVAL_MS);
	// Don't block process exit
	if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
		cleanupTimer.unref();
	}
}

export function stopCleanupTimer() {
	if (cleanupTimer) {
		clearInterval(cleanupTimer);
		cleanupTimer = null;
	}
}

// Auto-start cleanup timer on import
startCleanupTimer();

/** Reset all state (for testing). */
export function _resetApprovals() {
	pendingApprovals.clear();
	approvalRecords.clear();
}
