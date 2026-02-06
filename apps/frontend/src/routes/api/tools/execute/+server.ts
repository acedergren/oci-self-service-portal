import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logToolExecution, logToolApproval } from '$lib/server/audit.js';
import {
	getToolDefinition,
	requiresApproval,
	getToolWarning,
	executeTool
} from '$lib/tools/index.js';
import { createLogger } from '$lib/server/logger.js';
import { requirePermission } from '$lib/server/auth/rbac.js';
import { consumeApproval } from '$lib/server/approvals.js';
import {
	ValidationError,
	NotFoundError,
	AuthError,
	OCIError,
	toPortalError,
	errorResponse,
	isPortalError
} from '$lib/server/errors.js';
import { captureError } from '$lib/server/sentry.js';
import { toolExecutions, toolDuration } from '$lib/server/metrics.js';

const log = createLogger('execute');

/**
 * GET /api/tools/execute?toolName=xxx
 * Get approval requirements for a tool
 */
export const GET: RequestHandler = async (event) => {
	requirePermission(event, 'tools:execute');

	const toolName = event.url.searchParams.get('toolName');

	if (!toolName) {
		return errorResponse(
			new ValidationError('Missing toolName parameter', { field: 'toolName' }),
			event.locals.requestId
		);
	}

	const toolDef = getToolDefinition(toolName);

	if (!toolDef) {
		return errorResponse(
			new NotFoundError(`Unknown tool: ${toolName}`, {
				resourceType: 'tool',
				resourceId: toolName
			}),
			event.locals.requestId
		);
	}

	const warning = getToolWarning(toolName);
	const needsApproval = requiresApproval(toolDef.approvalLevel);

	return json({
		toolName,
		category: toolDef.category,
		approvalLevel: toolDef.approvalLevel,
		requiresApproval: needsApproval,
		warning: warning?.warning,
		impact: warning?.impact,
		description: toolDef.description
	});
};

/**
 * POST /api/tools/execute
 * Execute a tool after approval
 */
export const POST: RequestHandler = async (event) => {
	requirePermission(event, 'tools:execute');

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
	const toolName = body.toolName as string | undefined;
	const args = body.args as Record<string, unknown> | undefined;
	const sessionId = body.sessionId as string | undefined;

	if (!toolName || !args) {
		return errorResponse(
			new ValidationError('Missing toolName or args', { fields: ['toolName', 'args'] }),
			event.locals.requestId
		);
	}

	const toolDef = getToolDefinition(toolName);

	if (!toolDef) {
		return errorResponse(
			new NotFoundError(`Unknown tool: ${toolName}`, {
				resourceType: 'tool',
				resourceId: toolName
			}),
			event.locals.requestId
		);
	}

	const needsApproval = requiresApproval(toolDef.approvalLevel);

	// If tool requires approval, verify server-side approval record
	if (needsApproval) {
		if (!toolCallId || !(await consumeApproval(toolCallId, toolName))) {
			logToolApproval(toolName, toolDef.category, toolDef.approvalLevel, args, false, sessionId);

			return errorResponse(
				new AuthError('Tool requires explicit approval via the approval endpoint', 403, {
					toolName,
					approvalLevel: toolDef.approvalLevel,
					rejected: true
				}),
				event.locals.requestId
			);
		}

		logToolApproval(toolName, toolDef.category, toolDef.approvalLevel, args, true, sessionId);
	}

	// Execute the tool via registry
	const startTime = Date.now();
	const endTimer = toolDuration.startTimer({ tool: toolName, category: toolDef.category });

	try {
		const result = await executeTool(toolName, args);
		const duration = Date.now() - startTime;
		endTimer();

		log.info({ toolName, duration }, 'tool executed');
		toolExecutions.inc({
			tool: toolName,
			category: toolDef.category,
			approval_level: toolDef.approvalLevel,
			status: 'success'
		});

		// Log successful execution
		logToolExecution(
			toolName,
			toolDef.category,
			toolDef.approvalLevel,
			args,
			true,
			duration,
			undefined,
			sessionId
		);

		return json({
			success: true,
			toolCallId,
			toolName,
			data: result,
			duration,
			approvalLevel: toolDef.approvalLevel
		});
	} catch (error) {
		const duration = Date.now() - startTime;
		endTimer();
		const portalErr = toPortalError(error);

		log.error({ err: portalErr, toolName, duration }, 'tool execution failed');
		captureError(portalErr, { toolName, duration });
		toolExecutions.inc({
			tool: toolName,
			category: toolDef.category,
			approval_level: toolDef.approvalLevel,
			status: 'error'
		});

		// Log failed execution
		logToolExecution(
			toolName,
			toolDef.category,
			toolDef.approvalLevel,
			args,
			false,
			duration,
			portalErr.message,
			sessionId
		);

		// Use the PortalError's status if it's a recognized error (e.g. OCIError=502)
		return json(
			{
				success: false,
				toolCallId,
				toolName,
				error: portalErr.message,
				code: portalErr.code,
				duration,
				approvalLevel: toolDef.approvalLevel
			},
			{ status: portalErr.statusCode }
		);
	}
};
