import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getToolDefinition } from '$lib/tools/registry.js';
import { getToolWarning, requiresApproval } from '$lib/tools/types.js';
import { requireApiAuth } from '$lib/server/api/require-auth.js';
import { NotFoundError, errorResponse } from '$lib/server/errors.js';
import { createLogger } from '$lib/server/logger.js';

const log = createLogger('api-v1-tools');

/**
 * GET /api/v1/tools/:name
 * Get a single tool definition by name.
 *
 * Response: { tool: { name, description, category, approvalLevel, requiresApproval, warning? } }
 */
export const GET: RequestHandler = async (event) => {
	requireApiAuth(event, 'tools:read');

	const { name } = event.params;
	const toolDef = getToolDefinition(name);

	if (!toolDef) {
		return errorResponse(
			new NotFoundError(`Tool not found: ${name}`, { resourceType: 'tool', resourceId: name }),
			event.locals.requestId
		);
	}

	const warning = getToolWarning(name);

	log.debug({ toolName: name }, 'tool definition retrieved');

	return json({
		tool: {
			name: toolDef.name,
			description: toolDef.description,
			category: toolDef.category,
			approvalLevel: toolDef.approvalLevel,
			requiresApproval: requiresApproval(toolDef.approvalLevel),
			...(warning ? { warning: warning.warning, impact: warning.impact } : {})
		}
	});
};
