import Fastify, { type FastifyServerOptions, type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyCompress from '@fastify/compress';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import fastifySwagger from '@fastify/swagger';
import scalarFastify from '@scalar/fastify-api-reference';
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider
} from 'fastify-type-provider-zod';
import { createLogger } from '@portal/server/logger';
import {
	errorResponse,
	isPortalError,
	toPortalError,
	ValidationError
} from '@portal/server/errors';
import { RATE_LIMIT_CONFIG } from '@portal/server/rate-limiter';
import { generateRequestId } from '@portal/server/tracing';
import { getAuthCookieAttributes } from '@portal/server/auth/cookies';
import { initSetupToken } from '@portal/server/admin';
import otelPlugin from './plugins/otel.js';
import underPressurePlugin from './plugins/under-pressure.js';
import cachePlugin from './plugins/cache.js';
import oraclePlugin from './plugins/oracle.js';
import authPlugin from './plugins/auth.js';
import rbacPlugin, { requireAuth } from './plugins/rbac.js';
import vpdPlugin from './plugins/vpd.js';
import { rateLimiterOraclePlugin } from './plugins/rate-limiter-oracle.js';
import schedulePlugin from './plugins/schedule.js';
import mastraPlugin from './plugins/mastra.js';
import { restartAllActiveWorkflowRuns } from './mastra/workflows/recovery.js';
import { healthRoutes } from './routes/health.js';
import { sessionRoutes } from './routes/sessions.js';
import { activityRoutes } from './routes/activity.js';
import { toolExecuteRoutes, toolApproveRoutes } from './routes/tools/index.js';
import { v1ToolRoutes } from './routes/v1-tools.js';
import workflowRoutes from './routes/workflows.js';
import chatRoutes from './routes/chat.js';
import mcpRoutes from './routes/mcp.js';
import searchRoutes from './routes/search.js';
import { metricsRoutes } from './routes/metrics.js';
import openApiRoute from './routes/openapi.js';
import { modelRoutes } from './routes/models.js';
import { auditRoutes } from './routes/audit.js';
import { graphRoutes } from './routes/graph.js';
import { webhookRoutes } from './routes/webhooks.js';
import { setupRoutes } from './routes/setup.js';
import { authRoutes } from './routes/auth.js';
import { mcpAdminRoutes } from './routes/admin/mcp.js';
import { adminMetricsRoutes } from './routes/admin/metrics.js';
import { idpAdminRoutes } from './routes/admin/idp.js';
import { adminSettingsRoutes } from './routes/admin/settings.js';
import { aiProviderAdminRoutes } from './routes/admin/ai-providers.js';

const log = createLogger('app');

function isFastifyValidationError(error: unknown): error is {
	message?: string;
	validation: Array<Record<string, unknown>>;
	validationContext?: string;
} {
	if (!error || typeof error !== 'object') return false;
	const maybeValidation = (error as { validation?: unknown }).validation;
	return Array.isArray(maybeValidation);
}

export interface AppOptions {
	/**
	 * Fastify server options
	 */
	fastifyOptions?: FastifyServerOptions;

	/**
	 * CORS origin. In production, CORS_ORIGIN env var is required.
	 * In development, defaults to `true` (reflects request origin).
	 */
	corsOrigin?: string | string[] | boolean;

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

	/**
	 * Enable OpenAPI docs at /api/docs (default: true in dev, false in production).
	 * Requires admin:all permission.
	 */
	enableDocs?: boolean;
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
		enableHelmet = true,
		enableDocs
	} = options;

	const isProduction = process.env.NODE_ENV === 'production';

	// Runtime auth secret validation — fail fast in production (matches SvelteKit hooks.server.ts C1 fix)
	if (isProduction && !process.env.BETTER_AUTH_SECRET) {
		log.fatal('BETTER_AUTH_SECRET is required in production');
		throw new Error('BETTER_AUTH_SECRET is required in production');
	}

	// CORS origin: credentials:true requires an explicit origin (not '*').
	// In production, CORS_ORIGIN must be set. In development, allow SvelteKit frontend origin.
	if (isProduction && !corsOrigin && !process.env.CORS_ORIGIN) {
		log.fatal('CORS_ORIGIN is required in production (credentials:true forbids wildcard)');
		throw new Error('CORS_ORIGIN is required in production');
	}
	// In development, explicitly allow SvelteKit frontend for cross-origin auth.
	// Aligns with Better Auth trustedOrigins configuration.
	const resolvedCorsOrigin = corsOrigin ??
		process.env.CORS_ORIGIN ?? ['http://localhost:5173', 'http://localhost:3000'];

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

	// ── Infrastructure plugins (order matters) ──────────────────────────

	// Global error handler - maps PortalError to HTTP responses
	app.setErrorHandler((error, request, reply) => {
		const requestId =
			typeof request.headers['x-request-id'] === 'string'
				? request.headers['x-request-id']
				: undefined;

		if (isFastifyValidationError(error)) {
			const validationError = new ValidationError(
				error.message ?? 'Request validation failed',
				{
					requestId,
					validationContext: error.validationContext,
					validation: error.validation
				},
				error instanceof Error ? error : undefined
			);
			const response = errorResponse(validationError, requestId);
			reply.status(response.status).send(response);
			return;
		}

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
		const response = errorResponse(portalError, requestId);
		reply.status(response.status).send(response);
	});

	// ── OpenTelemetry (MUST be first plugin) ─────────────────────────────
	// @fastify/otel must register before all other plugins to properly instrument
	// the request lifecycle. No-op if OTEL_EXPORTER_OTLP_ENDPOINT is not configured.
	await app.register(otelPlugin);

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

	// Register CORS — origin is validated above; 'true' reflects the request origin (dev only)
	await app.register(fastifyCors, {
		origin: resolvedCorsOrigin,
		credentials: true
	});

	// Register compression (gzip + brotli)
	// Note: SSE and streaming responses are automatically excluded from compression
	// by @fastify/sse and Fastify's streaming handling
	await app.register(fastifyCompress, {
		threshold: 1024, // Minimum 1KB to compress
		encodings: ['br', 'gzip']
	});

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

	// Register cookie support (for Better Auth sessions)
	// Cookie flags are shared with Better Auth config (packages/shared/server/auth/cookies.ts)
	// to avoid drift between SvelteKit auth routes and Fastify API behavior.
	await app.register(fastifyCookie, {
		secret: process.env.BETTER_AUTH_SECRET,
		parseOptions: getAuthCookieAttributes()
	});

	// Register sensible (HTTP error helpers)
	await app.register(fastifySensible);

	// ── Resilience plugins (before auth chain) ───────────────────────

	// Under-pressure: returns 503 when event loop, heap, or RSS exceeds thresholds.
	// Custom health check pings Oracle when available, gracefully degrades otherwise.
	await app.register(underPressurePlugin);

	// Valkey cache: namespace-scoped TTLs with fail-open behavior.
	// App continues to function even if Valkey is unreachable.
	await app.register(cachePlugin);

	// ── Auth chain (oracle → auth → RBAC) ───────────────────

	// Register application plugins (Oracle → Auth → RBAC, in dependency order)
	await app.register(oraclePlugin, {
		migrate: process.env.SKIP_MIGRATIONS !== 'true'
	});

	// ── Graceful shutdown (after oracle + cache) ─────────────────────────
	// Coordinates graceful drain of Oracle pool and Valkey cache on shutdown.
	// Existing onClose hooks in oracle and cache plugins handle the actual cleanup.
	const gracefulShutdown = (await import('fastify-graceful-shutdown')).default;
	await app.register(gracefulShutdown, {
		timeout: 30000 // 30s timeout for graceful drain
	});

	// Log when shutdown begins (onClose hooks fire in reverse registration order)
	app.addHook('onClose', async () => {
		log.info('Graceful shutdown initiated - draining Oracle pool and Valkey cache');
	});

	await initSetupToken();
	await app.register(authPlugin, {
		excludePaths: [
			'/healthz',
			'/health',
			'/api/metrics',
			'/api/health',
			'/api/healthz',
			'/api/auth',
			'/api/models',
			'/api/v1/openapi.json'
		]
	});
	await app.register(rbacPlugin);

	// VPD plugin: decorates request.withVPD for Oracle tenant isolation.
	// Must come after auth so request.user, request.session, and request.apiKeyContext are set.
	await app.register(vpdPlugin);

	// Oracle-backed rate limiter: per-user, per-endpoint limits (L2 layer).
	// Must come after auth chain so request.user and request.apiKeyContext are populated.
	await app.register(rateLimiterOraclePlugin);

	// ── Background tasks (cron jobs) ───────────────────────────────────

	// Schedule plugin: recurring background tasks (health checks, session cleanup).
	// Registered after oracle plugin to ensure DB pool is available for cleanup jobs.
	await app.register(schedulePlugin);

	// ── Mastra framework (agents, workflows, MCP) ─────────────────────

	await app.register(mastraPlugin);

	// ── Workflow crash recovery (E-3.05) ────────────────────────────────
	// Resume stale workflow runs on startup (status = running/suspended, last update >5 min ago)
	app.addHook('onReady', async () => {
		const { restarted, failed } = await restartAllActiveWorkflowRuns(log);
		if (restarted > 0) {
			log.info(
				`Recovered ${restarted} workflow runs on startup${failed > 0 ? ` (${failed} failed)` : ''}`
			);
		}
	});

	// ── OpenAPI docs ────────────────────────────────────────────────────

	// OpenAPI docs — enabled explicitly or defaults to non-production
	const docsEnabled = enableDocs ?? !isProduction;
	if (docsEnabled) {
		await app.register(fastifySwagger, {
			openapi: {
				info: {
					title: 'CloudNow API',
					version: process.env.npm_package_version || '0.1.0'
				}
			}
		});

		// Register Scalar UI at /api/docs — auto-discovers spec from @fastify/swagger.
		// Also exposes /api/docs/openapi.json and /api/docs/openapi.yaml automatically.
		await app.register(scalarFastify, {
			routePrefix: '/api/docs',
			configuration: {
				theme: 'purple'
			},
			hooks: {
				onRequest: requireAuth('admin:all')
			}
		});
	}

	// ── Route modules ───────────────────────────────────────────────────

	await app.register(healthRoutes);
	await app.register(sessionRoutes);
	await app.register(activityRoutes);
	await app.register(toolExecuteRoutes);
	await app.register(toolApproveRoutes);
	await app.register(v1ToolRoutes);
	await app.register(workflowRoutes);
	await app.register(chatRoutes);
	await app.register(mcpRoutes);
	await app.register(searchRoutes);
	await app.register(metricsRoutes);
	await app.register(openApiRoute);
	await app.register(modelRoutes);
	await app.register(auditRoutes);
	await app.register(graphRoutes);
	await app.register(webhookRoutes);
	await app.register(setupRoutes);
	await app.register(authRoutes);
	await app.register(mcpAdminRoutes);
	await app.register(adminMetricsRoutes);
	await app.register(idpAdminRoutes);
	await app.register(adminSettingsRoutes);
	await app.register(aiProviderAdminRoutes);

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
