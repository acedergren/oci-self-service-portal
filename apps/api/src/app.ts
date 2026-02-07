import Fastify, { type FastifyServerOptions, type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider
} from 'fastify-type-provider-zod';
import { createLogger } from '@portal/shared/server/logger';
import { isPortalError, toPortalError } from '@portal/shared/server/errors';
import { RATE_LIMIT_CONFIG } from '@portal/shared/server/rate-limiter';
import { generateRequestId } from '@portal/shared/server/tracing';
import { getAuthCookieAttributes } from '@portal/shared/server/auth/cookies';
import oraclePlugin from './plugins/oracle.js';
import authPlugin from './plugins/auth.js';
import rbacPlugin from './plugins/rbac.js';
import { healthRoutes } from './routes/health.js';
import { sessionRoutes } from './routes/sessions.js';
import { activityRoutes } from './routes/activity.js';
import { toolRoutes } from './routes/tools.js';
import { metricsRoutes } from './routes/metrics.js';

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

	/**
	 * Enable Helmet.js security headers (default: true)
	 */
	enableHelmet?: boolean;
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
		corsOrigin,
		enableRateLimit = true,
		enableTracing = true,
		enableHelmet = true
	} = options;

	const isProduction = process.env.NODE_ENV === 'production';

	// Runtime auth secret validation — fail fast in production (matches SvelteKit hooks.server.ts C1 fix)
	if (isProduction && !process.env.BETTER_AUTH_SECRET) {
		log.fatal('BETTER_AUTH_SECRET is required in production');
		throw new Error('BETTER_AUTH_SECRET is required in production');
	}

	// CORS origin: credentials:true requires an explicit origin (not '*').
	// In production, CORS_ORIGIN must be set. In development, fall back to 'true'
	// (reflects the request origin — safe for local dev, rejected in prod).
	if (isProduction && !corsOrigin && !process.env.CORS_ORIGIN) {
		log.fatal('CORS_ORIGIN is required in production (credentials:true forbids wildcard)');
		throw new Error('CORS_ORIGIN is required in production');
	}
	const resolvedCorsOrigin = corsOrigin ?? process.env.CORS_ORIGIN ?? true;

	// Create Fastify instance with Pino logger integration
	const app = Fastify({
		...fastifyOptions,
		// Trust reverse proxy headers (X-Forwarded-Proto, X-Forwarded-For) from nginx.
		// Required so secure cookies and request metadata behave correctly behind TLS termination.
		trustProxy: fastifyOptions.trustProxy ?? true,
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

	// Register CORS — origin is validated above; 'true' reflects the request origin (dev only)
	await app.register(fastifyCors, {
		origin: resolvedCorsOrigin,
		credentials: true
	});

	// Register Helmet.js — security headers matching SvelteKit hooks.server.ts
	if (enableHelmet) {
		await app.register(fastifyHelmet, {
			enableCSPNonces: true,
			contentSecurityPolicy: {
				directives: {
					defaultSrc: ["'self'"],
					// Nonces are appended automatically by @fastify/helmet (enableCSPNonces: true).
					scriptSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
					styleSrc: ["'self'", "'unsafe-inline'"],
					imgSrc: ["'self'", 'data:', 'blob:'],
					fontSrc: ["'self'"],
					connectSrc: [
						"'self'",
						'https://identity.oraclecloud.com',
						'https://*.identity.oraclecloud.com'
					],
					frameSrc: ["'none'"],
					objectSrc: ["'none'"],
					baseUri: ["'self'"],
					formAction: ["'self'"],
					frameAncestors: ["'none'"],
					...(isProduction ? { upgradeInsecureRequests: [] } : {})
				}
			},
			// HSTS: 1 year with includeSubDomains + preload (production only)
			strictTransportSecurity: isProduction
				? { maxAge: 31536000, includeSubDomains: true, preload: true }
				: false,
			// Explicitly configure all Helmet middlewares for predictable header hardening.
			dnsPrefetchControl: { allow: false },
			frameguard: { action: 'deny' },
			hidePoweredBy: true,
			ieNoOpen: true,
			noSniff: true,
			referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
			xssFilter: true,
			permittedCrossDomainPolicies: { permittedPolicies: 'none' },
			crossOriginOpenerPolicy: { policy: 'same-origin' },
			crossOriginResourcePolicy: { policy: 'same-origin' },
			crossOriginEmbedderPolicy: false, // Keep disabled for broad API compatibility.
			originAgentCluster: true
		});

		// Additional non-Helmet headers (defense-in-depth for API responses).
		app.addHook('onSend', async (_request, reply, payload) => {
			reply.header('Cache-Control', 'no-store, max-age=0');
			reply.header('Pragma', 'no-cache');
			reply.header('Expires', '0');
			reply.header('X-Robots-Tag', 'noindex, nofollow');
			reply.header(
				'Permissions-Policy',
				'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
			);
			return payload;
		});
	}

	// Register cookie support (for Better Auth sessions)
	// Cookie flags are shared with Better Auth config (packages/shared/server/auth/cookies.ts)
	// to avoid drift between SvelteKit auth routes and Fastify API behavior.
	await app.register(fastifyCookie, {
		secret: process.env.BETTER_AUTH_SECRET || 'dev-secret-change-in-production',
		parseOptions: getAuthCookieAttributes()
	});

	// Register sensible (HTTP error helpers)
	await app.register(fastifySensible);

	// Register rate limiting
	if (enableRateLimit) {
		await app.register(fastifyRateLimit, {
			max: RATE_LIMIT_CONFIG.maxRequests.api ?? 60,
			timeWindow: RATE_LIMIT_CONFIG.windowMs,
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

	// Register application plugins (Oracle → Auth → RBAC, in dependency order)
	await app.register(oraclePlugin, {
		migrate: process.env.SKIP_MIGRATIONS !== 'true'
	});
	await app.register(authPlugin, {
		excludePaths: ['/healthz', '/health', '/api/metrics']
	});
	await app.register(rbacPlugin);

	// Register API routes
	await app.register(healthRoutes);
	await app.register(sessionRoutes);
	await app.register(activityRoutes);
	await app.register(toolRoutes);
	await app.register(metricsRoutes);

	log.info('Fastify app created with plugins and routes');
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
