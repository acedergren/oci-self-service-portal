import Fastify, { type FastifyServerOptions, type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider
} from 'fastify-type-provider-zod';
import { createLogger } from '@portal/shared/server/logger';
import {
	PortalError,
	errorResponse,
	isPortalError,
	toPortalError
} from '@portal/shared/server/errors';
import { RATE_LIMIT_CONFIG } from '@portal/shared/server/rate-limiter';
import { generateRequestId, REQUEST_ID_HEADER } from '@portal/shared/server/tracing';

const log = createLogger('app');

export interface AppOptions {
	/**
	 * Fastify server options
	 */
	fastifyOptions?: FastifyServerOptions;

	/**
	 * CORS origin (default: process.env.CORS_ORIGIN or '*')
	 */
	corsOrigin?: string | string[];

	/**
	 * Enable rate limiting (default: true)
	 */
	enableRateLimit?: boolean;

	/**
	 * Enable request tracing (default: true)
	 */
	enableTracing?: boolean;
}

/**
 * Create a configured Fastify app instance
 *
 * @param options - App configuration options
 * @returns Configured Fastify instance with ZodTypeProvider
 */
export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
	const {
		fastifyOptions = {},
		corsOrigin = process.env.CORS_ORIGIN || '*',
		enableRateLimit = true,
		enableTracing = true
	} = options;

	// Create Fastify instance with Pino logger integration
	const app = Fastify({
		...fastifyOptions,
		logger: {
			level: process.env.LOG_LEVEL || 'info',
			serializers: {
				req(req) {
					return {
						method: req.method,
						url: req.url,
						hostname: req.hostname,
						remoteAddress: req.ip,
						remotePort: req.socket?.remotePort
					};
				},
				res(res) {
					return {
						statusCode: res.statusCode
					};
				}
			}
		}
	}).withTypeProvider<ZodTypeProvider>();

	// Register Zod type provider
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);

	// Request tracing - add X-Request-Id header
	if (enableTracing) {
		app.addHook('onRequest', async (request, reply) => {
			// Get existing request ID from header or generate new one
			const existingId = request.headers['x-request-id'];
			const requestId = existingId || generateRequestId();

			// Set header on both request and reply
			request.headers['x-request-id'] = requestId as string;
			reply.header('X-Request-Id', requestId);
		});
	}

	// Register CORS
	await app.register(fastifyCors, {
		origin: corsOrigin,
		credentials: true
	});

	// Register cookie support (for Better Auth sessions)
	await app.register(fastifyCookie, {
		secret: process.env.BETTER_AUTH_SECRET || 'dev-secret-change-in-production'
	});

	// Register sensible (HTTP error helpers)
	await app.register(fastifySensible);

	// Register rate limiting
	if (enableRateLimit) {
		await app.register(fastifyRateLimit, {
			max: RATE_LIMIT_CONFIG.AUTHENTICATED.max,
			timeWindow: RATE_LIMIT_CONFIG.AUTHENTICATED.windowMs,
			skipOnError: true, // Fail open on Redis/DB errors
			errorResponseBuilder: (req, context) => {
				return {
					error: 'Too Many Requests',
					message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
					statusCode: 429
				};
			}
		});
	}

	// Global error handler - maps PortalError to HTTP responses
	app.setErrorHandler((error, request, reply) => {
		// Convert unknown errors to PortalError
		const portalError = isPortalError(error) ? error : toPortalError(error);

		// Log error with context
		log.error(
			{
				err: portalError,
				requestId: request.headers['x-request-id'],
				method: request.method,
				url: request.url
			},
			'Request error'
		);

		// Send error response
		const response = errorResponse(portalError);
		reply.status(response.status).send(response);
	});

	// Health check endpoint
	app.get('/health', async (request, reply) => {
		return { status: 'ok', timestamp: new Date().toISOString() };
	});

	log.info('Fastify app created');
	return app;
}

/**
 * Start the Fastify server
 *
 * @param app - Fastify instance
 * @param port - Port to listen on (default: 3000)
 * @param host - Host to bind to (default: '0.0.0.0')
 */
export async function startServer(
	app: FastifyInstance,
	port: number = Number(process.env.PORT) || 3000,
	host: string = process.env.HOST || '0.0.0.0'
): Promise<void> {
	try {
		await app.listen({ port, host });
		log.info(`Server listening on ${host}:${port}`);
	} catch (error) {
		log.fatal({ err: error }, 'Failed to start server');
		process.exit(1);
	}
}

/**
 * Gracefully stop the Fastify server
 *
 * @param app - Fastify instance
 */
export async function stopServer(app: FastifyInstance): Promise<void> {
	try {
		await app.close();
		log.info('Server stopped gracefully');
	} catch (error) {
		log.error({ err: error }, 'Error stopping server');
		throw error;
	}
}
