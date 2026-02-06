import type { Handle, RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { createLogger } from '$lib/server/logger.js';
import { initPool, closePool } from '$lib/server/oracle/connection.js';
import { runMigrations } from '$lib/server/oracle/migrations.js';
import { auth } from '$lib/server/auth/config.js';
import { getPermissionsForRole } from '$lib/server/auth/rbac.js';
import { getOrgRole } from '$lib/server/auth/tenancy.js';
import { checkRateLimit, RATE_LIMIT_CONFIG } from '$lib/server/rate-limiter.js';
import { generateRequestId, REQUEST_ID_HEADER } from '$lib/server/tracing.js';

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

	try {
		await initPool();
		await runMigrations();
		dbAvailable = true;
		log.info('Oracle database initialized');
	} catch (err) {
		log.error({ err }, 'Failed to initialize Oracle database - running in degraded mode');
		dbAvailable = false;
	}

	return dbAvailable;
}

// Paths exempt from rate limiting (health checks, etc.)
const RATE_LIMIT_EXEMPT_PATHS = ['/api/health', '/api/healthz'];

// ── Auth guard ─────────────────────────────────────────────────────────────
// Public paths that skip authentication entirely
const PUBLIC_PATHS = ['/api/health', '/api/healthz', '/api/auth/', '/login'];

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
 * Content Security Policy configuration
 */
function getCSPHeader(): string {
  const directives = [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://identity.oraclecloud.com https://*.identity.oraclecloud.com",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ];

  return directives.join('; ');
}

/**
 * Security headers applied to all responses
 */
function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  headers.set('Content-Security-Policy', getCSPHeader());
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
    headers,
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

export const handle: Handle = async ({ event, resolve }) => {
  // ── Request tracing ──────────────────────────────────────────────────────
  const incomingId = event.request.headers.get(REQUEST_ID_HEADER);
  const requestId = incomingId || generateRequestId();
  event.locals.requestId = requestId;

  // Make DB status available to all routes
  const isDbReady = await ensureDatabase();
  event.locals.dbAvailable = isDbReady;

  // Initialize default permissions (empty array — no access)
  event.locals.permissions = [];

  const { url } = event;

  // ── Auth guard ───────────────────────────────────────────────────────────
  const isPublic = PUBLIC_PATHS.some((p) => url.pathname.startsWith(p));

  if (!isPublic) {
    try {
      const session = await auth.api.getSession({ headers: event.request.headers });

      if (session) {
        event.locals.user = session.user;
        event.locals.session = session.session;

        // Resolve permissions from org role (gracefully degrade if DB is down)
        if (isDbReady) {
          const activeOrgId = (session.session as Record<string, unknown>).activeOrganizationId as string | undefined;
          const orgRole = await getOrgRole(session.user.id, activeOrgId);
          event.locals.permissions = getPermissionsForRole(orgRole ?? 'viewer');
        } else {
          event.locals.permissions = getPermissionsForRole('viewer');
        }
      } else {
        // No session — enforce auth on protected routes
        if (url.pathname.startsWith('/api/')) {
          return new Response(JSON.stringify({ error: 'Authentication required' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
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
      // Never grant permissions on auth failure
      if (url.pathname.startsWith('/api/')) {
        return new Response(JSON.stringify({ error: 'Authentication service unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', [REQUEST_ID_HEADER]: requestId },
        });
      }
      throw redirect(303, '/login');
    }
  }

  // Apply rate limiting to API routes (except exempt paths)
  if (url.pathname.startsWith('/api/') && !RATE_LIMIT_EXEMPT_PATHS.includes(url.pathname)) {
    const clientId = getClientId(event);
    const endpoint = url.pathname.startsWith('/api/chat') ? 'chat' : 'api';
    const rateLimitResult = await checkRateLimit(clientId, endpoint);

    if (rateLimitResult === null) {
      const limit = RATE_LIMIT_CONFIG.maxRequests[endpoint] ?? RATE_LIMIT_CONFIG.maxRequests.api ?? 60;
      const resetAt = Date.now() + RATE_LIMIT_CONFIG.windowMs;
      const retryAfter = Math.ceil(RATE_LIMIT_CONFIG.windowMs / 1000);

      log.warn({ clientId, endpoint, retryAfter, requestId }, 'rate limit exceeded');

      return new Response(
        JSON.stringify({
          error: 'Too many requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
            [REQUEST_ID_HEADER]: requestId,
          },
        }
      );
    }

    const response = await resolve(event);
    const headers = new Headers(response.headers);
    addRateLimitHeaders(headers, endpoint, rateLimitResult.remaining, rateLimitResult.resetAt);
    headers.set(REQUEST_ID_HEADER, requestId);

    return addSecurityHeaders(
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    );
  }

  const response = await resolve(event);
  const secureResponse = addSecurityHeaders(response);
  secureResponse.headers.set(REQUEST_ID_HEADER, requestId);
  return secureResponse;
};

// ── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  log.info('SIGTERM received, closing database pool');
  await closePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  log.info('SIGINT received, closing database pool');
  await closePool();
  process.exit(0);
});
