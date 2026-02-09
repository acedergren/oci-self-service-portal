import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auth } from '@portal/shared/server/auth/config';

function toWebRequest(request: FastifyRequest): Request {
	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers)) {
		if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
	}

	let body: RequestInit['body'] | undefined;
	if (request.method !== 'GET' && request.method !== 'HEAD' && request.body !== undefined) {
		if (typeof request.body === 'string') {
			body = request.body;
		} else {
			body = JSON.stringify(request.body);
			if (!headers.has('content-type')) headers.set('content-type', 'application/json');
		}
	}

	const url = `${request.protocol}://${request.hostname}${request.url}`;
	return new Request(url, {
		method: request.method,
		headers,
		body
	}) as Request;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
	app.route({
		method: ['GET', 'POST'],
		url: '/api/auth/*',
		handler: async (request: FastifyRequest, reply: FastifyReply) => {
			try {
				const response = await (
					auth as { handler: (request: Request) => Promise<Response> }
				).handler(toWebRequest(request));

				reply.status(response.status);
				response.headers.forEach((value, key) => {
					reply.header(key, value);
				});

				const body = await response.text();
				return reply.send(body);
			} catch (err) {
				request.log.error({ err }, 'Better Auth route handler failed');
				return reply.status(500).send({ error: 'Authentication service unavailable' });
			}
		}
	});
}
