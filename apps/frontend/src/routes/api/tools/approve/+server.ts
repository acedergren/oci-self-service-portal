import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logToolApproval } from '@portal/shared/server/audit.js';
import { getToolDefinition } from '@portal/shared/tools/index.js';
import { createLogger } from '@portal/shared/server/logger.js';
import { requirePermission } from '@portal/shared/server/auth/rbac.js';
import { pendingApprovals, recordApproval } from '@portal/shared/server/approvals.js';
import { ValidationError, NotFoundError, errorResponse } from '@portal/shared/server/errors.js';

const log = createLogger('approve');

/**
 * POST /api/tools/approve
 * Handle tool approval decisions from the client
 */
export const POST: RequestHandler = async (event) => {
	requirePermission(event, 'tools:approve');

	let body: Record<string, unknown>;
	try {
		body = await event.request.json();
	} catch {
		return errorResponse(
			new ValidationError('Invalid JSON in request body'),
			event.locals.requestId
		);
	}
	const toolCallId = body.toolCallId as string | undefined;
	const approved = body.approved as boolean;
	const reason = body.reason as string | undefined;

	if (!toolCallId) {
		return errorResponse(
			new ValidationError('Missing toolCallId', { field: 'toolCallId' }),
			event.locals.requestId
		);
	}

	const pending = pendingApprovals.get(toolCallId);

	if (!pending) {
		return errorResponse(
			new NotFoundError('No pending approval found for this tool call', {
				resourceType: 'approval',
				resourceId: toolCallId
			}),
			event.locals.requestId
		);
	}

	// Get tool definition for logging
	const toolDef = getToolDefinition(pending.toolName);

	// Log the approval decision
	logToolApproval(
		pending.toolName,
		toolDef?.category || 'unknown',
		toolDef?.approvalLevel || 'confirm',
		pending.args,
		approved,
		pending.sessionId
	);

	log.info({ toolName: pending.toolName, approved, toolCallId }, 'approval decision');

	// Record server-side approval so execute endpoint can verify
	if (approved) {
		await recordApproval(toolCallId, pending.toolName);
	}

	// Resolve the pending promise
	pending.resolve(approved);
	pendingApprovals.delete(toolCallId);

	return json({
		success: true,
		approved,
		toolCallId,
		message: approved ? 'Tool execution approved' : 'Tool execution rejected'
	});
};

/**
 * GET /api/tools/approve
 * Get list of pending approvals (for debugging/admin)
 */
export const GET: RequestHandler = async (event) => {
	requirePermission(event, 'tools:approve');

	const pending = Array.from(pendingApprovals.entries()).map(([id, data]) => ({
		toolCallId: id,
		toolName: data.toolName,
		args: data.args,
		sessionId: data.sessionId,
		createdAt: new Date(data.createdAt).toISOString(),
		age: Date.now() - data.createdAt
	}));

	return json({ pending, count: pending.length });
};
