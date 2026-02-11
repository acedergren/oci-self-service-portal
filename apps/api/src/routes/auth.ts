import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auth } from '@portal/server/auth/config';
import { createLogger } from '@portal/shared/server/logger';

const log = createLogger('auth-routes');

/**
 * Convert Fastify request to Web API Request for Better Auth.
 *
 * Better Auth's universal handler expects a standard Web API Request object.
 * This function transforms Fastify's request into the correct format, including:
 * - Headers (preserving cookies for session management)
 * - Request body (for POST requests like sign-in, sign-out)
 * - Full URL (protocol + hostname + path)
 */
function toWebRequest(request: FastifyRequest): Request {
	const headers = new Headers();

	// Copy all headers, preserving multi-value headers
	for (const [key, value] of Object.entries(request.headers)) {
		if (value) {
			headers.set(key, Array.isArray(value) ? value.join(', ') : value);
		}
	}

	// Handle request body for non-GET/HEAD requests
	let body: RequestInit['body'] | undefined;
	if (request.method !== 'GET' && request.method !== 'HEAD' && request.body !== undefined) {
		if (typeof request.body === 'string') {
			body = request.body;
		} else if (Buffer.isBuffer(request.body)) {
			// Convert Buffer to Uint8Array (which is a valid BodyInit type)
			body = new Uint8Array(request.body);
		} else {
			// JSON-encode object bodies
			body = JSON.stringify(request.body);
			if (!headers.has('content-type')) {
				headers.set('content-type', 'application/json');
			}
		}
	}

	// Construct full URL (Better Auth needs the complete URL for callback matching)
	const url = `${request.protocol}://${request.hostname}${request.url}`;

	return new Request(url, {
		method: request.method,
		headers,
		body
	}) as Request;
}

/**
 * Better Auth catch-all route handler for Fastify.
 *
 * Handles all authentication routes under /api/auth/*:
 * - GET  /api/auth/session - Get current session
 * - POST /api/auth/sign-in/social - OAuth sign-in initiation
 * - GET  /api/auth/callback/oci-iam - OAuth callback (PKCE)
 * - POST /api/auth/sign-out - Sign out and clear session
 * - GET  /api/auth/csrf - Get CSRF token
 *
 * Better Auth provides a universal `.handler()` method that processes requests
 * based on the path and method, returning a Web API Response.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
	app.route({
		// Support all HTTP methods (Better Auth uses GET, POST, DELETE, OPTIONS)
		method: ['GET', 'POST', 'DELETE', 'OPTIONS', 'PUT', 'PATCH'],
		url: '/api/auth/*',
		handler: async (request: FastifyRequest, reply: FastifyReply) => {
			const startTime = performance.now();

			try {
				log.debug({ method: request.method, url: request.url }, 'Processing Better Auth request');

				// Convert Fastify request to Web API Request
				const webRequest = toWebRequest(request);

				// Call Better Auth's universal handler
				const response = await (
					auth as { handler: (request: Request) => Promise<Response> }
				).handler(webRequest);

				// Set HTTP status
				reply.status(response.status);

				// Copy all response headers (especially Set-Cookie for sessions)
				response.headers.forEach((value, key) => {
					reply.header(key, value);
				});

				// Get response body
				const body = await response.text();

				const duration = performance.now() - startTime;
				log.info(
					{
						method: request.method,
						url: request.url,
						status: response.status,
						durationMs: Math.round(duration)
					},
					`Better Auth: ${request.method} ${request.url} ${response.status}`
				);

				// Send response (use empty string if body is empty to avoid Fastify 5 errors)
				return reply.send(body || '');
			} catch (err) {
				const duration = performance.now() - startTime;
				log.error(
					{
						err,
						method: request.method,
						url: request.url,
						durationMs: Math.round(duration)
					},
					'Better Auth route handler failed'
				);

				// Return error response (matches test expectations)
				return reply.status(500).send({
					error: 'Authentication service unavailable'
				});
			}
		}
	});
}
