# Self-Service Portal: MVP to Product Roadmap

> **Status**: Phase 5 complete, repo split next, then Phase 6
> **Last Updated**: 2026-02-06

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

- [ ] 6.1 Enhanced Pino logging (structured transports)
- [ ] 6.2 Pino child logger pattern (per-module)
- [ ] 6.3 Sentry SDK integration (@sentry/sveltekit)
- [ ] 6.4 Sentry performance monitoring
- [ ] 6.5 Prometheus metrics collector
- [ ] 6.6 Metrics endpoint (/api/metrics)
- [ ] 6.7 Grafana dashboard
- [ ] 6.8 Health endpoint deep checks
- [ ] 6.9 Structured error types (PortalError hierarchy)

**Verify**: Structured JSON logs. Sentry captures errors. `/api/metrics` returns Prometheus format. Grafana dashboard imports.

---

## Phase 7: Visual Workflow Designer
**Goal**: Canvas-based visual editor for multi-step OCI workflows with Mastra engine + Svelte Flow.

- [ ] 7.1 Install Svelte Flow (@xyflow/svelte)
- [ ] 7.2 Workflow data model (WorkflowDefinition, WorkflowNode, WorkflowEdge)
- [ ] 7.3 Migration 004: Workflows table
- [ ] 7.4 Workflow repository (CRUD + runs + steps)
- [ ] 7.5 Node palette component
- [ ] 7.6 Canvas component (Svelte Flow)
- [ ] 7.7 Properties panel (dynamic forms from Zod)
- [ ] 7.8 Mastra workflow engine integration
- [ ] 7.9 Workflow API routes
- [ ] 7.10 Designer page (list view)
- [ ] 7.11 Designer editor page (full-screen canvas)
- [ ] 7.12 Workflow templates (convert existing 7 templates)
- [ ] 7.13 Execution timeline view
- [ ] 7.14 Workflow sharing & marketplace

**Verify**: Create workflow visually, run it, watch execution. Save/reload persists. Share as template.

---

## Phase 8: API Integration Layer & MCP Server
**Goal**: Expose tools and workflows as REST API + MCP server.

- [ ] 8.1 REST API for tools (/api/v1/tools)
- [ ] 8.2 API key authentication
- [ ] 8.3 Workflow execution API
- [ ] 8.4 MCP Server (Model Context Protocol)
- [ ] 8.5 Webhook callbacks
- [ ] 8.6 OpenAPI spec generation
- [ ] 8.7 SDK client package

**Verify**: External API call executes tool. MCP client discovers portal tools. OpenAPI spec renders.

---

## Phase 9: ITSM Completeness & MCP Integrations
**Goal**: Complete ITSM platform with incident/change management and external system integrations.

- [ ] 9.1 MCP client integration (PagerDuty, Jira, Slack, GitHub)
- [ ] 9.2 Incident management tools
- [ ] 9.3 Change management workflow
- [ ] 9.4 Knowledge base (vector RAG with ADB 26AI)
- [ ] 9.5 Asset inventory enrichment
- [ ] 9.6 SLA tracking
- [ ] 9.7 Slack notifications
- [ ] 9.8 ITSM dashboard

**Verify**: Create incident via chat -> PagerDuty. Submit change request -> Jira. Search KB -> semantic results.

---

## Phase 10: Production Deployment & Go-Live
**Goal**: Live on portal.solutionsedge.io with CD pipeline and operational readiness.

- [ ] 10.1 Cloudflare Tunnel route
- [ ] 10.2 OCI IAM OIDC app configuration
- [ ] 10.3 Deploy script (bastion + Docker)
- [ ] 10.4 Graceful shutdown (Oracle pool, Sentry, Pino flush)
- [ ] 10.5 GitHub Actions CD
- [ ] 10.6 OCI Vault runtime secrets
- [ ] 10.7 E2E smoke tests
- [ ] 10.8 Operational runbook

**Verify**: `portal.solutionsedge.io/api/health` returns ok. Login flow works. CD deploys on merge.
