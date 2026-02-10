import type { Handle, RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import crypto from 'crypto';
import { createLogger } from '@portal/server/logger';
import { initPool, closePool } from '@portal/server/oracle/connection';
import { runMigrations } from '@portal/server/oracle/migrations';
import { webhookRepository } from '@portal/server/oracle/repositories/webhook-repository';
import { auth } from '@portal/server/auth/config';
import { getPermissionsForRole, type Permission } from '@portal/server/auth/rbac';
import { getOrgRole } from '@portal/server/auth/tenancy';
import { checkRateLimit, RATE_LIMIT_CONFIG } from '@portal/server/rate-limiter';
import { generateRequestId, REQUEST_ID_HEADER } from '@portal/server/tracing';
import {
	RateLimitError,
	AuthError,
	PortalError,
	errorResponse
} from '@portal/server/errors';
import { httpRequestDuration } from '@portal/server/metrics';
import { initSentry, captureError, closeSentry } from '@portal/server/sentry';
import { validateApiKey } from '@portal/server/auth/api-keys';
import { shouldProxyToFastify, proxyToFastify } from '$lib/server/feature-flags.js';

const log = createLogger('hooks');

// ── CORS for /api/v1/* (external REST API) ──────────────────────────────────
// Supports cross-origin browser clients using API key auth.
// Set ALLOWED_ORIGINS to a comma-separated list of origins, or '*' for public.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? (dev ? '*' : ''))
	.split(',')
	.filter(Boolean);
const V1_API_PREFIX = '/api/v1/';
const CORS_MAX_AGE = '86400'; // 24 h preflight cache
const CORS_ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const CORS_ALLOWED_HEADERS = 'Authorization, X-API-Key, Content-Type, X-Request-Id';

function getCorsOrigin(requestOrigin: string | null): string | null {
	if (!requestOrigin || ALLOWED_ORIGINS.length === 0) return null;
	if (ALLOWED_ORIGINS.includes('*')) return '*';
	return ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : null;
}

function addCorsHeaders(headers: Headers, allowedOrigin: string): void {
	headers.set('Access-Control-Allow-Origin', allowedOrigin);
	headers.set('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS);
	headers.set('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS);
	headers.set('Access-Control-Max-Age', CORS_MAX_AGE);
	if (allowedOrigin !== '*') {
		headers.set('Vary', 'Origin');
	}
}

/**
 * Add CORS headers to a response if the request targets /api/v1/ and the origin is allowed.
 */
function withV1Cors(response: Response, event: RequestEvent): Response {
	if (!event.url.pathname.startsWith(V1_API_PREFIX)) return response;
	const origin = event.request.headers.get('origin');
	const allowedOrigin = getCorsOrigin(origin);
	if (allowedOrigin) addCorsHeaders(response.headers, allowedOrigin);
	return response;
}

// ── Oracle Database lazy initialisation ──────────────────────────────────────
let dbInitialized = false;
let dbAvailable = false;

async function ensureDatabase(): Promise<boolean> {
	if (dbInitialized) return dbAvailable;
	dbInitialized = true;

	// Validate auth secret at runtime (not build time)
	if (!dev && !process.env.BETTER_AUTH_SECRET) {
		log.error('BETTER_AUTH_SECRET is not set — sessions will use an insecure default secret');
	}

	// Initialise Sentry (no-op if SENTRY_DSN is not set)
	await initSentry({
		environment: dev ? 'development' : 'production',
		release: '0.1.0'
	});

	try {
		await initPool();
		await runMigrations();

		// Encrypt legacy webhook secrets in small batches after schema migration.
		const webhookSecretMigration = await webhookRepository.migratePlaintextSecrets();
		if (webhookSecretMigration.migrated > 0 || webhookSecretMigration.remaining > 0) {
			log.info({ webhookSecretMigration }, 'webhook secret encryption migration completed');
		}

		dbAvailable = true;
		log.info('Oracle database initialized');
	} catch (err) {
		log.error({ err }, 'Failed to initialize Oracle database - running in degraded mode');
		if (err instanceof Error) captureError(err, { phase: 'db-init' });
		dbAvailable = false;
	}

	return dbAvailable;
}

// Paths exempt from rate limiting (health checks, metrics scrape)
const RATE_LIMIT_EXEMPT_PATHS = ['/api/health', '/api/healthz', '/api/metrics'];

// Paths exempt from request logging (noisy health checks and Prometheus scrapes)
const LOG_EXEMPT_PATHS = ['/api/health', '/api/healthz', '/api/metrics'];

// ── Auth guard ─────────────────────────────────────────────────────────────
// Public paths that skip authentication entirely
const PUBLIC_PATHS = [
	'/api/health',
	'/api/healthz',
	'/api/auth/',
	'/login',
	'/api/metrics',
	'/api/v1/openapi.json'
];

/**
 * Get client identifier from request event
 */
function getClientId(event: RequestEvent): string {
	try {
		return event.getClientAddress();
	} catch {
		return 'unknown-client';
	}
}

/**
 * Content Security Policy configuration.
 *
 * When a nonce is provided (production), script-src uses nonce instead of unsafe-inline.
 * Without a nonce (dev mode or fallback), unsafe-inline is retained for compatibility.
 */
export function getCSPHeader(nonce?: string): string {
	let scriptSrc: string;
	if (dev) {
		scriptSrc = "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
	} else if (nonce) {
		scriptSrc = `script-src 'self' 'nonce-${nonce}'`;
	} else {
		scriptSrc = "script-src 'self' 'unsafe-inline'";
	}

	const directives = [
		"default-src 'self'",
		scriptSrc,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self'",
		"connect-src 'self' https://identity.oraclecloud.com https://*.identity.oraclecloud.com",
		"frame-src 'none'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
		...(dev ? [] : ['upgrade-insecure-requests'])
	];

	return directives.join('; ');
}

/**
 * Security headers applied to all responses
 */
function addSecurityHeaders(response: Response, nonce?: string): Response {
	const headers = new Headers(response.headers);

	headers.set('Content-Security-Policy', getCSPHeader(nonce));
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('X-Frame-Options', 'DENY');
	headers.set('X-XSS-Protection', '0');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	headers.set(
		'Permissions-Policy',
		'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
	);
	headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	headers.set('Cross-Origin-Resource-Policy', 'same-origin');

	if (!dev) {
		headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

/**
 * Add rate limit headers to response
 */
function addRateLimitHeaders(
	headers: Headers,
	endpoint: string,
	remaining: number,
	resetAt: number
): void {
	const limit = RATE_LIMIT_CONFIG.maxRequests[endpoint] ?? RATE_LIMIT_CONFIG.maxRequests.api ?? 60;
	headers.set('X-RateLimit-Limit', String(limit));
	headers.set('X-RateLimit-Remaining', String(remaining));
	headers.set('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
}

/**
 * Log an HTTP request with method, path, status, duration, and user context.
 * Skips noisy health-check endpoints.
 */
function logRequest(
	method: string,
	path: string,
	status: number,
	durationMs: number,
	requestId: string,
	userId?: string
): void {
	// Record HTTP request duration metric (always, even for exempt paths)
	const route = path.split('?')[0]; // strip query params
	httpRequestDuration.observe({ method, route, status: String(status) }, durationMs / 1000);

	if (LOG_EXEMPT_PATHS.some((p) => path.startsWith(p))) return;

	const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
	log[level](
		{ method, path, status, durationMs: Math.round(durationMs), requestId, userId },
		`${method} ${path} ${status} ${Math.round(durationMs)}ms`
	);
}

export const handle: Handle = async ({ event, resolve }) => {
	const startTime = performance.now();

	// ── CSP nonce (production only) ────────────────────────────────────────
	const cspNonce = dev ? undefined : crypto.randomUUID();

	// ── Request tracing ──────────────────────────────────────────────────────
	const incomingId = event.request.headers.get(REQUEST_ID_HEADER);
	const requestId = incomingId || generateRequestId();
	event.locals.requestId = requestId;

	// ── Fastify proxy (Phase 9.16) ──────────────────────────────────────────
	if (shouldProxyToFastify(event.url.pathname)) {
		const proxyResponse = await proxyToFastify(event.request, event.url.pathname);
		proxyResponse.headers.set(REQUEST_ID_HEADER, requestId);
		logRequest(
			event.request.method,
			event.url.pathname,
			proxyResponse.status,
			performance.now() - startTime,
			requestId
		);
		return proxyResponse;
	}

	// Make DB status available to all routes
	const isDbReady = await ensureDatabase();
	event.locals.dbAvailable = isDbReady;

	// Initialize default permissions (empty array — no access)
	event.locals.permissions = [];

	const { url } = event;

	// ── CORS preflight for /api/v1/* ─────────────────────────────────────────
	// Respond to OPTIONS before auth — browsers don't send credentials on preflight.
	if (url.pathname.startsWith(V1_API_PREFIX) && event.request.method === 'OPTIONS') {
		const origin = event.request.headers.get('origin');
		const allowedOrigin = getCorsOrigin(origin);
		if (allowedOrigin) {
			const preflightHeaders = new Headers();
			addCorsHeaders(preflightHeaders, allowedOrigin);
			preflightHeaders.set(REQUEST_ID_HEADER, requestId);
			logRequest('OPTIONS', url.pathname, 204, performance.now() - startTime, requestId);
			return new Response(null, { status: 204, headers: preflightHeaders });
		}
		// No matching origin — fall through to normal handling (returns no CORS headers)
	}

	// ── Auth guard ───────────────────────────────────────────────────────────
	const isPublic = PUBLIC_PATHS.some((p) => url.pathname.startsWith(p));

	if (!isPublic) {
		// ── API key authentication (checked before session auth) ───────────────
		// Supports both `Authorization: Bearer portal_...` and `X-API-Key: portal_...`
		const authHeader = event.request.headers.get('authorization');
		const apiKeyHeader = event.request.headers.get('x-api-key');
		const apiKeyCandidate = authHeader?.startsWith('Bearer portal_')
			? authHeader.slice(7)
			: apiKeyHeader?.startsWith('portal_')
				? apiKeyHeader
				: undefined;

		let apiKeyAuthenticated = false;

		if (apiKeyCandidate) {
			const ctx = await validateApiKey(apiKeyCandidate);
			if (ctx) {
				event.locals.apiKeyContext = ctx;
				event.locals.permissions = ctx.permissions as Permission[];
				apiKeyAuthenticated = true;
				log.debug(
					{ keyId: ctx.keyId, orgId: ctx.orgId, path: url.pathname },
					'API key authenticated'
				);
			} else {
				// API key was provided but is invalid — reject immediately
				const authResp = errorResponse(new AuthError('Invalid API key'), requestId);
				logRequest(
					event.request.method,
					url.pathname,
					401,
					performance.now() - startTime,
					requestId
				);
				return withV1Cors(authResp, event);
			}
		}

		// ── Session authentication (skipped if API key was valid) ──────────────
		if (!apiKeyAuthenticated) {
			try {
				const session = await auth.api.getSession({ headers: event.request.headers });

				if (session) {
					event.locals.user = session.user;
					event.locals.session = session.session;

					// Resolve permissions from org role (gracefully degrade if DB is down)
					if (isDbReady) {
						const activeOrgId = (session.session as Record<string, unknown>)
							.activeOrganizationId as string | undefined;
						const orgRole = await getOrgRole(session.user.id, activeOrgId);
						event.locals.permissions = getPermissionsForRole(orgRole ?? 'viewer');
					} else {
						event.locals.permissions = getPermissionsForRole('viewer');
					}
				} else {
					// No session — enforce auth on protected routes
					if (url.pathname.startsWith('/api/')) {
						const authResp = errorResponse(new AuthError('Authentication required'), requestId);
						logRequest(
							event.request.method,
							url.pathname,
							401,
							performance.now() - startTime,
							requestId
						);
						return withV1Cors(authResp, event);
					}
					// Page routes: redirect to login
					throw redirect(303, '/login');
				}
			} catch (err) {
				// Re-throw SvelteKit redirects
				if (err && typeof err === 'object' && 'status' in err && 'location' in err) {
					throw err;
				}
				log.error({ err, path: url.pathname }, 'auth guard error');
				if (err instanceof Error) captureError(err, { path: url.pathname, phase: 'auth-guard' });
				// Never grant permissions on auth failure
				if (url.pathname.startsWith('/api/')) {
					const svcResp = errorResponse(
						new PortalError('AUTH_SERVICE_UNAVAILABLE', 'Authentication service unavailable', 503, {
							service: 'auth'
						}),
						requestId
					);
					logRequest(
						event.request.method,
						url.pathname,
						503,
						performance.now() - startTime,
						requestId
					);
					return withV1Cors(svcResp, event);
				}
				throw redirect(303, '/login');
			}
		}
	}

	// Apply rate limiting to API routes (except exempt paths)
	if (url.pathname.startsWith('/api/') && !RATE_LIMIT_EXEMPT_PATHS.includes(url.pathname)) {
		const clientId = getClientId(event);
		const endpoint = url.pathname.startsWith('/api/chat') ? 'chat' : 'api';
		const rateLimitResult = await checkRateLimit(clientId, endpoint);

		if (rateLimitResult === null) {
			const limit =
				RATE_LIMIT_CONFIG.maxRequests[endpoint] ?? RATE_LIMIT_CONFIG.maxRequests.api ?? 60;
			const resetAt = Date.now() + RATE_LIMIT_CONFIG.windowMs;
			const retryAfter = Math.ceil(RATE_LIMIT_CONFIG.windowMs / 1000);

			const err = new RateLimitError('Rate limit exceeded. Please try again later.', {
				limit,
				windowMs: RATE_LIMIT_CONFIG.windowMs,
				retryAfter,
				clientId,
				endpoint
			});
			log.warn({ err, clientId, endpoint, retryAfter, requestId }, 'rate limit exceeded');

			const rateLimitResponse = errorResponse(err, requestId);
			rateLimitResponse.headers.set('Retry-After', String(retryAfter));
			rateLimitResponse.headers.set('X-RateLimit-Limit', String(limit));
			rateLimitResponse.headers.set('X-RateLimit-Remaining', '0');
			rateLimitResponse.headers.set('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
			logRequest(
				event.request.method,
				url.pathname,
				429,
				performance.now() - startTime,
				requestId,
				event.locals.user?.id
			);
			return withV1Cors(rateLimitResponse, event);
		}

		const response = await resolve(event);
		const headers = new Headers(response.headers);
		addRateLimitHeaders(headers, endpoint, rateLimitResult.remaining, rateLimitResult.resetAt);
		headers.set(REQUEST_ID_HEADER, requestId);

		const securedApiResponse = addSecurityHeaders(
			new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers
			}),
			cspNonce
		);

		logRequest(
			event.request.method,
			url.pathname,
			response.status,
			performance.now() - startTime,
			requestId,
			event.locals.user?.id
		);
		return withV1Cors(securedApiResponse, event);
	}

	// For page responses, inject nonce into inline script tags via transformPageChunk
	const response = await resolve(event, {
		transformPageChunk: cspNonce
			? ({ html }) => html.replace(/<script(?=[\s>])/g, `<script nonce="${cspNonce}"`)
			: undefined
	});
	const secureResponse = addSecurityHeaders(response, cspNonce);
	secureResponse.headers.set(REQUEST_ID_HEADER, requestId);
	logRequest(
		event.request.method,
		url.pathname,
		response.status,
		performance.now() - startTime,
		requestId,
		event.locals.user?.id
	);
	return secureResponse;
};

// ── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
	log.info('SIGTERM received, closing resources');
	await closeSentry();
	await closePool();
	process.exit(0);
});

process.on('SIGINT', async () => {
	log.info('SIGINT received, closing resources');
	await closeSentry();
	await closePool();
	process.exit(0);
});
