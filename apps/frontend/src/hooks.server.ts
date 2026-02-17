import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import crypto from 'crypto';
import { createLogger } from '@portal/server/logger';
import { initPool, closePool } from '@portal/server/oracle/connection';
import { runMigrations } from '@portal/server/oracle/migrations';
import { webhookRepository } from '@portal/server/oracle/repositories/webhook-repository';
import { generateRequestId, REQUEST_ID_HEADER } from '@portal/server/tracing';
import { httpRequestDuration } from '@portal/server/metrics';
import { initSentry, captureError, closeSentry } from '@portal/server/sentry';

const log = createLogger('hooks');

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

// Paths exempt from request logging (noisy health checks and Prometheus scrapes)
const LOG_EXEMPT_PATHS = ['/api/health', '/api/healthz', '/api/metrics'];

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
 * Security headers applied to all page responses.
 * API responses get equivalent headers from Fastify's helmet plugin.
 */
function addSecurityHeaders(response: Response, nonce?: string): Response {
	const headers = new Headers(response.headers);

	headers.set('Content-Security-Policy', getCSPHeader(nonce));
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('X-Frame-Options', 'DENY'); // nosemgrep: x-frame-options-misconfiguration — hardcoded DENY, not user-controlled
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
 * Log an HTTP request with method, path, status, duration, and user context.
 * Skips noisy health-check endpoints.
 */
function logRequest(
	method: string,
	path: string,
	status: number,
	durationMs: number,
	requestId: string
): void {
	// Record HTTP request duration metric (always, even for exempt paths)
	const route = path.split('?')[0]; // strip query params
	httpRequestDuration.observe({ method, route, status: String(status) }, durationMs / 1000);

	if (LOG_EXEMPT_PATHS.some((p) => path.startsWith(p))) return;

	const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
	log[level](
		{ method, path, status, durationMs: Math.round(durationMs), requestId },
		`${method} ${path} ${status} ${Math.round(durationMs)}ms`
	);
}

// ── Note: CORS and rate limiting for /api/* are handled exclusively by Fastify ──
// - CORS:         @fastify/cors plugin (apps/api/src/app.ts)
// - Rate limiting: rateLimiterOraclePlugin (apps/api/src/plugins/rate-limiter-oracle.ts)
// - Nginx routes /api/* directly to Fastify (port 3001), bypassing SvelteKit entirely.
export const handle: Handle = async ({ event, resolve }) => {
	const startTime = performance.now();

	// ── CSP nonce (production only) ────────────────────────────────────────
	const cspNonce = dev ? undefined : crypto.randomUUID();

	// ── Request tracing ──────────────────────────────────────────────────────
	const incomingId = event.request.headers.get(REQUEST_ID_HEADER);
	const requestId = incomingId || generateRequestId();
	event.locals.requestId = requestId;

	// Make DB status available to all SSR page routes
	const isDbReady = await ensureDatabase();
	event.locals.dbAvailable = isDbReady;

	// ── Page response: inject nonce into inline script tags via transformPageChunk
	const response = await resolve(event, {
		transformPageChunk: cspNonce
			? ({ html }) => html.replace(/<script(?=[\s>])/g, `<script nonce="${cspNonce}"`)
			: undefined
	});
	const secureResponse = addSecurityHeaders(response, cspNonce);
	secureResponse.headers.set(REQUEST_ID_HEADER, requestId);
	logRequest(
		event.request.method,
		event.url.pathname,
		response.status,
		performance.now() - startTime,
		requestId
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
