# Phase 9: Fastify Backend Cutover Guide

Operator guide for enabling the Fastify 5 backend via the SvelteKit feature-flag proxy.

## Prerequisites

Before enabling the proxy, verify:

1. **Fastify is running and healthy**:

   ```bash
   curl -f http://localhost:3001/healthz   # Should return "ok"
   curl -f http://localhost:3001/health     # Should return JSON with subsystem status
   ```

2. **Docker Compose stack is up** (if using Docker):

   ```bash
   cd infrastructure/docker/phase9
   docker compose up -d
   docker compose ps  # All services should be "healthy"
   ```

3. **TLS configured** (production): See `infrastructure/docker/phase9/CERTIFICATES.md`

4. **Database migrations applied**: Fastify runs migrations on startup via the Oracle plugin

## Environment Variables

| Variable               | Default                 | Description                                                    |
| ---------------------- | ----------------------- | -------------------------------------------------------------- |
| `FASTIFY_ENABLED`      | `false`                 | Master switch. Set to `true` to enable proxying.               |
| `FASTIFY_URL`          | `http://localhost:3001` | Fastify backend URL. Use `http://api:3001` in Docker Compose.  |
| `FASTIFY_PROXY_ROUTES` | _(empty)_               | Comma-separated route prefixes to proxy. Empty = all `/api/*`. |

### How Routing Works

When `FASTIFY_ENABLED=true`:

1. SvelteKit receives the request
2. **Before** auth, DB init, or rate limiting, checks `shouldProxyToFastify(pathname)`
3. If match: forwards request to Fastify (method, headers, body, query string preserved)
4. If no match: falls through to normal SvelteKit handling
5. `/api/auth/*` is **never** proxied regardless of configuration

The proxy preserves `X-Request-Id` for distributed trace correlation.

## Recommended Rollout Sequence

Incremental enablement, validating at each step before proceeding.

### Step 1: Health & Metrics Only

```env
FASTIFY_ENABLED=true
FASTIFY_PROXY_ROUTES=/api/health,/api/healthz,/api/metrics
```

**Validate**: Health endpoints return identical responses. Prometheus scraping still works.

### Step 2: Read-Only Routes

```env
FASTIFY_PROXY_ROUTES=/api/health,/api/healthz,/api/metrics,/api/sessions,/api/activity
```

**Validate**: Session listing and activity feed work. Check auth passes through correctly.

### Step 3: Write Routes

```env
FASTIFY_PROXY_ROUTES=/api/health,/api/healthz,/api/metrics,/api/sessions,/api/activity,/api/tools,/api/chat
```

**Validate**: Tool execution, approval workflows, and AI chat streaming all function. Pay attention to SSE streaming latency on `/api/chat`.

### Step 4: Versioned API

```env
FASTIFY_PROXY_ROUTES=/api/health,/api/healthz,/api/metrics,/api/sessions,/api/activity,/api/tools,/api/chat,/api/v1/
```

**Validate**: Workflow CRUD, semantic search, MCP endpoints, and OpenAPI spec all work via Fastify.

### Step 5: Full Proxy

```env
FASTIFY_ENABLED=true
FASTIFY_PROXY_ROUTES=
```

Empty `FASTIFY_PROXY_ROUTES` proxies **all** `/api/*` routes (except `/api/auth/*`).

**Validate**: Full application functionality. Run the test suite against the proxied backend.

## Monitoring During Rollout

Watch these signals at each step:

| Metric               | Where                                      | Alert Threshold          |
| -------------------- | ------------------------------------------ | ------------------------ |
| 502 error rate       | SvelteKit logs (`Backend unavailable`)     | Any 502 = Fastify down   |
| Response latency P99 | Prometheus `http_request_duration_seconds` | >2x baseline             |
| Error rate by status | Fastify logs                               | 5xx rate > 1%            |
| Auth failures        | Both SvelteKit + Fastify logs              | Unexpected 401/403 spike |

**SvelteKit logs** the proxied request with method, path, status, and duration — use these to compare against pre-proxy baselines.

## Rollback

Instant rollback, no restart required:

```env
FASTIFY_ENABLED=false
```

SvelteKit will immediately stop proxying and handle all requests itself. The feature flag is evaluated per-request with no caching.

For Docker Compose, update `.env` and the running containers will pick up the change on next request (no restart needed since env vars are read at module load time — a SvelteKit restart is needed if the process is long-lived).

## Route Parity Matrix

Routes available in Fastify vs SvelteKit-only:

| Route                      | Fastify | SvelteKit | Notes                                         |
| -------------------------- | ------- | --------- | --------------------------------------------- |
| `/healthz`, `/health`      | Yes     | Yes       | Liveness + deep health check                  |
| `/api/metrics`             | Yes     | Yes       | Prometheus metrics                            |
| `POST /api/chat`           | Yes     | Yes       | SSE streaming chat                            |
| `/api/sessions` (CRUD)     | Yes     | Yes       | Session list, create, delete                  |
| `/api/activity`            | Yes     | Yes       | Activity feed                                 |
| `/api/tools/execute`       | Yes     | Yes       | Tool execution + approval check               |
| `/api/tools/approve`       | Yes     | Yes       | Approval workflow                             |
| `/api/v1/workflows` (CRUD) | Yes     | Yes       | Full workflow lifecycle                       |
| `/api/v1/search`           | Yes     | Yes       | Semantic vector search                        |
| `/api/mcp/*`               | Yes     | Yes       | MCP tools + resources                         |
| `/api/v1/openapi.json`     | Yes     | Yes       | OpenAPI 3.0 spec                              |
| `/api/auth/[...all]`       | **No**  | Yes       | Better Auth OIDC — **must stay in SvelteKit** |
| `/api/setup/*`             | **No**  | Yes       | Admin setup wizard (IDP, AI, settings)        |
| `/api/models`              | **No**  | Yes       | AI model listing                              |
| `/api/v1/webhooks`         | **No**  | Yes       | Webhook management                            |
| `/api/v1/graph`            | **No**  | Yes       | Graph visualization data                      |
| `/api/v1/audit/verify`     | **No**  | Yes       | Audit trail verification                      |
| `/api/workflows` (legacy)  | **No**  | Yes       | **Deprecated** — use `/api/v1/workflows`      |

### Routes That Stay in SvelteKit

- **`/api/auth/*`**: Better Auth OIDC callbacks require SvelteKit's cookie handling. These are explicitly excluded from proxying.
- **`/api/setup/*`**: Admin onboarding wizard. Low traffic, tightly coupled to SvelteKit page routes.
- **Legacy `/api/workflows`**: Deprecated with `Sunset: Sat, 30 May 2026` headers. Use `/api/v1/workflows` instead.

## Known Limitations

1. **No setup/admin routes in Fastify**: `/api/setup/*`, `/api/models` remain SvelteKit-only. These handle initial portal configuration and are rarely called after setup.

2. **Auth always in SvelteKit**: Better Auth's OIDC callback flow depends on SvelteKit's cookie middleware. Proxying auth routes would break SSO.

3. **Double middleware on non-proxied routes**: When proxy is enabled, non-proxied `/api/*` routes still go through SvelteKit's full middleware stack (auth, rate limiting, security headers).

4. **Proxy adds latency**: Each proxied request adds one internal HTTP hop (~1-5ms). For SSE streaming (`/api/chat`), this is negligible.
