# Phase 9.15–9.20: Feature Flag Proxy & Migration Cutover

**Status**: Planning
**Date**: 2026-02-09
**Branch**: `main` (all work on main, no feature branch needed — incremental additions)

## Context

Phases 9.1–9.14 built the Fastify 5 backend with full parity on core APIs (health, sessions, chat, activity, tools, workflows, search, MCP). Docker deployment, CI/CD, and OpenAPI/Swagger are also done.

**What's missing**: The plumbing to actually _use_ Fastify in production — the feature-flag proxy that lets SvelteKit forward requests to Fastify, integration tests proving it works, and operator documentation for cutover.

## Sub-Phase Summary

| Phase | Title                               | Depends On       | Assignee         |
| ----- | ----------------------------------- | ---------------- | ---------------- |
| 9.15  | Feature Flag Module                 | —                | proxy-engineer   |
| 9.16  | Proxy Middleware in hooks.server.ts | 9.15             | proxy-engineer   |
| 9.17  | Proxy Integration Tests             | 9.16             | test-engineer    |
| 9.18  | Fastify OpenAPI JSON Route          | —                | openapi-engineer |
| 9.19  | Legacy Route Deprecation Headers    | 9.16             | proxy-engineer   |
| 9.20  | Cutover Documentation               | 9.17, 9.18, 9.19 | team-lead        |

---

## 9.15 — Feature Flag Module

**File**: `apps/frontend/src/lib/server/feature-flags.ts`

Create the module that the existing test file (`apps/frontend/src/tests/phase9/feature-flags.test.ts`) imports from. The test specifies the exact API contract:

### Exports

```typescript
// Environment-driven configuration
export const FASTIFY_URL: string; // default: 'http://localhost:3001'
export const FASTIFY_PROXY_ROUTES: string[]; // parsed from comma-separated env var

// Route matching
export function shouldProxyToFastify(pathname: string): boolean;

// Proxy execution
export function proxyToFastify(request: Request, pathname: string): Promise<Response>;
```

### Behavior (from tests)

1. `FASTIFY_ENABLED=false` (default) → `shouldProxyToFastify()` returns `false` for all paths
2. `FASTIFY_ENABLED=true` + empty `FASTIFY_PROXY_ROUTES` → proxy all `/api/*` except `/api/auth/*`
3. `FASTIFY_ENABLED=true` + specific routes → only proxy listed prefixes; `/api/auth/*` always excluded
4. `FASTIFY_PROXY_ROUTES` parsing: comma-separated, trim whitespace, filter blanks
5. `proxyToFastify()`: Forward request to `FASTIFY_URL + pathname + querystring`, return 502 JSON on failure
6. Forward `X-Request-Id` header for trace correlation

### Acceptance

- All 12 tests in `feature-flags.test.ts` pass
- No changes to existing tests

---

## 9.16 — Proxy Middleware in hooks.server.ts

**File**: `apps/frontend/src/hooks.server.ts`

Wire the feature flag module into the SvelteKit request pipeline.

### Insertion Point

After request tracing (line ~244), **before** `ensureDatabase()` and auth guard:

```typescript
// ── Fastify proxy (Phase 9.16) ──────────────────────────────────────────
import { shouldProxyToFastify, proxyToFastify } from '$lib/server/feature-flags.js';

// Inside handle():
// After requestId assignment, before ensureDatabase()
if (shouldProxyToFastify(url.pathname)) {
	const proxyResponse = await proxyToFastify(event.request, url.pathname);
	proxyResponse.headers.set(REQUEST_ID_HEADER, requestId);
	logRequest(
		event.request.method,
		url.pathname,
		proxyResponse.status,
		performance.now() - startTime,
		requestId
	);
	return proxyResponse;
}
```

### Key Design Decisions

1. **Before auth**: Fastify handles its own auth — don't double-authenticate
2. **Before DB init**: Proxied requests don't need SvelteKit's Oracle connection
3. **Preserve requestId**: Forward and set on response for trace correlation
4. **Log the proxy**: Appears in SvelteKit logs as a forwarded request
5. **No security headers added**: Fastify's helmet plugin handles those

### Acceptance

- With `FASTIFY_ENABLED=false`: zero behavior change (all existing tests pass)
- With `FASTIFY_ENABLED=true` + Fastify running: health/sessions/chat proxied successfully
- `/api/auth/*` never proxied regardless of config
- 502 returned when Fastify is unreachable

---

## 9.17 — Proxy Integration Tests

**File**: `apps/frontend/src/tests/phase9/proxy-integration.test.ts`

Test that the hooks.server.ts proxy middleware works end-to-end.

### Test Cases

1. **Proxy disabled**: `FASTIFY_ENABLED=false` — requests go to SvelteKit routes normally
2. **Proxy enabled, Fastify down**: Returns 502 JSON with `{"error": "Backend unavailable"}`
3. **Auth exclusion**: `/api/auth/callback/oci-iam` never proxied even when enabled
4. **Header forwarding**: `X-Request-Id`, `Cookie`, `Authorization` headers forwarded
5. **Query string preservation**: `/api/sessions?limit=10` → Fastify gets same query
6. **SSE streaming**: `/api/chat` proxy preserves streaming response (doesn't buffer)
7. **Error propagation**: Fastify 4xx/5xx responses passed through unchanged

### Approach

Use Vitest with mocked `fetch` (no real Fastify needed) to test the proxy logic in isolation.

---

## 9.18 — Fastify OpenAPI JSON Route

**File**: `apps/api/src/routes/openapi.ts`

Add a `/api/v1/openapi.json` route to Fastify that serves the auto-generated OpenAPI spec from `@fastify/swagger` (already registered in `app.ts`).

### Implementation

```typescript
const openApiRoute: FastifyPluginAsync = async (fastify) => {
	fastify.get(
		'/api/v1/openapi.json',
		{
			schema: { hide: true } // Don't include this route in the spec itself
		},
		async (request, reply) => {
			const spec = fastify.swagger();
			reply.header('Cache-Control', 'public, max-age=3600');
			return spec;
		}
	);
};
```

### Acceptance

- `GET /api/v1/openapi.json` returns valid OpenAPI 3.x JSON
- Includes all registered Fastify routes with their Zod schemas
- Public endpoint (in `PUBLIC_ROUTES` set)
- Matches SvelteKit's cache behavior (`max-age=3600`)

---

## 9.19 — Legacy Route Deprecation Headers

Add `Sunset` and `Deprecation` headers to SvelteKit's non-versioned workflow routes, nudging consumers toward the `/api/v1/` equivalents.

### Affected Routes

| Legacy Route                  | v1 Equivalent                    |
| ----------------------------- | -------------------------------- |
| `GET /api/workflows`          | `GET /api/v1/workflows`          |
| `POST /api/workflows`         | `POST /api/v1/workflows`         |
| `GET /api/workflows/:id`      | `GET /api/v1/workflows/:id`      |
| `POST /api/workflows/:id/run` | `POST /api/v1/workflows/:id/run` |

### Headers Added

```
Deprecation: true
Sunset: Sat, 30 May 2026 00:00:00 GMT
Link: </api/v1/workflows>; rel="successor-version"
```

### Implementation

Create a shared helper in `apps/frontend/src/lib/server/deprecation.ts`:

```typescript
export function addDeprecationHeaders(
	headers: Headers,
	successorPath: string,
	sunsetDate?: string
): void {
	headers.set('Deprecation', 'true');
	headers.set('Sunset', sunsetDate ?? 'Sat, 30 May 2026 00:00:00 GMT');
	headers.set('Link', `<${successorPath}>; rel="successor-version"`);
}
```

Apply in each legacy workflow `+server.ts` file.

---

## 9.20 — Cutover Documentation

**File**: `docs/PHASE9_CUTOVER.md`

Operator guide for enabling the Fastify backend in production.

### Sections

1. **Prerequisites**: Docker Compose stack running, TLS configured, Fastify healthy
2. **Environment Variables Reference**:
   - `FASTIFY_ENABLED` — master switch (default: `false`)
   - `FASTIFY_URL` — Fastify backend URL (default: `http://localhost:3001`)
   - `FASTIFY_PROXY_ROUTES` — comma-separated route prefixes to proxy
3. **Recommended Rollout Sequence**:
   - Step 1: Enable health only (`/api/health,/api/healthz,/api/metrics`)
   - Step 2: Add read-only routes (`/api/sessions,/api/activity`)
   - Step 3: Add write routes (`/api/tools,/api/chat`)
   - Step 4: Add v1 API (`/api/v1/`)
   - Step 5: Full proxy (empty `FASTIFY_PROXY_ROUTES` = all `/api/*`)
4. **Monitoring**: What to watch during rollout (502 rate, latency P99, error rates)
5. **Rollback**: Set `FASTIFY_ENABLED=false` — instant, no restart needed
6. **Known Limitations**: `/api/auth/*` always stays in SvelteKit; setup/admin routes not yet in Fastify
