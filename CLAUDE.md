# OCI Self-Service Portal

## Project Overview

Enterprise SvelteKit + Fastify portal for Oracle Cloud Infrastructure management with AI-powered chat, visual workflow designer, and comprehensive security.

## Architecture

### Monorepo Structure (Phase 9)
```
oci-self-service-portal/
├── apps/
│   ├── frontend/          # SvelteKit app (adapter-node, Docker)
│   │   ├── src/lib/       # Components, tools, pricing, terraform, workflows
│   │   └── src/routes/    # SvelteKit routes + API endpoints
│   └── api/               # Fastify 5 backend (Phase 9)
│       └── src/
│           ├── plugins/   # Oracle, Auth, RBAC plugins
│           └── routes/    # health, sessions, activity, tools, metrics
├── packages/
│   └── shared/            # Shared types, server modules, Oracle adapter
│       └── src/server/    # auth/, oracle/, workflows/, errors, logger, metrics
├── infrastructure/
│   └── docker/phase9/     # Docker Compose, Nginx, certbot, DH params
└── tests/                 # E2E tests
```

### Key Dependencies
- **Frontend**: SvelteKit 2, Svelte 5, @xyflow/svelte (workflow designer), shadcn-svelte, AI SDK
- **Backend**: Fastify 5, fastify-type-provider-zod, @fastify/swagger, Better Auth
- **Database**: Oracle Autonomous Database 26AI (connection pool, migrations, vector search, blockchain audit)
- **Provider**: @acedergren/oci-genai-provider (GitHub Packages)

## Development

### Commands
```bash
pnpm install                          # Install all workspace deps
pnpm build                            # Build all packages
pnpm test                             # Run all tests (vitest)
pnpm --filter @portal/api test        # API tests only
pnpm --filter @portal/frontend test   # Frontend tests only
pnpm --filter @portal/frontend dev    # Dev server (port 5173)
pnpm lint                             # ESLint
pnpm format                           # Prettier
```

### Branch Strategy
- `main` - stable releases
- `feature/phase9-fastify-migration` - current active development branch

### Environment Variables
- `BETTER_AUTH_SECRET` - **Required** in production (fatal error if missing)
- `OCI_REGION` - OCI region (eu-frankfurt-1)
- `FASTIFY_ENABLED` - Feature flag for Fastify route proxying
- `SENTRY_DSN` - Optional Sentry error tracking
- `DATABASE_URL` - Oracle connection string

## Critical Patterns

### Authentication
- **Dual auth**: `requireApiAuth(request, permission)` checks session first, then API key
- **Better Auth bridge**: `toWebRequest(request)` converts Fastify request to Web API Request for session lookup
- **Path normalization**: Strip trailing slashes to prevent auth bypass: `.replace(/\/+$/, '') || '/'`
- **RBAC**: 3 roles (viewer/operator/admin), 13 permissions via `getPermissionsForRole()`
- **Org resolution**: `resolveOrgId(request)` resolves org from session or API key context

### API Key Format
- Prefix: `portal_` + `crypto.randomBytes(32).hex`
- Storage: SHA-256 hashed, `key_prefix` (first 8 chars) for identification

### Oracle Database
- **Connection pool**: `packages/shared/src/server/oracle/` with fallback patterns
- **UPPERCASE keys**: `OUT_FORMAT_OBJECT` returns UPPERCASE; use `fromOracleRow()` for camelCase
- **Migrations**: `packages/shared/src/server/oracle/migrations/` (001-009)
- **Fallback**: All services have fallback to JSONL/in-memory/SQLite when Oracle unavailable
- **Blockchain tables**: `NO DROP UNTIL 365 DAYS IDLE`, `NO DELETE UNTIL 365 DAYS AFTER INSERT`

### Security
- **IDOR prevention**: All endpoints verify org ownership via `resolveOrgId()`
- **SSRF prevention**: `isValidWebhookUrl()` blocks private IPs, requires HTTPS
- **Webhook signatures**: HMAC-SHA256 via `X-Portal-Signature: sha256=<hex>`
- **CSP nonce**: `crypto.randomUUID()` per request in production
- **Rate limiting**: Oracle `MERGE INTO` for atomic upsert, fail-open on DB errors
- **Column injection**: `validateColumnName()` regex allowlist in oracle-adapter.ts
- **AES-256-GCM**: Webhook secret encryption at rest (migration 009)

### Error Handling
- **PortalError hierarchy**: Base class with code/statusCode/context
- **Subclasses**: ValidationError(400), AuthError(401|403), NotFoundError(404), RateLimitError(429), OCIError(502), DatabaseError(503)
- **Serialization**: `toJSON()` for Pino, `toSentryExtras()` for Sentry, `toResponseBody()` for HTTP

### SvelteKit Build Gotchas
- Non-HTTP exports in `+server.ts` must be prefixed with `_` (e.g., `_MODEL_ALLOWLIST`)
- `+page.svelte` cannot import from `$lib/server/`; use `+page.server.ts` load()
- `$state.raw()` for @xyflow/svelte nodes/edges (xyflow mutates directly)

## Observability
- **Logger**: Pino via `createLogger(module)` with custom serializers, redacts auth/cookie headers
- **Metrics**: Custom Prometheus registry at `/api/metrics`
- **Sentry**: Dynamic import, no-op when DSN missing
- **Health**: `/healthz` liveness probe (plain text "ok") + `/health` deep check with 3s `Promise.race` timeout
- **Tracing**: `X-Request-Id` header propagation

## Workflow Designer
- **Canvas**: @xyflow/svelte with drag-and-drop node palette
- **Executor**: Custom WorkflowExecutor with Kahn's topological sort, DFS cycle detection
- **Node types**: tool, condition, loop, approval, ai-step, input, output, parallel
- **API**: `/api/workflows` CRUD + `/api/workflows/[id]/run` + `/api/workflows/runs/[runId]/approve`

## Testing

### Framework & Configuration
- **Vitest** with `mockReset: true` in `vitest.config.ts` — clears ALL mock implementations between tests
- **Current count**: 203 tests across 13 files (Phase 9 API)
- **TDD pattern**: Tests written BEFORE implementation; tests in `src/tests/` directories

### Critical: mockReset Gotcha
`vitest.config.ts` has `mockReset: true` which clears mock return values between every test. Every test file using `vi.mock()` **must** re-configure mocks in `beforeEach`:
```typescript
// Top-level: define the mock fn
const mockFn = vi.fn();
vi.mock('module', () => ({ fn: (...args) => mockFn(...args) }));

// In beforeEach: re-configure after reset clears it
beforeEach(() => {
  mockFn.mockResolvedValue({ data: 'test' });
});
```
The forwarding pattern `(...args) => mockFn(...args)` allows `beforeEach` to re-configure `mockFn` independently of the factory.

### Fastify Test Patterns
- **Zod type provider**: Routes with Zod schemas require `app.setValidatorCompiler(validatorCompiler)` and `app.setSerializerCompiler(serializerCompiler)` in test `buildApp()`
- **Fastify 5 reference-type decorators**: Arrays on `request` must use `{ getter, setter }` with a Symbol key (Fastify 5 restriction):
```typescript
const PERMS_KEY = Symbol('permissions');
fastify.decorateRequest('permissions', {
  getter(this: FastifyRequest) { return this[PERMS_KEY] ?? []; },
  setter(this: FastifyRequest, v: string[]) { this[PERMS_KEY] = v; }
});
```
- **Fake auth plugin**: Tests use `fp()` wrapped plugin decorating `request.user`, `request.session`, `request.permissions` (getter/setter), `request.apiKeyContext`, `request.dbAvailable`
- **`simulateSession()` helper**: Injects user/permissions via `onRequest` hook before RBAC `preHandler` runs
- **Zod UUID validation**: `z.string().uuid()` is strict — test UUIDs must be valid v4 format (e.g., `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`)

### Test Coverage Matrix
Every API route tests:
- **401**: Unauthenticated requests (no session, no API key)
- **403**: Wrong permission (e.g., `tools:read` when `tools:execute` required)
- **400**: Zod schema validation failures (missing fields, invalid types, out-of-range)
- **IDOR**: User-scoped queries filter by `userId` or `orgId`
- **DB fallback**: `dbAvailable=false` returns empty/503, DB errors handled gracefully
- **Happy path**: Success responses with correct shape and status codes

### Semgrep Scan Status
- `apps/api/src/`: **0 findings** (214 rules, 13 files)
- `packages/shared/src/`: **2 findings** — GCM tag length in crypto.ts, path traversal in migrations.ts

## Architecture Decisions (Phase 9)

### Package Boundaries
- **`packages/shared`**: All business logic, Oracle repositories, auth core, error hierarchy, metrics. Both frontend and API import from here.
- **`apps/api`**: Fastify plugins + routes only. Thin wrappers calling into shared. No business logic in route handlers beyond request/response mapping.
- **`apps/frontend`**: SvelteKit UI. Server-side routes proxy to API when `FASTIFY_ENABLED=true`.
- **Rule**: If code is needed by both frontend and API, it belongs in `packages/shared`. Never duplicate.

### Migration Strategy
- **Feature-flag migration**: `FASTIFY_ENABLED` env var in SvelteKit hooks controls whether `/api/*` routes proxy to Fastify or fall back to SvelteKit API routes
- **Parallel running**: Both SvelteKit API and Fastify API can run simultaneously during migration
- **Shared-first extraction**: Business logic extracted to `packages/shared` first, then both frontends import it
- **Route parity**: Every Fastify route has a corresponding test covering the same contract as the SvelteKit route

### Fastify Plugin Architecture
- **`oracle` plugin** (`fp()` wrapped): Initializes pool, runs migrations, decorates `fastify.oracle` and `request.dbAvailable`
- **`auth` plugin** (`fp()` wrapped): Resolves session via Better Auth's `toWebRequest()` bridge, decorates `request.user`, `request.session`, `request.permissions`
- **`rbac` plugin**: Exports `requireAuth(permission)` as `preHandler` hook factory — not a registered plugin, just helpers
- **Plugin registration order**: oracle → auth → routes (auth depends on oracle for session DB, routes depend on auth for RBAC)

### Approval System Architecture
- **Org-scoped IDOR prevention**: `pendingApprovals` Map entries carry `orgId` field. GET/POST `/api/tools/approve` filter by `resolveOrgId(request)` using `?? null` coercion for strict equality
- **`registerPendingApproval()`** accepts `orgId` parameter — callers must pass the org context from the chat stream
- **Dual storage**: Oracle DB primary + in-memory Map fallback. `recordApproval()`/`consumeApproval()` try DB first with automatic fallback

## Infrastructure & DevOps

### Docker Compose (Phase 9)
- **Location**: `infrastructure/docker/phase9/`
- **Services**: nginx (TLS termination) + api (Fastify) + frontend (SvelteKit) + certbot (optional Let's Encrypt)
- **Network**: All services on `portal-network` bridge; only nginx exposes host ports (80/443)
- **API/Frontend are internal-only**: Use `expose:` not `ports:` — only reachable via nginx reverse proxy
- **Build context**: `../../..` (monorepo root) because Dockerfiles need `packages/shared/` as sibling

### Container Hardening
- All containers: `read_only: true`, `no-new-privileges: true`, `tmpfs` for writable dirs
- nginx: `tmpfs` for `/var/cache/nginx`, `/var/run`, `/tmp` with size limits
- Resource limits: Configurable via `.env` (`API_MEMORY_LIMIT`, `API_CPU_LIMIT`, `FRONTEND_MEMORY_LIMIT`, `FRONTEND_CPU_LIMIT`)
- Health checks: nginx via `wget --spider`, api/frontend via `curl -f` to `/health` endpoints

### TLS / Certificates
- **Single variable**: `TLS_CERTS_DIR` (default `./certs`) points to directory containing `fullchain.pem`, `privkey.pem`, `dhparam.pem`
- **DH params required**: Generate with `openssl dhparam -out certs/dhparam.pem 2048` (takes ~30s)
- **Self-signed dev cert**: `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout certs/privkey.pem -out certs/fullchain.pem -subj "/CN=localhost"`
- **Let's Encrypt**: Enable certbot profile with `docker compose --profile letsencrypt up -d`
- See `infrastructure/docker/phase9/CERTIFICATES.md` for full guide

### Nginx Configuration
- **Proxy directive order**: Every `location` block follows: `proxy_pass` → `proxy_http_version` → `Connection` → `Host` → forwarding headers → `Upgrade ""` → timeouts → location-specific
- **H2C smuggling prevention**: All locations set `proxy_set_header Upgrade ""` to block Upgrade header
- **Health endpoints**: Both HTTP `/nginx-health` and HTTPS `/health` have `access_log off` to suppress noise
- **Security headers**: Defined once at `server` level (not per-location) to avoid nginx header-redefinition behavior
- **Rate limiting**: nginx `limit_req` as defence-in-depth alongside Fastify `@fastify/rate-limit`
- **SSE/streaming**: `proxy_buffering off` + `X-Accel-Buffering no` + `proxy_cache off` on `/api/` for AI chat streaming

### Feature Flag Migration
- **SvelteKit proxy**: `FASTIFY_ENABLED=true` in SvelteKit hooks causes `/api/*` to proxy to Fastify backend
- **Selective routing**: `FASTIFY_PROXY_ROUTES=/api/health,/api/sessions,/api/v1/` proxies only listed prefixes
- **Auth excluded**: `/api/auth/*` is NEVER proxied (Better Auth OIDC callbacks require SvelteKit cookie handling)
- **Proxy placement**: After request tracing, BEFORE auth/DB init (Fastify handles its own middleware)
- **Request ID forwarding**: `X-Request-Id` header propagated to Fastify for distributed trace correlation
- **502 fallback**: Returns `{"error": "Backend unavailable"}` when Fastify is unreachable
- See `docs/FEATURE_FLAG.md` for migration stages

### Git Hooks
- **Location**: `.githooks/` directory, auto-installed via `prepare` script in package.json
- **Install**: `git config core.hooksPath .githooks` (runs automatically on `pnpm install`)
- **Pre-commit**: ESLint + type check + Prettier, scoped to changed workspaces only
- **Pre-push**: Semgrep (security), CodeQL (security-extended), test suite, CodeRabbit note
- **Skip**: `git push --no-verify` for emergencies only
- **Required tools**: semgrep (`brew install semgrep`), codeql (`brew install codeql`)

### CI/CD Considerations
- **GitHub Packages auth**: `@acedergren/oci-genai-provider` requires `NODE_AUTH_TOKEN` for install
- **Semgrep baseline**: 2 known false positives in packages/shared (GCM tag pattern, path traversal guard with nosemgrep)
- **CodeQL**: Uses `javascript-security-extended` query suite; 0 findings on clean codebase
- **Build order**: `packages/shared` must build first (tsc), then `apps/api` and `apps/frontend` can build in parallel

### Docker Gotchas
- **Compose V2**: No `version:` field needed — Docker Compose V2 ignores it
- **OCI CLI in container**: Mount `~/.oci:/home/portal/.oci:ro` for config-file auth
- **Wallet mount**: `${WALLET_PATH:-/data/wallets}:/wallets:ro` for Oracle ADB wallet
- **Data volumes**: `portal-api-data` and `portal-frontend-data` for persistent state across restarts
