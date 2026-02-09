import type { RequestHandler } from './$types';
import { generateOpenAPISpec } from '@portal/shared/server/api/openapi';

/**
 * GET /api/v1/openapi.json
 * Serves the OpenAPI 3.1 specification.
 *
 * Public endpoint (no auth required) — the spec describes the API surface
 * but does not expose any sensitive data.
 */
export const GET: RequestHandler = async () => {
	const spec = generateOpenAPISpec();

	return new Response(JSON.stringify(spec, null, 2), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
