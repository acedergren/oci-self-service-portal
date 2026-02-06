import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getToolDefinition, executeTool } from '@portal/shared/tools/registry.js';
import { requiresApproval } from '@portal/shared/tools/types.js';
import { requireApiAuth } from '@portal/shared/server/api/require-auth.js';
import { logToolExecution } from '@portal/shared/server/audit.js';
import {
	ValidationError,
	NotFoundError,
	AuthError,
	toPortalError,
	errorResponse
} from '@portal/shared/server/errors.js';
import { createLogger } from '@portal/shared/server/logger.js';
import { captureError } from '@portal/shared/server/sentry.js';
import { toolExecutions, toolDuration } from '@portal/shared/server/metrics.js';

const log = createLogger('api-v1-tools');

/** Request body schema for tool execution */
const executeBodySchema = z.object({
	args: z.record(z.string(), z.unknown()).default({}),
	confirmed: z.boolean().optional()
});

/**
 * POST /api/v1/tools/:name/execute
 * Execute a tool by name.
 *
 * For danger-level tools, requires either:
 *   - { "confirmed": true } in request body
 *   - X-Confirm: true header
 *
 * Request body: { args: { ... }, confirmed?: boolean }
 * Response: { success, tool, data?, error?, duration, approvalLevel }
 */
export const POST: RequestHandler = async (event) => {
	requireApiAuth(event, 'tools:execute');

	const { name } = event.params;
	const toolDef = getToolDefinition(name);

	if (!toolDef) {
		return errorResponse(
			new NotFoundError(`Tool not found: ${name}`, { resourceType: 'tool', resourceId: name }),
			event.locals.requestId
		);
	}

	// Parse and validate request body
	let body: z.infer<typeof executeBodySchema>;
	try {
		const raw = await event.request.json();
		body = executeBodySchema.parse(raw);
	} catch (err) {
		if (err instanceof z.ZodError) {
			return errorResponse(
				new ValidationError('Invalid request body', {
					issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
				}),
				event.locals.requestId
			);
		}
		return errorResponse(
			new ValidationError('Invalid JSON in request body'),
			event.locals.requestId
		);
	}

	// Danger-level tools require tools:danger permission (checked BEFORE confirmation)
	if (toolDef.approvalLevel === 'danger') {
		requireApiAuth(event, 'tools:danger');
	}

	// Tools requiring approval need explicit confirmation
	if (requiresApproval(toolDef.approvalLevel)) {
		const confirmedHeader = event.request.headers.get('X-Confirm') === 'true';
		const confirmedBody = body.confirmed === true;

		if (!confirmedHeader && !confirmedBody) {
			return errorResponse(
				new AuthError(
					`Tool "${name}" requires confirmation. Set "confirmed": true in body or X-Confirm: true header.`,
					403,
					{
						toolName: name,
						approvalLevel: toolDef.approvalLevel,
						requiresConfirmation: true
					}
				),
				event.locals.requestId
			);
		}
	}

	// Execute the tool
	const startTime = Date.now();
	const endTimer = toolDuration.startTimer({ tool: name, category: toolDef.category });

	try {
		const result = await executeTool(name, body.args);
		const duration = Date.now() - startTime;
		endTimer();

		log.info({ toolName: name, duration, userId: event.locals.user?.id }, 'v1 tool executed');
		toolExecutions.inc({
			tool: name,
			category: toolDef.category,
			approval_level: toolDef.approvalLevel,
			status: 'success'
		});

		logToolExecution(
			name,
			toolDef.category,
			toolDef.approvalLevel,
			body.args,
			true,
			duration,
			undefined,
			undefined,
			event.locals.user?.id
		);

		return json({
			success: true,
			tool: name,
			data: result,
			duration,
			approvalLevel: toolDef.approvalLevel
		});
	} catch (error) {
		const duration = Date.now() - startTime;
		endTimer();
		const portalErr = toPortalError(error);

		log.error({ err: portalErr, toolName: name, duration }, 'v1 tool execution failed');
		captureError(portalErr, { toolName: name, duration });
		toolExecutions.inc({
			tool: name,
			category: toolDef.category,
			approval_level: toolDef.approvalLevel,
			status: 'error'
		});

		logToolExecution(
			name,
			toolDef.category,
			toolDef.approvalLevel,
			body.args,
			false,
			duration,
			portalErr.message,
			undefined,
			event.locals.user?.id
		);

		return json(
			{
				success: false,
				tool: name,
				error: portalErr.message,
				code: portalErr.code,
				duration,
				approvalLevel: toolDef.approvalLevel
			},
			{ status: portalErr.statusCode }
		);
	}
};
