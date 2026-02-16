import fp from 'fastify-plugin';
import { isPortalError, toPortalError } from '@portal/types';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

async function errorHandler(app: FastifyInstance): Promise<void> {
	app.setErrorHandler((error: Error, request: FastifyRequest, reply: FastifyReply) => {
		const portalError = isPortalError(error) ? error : toPortalError(error);

		// For unknown errors, use generic message to avoid leaking internals
		const body = isPortalError(error)
			? error.toResponseBody()
			: { error: 'Internal server error', code: 'INTERNAL_ERROR' as const };

		// Add requestId from context if present
		const responseBody: Record<string, unknown> = { ...body };
		if (isPortalError(error) && error.context.requestId) {
			responseBody.requestId = error.context.requestId;
		}

		// Log PortalErrors fully (they're safe); log unknown errors with only message/name
		if (isPortalError(error)) {
			request.log.error(error);
		} else {
			request.log.error({ message: error.message, name: error.name }, 'Unhandled error');
		}

		return reply.status(portalError.statusCode).send(responseBody);
	});
}

export default fp(errorHandler, { name: 'error-handler' });
