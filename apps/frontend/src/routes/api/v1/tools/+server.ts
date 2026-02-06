import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllToolDefinitions, getToolsByCategory } from '@portal/shared/tools/registry.js';
import type { ToolCategory } from '@portal/shared/tools/types.js';
import { requireApiAuth } from '@portal/shared/server/api/require-auth.js';
import { ValidationError, errorResponse } from '@portal/shared/server/errors.js';
import { createLogger } from '@portal/shared/server/logger.js';

const log = createLogger('api-v1-tools');

/** Valid tool categories for query param validation */
const VALID_CATEGORIES: ToolCategory[] = [
	'compute',
	'networking',
	'storage',
	'database',
	'identity',
	'observability',
	'pricing',
	'search',
	'billing',
	'logging'
];

/**
 * GET /api/v1/tools
 * List all tool definitions, optionally filtered by category.
 *
 * Query params:
 *   ?category=compute  - Filter by tool category
 *
 * Response: { tools: [...], total: N }
 */
export const GET: RequestHandler = async (event) => {
	requireApiAuth(event, 'tools:read');

	const category = event.url.searchParams.get('category');

	if (category && !VALID_CATEGORIES.includes(category as ToolCategory)) {
		return errorResponse(
			new ValidationError(
				`Invalid category: ${category}. Valid categories: ${VALID_CATEGORIES.join(', ')}`,
				{
					field: 'category',
					value: category
				}
			),
			event.locals.requestId
		);
	}

	const tools = category ? getToolsByCategory(category as ToolCategory) : getAllToolDefinitions();

	const response = tools.map((t) => ({
		name: t.name,
		description: t.description,
		category: t.category,
		approvalLevel: t.approvalLevel
	}));

	log.debug({ category, count: response.length }, 'listed tools');

	return json({ tools: response, total: response.length });
};
