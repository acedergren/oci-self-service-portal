import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Headers to redact from logged request objects. */
const REDACTED_HEADERS = new Set([
	'authorization',
	'cookie',
	'set-cookie',
	'x-api-key'
]);

/** Only allow safe characters in request IDs to prevent log injection. */
export const VALID_REQUEST_ID = /^[a-zA-Z0-9._-]{1,128}$/;

function generateRequestId(request: FastifyRequest): string {
	const header = request.headers['x-request-id'];
	if (typeof header === 'string' && VALID_REQUEST_ID.test(header)) {
		return header;
	}
	return `req-${randomUUID()}`;
}

async function requestLogger(app: FastifyInstance): Promise<void> {
	// Override Fastify's default request ID generation
	app.addHook('onRequest', (request, _reply, done) => {
		// Fastify sets request.id from genReqId before plugins run,
		// so we override it here for incoming X-Request-Id support
		(request as { id: string }).id = generateRequestId(request);
		done();
	});

	// Attach X-Request-Id to response headers
	app.addHook('onSend', (request, reply: FastifyReply, _payload, done) => {
		void reply.header('x-request-id', request.id);
		done();
	});
}

export default fp(requestLogger, { name: 'request-logger' });

/** Redact sensitive headers for log serialization. */
export function redactHeaders(
	headers: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined | string> {
	const result: Record<string, string | string[] | undefined | string> = {};
	for (const [key, value] of Object.entries(headers)) {
		result[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value;
	}
	return result;
}
