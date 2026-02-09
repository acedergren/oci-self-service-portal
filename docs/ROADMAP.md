# Self-Service Portal: MVP to Product Roadmap

> **Status**: Phase 9 complete (Fastify Backend Migration — 9.1-9.20 merged)
> **Standalone Repo**: [oci-self-service-portal](https://github.com/acedergren/oci-self-service-portal)
> **Last Updated**: 2026-02-09
> **Tests**: 1213 passing across 92 test files (frontend + API + shared)

---

## Phase 1: Build Foundation & Deployment Pipeline

**Goal**: Deployable Docker container on OCI Compute with CI/CD and code quality tooling.

- [x] 1.0 Create ROADMAP.md
- [x] 1.1 Switch to adapter-node (replace adapter-vercel) — `@sveltejs/adapter-node@^5.5.2`
- [x] 1.2 Create Dockerfile (multi-stage: deps/builder/runner with OCI CLI)
- [x] 1.3 Create docker-compose.yml + .env.example
- [x] 1.4 Add ESLint + Prettier (eslint.config.js flat config, .prettierrc)
- [x] 1.5 GitHub Actions CI pipeline (lint, typecheck, test, build jobs)
- [x] 1.6 Health endpoint upgrade (database check returns `not_configured`)

**Verify**: `pnpm build` produces `build/`. `docker build` succeeds. `docker-compose up` serves `/api/health`. `pnpm lint` passes. CI pipeline green.

---

## Phase 2: Oracle ADB 26AI Database Layer

**Goal**: Replace SQLite + in-memory state with Oracle ADB 26AI.

- [x] 2.1 Add oracledb driver (thin mode) — `oracledb@6.10.0`
- [x] 2.2 Connection pool service (`withConnection<T>()`) — `src/lib/server/oracle/connection.ts`
- [x] 2.3 Migration runner (numbered SQL migrations) — `src/lib/server/oracle/migrations.ts`
- [x] 2.4 Migration 001: Core tables (organizations, users, sessions, turns, tool_executions, pending_approvals)
- [x] 2.5 Migration 002: Vector search (conversation_embeddings with VECTOR(1536, FLOAT32))
- [x] 2.6 Repository layer (session, audit, approval repositories)
- [x] 2.7 Replace db.ts facade (deprecated, re-exports Oracle utils)
- [x] 2.8 Migrate audit.ts (Oracle-first, JSONL fallback)
- [x] 2.9 Migrate approvals (Oracle persistence + in-memory Map for real-time resolution)
- [x] 2.10 Migrate sessions (Oracle-first, SQLite fallback, async)
- [x] 2.11 Wire sessions API (real queries with `dbAvailable` gate)
- [x] 2.12 SvelteKit hooks (lazy DB init, graceful shutdown, `app.d.ts` types)
- [ ] 2.13 Integration tests

**Verify**: Health shows `database: 'ok'`. Chat sessions persist across restarts. Audit logs in `tool_executions` table. Approvals survive restart.

---

## Phase 3: Authentication (OCI IAM SSO/OIDC)

**Goal**: Protect all routes with OCI IAM Identity Domains. RBAC for tool access.

- [x] 3.1 Install Better Auth — `better-auth@1.4.18`
- [x] 3.2 Auth config (OIDC plugin for OCI IAM) — `src/lib/server/auth/config.ts`
- [x] 3.3 Oracle adapter (custom Better Auth adapter) — `src/lib/server/auth/oracle-adapter.ts`
- [x] 3.4 Auth client (SvelteKit client-side) — `src/lib/auth-client.ts`
- [x] 3.5 Auth routes (/api/auth/[...all]) — `src/routes/api/auth/[...all]/+server.ts`
- [x] 3.6 Auth guard in hooks.server.ts (session validation, redirect to login)
- [x] 3.7 App.d.ts types (Locals.user, Locals.session, Locals.permissions)
- [x] 3.8 RBAC middleware (3 roles, 10 permissions) — `src/lib/server/auth/rbac.ts`
- [x] 3.9 Protect API routes (requirePermission on chat, execute, approve)
- [x] 3.10 Multi-tenancy (org -> compartment mapping) — `src/lib/server/auth/tenancy.ts`
- [x] 3.11 Login UI (UserMenu component) — `src/lib/components/UserMenu.svelte`
- [x] 3.12 Layout auth context — `src/routes/+layout.server.ts`, `+layout.svelte`
- [x] 3.13 CSP update (allow identity.oraclecloud.com)
- [x] 3.14 SQL migration 003-better-auth (accounts, verifications, org_invitations)
- [x] 3.15 Org repository — `src/lib/server/oracle/repositories/org-repository.ts`
- [x] 3.16 Tests: 52 tests across 4 files (rbac, adapter, session-flow, tenancy)

**Verify**: Unauthenticated visitors redirect to OCI IAM login. RBAC enforced per role. API calls without session return 401.

---

## Phase 4: Code Consolidation & Cleanup

**Goal**: Eliminate duplication, move rate limiting to DB, add request tracing.

- [x] 4.1 Remove duplicate executors from execute/+server.ts
- [x] 4.2 DB-backed rate limiting (replace in-memory Map)
- [x] 4.3 Request tracing (X-Request-Id header)
- [x] 4.4 Fix pre-existing type errors in approve/execute endpoints
- [x] 4.5 Security review of Phases 1-3 (14 findings, 4 critical/high fixed)
- [x] 4.6 Security fixes: C1 (auth secret), H1 (auth error 503), H2 (session IDOR), H3 (approval bypass)

**Verify**: All 60+ tools work through both chat and execute endpoint. Rate limits persist across restarts. `svelte-check` passes clean.

---

## Phase 5: Frontend Component Decomposition + shadcn-svelte

**Goal**: Break 2043-line self-service page into focused components. Introduce shadcn-svelte.

- [x] 5.1 Install shadcn-svelte (bits-ui@2.15.5, tailwind-variants, svelte-sonner)
- [x] 5.2 Extract 17 portal components (PortalHeader, HeroSection, ServiceCategoryGrid, ChatOverlay, etc.)
- [x] 5.3 Slim down self-service page (2042 → 212 lines)
- [x] 5.4 Real recent activity API (GET /api/activity with pagination, filtering, Oracle fallback)
- [x] 5.5 Real session list (enhanced GET + DELETE /api/sessions/[id], search, pagination)
- [x] 5.6 Notification system (svelte-sonner Toaster + typed notification helpers)
- [x] 5.7 Component tests (78 Phase 5 tests, 289 total passing)
- [x] 5.8 Security fixes: H4/H5 (atomic MERGE INTO rate limiter), M6 (switchToSession ownership), M7 (session userId)

**Verify**: Self-service page renders identically (or better). `+page.svelte` under 200 lines. Real activity feed.

---

## Phase 6: Observability Stack (Pino + Sentry + Prometheus)

**Goal**: Production-grade logging, error tracking, performance monitoring.

- [x] 6.1 Enhanced Pino logging (structured transports, pino-pretty dev, JSON prod)
- [x] 6.2 Pino child logger pattern (createLogger per-module, custom error/request serializers)
- [x] 6.3 Sentry SDK integration (graceful degradation wrapper, dynamic import)
- [x] 6.4 Sentry performance monitoring (wrapWithSpan, captureError with PortalError extras)
- [x] 6.5 Prometheus metrics collector (Counter/Gauge/Histogram, 9 predefined portal\_\* metrics)
- [x] 6.6 Metrics endpoint (/api/metrics — Prometheus text format)
- [x] 6.7 Grafana dashboard (15+ panels, 710-line JSON)
- [x] 6.8 Health endpoint deep checks (runHealthChecks: database, pool, oci_cli, sentry, metrics)
- [x] 6.9 Structured error types (PortalError → 6 subclasses, toJSON/toSentryExtras/toResponseBody, helpers)

**Verified**: 104 Phase 6 tests passing. 366 total tests (4 future-phase TDD stubs expected). Build succeeds. svelte-check clean (3 future-phase module stubs expected). HTTP metrics wired into hooks.server.ts. Graceful shutdown closes Sentry + Oracle pool.

---

## Phase 7: Visual Workflow Designer

**Goal**: Canvas-based visual editor for multi-step OCI workflows with custom executor + Svelte Flow.

- [x] 7.1 Install Svelte Flow (@xyflow/svelte@1.5) — Svelte 5 native rewrite
- [x] 7.2 Workflow data model (20 Zod schemas, 8 node types) — `src/lib/workflows/types.ts`
- [x] 7.3 Migration 005: Workflows tables (definitions, runs, steps)
- [x] 7.4 Workflow repository (CRUD + runs + steps) — `src/lib/server/workflows/repository.ts`
- [x] 7.5 Node palette component — `src/lib/components/workflows/NodePalette.svelte`
- [x] 7.6 Canvas component (Svelte Flow, $state.raw) — `src/lib/components/workflows/WorkflowCanvas.svelte`
- [x] 7.7 Properties panel (dynamic forms) — `src/lib/components/workflows/NodeProperties.svelte`
- [x] 7.8 Custom WorkflowExecutor (Kahn's topological sort, DFS cycle detection, safe expressions)
- [x] 7.9 Workflow API routes (/api/workflows CRUD + /[id]/run + /runs/[runId]/approve)
- [x] 7.10 Designer page (list view) — `src/routes/workflows/+page.svelte`
- [x] 7.11 Designer editor page (canvas + toolbar + palette + properties) — `src/routes/workflows/[id]/+page.svelte`
- [x] 7.12 Designer create page — `src/routes/workflows/create/+page.svelte`
- [x] 7.13 Execution timeline — `src/lib/components/workflows/ExecutionTimeline.svelte`
- [x] 7.14 RBAC: 3 new workflow permissions (read, write, execute)

**Security hardening** (post-Phase 7):

- [x] I-1: Column injection prevention (validateColumnName regex + validateTableName allowlist)
- [x] I-2: CSP nonce (crypto.randomUUID per request, transformPageChunk injection)
- [x] M-2: DB-backed approvals (recordApproval/consumeApproval async with Oracle)
- [x] M-3 through M-6: ESCAPE clause, workflow IDOR, rate limit cleanup

**CodeRabbit review fixes**:

- [x] C-1: Atomic DELETE in approval consumption
- [x] H-1: LIKE wildcard escaping in oracle-adapter
- [x] H-2: Recursive subgraph skip in workflow executor
- [x] H-3: CSP nonce regex anchoring
- [x] M-3: ESCAPE clause on all LIKE queries
- [x] M-4: Workflow IDOR prevention (userId scoping)

**Verified**: 107 Phase 7 tests, 506 total. Build succeeds. svelte-check clean.

---

## Phase 8: API Integration Layer + Oracle 26AI Intelligence

**Goal**: REST API for external integrations, API key auth, Oracle 26AI features (vector search, blockchain audit, property graphs), webhook subscriptions, and MCP server for AI agent tool discovery. ~125 new tests, 3 new migrations.

### Wave 1 — Foundation

- [x] 8.1 API key authentication (portal\_ prefix, SHA-256, dual auth in hooks.server.ts) — `src/lib/server/auth/api-keys.ts`
- [x] 8.2 REST API v1 for tools (GET list, GET detail, POST execute with confirmation) — `src/routes/api/v1/tools/`
- [x] 8.3 OpenAPI spec generation (auto-generated from tool Zod schemas) — `src/routes/api/v1/openapi.json/`
- [x] 8.4 Dual auth guard (requireApiAuth: session OR API key) — `src/lib/server/api/require-auth.ts`
- [x] 8.5 Phase 8 type definitions (403-line shared types + Zod schemas) — `src/lib/server/api/types.ts`

### Wave 2 — Oracle 26AI Intelligence

- [x] 8.6 Vector search activation (OCI GenAI embed-english-v3, embedding pipeline) — `src/lib/server/embeddings.ts`
- [x] 8.7 Semantic search endpoint (cosine similarity, graceful degradation) — `src/routes/api/v1/search/`
- [x] 8.8 Blockchain audit table (SHA-256 row chaining, dual-write, verification API) — `src/routes/api/v1/audit/verify/`
- [x] 8.9 Property graph analytics (SQL/PGQ, user-activity/tool-affinity/org-impact) — `src/routes/api/v1/graph/`

### Wave 3 — External Integration

- [x] 8.10 Webhook subscriptions (HMAC-SHA256 signed, SSRF prevention, circuit breaker) — `src/routes/api/v1/webhooks/`
- [x] 8.11 Workflow execution REST API v1 (list, trigger, status with steps) — `src/routes/api/v1/workflows/`
- [ ] 8.12 MCP server for portal tools (in progress) — `src/lib/server/mcp/portal-server.ts`

### Migrations

- [x] Migration 006: API keys + webhook subscriptions tables
- [x] Migration 007: Oracle Text index, blockchain audit table (SHA2_256)
- [x] Migration 008: SQL/PGQ property graph (5 vertex, 4 edge tables)

### Security Fixes (Applied During Phase 8)

- [x] H-8: Fire-and-forget race condition in api-keys.ts (separate withConnection)
- [x] M-13: Search endpoint orgId resolution (dead code path)
- [x] M-14: Danger permission bypass in v1 tool execute (check before confirmation)
- [x] M-17: Webhook/workflow/graph/audit auth inconsistency (all v1 routes use requireApiAuth + resolveOrgId)

### OCI IDCS Integration

- [x] Enhanced Better Auth config for OCI IDCS (urn:opc:idm:**myscopes** scope, IDCS claim mapping)
- [x] IDCS group-to-role auto-provisioning (mapIdcsGroupsToRole, MERGE INTO upsert)
- [x] .env.example with IDCS configuration guidance

**Verified**: 614 tests passing (44 test files). All v1 endpoints use dual auth (session + API key). Build succeeds.

---

## Phase 9: Fastify Backend Migration

**Goal**: Extract API routes from SvelteKit into a dedicated Fastify backend for independent scaling, OpenAPI docs, and cleaner separation of concerns.

**Architecture**: `apps/frontend/` (SvelteKit UI-only) + `apps/api/` (Fastify backend) + `packages/shared/` (business logic)

- [x] 9.1 Monorepo restructure (`apps/frontend`, `apps/api`, `packages/shared`)
- [x] 9.2 Extract shared business logic package (tools, oracle, auth, pricing, terraform)
- [x] 9.3 Fastify app factory with plugin architecture (`@fastify/cors`, `@fastify/cookie`, `@fastify/rate-limit`)
- [x] 9.4 Oracle DB Fastify plugin (connection pool lifecycle, `request.db` decorator)
- [x] 9.5 Better Auth Fastify integration (`fastify-better-auth` or manual middleware)
- [x] 9.6 RBAC + session validation as Fastify preHandler hooks
- [x] 9.7 Migrate health endpoint (`GET /api/health` with DB + OCI CLI checks)
- [x] 9.8 Migrate sessions API (`GET/POST/DELETE /api/sessions`)
- [x] 9.9 Migrate activity API (`GET /api/activity`)
- [x] 9.10 Migrate tools API (`POST /api/tools/execute`, `POST /api/tools/approve`)
- [x] 9.11 Mastra integration — Oracle storage adapter (MastraStorage, 20+ methods), tool registry, Fastify plugin
- [x] 9.12 Workflow engine migration — Workflow executor, graph-utils extraction to packages/shared
- [x] 9.13 AI agent + memory — CloudAdvisor agent, chat route, MemoryOracle (12 methods), provider registry, 64 tests
- [x] 9.14 RAG + MCP + ScoresOracle — Oracle vector store (MastraVector), OCI GenAI embedder, MCP server migration, ScoresOracle (5 methods), 59 tests
- [x] 9.15 Feature flag proxy module (shouldProxyToFastify, proxyToFastify with X-Request-Id forwarding)
- [x] 9.16 Proxy middleware in hooks.server.ts (inserted before auth/DB init, excludes /api/auth/\*)
- [x] 9.17 Proxy integration tests (12 tests covering routing logic, fallback, auth exclusion)
- [x] 9.18 OpenAPI JSON route (GET /api/v1/openapi.json via @fastify/swagger)
- [x] 9.19 Legacy route deprecation headers (X-Deprecated-Route, X-Preferred-Route on SvelteKit fallback)
- [x] 9.20 Cutover documentation (docs/PHASE9_CUTOVER.md with rollout stages and rollback plan)

**Key dependencies**: `fastify@5`, `@fastify/swagger`, `@fastify/cors`, `@fastify/cookie`, `@fastify/rate-limit`, `fastify-type-provider-zod`

**Verified**: 1213 tests passing across 92 test files. All routes migrated (9.1-9.14). Mastra framework integration complete (9.11-9.14). Feature flag proxy operational (9.15-9.20). Build succeeds. Cutover guide complete.

---

## Phase 9A: Admin Console (Database-Driven Configuration)

**Goal**: Centralized administration console for portal configuration (identity providers, AI models, settings).

- [x] 9A.1 Migration 009-admin.sql (idp_configs, ai_provider_configs, portal_settings tables)
- [x] 9A.2 Admin module — `apps/frontend/src/lib/server/admin/` (types.ts, crypto.ts, idp-repository.ts, ai-provider-repository.ts, settings-repository.ts, index.ts)
- [x] 9A.3 Auth factory — `src/lib/server/auth/auth-factory.ts` (dynamic IDP configuration from database)
- [x] 9A.4 Crypto utilities (AES-256-GCM for encrypted API keys/secrets at rest) — `src/lib/server/admin/crypto.ts`
- [x] 9A.5 Setup Wizard API (7 endpoints under `/api/setup/`) — status, settings, idp, idp/test, ai-provider, ai-provider/test, complete
- [x] 9A.6 Admin Console UI (3 pages under `/routes/admin/`) — IDP management, AI Models, Portal Settings + layout
- [x] 9A.7 Admin API (6 endpoints under `/api/admin/`) — idp CRUD, ai-providers CRUD, settings, auth/reload
- [x] 9A.8 Dynamic IDP buttons on login page (database-driven)
- [x] 9A.9 IDCS provisioning refactored for database-driven config
- [x] 9A.10 Tests: 27 crypto + 67 Zod schemas + 21 IDP repository = 115 new tests
- [x] 9A.11 Security review with IDOR + auth + RBAC hardening

**Verified**: 115 admin tests passing. All CRUD endpoints protect via auth factory + RBAC. Setup wizard verifies IDP and AI provider connectivity. Build succeeds.

---

## API Security Hardening Sprint

**Goal**: Comprehensive security hardening of API layer across all v1 endpoints, auth mechanisms, and infrastructure.

**Status**: Complete (26 security fix commits, 30+ new tests)

### Categories

**IDOR Prevention**:

- [x] Workflow endpoints org-scoped (filter by `event.locals.orgId`)
- [x] Session ownership verification (requirePermission + ownership check)
- [x] API key list/webhook list row limits (1000 per query, prevent enumeration)

**SSRF Prevention**:

- [x] IDP test endpoint URL validation (block private IPs, require HTTPS)
- [x] Webhook URL validation (`isValidWebhookUrl()`, private IP blocklist, timing-safe comparison)

**Error Leakage**:

- [x] toPortalError wrapping (internal error message redaction)
- [x] Tool execute error handling (never leak OCI CLI output to client)

**Rate Limiting**:

- [x] Granular per-endpoint buckets (avoid key collisions)
- [x] In-memory fallback on DB errors (fail-open, graceful degradation)
- [x] OCI CLI concurrency limiter (prevent CLI subprocess exhaustion)

**Input Validation**:

- [x] Zod schemas on chat/session endpoints (strict parsing)
- [x] 512 KiB body size limits on POST endpoints

**Auth Guards**:

- [x] Endpoint-level defense-in-depth checks (preHandler hooks)
- [x] MCP server executeTool auth enforcement (S-7)
- [x] Dual auth consistency (all v1 routes use requireApiAuth + resolveOrgId)

**Resource Limits**:

- [x] API key list row limits (1000 max)
- [x] Webhook list row limits (1000 max)
- [x] Approval queue limit (100 concurrent pending)

**Infrastructure Hardening**:

- [x] Source maps disabled in production builds
- [x] Health endpoint detail restricted to admins (S-11)
- [x] Cache-Control no-store on all API responses
- [x] Security headers on Fastify proxy responses

---

## Stabilization Sprint (Post Phase 9A)

**Goal**: Fix 182 test failures caused by Vitest 4 migration and monorepo restructure.

- [x] Migrate vitest config from deprecated `defineWorkspace` to Vitest 4 `test.projects` API
- [x] Create root `vitest.config.ts` with `test.projects` referencing per-package configs
- [x] Update per-project configs to use `defineProject` (not `defineConfig`)
- [x] Add `resolve.alias` for `$lib` in frontend project config
- [x] Fix `process.cwd()` references in tests to use `import.meta.dirname` (monorepo CWD changed)
- [x] Fix MCP server tests: pass auth context with `permissions` (required after S-7 security hardening)
- [x] Security review of admin console additions (crypto, IDP, auth-factory, setup wizard APIs)

**Result**: 182 failures → 0 failures. 961 tests passing across 68 test files.

---

## CodeRabbit Security Fixes (Post Phase 9.7)

**Goal**: Address 5 security findings from CodeRabbit review of Phase 9.7 code.

- [x] Fix block-sensitive-files.sh fail-open → fail-closed when jq unavailable
- [x] Fix approve.ts lost approval — move map delete after recordApproval succeeds
- [x] Fix HCL tag injection — escape `"`, `\`, `${` in Terraform tag generation
- [x] Fix DELETE /api/v1/workflows/:id IDOR — add orgId scoping to delete
- [x] Fix workflow LIST total — use COUNT(\*) query instead of page result length

**Commit**: f9aab0d fix(security): address 5 CodeRabbit review findings

**Result**: 1213 tests passing (1211 pass, 2 pre-existing failures in Phase 8 frontend mocks).

---

## Phase 10: ITSM Completeness & MCP Integrations

**Goal**: Complete ITSM platform with incident/change management and external system integrations.

- [ ] 10.1 MCP client integration (PagerDuty, Jira, Slack, GitHub)
- [ ] 10.2 Incident management tools
- [ ] 10.3 Change management workflow
- [ ] 10.4 Knowledge base (vector RAG with ADB 26AI)
- [ ] 10.5 Asset inventory enrichment
- [ ] 10.6 SLA tracking
- [ ] 10.7 Slack notifications
- [ ] 10.8 ITSM dashboard

**Verify**: Create incident via chat -> PagerDuty. Submit change request -> Jira. Search KB -> semantic results.

---

## Phase 11: Production Deployment & Go-Live

**Goal**: Live on portal.solutionsedge.io with CD pipeline and operational readiness.

- [ ] 11.1 Cloudflare Tunnel route
- [ ] 11.2 OCI IAM OIDC app configuration
- [ ] 11.3 Deploy script (bastion + Docker)
- [ ] 11.4 Graceful shutdown (Oracle pool, Sentry, Pino flush)
- [ ] 11.5 GitHub Actions CD
- [ ] 11.6 OCI Vault runtime secrets
- [ ] 11.7 E2E smoke tests
- [ ] 11.8 Operational runbook

**Verify**: `portal.solutionsedge.io/api/health` returns ok. Login flow works. CD deploys on merge.

---

Last updated: February 9, 2026
