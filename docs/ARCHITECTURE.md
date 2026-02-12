# Phase 9 Architecture: Fastify Backend Migration

## Overview

Phase 9 migrates the OCI Self-Service Portal from a monolithic SvelteKit application to a **monorepo** with a dedicated Fastify 5 backend. The migration follows a **shared-first extraction** strategy: business logic moves to `packages/shared`, then both `apps/frontend` (SvelteKit) and `apps/api` (Fastify) import from the shared package.

## Monorepo Structure

```
oci-self-service-portal/
├── apps/
│   ├── api/                    # Fastify 5 backend
│   │   └── src/
│   │       ├── app.ts          # Factory: createApp(), startServer(), stopServer()
│   │       ├── server.ts       # Entry point (creates app + listens)
│   │       ├── config.ts       # Centralized env config with Zod validation
│   │       ├── plugins/        # Fastify plugins (fp-wrapped)
│   │       │   ├── oracle.ts   # Connection pool + migrations
│   │       │   ├── auth.ts     # Better Auth session bridge
│   │       │   ├── rbac.ts     # Permission guards + org resolution
│   │       │   ├── mastra.ts   # Mastra framework (agents, RAG, MCP)
│   │       │   ├── helmet.ts   # Security headers
│   │       │   ├── cors.ts     # CORS configuration
│   │       │   ├── rate-limit.ts       # Rate limiting
│   │       │   ├── error-handler.ts    # Global error handler
│   │       │   └── request-logger.ts   # Request logging
│   │       ├── routes/         # HTTP route registrations
│   │       │   ├── health.ts   # /healthz (liveness) + /health (deep)
│   │       │   ├── sessions.ts # CRUD for chat sessions
│   │       │   ├── activity.ts # Tool execution feed
│   │       │   ├── tools/      # Tool execution + approval workflow
│   │       │   ├── chat.ts     # AI chat streaming (POST /api/chat)
│   │       │   ├── search.ts   # Semantic search (GET /api/v1/search)
│   │       │   ├── mcp.ts      # MCP server endpoints
│   │       │   ├── workflows.ts # Workflow CRUD + execution
│   │       │   └── metrics.ts  # Prometheus /api/metrics
│   │       ├── mastra/         # Mastra framework integration
│   │       │   ├── agents/     # CloudAdvisor agent
│   │       │   ├── models/     # Provider registry, model types
│   │       │   ├── rag/        # OracleVectorStore, OCI embedder
│   │       │   ├── mcp/        # MCP server (tool discovery + execution)
│   │       │   ├── storage/    # OracleStore (MastraStorage impl)
│   │       │   ├── tools/      # 60+ OCI tool wrappers for Mastra
│   │       │   └── workflows/  # Workflow executor
│   │       ├── services/       # approvals, tools adapter, workflow-repository
│   │       └── tests/          # Integration tests
│   └── frontend/               # SvelteKit app (existing)
│       └── src/
│           ├── hooks.server.ts # Feature-flag proxy to Fastify
│           ├── lib/            # Components, tools, workflows
│           └── routes/         # SvelteKit routes + API endpoints
├── packages/
│   └── shared/                 # All business logic lives here
│       └── src/
│           ├── server/         # Auth, Oracle, errors, logger, metrics, etc.
│           └── query/          # TanStack Query helpers
└── infrastructure/
    └── docker/phase9/          # Docker Compose + nginx + certbot
```

## Design Principles

### 1. Package Boundaries

| Package           | Contains                                                                         | Rule                                                              |
| ----------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/shared` | Business logic, Oracle repositories, auth core, error hierarchy, metrics, logger | If both apps need it, it lives here                               |
| `apps/api`        | Fastify plugins + route handlers                                                 | Thin wrappers — no business logic beyond request/response mapping |
| `apps/frontend`   | SvelteKit UI + server routes                                                     | Proxies to Fastify when `FASTIFY_ENABLED=true`                    |

The key constraint: **route handlers are adapters, not implementations**. A Fastify route calls into `packages/shared` the same way a SvelteKit `+server.ts` does. Business logic is never duplicated.

### 2. Shared-First Extraction

Before writing any Fastify code, we extracted business logic from SvelteKit into `packages/shared`:

- Oracle connection pool, migrations, repositories
- Better Auth configuration
- RBAC permission definitions (`getPermissionsForRole`)
- PortalError hierarchy and `errorResponse()`
- Pino logger factory
- Prometheus metrics registry
- Approval system (`recordApproval`, `consumeApproval`, `pendingApprovals`)
- Audit logging (`logToolExecution`, `logToolApproval`)

This ensures zero drift between the two API surfaces.

### 3. Feature-Flag Migration

The migration uses `FASTIFY_ENABLED` for gradual rollout:

```
Browser → SvelteKit hooks.server.ts
           ├── FASTIFY_ENABLED=false → SvelteKit API routes (status quo)
           └── FASTIFY_ENABLED=true  → fetch() proxy → Fastify backend
               (selective: FASTIFY_PROXY_ROUTES=/api/health,/api/sessions,...)
```

- `/api/auth/*` is **never** proxied (Better Auth OIDC callbacks need SvelteKit cookie handling)
- Proxy inserts after request tracing, before SvelteKit auth/DB init
- `X-Request-Id` header forwarded for distributed trace correlation
- Returns `{"error": "Backend unavailable"}` if Fastify is unreachable (502 fallback)

## Plugin Architecture

Fastify plugins are registered in strict dependency order (see `app.ts`):

```
error-handler → helmet → CORS → rate-limit → cookie → sensible
  → oracle → auth → rbac → mastra → swagger (optional) → routes
```

### Oracle Plugin (`plugins/oracle.ts`)

**Responsibility**: Initialize the Oracle connection pool, run migrations, decorate the Fastify instance.

```typescript
// Decorations:
fastify.oracle.withConnection(fn); // Borrow connection, auto-release
fastify.oracle.getPoolStats(); // Pool health stats
fastify.oracle.isAvailable(); // Boolean availability check
request.dbAvailable; // Per-request flag (set via onRequest hook)
```

- **Fallback-tolerant**: If Oracle is unreachable, `available = false` and routes degrade gracefully
- **Lifecycle**: `onClose` hook closes the pool on server shutdown
- **Migrations**: Run on startup unless `SKIP_MIGRATIONS=true`
- Wraps `initPool()`, `closePool()`, `withConnection()` from `packages/shared`

### Auth Plugin (`plugins/auth.ts`)

**Responsibility**: Resolve the authenticated user and session on every request.

```typescript
// Decorations:
request.user; // User | null
request.session; // Session | null
request.permissions; // string[] (from role-based lookup)
request.apiKeyContext; // ApiKeyContext | null
```

- **Better Auth bridge**: `toWebRequest(request)` converts Fastify's `request.headers` into a `Web API Request` so Better Auth's `auth.api.getSession()` can extract the cookie
- **Permissions resolution**: Maps `session.role` → permissions via `getPermissionsForRole(role ?? 'viewer')`
- **Excluded paths**: `/healthz`, `/health`, `/api/metrics` skip session resolution
- **Fail-open**: Auth errors are logged but don't block the request — individual routes guard themselves via RBAC

### RBAC Guards (`plugins/rbac.ts`)

**Responsibility**: Provide `preHandler` hook factories for route-level authorization.

Not a traditional plugin (registers no decorators). Exports standalone functions:

| Function                  | Purpose                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| `requireAuth(permission)` | Checks session permissions OR API key permissions. Returns 401/403.        |
| `requireAuthenticated()`  | Checks that _some_ auth exists (no permission check).                      |
| `resolveOrgId(request)`   | Extracts org from `apiKeyContext.orgId` or `session.activeOrganizationId`. |

**Dual auth flow** in `requireAuth`:

1. Check `request.user` + `request.permissions` (session auth)
2. Check `request.apiKeyContext` (if already resolved by auth plugin)
3. Try extracting `portal_` prefixed key from `Authorization: Bearer` or `X-API-Key` header
4. Fall through to 401

`admin:all` permission bypasses all specific permission checks.

## Route Design

All routes follow a consistent pattern:

```typescript
app.get(
	'/api/resource',
	{
		preHandler: requireAuth('resource:read'), // RBAC guard
		schema: { querystring: ZodSchema } // Zod validation
	},
	async (request, reply) => {
		if (!request.dbAvailable) {
			/* graceful fallback */
		}
		// Call into packages/shared
		// Return structured response
	}
);
```

### Route Inventory

| Route                | Method | Auth              | Description                                        |
| -------------------- | ------ | ----------------- | -------------------------------------------------- |
| `/healthz`           | GET    | None              | Liveness probe (plain text "ok")                   |
| `/health`            | GET    | None              | Deep health check (3s timeout, subsystem statuses) |
| `/api/metrics`       | GET    | None              | Prometheus text format metrics                     |
| `/api/sessions`      | GET    | `sessions:read`   | List enriched sessions (with message count)        |
| `/api/sessions`      | POST   | `sessions:write`  | Create new chat session                            |
| `/api/sessions/:id`  | DELETE | `sessions:write`  | Delete session (user-scoped)                       |
| `/api/activity`      | GET    | `tools:read`      | Recent tool execution feed                         |
| `/api/tools/execute` | GET    | `tools:execute`   | Approval requirements for a tool                   |
| `/api/tools/execute` | POST   | `tools:execute`   | Execute a tool (checks approval)                   |
| `/api/tools/approve` | GET    | `tools:approve`   | List pending approvals (org-scoped)                |
| `/api/tools/approve` | POST   | `tools:approve`   | Approve/reject a tool execution                    |
| `/api/chat`          | POST   | `sessions:write`  | AI chat streaming (SSE via `streamText`)           |
| `/api/v1/search`     | GET    | `sessions:read`   | Semantic vector search                             |
| `/api/mcp/*`         | \*     | `tools:execute`   | MCP server endpoints (tool discovery + execution)  |
| `/api/workflows`     | GET    | `workflows:read`  | List workflow definitions                          |
| `/api/workflows`     | POST   | `workflows:write` | Create workflow                                    |
| `/api/workflows/:id` | \*     | `workflows:*`     | Workflow CRUD + execution                          |
| `/api/audit`         | GET    | `admin:audit`     | Blockchain audit verification                      |
| `/api/graph`         | GET    | `admin:audit`     | Property graph analytics                           |
| `/api/webhooks`      | \*     | `admin:all`       | Webhook CRUD + delivery                            |
| `/api/models`        | \*     | `admin:all`       | AI model provider management                       |
| `/api/setup`         | \*     | Setup token       | Portal setup wizard                                |
| `/api/auth`          | \*     | None              | Better Auth session management                     |
| `/api/docs`          | GET    | `admin:all`       | OpenAPI/Swagger UI (non-production default)        |

### Database Fallback Strategy

Every route that queries Oracle checks `request.dbAvailable` first:

- **GET routes**: Return empty arrays with a `message` field (200 OK)
- **POST/DELETE**: Return 503 via `DatabaseError` + `errorResponse()`
- **Exception**: Activity route returns 500 with `{ error: "..." }` on query failure

### Approval System

The tool approval workflow prevents unauthorized execution of dangerous OCI operations:

```
1. Client calls POST /api/tools/execute with toolName requiring approval
2. Route checks consumeApproval(toolCallId, toolName, orgId)
   - If no approval exists → 403 "requires explicit approval"
3. Client first calls POST /api/tools/approve { approved: true }
   - Verifies pending approval exists AND matches caller's orgId (IDOR prevention)
   - Calls recordApproval(toolCallId, toolName, orgId) — stores in Oracle + in-memory
4. Client retries POST /api/tools/execute
   - consumeApproval() succeeds, returns true, deletes the record (single-use)
   - Tool executes
```

Org-scoping prevents cross-tenant approval manipulation.

## Security Architecture

### Request Lifecycle

```
Request → Tracing (X-Request-Id) → CORS → Helmet (CSP/HSTS) → Cookie → Rate Limit
       → Oracle (dbAvailable) → Auth (session resolution) → RBAC (preHandler)
       → Route Handler → Error Handler → Response
```

### Security Headers (via `@fastify/helmet`)

- **CSP**: `default-src 'self'`, nonce-based `script-src` in production, `unsafe-inline`/`unsafe-eval` in dev for HMR
- **HSTS**: 1 year + includeSubDomains + preload (production only)
- **Frame protection**: `X-Frame-Options: DENY` + `frame-ancestors: 'none'`
- **Additional**: `Cache-Control: no-store`, `Permissions-Policy`, `X-Robots-Tag: noindex`

### Production Fail-Fast

The app refuses to start in production without:

- `BETTER_AUTH_SECRET` — fatal error
- `CORS_ORIGIN` — fatal error (credentials:true forbids wildcard)

### CORS Configuration

```typescript
cors: {
  origin: corsOrigin,      // Explicit origin in production (never '*')
  credentials: true         // Cookies for Better Auth sessions
}
```

In development, `origin: true` reflects the request origin for local dev convenience.

## Error Handling

### Global Error Handler

```typescript
app.setErrorHandler((error, request, reply) => {
	const portalError = isPortalError(error) ? error : toPortalError(error);
	log.error({ err: portalError, requestId, method, url }, 'Request error');
	const response = errorResponse(portalError);
	reply.status(response.status).send(response);
});
```

All unknown errors are wrapped via `toPortalError()` → `INTERNAL_ERROR(500)`. This ensures:

- Consistent error response shape across all routes
- No stack traces or internal details leaked to clients
- Structured logging with request context

## Observability

| Signal  | Implementation                                         | Endpoint              |
