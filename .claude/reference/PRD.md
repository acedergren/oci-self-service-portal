# PRD: Phase 10 — Foundation Rewrite, Workflow Designer & Oracle 26AI Modernization

> **Status**: Draft v7
> **Author**: Claude Opus 4.6 + acedergr
> **Created**: 2026-02-10
> **Last Updated**: 2026-02-11

---

## Validation Checklist

| #   | Gate                                                    | Severity | Status |
| --- | ------------------------------------------------------- | -------- | ------ |
| V1  | Every Must-Have has Given/When/Then acceptance criteria | Critical | [x]    |
| V2  | Every Must-Have maps to at least one test file          | Critical | [x]    |
| V3  | Architecture Decisions have alternatives evaluated      | Critical | [x]    |
| V4  | No deprecated dependencies in scope                     | Critical | [x]    |
| V5  | Phases form a valid DAG (no circular dependencies)      | Critical | [x]    |
| V6  | Success metrics are measurable (number, %, duration)    | High     | [x]    |
| V7  | All personas referenced in at least one user story      | High     | [x]    |
| V8  | No `[NEEDS CLARIFICATION]` markers remain               | High     | [x]    |
| V9  | Risk mitigations are actionable (not "be careful")      | Medium   | [x]    |
| V10 | Open Questions section is empty or tracked              | Medium   | [x]    |

---

## 1. Executive Summary

### Problem Statement

The OCI Self-Service Portal has accumulated architectural debt across 9 phases of rapid development:

1. **Dual API boundary**: SvelteKit serves as both UI layer and API gateway via 37 `+server.ts` routes, while Fastify handles the "real" API — creating split auth, duplicated middleware, and confused request routing
2. **Split authentication**: Better Auth lives in SvelteKit hooks while Fastify validates sessions separately — two codepaths for one concern
3. **Monolithic shared package**: `@portal/shared` (25+ modules) mixes types, server logic, and UI utilities — Svelte deps leak into API builds, Oracle deps leak into frontend
4. **CLI subprocess overhead**: 60+ OCI tools spawn `oci` CLI processes (2-5s each) instead of using the native TypeScript SDK (<500ms)
5. **Incomplete workflow designer**: 3 of 8 node types (ai-step, loop, parallel) unimplemented; no retry policies, no compensation, no execution streaming
6. **Legacy vector indexing**: IVF indexes require full rebuilds after DML; Oracle 26AI HNSW indexes support real-time DML
7. **String-based vector conversion**: `vectorToOracleString()` converts Float32Arrays to strings when node-oracledb 6.5+ supports direct TypedArray binding

### Proposed Solution

A phased foundation rewrite that:

1. **Unifies the API boundary**: Fastify owns ALL API logic — auth, RBAC, routes, middleware. SvelteKit becomes a pure SSR/UI layer with zero `+server.ts` files
2. **Consolidates authentication**: Better Auth moves entirely to Fastify. SvelteKit forwards cookies for SSR hydration only
3. **Splits the shared package**: `@portal/types` (schemas, zero deps), `@portal/server` (business logic), `@portal/ui` (Svelte components)
4. **Adopts OCI TypeScript SDK**: Replace CLI subprocess calls with `oci-sdk` v2.125.0 native API calls for 3-5x latency improvement
5. **Completes the workflow designer**: Implement remaining node types using Mastra workflow primitives (`.then()`, `.parallel()`, `.branch()`, `.foreach()`, suspend/resume)
6. **Modernizes Oracle integration**: HNSW DML indexes, direct Float32Array vector binding, JSON Relational Duality Views, VPD tenant isolation
7. **Replaces custom code with packages**: `@modelcontextprotocol/sdk` replaces 750 LOC MCP client, `terraform-generator` replaces 577 LOC string concatenation

### Success Criteria

| Metric                            | Target         | Measurement                                                      |
| --------------------------------- | -------------- | ---------------------------------------------------------------- |
| SvelteKit API routes eliminated   | 37 → 0         | Zero `+server.ts` files proxying to Fastify                      |
| OCI tool call latency (p95)       | < 500ms        | SDK API call vs 2-5s CLI subprocess                              |
| Shared package compile time       | < 3s           | `tsc --noEmit` on split packages                                 |
| Workflow node types implemented   | 8/8            | All node types functional in designer + executor                 |
| Oracle query performance (vector) | 3x improvement | HNSW DML index vs IVF rebuild                                    |
| Test suite pass rate              | 100%           | `npx vitest run` on all workspaces                               |
| Deprecated dependencies           | 0              | `pnpm outdated` shows no deprecated                              |
| Custom LOC replaced by packages   | ~1,300 LOC     | MCP client + Terraform generator                                 |
| Auth codepaths                    | 1              | Single Fastify auth plugin, zero SvelteKit auth                  |
| Admin experience pages            | 4 new pages    | /admin/{agents, workflows/runs, tools/playground, observability} |
| Design iterations per admin page  | >= 2           | Browser feedback loops validate visual quality                   |

### Global Engineering Gates (Phase 10)

These are the minimum runnable gates used as exit criteria across milestones:

- Install: `pnpm install`
- Build: `pnpm build`
- Lint (repo-wide): `pnpm lint`
- Tests (full): `npx vitest run`
- Typecheck (targeted):
  - API: `cd apps/api && npx tsc --noEmit`
  - Frontend: `cd apps/frontend && npx svelte-check`
  - Shared: `cd packages/shared && npx tsc --noEmit`

---

## 2. User Experience & Functionality

### User Personas

| Persona                 | Role                                       | Key Concern                                          |
| ----------------------- | ------------------------------------------ | ---------------------------------------------------- |
| **Platform Admin**      | Configures portal, manages MCP servers     | Workflow reliability, auth consistency               |
| **Operations Engineer** | Daily CloudAdvisor user                    | Tool response speed, workflow execution feedback     |
| **Workflow Designer**   | Builds automation DAGs in visual editor    | All node types working, retry/compensation support   |
| **Security Reviewer**   | Audits auth, RBAC, encryption              | Single auth boundary, tenant isolation, audit trails |
| **Developer**           | Extends portal, writes new tools/workflows | Clean package boundaries, fast builds, good DX       |

### User Stories

#### US-1: Fastify-First API (Admin, Engineer, Security Reviewer)

As a **Security Reviewer**, I want all API authentication handled in a single Fastify boundary so that I can audit one auth implementation instead of two.

**Acceptance Criteria**:

```gherkin
Given the SvelteKit frontend makes an API request
When the request hits /api/v1/*
Then it is handled directly by Fastify (no SvelteKit proxy)
And authentication is validated by Fastify's auth plugin
And RBAC permissions are enforced by Fastify's rbac plugin

Given SvelteKit previously handled /api/auth/* routes
When Better Auth is migrated to Fastify
Then OIDC callbacks, session management, and CSRF protection work from Fastify
And SvelteKit hooks only forward the session cookie (no auth logic)

Given Phase 9 introduced the FASTIFY_PROXY_ROUTES feature flag to gate the cutover
When Phase 10 is complete
Then the proxy code and feature flag stay deleted
And SvelteKit serves only SSR pages and static assets
```

**Affected Files**: `apps/frontend/src/hooks.server.ts`, `apps/api/src/plugins/auth.ts`, `apps/api/src/routes/auth.ts` (new)
**Test File**: `apps/api/src/tests/routes/auth-routes.test.ts`

#### US-2: OCI SDK Migration (Engineer, Developer)

As an **Operations Engineer**, I want OCI tool calls to respond in under 500ms so that CloudAdvisor conversations feel interactive.

**Acceptance Criteria**:

```gherkin
Given the portal uses 60+ OCI CLI tool wrappers
When a tool is called via CloudAdvisor
Then it uses the official oci-sdk TypeScript API (not CLI subprocess)
And the response time is < 500ms p95 (vs 2-5s CLI)
And the response is natively typed (no CLI output parsing)

Given the oci-sdk is used for API calls
When authentication is configured
Then it uses OCI config file (~/.oci/config) or instance principal
And connection pooling and automatic retries are enabled

Given a tool call fails
When the SDK throws a structured exception
Then the error includes service name, status code, and opc-request-id
And the error is wrapped as OCIError (not raw Error)
```

**Affected Files**: `packages/shared/src/tools/executor-sdk.ts` (new), `packages/shared/src/tools/categories/*.ts`
**Test File**: `apps/api/src/tests/tools/oci-sdk-executor.test.ts`

#### US-3: Visual Workflow Designer Completion (Workflow Designer, Admin)

As a **Workflow Designer**, I want all 8 node types functional in the visual editor so that I can build complete automation workflows without workarounds.

**Acceptance Criteria**:

```gherkin
Given the workflow editor canvas
When I add an AI Step node
Then I can configure the model, prompt template, and output schema
And the executor sends the prompt to the selected AI model
And the response is available as step output for downstream nodes

Given the workflow editor canvas
When I add a Loop node with a collection input
Then the executor iterates over each item with configurable concurrency
And executes the loop body for each item
And aggregates results into an array output

Given the workflow editor canvas
When I add a Parallel node with multiple branches
Then the executor runs all branches concurrently (Promise.all)
And waits for all branches to complete before continuing
And each branch result is available by branch name

Given a tool node with retry configuration
When the tool call fails
Then the executor retries with exponential backoff (base * 2^attempt)
And respects maxRetries (default 3) and maxDelay (default 30s)
And logs each retry attempt

Given a workflow with compensation steps
When a node fails after previous nodes succeeded
Then the executor runs compensation handlers in reverse order
And records compensation results in the run audit trail
```

**Affected Files**: `packages/shared/src/server/workflows/executor.ts`, `apps/frontend/src/lib/components/workflow/*.svelte`
**Test File**: `apps/api/src/tests/workflows/executor.test.ts`

#### US-4: Package Split (Developer)

As a **Developer**, I want the shared package split into focused packages so that builds are fast and import boundaries are clear.

**Acceptance Criteria**:

```gherkin
Given the current @portal/shared monolith (25+ modules)
When Phase 10 is complete
Then three packages exist:
  - @portal/types: Zod schemas, TypeScript types, error hierarchy (no runtime deps)
  - @portal/server: Oracle, auth, workflows, admin repositories (server-only deps)
  - @portal/ui: Svelte components, stores, client utilities (Svelte deps)

Given @portal/types
When imported by any package
Then it has zero runtime dependencies (types + Zod only)
And compile time is < 1s

Given @portal/server
When imported by apps/api
Then it does NOT pull in Svelte or SvelteKit dependencies
And it does NOT re-export @portal/ui modules
```

**Affected Files**: `packages/types/package.json` (new), `packages/server/package.json` (new), `packages/ui/package.json` (new)
**Test File**: `packages/server/src/tests/**/*.test.ts`, build validation scripts

#### US-5: Oracle 26AI Modernization (Developer, Admin)

As a **Developer**, I want Oracle vector indexes to support real-time DML so that embeddings are searchable immediately after insertion.

**Acceptance Criteria**:

```gherkin
Given conversation embeddings are inserted
When using HNSW DML vector indexes
Then the embedding is searchable within 1 second (no index rebuild)
And index accuracy remains >= 95% at topK=10

Given vector data is bound to Oracle queries
When using node-oracledb 6.10
Then Float32Array values are bound directly (no vectorToOracleString conversion)
And oracledb.DB_TYPE_VECTOR is used for flexible vector columns

Given multi-tenant vector search
When using VPD (Virtual Private Database) policies
Then queries automatically filter by org_id
And no application code can bypass tenant isolation
```

**Affected Files**: `apps/api/src/mastra/rag/oracle-vector-store.ts`, `packages/shared/src/server/oracle/migrations/015-26ai.sql` (new)
**Test File**: `apps/api/src/tests/rag/oracle-vector-store.test.ts`

#### US-6: Self-Built Admin Experience (Admin, Developer)

As a **Platform Admin**, I want a coherent admin experience for managing agents, monitoring workflows, and testing tools so that I don't need a separate dev tool (Mastra Studio) running alongside the portal.

**Acceptance Criteria**:

```gherkin
Given the admin portal at /admin/agents
When I select an agent (e.g. CloudAdvisor)
Then I can chat with it in a streaming playground
And I can see real-time tool calls as the agent works
And I can view token usage, latency, and model selection per request

Given the admin portal at /admin/workflows/runs
When a workflow is executing
Then I see live SSE-powered step-by-step progress
And I can pause, resume, or cancel a running workflow
And I can view execution history with filtering

Given the admin portal at /admin/tools/playground
When I select a tool and provide arguments
Then I can execute it and see the raw OCI response
And dangerous tools show the approval flow preview
And execution time and category are displayed

Given the admin portal at /admin/observability
When I view the observability dashboard
Then I see agent traces (tool calls, ordering, latency)
And workflow run timelines with error rates
And cost tracking per agent/workflow/model
```

**Affected Files**: `apps/frontend/src/routes/admin/agents/`, `apps/frontend/src/routes/admin/tools/playground/`, `apps/frontend/src/routes/admin/observability/` (all new)
**Test File**: `apps/frontend/src/tests/phase10/admin-experience.test.ts`

#### US-7: Frontend Design Iteration with Browser Feedback (Developer, Admin)

As a **Developer**, I want to iterate on admin UI designs using browser-based feedback loops so that design decisions are validated visually before committing to implementation.

**Acceptance Criteria**:

```gherkin
Given a new admin page design
When multiple design iterations are created
Then each iteration is branched for independent evaluation
And browser screenshots/feedback inform the selection process

Given the admin portal design system
When new pages are added
Then they use shadcn-svelte components consistently
And responsive design works across desktop and tablet viewports
And the design matches the existing portal aesthetic
```

**Affected Files**: All new admin pages
**Test File**: Visual regression tests via browser automation

### Non-Goals

- **Kubernetes migration**: Stay on single OCI instance with Docker Compose
- **GraphQL API**: REST + SSE is sufficient; GraphQL adds complexity without clear benefit
- **Mobile app**: Responsive web only; native apps are out of scope
- **Multi-region deployment**: Single region with DR as a future phase
- **Mastra Studio embedding**: Studio is a standalone dev tool (Hono + React), not embeddable in SvelteKit. Build custom admin experience instead (AD-53)
- **Real-time collaboration**: No WebSocket-based multi-user workflow editing
- **Full SvelteKit removal**: SvelteKit stays for SSR/UI — we remove its API role, not the framework

---

## 2A. Engineering Traceability (Contract)

This section makes Phase 10 executable: each requirement maps to Phase 10 tasks, primary files, tests, and runnable verification gates.

| Requirement                                                                       | Phase 10 Tasks (primary)                            | Key Files (indicative)                                                                                                                                                                | Tests (primary)                                                                              | Verification Gates                                                                                                   |
| --------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| US-1 Fastify-first API boundary + single auth/RBAC enforcement                    | C-1.01..C-1.05, C-2.01..C-2.06, C-3.05..C-3.08      | `apps/api/src/app.ts`, `apps/api/src/plugins/auth.ts`, `apps/api/src/routes/`, `apps/frontend/src/hooks.server.ts`, `apps/frontend/src/routes/+layout.server.ts`                      | `apps/api/src/tests/routes/auth-routes.test.ts`, `apps/api/src/tests/routes/*.test.ts`       | `npx vitest run apps/api`; `find apps/frontend -name '+server.ts'` (0 API routes); `cd apps/api && npx tsc --noEmit` |
| US-2 OCI SDK migration (latency + structured errors)                              | D-1.01..D-1.03, D-2.01..D-2.05, D-3.01..D-3.06      | `packages/shared/src/tools/sdk-auth.ts` (new), `packages/shared/src/tools/executor-sdk.ts` (new), `packages/shared/src/tools/categories/`                                             | `apps/api/src/tests/tools/executor-sdk.test.ts`, `apps/api/src/tests/tools/*.test.ts`        | `npx vitest run apps/api`; benchmark script (p95 SDK < 500ms)                                                        |
| US-3 Workflow designer node completion + executor features                        | E-1.01..E-1.03, E-2.01..E-2.07, E-3.03..E-3.06      | `apps/api/src/mastra/workflows/`, `packages/shared/src/workflows/types.ts`, `apps/frontend/src/lib/components/workflow/`                                                              | `apps/api/src/tests/workflows/executor.test.ts`, `apps/frontend/src/tests/phase10/*.test.ts` | `npx vitest run`; `cd apps/frontend && npx svelte-check`                                                             |
| US-4 Package split (`@portal/types`, `@portal/server`, `@portal/ui`)              | B-1.01..B-1.07, B-2.01..B-2.05                      | `packages/types/`, `packages/server/`, `packages/ui/`, `pnpm-workspace.yaml`                                                                                                          | Package-level build/typecheck tests as defined in Phase B                                    | `pnpm build`; `npx vitest run`; `npx madge --circular`                                                               |
| US-5 Oracle 26AI modernization (HNSW DML + typed vector binding + VPD)            | F-1.01..F-1.03, F-2.01..F-2.05                      | `apps/api/src/mastra/rag/oracle-vector-store.ts`, `packages/shared/src/server/oracle/migrations/015-hnsw.sql` (new), `packages/shared/src/server/oracle/migrations/017-vpd.sql` (new) | `apps/api/src/tests/rag/oracle-vector-store.test.ts`, VPD isolation tests                    | `npx vitest run apps/api`; migration run; benchmark shows 3x improvement                                             |
| US-6 Admin experience pages (agents/workflow runs/tools playground/observability) | B-3.06..B-3.15, (additional admin tasks as defined) | `apps/frontend/src/routes/admin/agents/`, `apps/frontend/src/routes/admin/tools/playground/`, `apps/frontend/src/routes/admin/observability/`                                         | `apps/frontend/src/tests/phase10/admin-experience.test.ts`                                   | `npx vitest run apps/frontend`; `cd apps/frontend && npx svelte-check`                                               |
| US-7 Browser-feedback design iterations                                           | Process requirement                                 | All new admin pages                                                                                                                                                                   | Visual regression / screenshots as defined                                                   | Manual: capture screenshots per iteration; record decision in PRD                                                    |

Notes:

- Phase 10 task IDs are defined in `.claude/reference/phase-10-task-plan.md`.
- File paths are indicative; treat the gates as authoritative.

## 3. Separation of Concerns

### Current State Before Fastify Cutover (Problematic)

```
Request → Nginx → SvelteKit hooks.server.ts
                      ├── Auth check (Better Auth)
                      ├── Request tracing (X-Request-Id)
                      ├── Feature flag check (FASTIFY_ENABLED?)
                      │   ├── YES → Proxy to Fastify (re-auth, re-trace)
                      │   └── NO → Handle in SvelteKit +server.ts
                      └── SSR page rendering

Result: Two auth implementations, duplicated middleware, confused routing
```

### Target State (Clean Layers)

```
Layer 1: Edge (Nginx)
├── TLS termination (TLS 1.2 + 1.3)
├── Rate limiting (defence-in-depth)
├── H2C smuggling prevention (Upgrade "" header)
├── Static asset serving
├── Route splitting:
│   ├── /api/* → Fastify :3001 (all API traffic)
│   └── /* → SvelteKit :3000 (all page traffic)
└── SSE buffering disabled for /api/

Layer 2: API (Fastify 5)
├── Plugin pipeline (18 steps, order is load-bearing):
│   1. Zod type provider
│   2. Request tracing (X-Request-Id)
│   3. Error handler (PortalError → HTTP)
│   4. Helmet (security headers)
│   5. CORS (credentials: true, trusted origins)
│   6. Rate limit (@fastify/rate-limit)
│   7. Cookie parser
│   8. Sensible defaults
│   9. Oracle connection pool
│   10. Setup detection
│   11. Auth (Better Auth — sessions, OIDC, API keys)
│   12. RBAC (deny-by-default, 13 permissions)
│   13. Mastra (agent, RAG, MCP, workflows)
│   14. Swagger + Swagger UI
│   15-18. Route modules (grouped)
├── Request decorators: user, session, permissions (Symbol-keyed), apiKeyContext
├── Deny-by-default auth gate: onRequest hook rejects unauthenticated
└── Route handlers: chat, workflows, admin, tools, search, sessions, etc.

Layer 3: UI (SvelteKit)
├── SSR page rendering only
├── +layout.server.ts: reads session cookie, passes auth data to client
├── +page.server.ts: server-side data loading via Fastify API calls
├── Zero +server.ts API routes
├── No auth logic (cookie forwarding only)
├── 54 Svelte 5 components (fully migrated to runes)
└── TanStack Query for server state management

Layer 4: Business Logic (@portal/server)
├── Oracle repositories (connection pool, migrations)
├── Auth configuration (Better Auth setup, IDCS, API keys)
├── Admin repositories (IDP, AI providers, settings, MCP)
├── Workflow executor and repository
├── Crypto (AES-256-GCM), logger (Pino), metrics (Prometheus)
└── Zero framework dependencies (no Fastify, no SvelteKit)

Layer 5: Types (@portal/types)
├── Zod schemas (API request/response, tools, workflows)
├── TypeScript types
├── PortalError hierarchy + type guards
└── Zero runtime dependencies (Zod only)

Layer 6: Data (Oracle Database 26AI)
├── HNSW DML vector indexes (real-time searchable embeddings)
├── JSON Relational Duality Views (workflow definitions)
├── VPD tenant isolation (database-level org_id filtering)
├── Blockchain audit tables (immutable audit trail)
└── AES-256-GCM encrypted secrets at rest
```

### Boundary Rules

| Boundary                   | Rule                                                        | Enforcement                    |
| -------------------------- | ----------------------------------------------------------- | ------------------------------ |
| SvelteKit → Fastify        | SvelteKit NEVER handles API logic                           | Remove all +server.ts files    |
| Fastify → @portal/server   | Fastify routes call server functions, not Oracle directly   | Lint rule: no oracledb imports |
| @portal/server → Oracle    | All DB access through repositories with bind parameters     | Code review                    |
| @portal/types → anything   | Types package has zero runtime deps (Zod only)              | Package.json validation        |
| @portal/ui → @portal/types | UI may import types, never server                           | TypeScript path restrictions   |
| Frontend → API             | All data fetching via HTTP to Fastify (no direct DB access) | SvelteKit server/client split  |

---

## 4. Authentication Architecture

### Current Auth Flow

```
SvelteKit hooks.server.ts:
  ├── Reads session cookie → Better Auth validateSession()
  ├── OIDC callbacks handled by SvelteKit /api/auth/*
  ├── Sets event.locals.user, event.locals.session
  └── Proxies /api/* to Fastify (with cookie forwarded)

Fastify auth plugin:
  ├── Reads same session cookie → validates via Oracle session table
  ├── OR reads X-API-Key header → validates via Oracle api_keys table
  ├── Sets request.user, request.session, request.permissions
  └── Deny-by-default: rejects unauthed requests not in PUBLIC_ROUTES
```

**Problem**: Two separate auth validations for the same request. Session created by SvelteKit, re-validated by Fastify. OIDC callbacks split across runtimes.

### Target Auth Flow

```
Fastify (single auth boundary):
  ├── /api/auth/* → Better Auth handler (OIDC, sessions, CSRF)
  │   ├── Catch-all route: ["GET", "POST"] /api/auth/*
  │   ├── Convert Fastify request to Fetch API Request (toWebRequest)
  │   ├── Call auth.handler(request)
  │   └── trustedOrigins: [FRONTEND_URL]
  │
  ├── Session auth (cookie-based):
  │   ├── Read session cookie from request
  │   ├── Validate via Better Auth session store (Oracle adapter)
  │   ├── Decorate: request.user, request.session
  │   └── Load permissions from user role → request.permissions
  │
  ├── API key auth (header-based):
  │   ├── Read X-API-Key header
  │   ├── SHA-256 hash → lookup in Oracle api_keys table
  │   ├── Decorate: request.apiKeyContext { orgId, permissions }
  │   └── request.permissions from API key scope
  │
  └── RBAC enforcement:
      ├── Deny-by-default onRequest hook
      ├── PUBLIC_ROUTES exempted (health, openapi, setup)
      ├── Permission check against route requirements
      └── 401 (no session) or 403 (insufficient permissions)

SvelteKit (cookie forwarding only):
  ├── +layout.server.ts: reads session cookie, calls Fastify /api/auth/session
  ├── Passes { user, session } to client via page data
  └── No auth logic — just HTTP fetch to Fastify for session info
```

### Better Auth Configuration

```typescript
// Fastify catch-all route (from Better Auth Fastify docs)
fastify.route({
	method: ['GET', 'POST'],
	url: '/api/auth/*',
	handler: async (request, reply) => {
		const headers = new Headers();
		for (const [key, value] of Object.entries(request.headers)) {
			if (value) headers.append(key, String(value));
		}
		const req = new Request(new URL(request.url, `${request.protocol}://${request.hostname}`), {
			method: request.method,
			headers,
			body: request.body ? JSON.stringify(request.body) : undefined
		});
		const response = await auth.handler(req);
		// Forward response back through Fastify reply
	}
});
```

### Auth Components

| Component             | Location                                    | Purpose                                      |
| --------------------- | ------------------------------------------- | -------------------------------------------- |
| Better Auth config    | `@portal/server/auth/auth-factory.ts`       | Creates auth instance with Oracle adapter    |
| OIDC/IDCS integration | `@portal/server/auth/idcs-provisioning.ts`  | OCI Identity Cloud Service via genericOAuth  |
| Session store         | Oracle `sessions` table                     | Cookie-based sessions with configurable TTL  |
| API key store         | Oracle `api_keys` table                     | SHA-256 hashed keys with per-key permissions |
| Organization plugin   | Better Auth `organization()` plugin         | Multi-org support, member roles, invitations |
| Fastify auth plugin   | `apps/api/src/plugins/auth.ts`              | Validates session/API key, decorates request |
| RBAC plugin           | `apps/api/src/plugins/rbac.ts`              | Deny-by-default permission enforcement       |
| CSRF protection       | Better Auth built-in (double-submit cookie) | Automatic with Better Auth handler           |

### 37 SvelteKit API Routes to Migrate

These `+server.ts` files must be replaced by Fastify routes:

**Auth & Sessions (3 routes)**:

- `/api/auth/[...all]/+server.ts` — Better Auth catch-all (OIDC callbacks, session mgmt)
- `/api/sessions/+server.ts` — Session list/management
- `/api/sessions/[id]/+server.ts` — Individual session operations

**Chat & AI (6 routes)**:

- `/api/chat/+server.ts` — Chat message handling
- `/api/chat/approve/+server.ts` — Tool approval
- `/api/chat/reject/+server.ts` — Tool rejection
- `/api/chat/sessions/+server.ts` — Chat session list
- `/api/chat/sessions/[id]/+server.ts` — Chat session details
- `/api/chat/sessions/[id]/fork/+server.ts` — Fork a chat session

**Tools (4 routes)**:

- `/api/tools/+server.ts` — Tool listing
- `/api/tools/execute/+server.ts` — Tool execution
- `/api/v1/tools/+server.ts` — V1 tool listing
- `/api/v1/tools/[name]/+server.ts` — V1 tool details

**Workflows (5 routes)**:

- `/api/workflows/+server.ts` — Workflow CRUD
- `/api/workflows/[id]/+server.ts` — Workflow details
- `/api/workflows/[id]/run/+server.ts` — Execute workflow
- `/api/workflows/[id]/runs/+server.ts` — List workflow runs
- `/api/workflows/[id]/runs/[runId]/+server.ts` — Run details

**Admin (10 routes)**:

- `/api/admin/setup/+server.ts` — Initial setup
- `/api/admin/settings/+server.ts` — Portal settings
- `/api/admin/idp/+server.ts` — Identity provider config
- `/api/admin/models/+server.ts` — AI model management
- `/api/admin/models/test/+server.ts` — Model connection test
- `/api/admin/models/import/+server.ts` — Model import
- `/api/admin/mcp/+server.ts` — MCP server management
- `/api/admin/mcp/[id]/+server.ts` — Individual MCP server
- `/api/admin/mcp/catalog/+server.ts` — MCP server catalog
- `/api/admin/integrations/+server.ts` — Admin integrations

**Webhooks & Misc (9 routes)**:

- `/api/webhooks/+server.ts` — Webhook management
- `/api/webhooks/test/+server.ts` — Webhook test
- `/api/webhooks/[id]/+server.ts` — Individual webhook
- `/api/v1/webhooks/[name]/+server.ts` — V1 webhook trigger
- `/api/setup/+server.ts` — Setup wizard
- `/api/setup/test-connection/+server.ts` — DB connection test
- `/api/setup/create-admin/+server.ts` — First admin creation
- `/api/setup/test-oci/+server.ts` — OCI config test
- `/api/setup/configure-oci/+server.ts` — OCI configuration

---

## 5. Authorization Architecture

### Role Model

| Role       | Level    | Permissions                                                                                     |
| ---------- | -------- | ----------------------------------------------------------------------------------------------- |
| `viewer`   | Org-wide | `chat:read`, `tools:read`, `workflows:read`, `sessions:read`                                    |
| `operator` | Org-wide | All viewer + `chat:write`, `tools:execute`, `workflows:execute`, `sessions:write`               |
| `admin`    | Org-wide | All operator + `admin:all`, `tools:manage`, `workflows:manage`, `webhooks:manage`, `mcp:manage` |

### 13 Permissions

| Permission          | Description                            | Roles                   |
| ------------------- | -------------------------------------- | ----------------------- |
| `chat:read`         | View chat history                      | viewer, operator, admin |
| `chat:write`        | Send messages to CloudAdvisor          | operator, admin         |
| `tools:read`        | View tool definitions                  | viewer, operator, admin |
| `tools:execute`     | Execute OCI tools                      | operator, admin         |
| `tools:manage`      | Create/modify tool configurations      | admin                   |
| `workflows:read`    | View workflow definitions              | viewer, operator, admin |
| `workflows:execute` | Run workflows                          | operator, admin         |
| `workflows:manage`  | Create/modify workflow definitions     | admin                   |
| `sessions:read`     | View session history                   | viewer, operator, admin |
| `sessions:write`    | Create/delete sessions                 | operator, admin         |
| `webhooks:manage`   | Create/modify webhooks                 | admin                   |
| `mcp:manage`        | Manage MCP server connections          | admin                   |
| `admin:all`         | Full admin access (settings, IDP, etc) | admin                   |

### RBAC Enforcement

```
Request → auth plugin (validates identity)
        → rbac plugin (checks permissions)
           ├── Route has @requirePermission('tools:execute')?
           │   ├── request.permissions includes it? → Allow
           │   └── Missing? → 403 Forbidden
           └── Route in PUBLIC_ROUTES? → Skip check
```

**Implementation**:

- Deny-by-default `onRequest` hook runs on every request
- `PUBLIC_ROUTES` set exempts health, openapi spec, setup endpoints
- Permissions loaded from role mapping at auth time (not per-request DB lookup)
- API keys carry their own permission scope (can be more restrictive than role)

### Multi-Org Isolation

- Better Auth `organization()` plugin manages org membership
- `resolveOrgId(request)` extracts org from session or API key context
- All repository methods accept `orgId` parameter — no global state
- VPD policies (Phase 10) add database-level enforcement as defence-in-depth

---

## 6. Backend Architecture (Fastify 5)

### Plugin Registration Order

The order is **load-bearing** — changing it breaks the auth pipeline.

```
1.  Zod type provider (validatorCompiler, serializerCompiler)
2.  Request tracing (X-Request-Id generation/forwarding)
3.  Error handler (PortalError → structured HTTP responses)
4.  Helmet (security headers via @fastify/helmet)
5.  CORS (credentials: true, trusted origins via @fastify/cors)
6.  Rate limit (configurable per-route via @fastify/rate-limit)
7.  Cookie parser (@fastify/cookie)
8.  Sensible defaults (@fastify/sensible — httpErrors helpers)
9.  Oracle connection pool (withConnection decorator)
10. Setup detection (portal setup state check)
11. Auth plugin (Better Auth handler + session/API key validation)
12. RBAC plugin (deny-by-default permission enforcement)
13. Mastra plugin (agent, RAG, MCP, tool discovery, workflows)
14. Swagger + Swagger UI (OpenAPI spec generation, auth-gated UI)
15. Route modules: health, auth, chat, tools, search, sessions
16. Route modules: workflows, webhooks, admin, metrics, setup
17. Route modules: activity, audit, graph, models, schemas, openapi
18. Mastra routes (@mastra/fastify auto-registered)
```

### Request Decorators

| Decorator        | Type                    | Set By        | Notes                                        |
| ---------------- | ----------------------- | ------------- | -------------------------------------------- |
| `user`           | `User \| null`          | Auth plugin   | Session user object                          |
| `session`        | `Session \| null`       | Auth plugin   | Session metadata                             |
| `permissions`    | `string[]`              | Auth plugin   | Symbol-keyed (Fastify 5 reference-type)      |
| `apiKeyContext`  | `ApiKeyContext \| null` | Auth plugin   | API key org/permissions when using X-API-Key |
| `withConnection` | `<T>(fn) => Promise<T>` | Oracle plugin | Leases Oracle connection from pool           |

### Route Module Structure

Each route module follows:

```typescript
export default async function routes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/api/v1/resource', {
    schema: {
      querystring: z.object({ ... }),
      response: { 200: z.object({ ... }) }
    },
    preHandler: [requirePermission('resource:read')]
  }, async (request, reply) => {
    const orgId = resolveOrgId(request);
    const result = await fastify.withConnection(async (conn) => {
      return repository.list(conn, orgId);
    });
    return reply.send(result);
  });
}
```

### Error Handling

```
Fastify error handler plugin:
  ├── PortalError? → toResponseBody() (structured, never exposes internals)
  ├── Fastify validation error? → 400 with Zod error details
  ├── Unknown error? → toPortalError(err) wraps as INTERNAL_ERROR(500)
  └── All errors: Pino structured log + Sentry capture (if configured)
```

---

## 7. Frontend Architecture (SvelteKit)

### Current State

- **14 page routes** across 4 layouts (root, admin, self-service, workflows)
- **37 `+server.ts` API routes** (all to be migrated to Fastify — see Section 4)
- **54 Svelte components** in 7 groups:
  - `admin/` — Admin console (IDP, AI models, settings, MCP)
  - `mobile/` — Responsive adaptations
  - `panels/` — Info, help, settings panels
  - `portal/` — Main portal UI (sidebar, header, overlay)
  - `setup/` — First-run setup wizard
  - `ui/` — Base UI components (buttons, dialogs, tooltips)
  - `workflows/` — Workflow designer (canvas, node editors)

### Svelte 5 Migration Status

Fully migrated. Zero legacy patterns remain in components:

| Pattern     | Count | Legacy Remaining |
| ----------- | ----- | ---------------- |
| `$props()`  | 62    | 0 `export let`   |
| `$state()`  | 55+   | 0 `let x = ...`  |
| `$derived`  | 65+   | 0 `$: x = ...`   |
| `$effect()` | 14    | 0 `$: { ... }`   |

**Remaining legacy**: 3 `writable` stores in `stores/ui.ts` (sidebar state, theme). These can remain — Svelte 5 runes and stores coexist. Migration to `$state` is optional.

### State Management Strategy

| State Type      | Tool                     | Example                                |
| --------------- | ------------------------ | -------------------------------------- |
| Server state    | TanStack Query           | Chat sessions, tool results, workflows |
| Component state | Svelte 5 runes ($state)  | Form inputs, toggles, local UI state   |
| Global UI       | Svelte stores (writable) | Sidebar open/closed, theme preference  |
| Auth state      | Page data (SSR)          | User, session from +layout.server.ts   |
| Workflow canvas | $state.raw()             | XY Flow nodes/edges (xyflow mutates)   |

### Layout Hierarchy

```
+layout.svelte (root)
├── QueryClientProvider (TanStack)
├── Toaster (svelte-sonner)
├── Auth data from +layout.server.ts
│
├── / → Main portal (CloudAdvisor chat)
├── /self-service → Overlay chat interface
│
├── /admin/ → +layout.svelte (admin)
│   ├── Auth gate: requires admin:all
│   ├── Sidebar navigation
│   ├── /admin/settings
│   ├── /admin/models
│   ├── /admin/idp
│   └── /admin/integrations
│
└── /workflows/ → +layout.svelte (workflows)
    ├── /workflows → List view
    └── /workflows/[id] → Visual editor (XY Flow canvas)
```

### Post-Migration Frontend

After all 37 `+server.ts` routes are removed:

```
apps/frontend/src/routes/
├── +layout.server.ts         ← Fetches session from Fastify /api/auth/session
├── +layout.svelte            ← Root layout (QueryClient, Toaster)
├── +page.svelte              ← Main chat interface
├── admin/
│   ├── +layout.server.ts     ← Auth gate via Fastify API
│   ├── +layout.svelte        ← Admin sidebar
│   ├── settings/+page.svelte
│   ├── models/+page.svelte
│   ├── idp/+page.svelte
│   └── integrations/+page.svelte
├── self-service/+page.svelte ← Overlay chat
├── setup/+page.svelte        ← First-run wizard
└── workflows/
    ├── +page.svelte           ← Workflow list
    └── [id]/+page.svelte      ← Visual editor
```

All data fetching via TanStack Query → Fastify API. Zero `+server.ts` files.

---

## 8. Middleware & Infrastructure

### Nginx (Edge Layer)

**Config**: `infrastructure/docker/phase9/nginx.conf`

```
TLS: 1.2 + 1.3 (ECDHE + AES-GCM ciphers)
Certificates: ${TLS_CERTS_DIR}/fullchain.pem, privkey.pem, dhparam.pem

Rate limiting:
  - /api/auth/*: 10 req/s (auth abuse prevention)
  - /api/*: 30 req/s (general API)
  - Static assets: no limit

Route splitting (Phase 10 target):
  location /api/ {
    proxy_pass http://api:3001;
    proxy_buffering off;           # SSE/streaming support
    proxy_set_header Upgrade "";   # H2C smuggling prevention
  }
  location / {
    proxy_pass http://frontend:3000;
  }

Security headers (server-level):
  - X-Frame-Options: DENY
  - X-Content-Type-Options: nosniff
  - Referrer-Policy: strict-origin-when-cross-origin
  - CSP: script-src 'nonce-...'
```

### Docker Compose

```yaml
services:
  nginx: # TLS termination, reverse proxy
  api: # Fastify 5 (expose: 3001, not ports:)
  frontend: # SvelteKit SSR (expose: 3000, not ports:)
  certbot: # Let's Encrypt renewal (profile: letsencrypt)
```

All containers: `read_only: true`, `no-new-privileges: true`, `tmpfs` for writable dirs.

### Container Hardening

| Container | Memory Limit               | CPU Limit               | Health Check                  |
| --------- | -------------------------- | ----------------------- | ----------------------------- |
| nginx     | Fixed (not configurable)   | Fixed                   | `wget --spider /nginx-health` |
| api       | `${API_MEMORY_LIMIT}`      | `${API_CPU_LIMIT}`      | `curl -f /health`             |
| frontend  | `${FRONTEND_MEMORY_LIMIT}` | `${FRONTEND_CPU_LIMIT}` | `curl -f /health`             |

---

## 9. Package Architecture

### Current: @portal/shared (Monolith)

```
packages/shared/src/           # 25+ modules, mixed concerns
├── errors.ts                  # PortalError hierarchy (should be in types)
├── index.ts                   # Re-exports everything
├── api/types.ts               # API types (should be in types)
├── tools/                     # Tool types + executor (mixed)
├── workflows/                 # Workflow types + utils (mixed)
└── server/                    # Server-only code
    ├── admin/                 # IDP, AI providers, settings repos
    ├── agent-state/           # SQLite chat state
    ├── auth/                  # Better Auth config, RBAC, IDCS, API keys
    ├── mcp/                   # MCP portal server
    ├── mcp-client/            # Custom MCP client (750 LOC — to be replaced)
    ├── oracle/                # Connections, migrations, repositories
    ├── logger.ts              # Pino factory
    ├── metrics.ts             # Prometheus
    ├── crypto.ts              # AES-256-GCM
    ├── feature-flags.ts       # Feature flag evaluation
    ├── approvals.ts           # Approval token management
    └── embeddings.ts          # OCI GenAI helpers
```

### Target: Three Focused Packages

#### @portal/types

Zero runtime dependencies. Pure types and Zod schemas.

```
packages/types/
├── src/
│   ├── api/          # API request/response types
│   ├── errors.ts     # PortalError hierarchy + type guards
│   ├── tools/        # ToolDefinition, ApprovalLevel, tool schemas
│   ├── workflows/    # WorkflowNode, WorkflowEdge, WorkflowRun
│   ├── pricing/      # PricingComparison, WorkloadRequirements
│   └── index.ts
├── package.json      # deps: { zod: "^4.3.6" }
└── tsconfig.json
```

#### @portal/server

Server-only business logic. No Svelte/SvelteKit deps.

```
packages/server/
├── src/
│   ├── oracle/       # connection pool, migrations, repositories
│   ├── auth/         # Better Auth config, RBAC, API keys, IDCS provisioning
│   ├── admin/        # IDP, AI provider, settings, MCP repositories
│   ├── workflows/    # executor, repository
│   ├── agent-state/  # SQLite session management
│   ├── mcp/          # MCP portal server (uses @modelcontextprotocol/sdk)
│   ├── crypto.ts     # AES-256-GCM encryption
│   ├── logger.ts     # Pino factory
│   ├── metrics.ts    # Prometheus registry
│   ├── feature-flags.ts
│   ├── approvals.ts
│   ├── embeddings.ts
│   └── index.ts
├── package.json      # deps: { oracledb, better-auth, pino, @portal/types }
└── tsconfig.json
```

#### @portal/ui

Svelte components, stores, and client utilities.

```
packages/ui/
├── src/
│   ├── components/   # 54 Svelte 5 components
│   ├── stores/       # Svelte stores (ui.ts)
│   ├── utils/        # Client-side utilities
│   └── index.ts
├── package.json      # deps: { svelte, @portal/types }
└── tsconfig.json
```

### Dependency Graph

```
@portal/types (zero deps, Zod only)
    ▲
    │
    ├── @portal/server (oracledb, better-auth, pino, prom-client)
    │       ▲
    │       └── apps/api (fastify, @mastra/*, oci-sdk)
    │
    └── @portal/ui (svelte, @xyflow/svelte, @tanstack/svelte-query)
            ▲
            └── apps/frontend (@sveltejs/kit)
```

**Rule**: No upward arrows. No cross-arrows between @portal/server and @portal/ui.

---

## 10. AI System Requirements

### Mastra Integration

| Component       | Current                                   | Phase 10 Target                         |
| --------------- | ----------------------------------------- | --------------------------------------- |
| Agent framework | @mastra/core 1.2.0                        | Keep current (stable)                   |
| RAG pipeline    | @mastra/rag 2.1.0                         | Keep current + HNSW DML indexes         |
| MCP integration | Custom client (750 LOC)                   | @modelcontextprotocol/sdk v1.26.0       |
| Fastify adapter | @mastra/fastify 1.1.1                     | Keep current (stable)                   |
| Memory          | @mastra/memory 1.1.0                      | Keep current (stable)                   |
| Tool discovery  | ToolSearchProcessor (94% token reduction) | Keep + extend for SDK-based tools       |
| Workflows       | Custom executor (500 LOC)                 | Enhance with Mastra workflow primitives |

### Mastra Workflow API (from Latest Docs)

The Mastra workflow system provides primitives that map to our remaining node types:

```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';

// Sequential execution (.then)
const workflow = createWorkflow({ id: 'my-workflow' })
  .then(stepA)
  .then(stepB)
  .commit();

// Parallel execution (.parallel)
workflow.then(createStep(...))
  .parallel([branchA, branchB, branchC])  // All run concurrently
  .then(mergeStep)
  .commit();

// Conditional branching (.branch)
workflow.then(inputStep)
  .branch([
    [async ({ inputData }) => inputData.type === 'compute', computeStep],
    [async ({ inputData }) => inputData.type === 'network', networkStep],
    [async () => true, defaultStep],  // Default branch
  ])
  .commit();

// Loop over collection (.foreach)
workflow.then(listStep)
  .foreach(processItem, { concurrency: 5 })  // Process items with concurrency
  .then(aggregateStep)
  .commit();

// Loop until condition (.dountil / .dowhile)
workflow.then(initStep)
  .dountil(retryStep, async ({ inputData }) => inputData.success === true)
  .commit();
```

### Suspend/Resume (Human-in-the-Loop)

```typescript
const approvalStep = createStep({
  id: 'get-approval',
  inputSchema: z.object({ action: z.string() }),
  outputSchema: z.object({ approved: z.boolean() }),
  resumeSchema: z.object({ decision: z.enum(['approve', 'reject']) }),
  execute: async ({ inputData, suspend, resumeData }) => {
    if (!resumeData) {
      // First execution: suspend and wait for human input
      await suspend({ action: inputData.action });
      return undefined;
    }
    // Resumed with human decision
    return { approved: resumeData.decision === 'approve' };
  }
});

// Resume a suspended workflow
const run = workflow.createRun();
const result = await run.start({ inputData: { ... } });
if (result.status === 'suspended') {
  // Later, when human approves:
  await run.resume({
    stepId: 'get-approval',
    resumeData: { decision: 'approve' }
  });
}
```

### Workflow Streaming

```typescript
const run = workflow.createRun();
const stream = run.stream({ inputData: { ... } });
for await (const event of stream.fullStream) {
  // event: { type: 'step-start' | 'step-complete' | 'step-error', stepId, data }
}
```

### ToolSearchProcessor

Already integrated in Phase 9. Reduces context tokens by 94% when agent has 60+ tools. No changes needed — continues to work with SDK-based tools since the tool interface is unchanged.

### Mastra Studio (Admin & Development Tool)

Mastra Studio is elevated to a **first-class admin/development tool** — not just a dev footnote. It replaces the need for several bespoke admin pages and provides capabilities that don't exist in the portal today.

**Architecture Decision**: AD-14 — Adopt Mastra Studio as primary agent/workflow debugging UI.

#### Capabilities

| Feature                          | What It Provides                                                            | Replaces/Augments                                           |
| -------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Agent Chat Playground**        | Interactive agent testing with model switching, temperature/top-p tuning    | New capability — no equivalent today                        |
| **Workflow Graph Visualization** | Real-time DAG rendering with step execution state, active path highlighting | Augments existing @xyflow/svelte designer with runtime view |
| **Tool Playground**              | Run any tool in isolation, inspect inputs/outputs                           | New capability — currently must test via chat               |
| **MCP Explorer**                 | Browse all connected MCP servers and their available tools                  | Augments admin MCP integrations page                        |
| **Observability Traces**         | AI-focused traces: model calls, tool executions, workflow steps             | Augments Sentry with AI-specific trace visualization        |
| **Eval Scorers**                 | Display @mastra/evals scorer results per agent interaction                  | New capability — requires @mastra/evals (AD-16)             |
| **REST API Explorer**            | OpenAPI + Swagger equivalent at `/mastra/studio`                            | Augments @fastify/swagger-ui, may replace @scalar           |

#### Access Control

```
Environment    Access                          Gating
─────────────────────────────────────────────────────────────
Development    Full access, no auth required    NODE_ENV === 'development'
Staging        Admin role required              Fastify RBAC + Better Auth session
Production     Disabled by default              MASTRA_STUDIO_ENABLED=true + admin auth
```

Studio routes are exposed via `@mastra/fastify` at the `studioBase` path (default: `/mastra`). In non-development environments, wrap with Fastify `onRequest` hook requiring `admin` role via RBAC plugin.

#### Configuration

```typescript
// apps/api/src/plugins/mastra.ts
const mastra = new Mastra({
	server: {
		port: 4111,
		studioBase: '/admin/studio', // Custom path under admin namespace
		build: {
			openAPIDocs: true, // Expose OpenAPI spec via Studio
			swaggerUI: process.env.NODE_ENV !== 'production'
		}
	}
});
```

#### Integration with Existing Admin Console

Studio **augments** (not replaces) the existing admin console:

- Admin console (`/admin/*`) remains the primary UI for IDP, AI Providers, Settings, MCP server management
- Studio (`/admin/studio`) provides the AI debugging/testing layer
- Navigation sidebar links to Studio from admin console
- Studio uses the same Better Auth session for authenticated access

### New Mastra Packages

#### @mastra/sentry — AI Observability (AD-15)

Bridges Mastra's internal tracing to Sentry with AI-specific span mapping:

```typescript
import { SentryExporter } from '@mastra/sentry';

const mastra = new Mastra({
	telemetry: {
		export: {
			type: 'custom',
			exporter: new SentryExporter({ debug: false })
		}
	}
});
```

| Mastra Span        | Sentry Operation      | Attributes                         |
| ------------------ | --------------------- | ---------------------------------- |
| `AGENT_RUN`        | `gen_ai.invoke_agent` | agent.name, resourceId, threadId   |
| `TOOL_CALL`        | `gen_ai.execute_tool` | tool.name, connectionId            |
| `MODEL_GENERATION` | `gen_ai.chat`         | gen_ai.request.model, token counts |
| `WORKFLOW_RUN`     | `workflow.run`        | workflow.name, trigger.type        |

**Benefit**: Sentry dashboard shows AI-specific performance — model latency, tool success rates, agent cost breakdown — alongside existing error tracking.

#### @mastra/evals — Agent Quality Scoring (AD-16)

Scorer framework for measuring agent output quality:

```typescript
import { createAnswerRelevancyScorer, createToxicityScorer } from '@mastra/evals';

const cloudAdvisor = new Agent({
	id: 'cloud-advisor',
	evals: {
		scorers: [
			createAnswerRelevancyScorer({ model: 'openai/gpt-4o-mini' }),
			createToxicityScorer({ model: 'openai/gpt-4o-mini' })
		],
		sampling: { rate: 0.1 } // Score 10% of production interactions
	}
});
```

Scores persist to `mastra_scorers` table (auto-created by Mastra storage). Studio's Scorers tab displays results over time.

**Use cases**: Detect prompt injection success rate, track relevancy degradation after model updates, compare scoring across providers.

#### Agent Guardrails — Security Processors (AD-17)

Input/output processors that protect the agent pipeline:

| Processor                 | Type   | Strategy  | Purpose                                                    |
| ------------------------- | ------ | --------- | ---------------------------------------------------------- |
| `PromptInjectionDetector` | Input  | `block`   | Detect and reject injection attempts before reaching model |
| `PIIDetector`             | Hybrid | `redact`  | Strip PII from inputs/outputs (emails, SSNs, credit cards) |
| `ModerationProcessor`     | Output | `warn`    | Flag inappropriate content, log but don't block            |
| `TokenLimiterProcessor`   | Output | `block`   | Prevent runaway responses exceeding token budget           |
| `SystemPromptScrubber`    | Output | `rewrite` | Remove system prompt leakage from responses                |

```typescript
const cloudAdvisor = new Agent({
	id: 'cloud-advisor',
	inputProcessors: [
		new PromptInjectionDetector({ strategy: 'block', model: 'openai/gpt-4o-mini' }),
		new PIIDetector({ strategy: 'redact', patterns: ['email', 'ssn'] })
	],
	outputProcessors: [
		new TokenLimiterProcessor({ maxTokens: 4000 }),
		new ModerationProcessor({ strategy: 'warn' })
	]
});
```

### Mastra Workflow Enhancements

#### Lifecycle Callbacks (AD-18)

```typescript
const workflow = createWorkflow({
	id: 'provision-infra',
	onFinish: async ({ runId, result }) => {
		await auditLog.record({ runId, status: result.status });
		if (result.status === 'success') await notifySlack(runId);
	},
	onError: async ({ runId, error, step }) => {
		await sentry.captureException(error, { extra: { runId, step } });
		await notifyAdmin({ runId, step, error: error.message });
	},
	retryConfig: { attempts: 3, delay: 'exponential' }
});
```

#### Typed Snapshots with suspendSchema/resumeSchema (AD-19)

Already shown in Section 11 (Suspend/Resume). Adds type safety to human-in-the-loop workflows — `suspend()` and `resume()` payloads are validated against Zod schemas at runtime.

#### Workflow Streaming via writer Argument (AD-20)

```typescript
const streamStep = createStep({
	id: 'stream-analysis',
	execute: async ({ inputData, mastra }, { writer }) => {
		const agent = mastra.getAgent('cloud-advisor');
		const { textStream } = await agent.stream(inputData.prompt);
		// Pipe agent stream directly to workflow stream
		await textStream.pipeTo(writer);
		return { complete: true };
	}
});

// Client-side consumption
const stream = run.stream({ inputData: { prompt: 'Analyze my VCN' } });
for await (const event of stream.fullStream) {
	// Real-time step progress + streamed agent output
	updateUI(event);
}
```

---

## 11. Workflow Designer Completion

### Node Type Implementation Map

| Node Type    | Status   | Mastra Primitive            | Implementation                                   |
| ------------ | -------- | --------------------------- | ------------------------------------------------ |
| input        | Done     | `createStep` inputSchema    | —                                                |
| tool         | Done     | `createStep` + tool call    | —                                                |
| condition    | Done     | `.branch()`                 | —                                                |
| approval     | Done     | `suspend()` / `resume()`    | —                                                |
| output       | Done     | `createStep` outputSchema   | —                                                |
| **ai-step**  | **TODO** | `createStep` + agent call   | Prompt template → AI model → parsed response     |
| **loop**     | **TODO** | `.foreach({ concurrency })` | Iterate collection with configurable concurrency |
| **parallel** | **TODO** | `.parallel([...])`          | Run branches concurrently, merge results         |

### AI Step Node

```typescript
const aiStep = createStep({
	id: 'ai-analysis',
	inputSchema: z.object({
		prompt: z.string(),
		model: z.string(),
		outputSchema: z.record(z.unknown()).optional()
	}),
	outputSchema: z.object({ response: z.string(), structured: z.unknown().optional() }),
	execute: async ({ inputData, mastra }) => {
		const agent = mastra.getAgent('cloud-advisor');
		const result = await agent.generate(inputData.prompt, {
			model: inputData.model,
			output: inputData.outputSchema ? z.object(inputData.outputSchema) : undefined
		});
		return { response: result.text, structured: result.object };
	}
});
```

### Loop Node

```typescript
// Maps to Mastra .foreach() with concurrency control
workflow
	.then(getItemsStep) // Returns { items: [...] }
	.foreach(processItemStep, {
		concurrency: 5 // Process up to 5 items in parallel
	})
	.then(aggregateResultsStep) // Receives array of results
	.commit();
```

### Parallel Node

```typescript
// Maps to Mastra .parallel()
workflow
	.then(inputStep)
	.parallel([
		checkCompute, // Branch 1: check compute resources
		checkNetwork, // Branch 2: check networking
		checkStorage // Branch 3: check storage
	])
	.then(mergeResultsStep) // Receives results from all branches
	.commit();
```

### Retry Policy

```typescript
interface RetryPolicy {
	maxRetries: number; // Default: 3
	baseDelayMs: number; // Default: 1000
	maxDelayMs: number; // Default: 30000
	backoffMultiplier: number; // Default: 2 (exponential)
}
// Delay = min(baseDelay * multiplier^attempt, maxDelay)
```

### Compensation / Saga Pattern

When a node fails after previous nodes succeeded:

1. Executor marks failed node
2. Walks backward through completed nodes
3. Executes each node's `compensationHandler` if defined
4. Records compensation results in run audit trail
5. Final run status: `compensated` or `compensation_failed`

### SSE Streaming for Execution Progress

Powered by Mastra's `run.stream()` API:

```typescript
// Server: Fastify SSE endpoint
fastify.get('/api/v1/workflows/runs/:runId/stream', async (request, reply) => {
	reply.raw.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive'
	});

	const run = workflow.createRun();
	const stream = run.stream({ inputData: runInput });
	for await (const event of stream.fullStream) {
		reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
	}
	reply.raw.end();
});

// Client: EventSource
const events = new EventSource(`/api/v1/workflows/runs/${runId}/stream`);
events.onmessage = (e) => {
	const update = JSON.parse(e.data);
	// { type, stepId, status, result?, error?, timestamp }
};
```

### Crash Recovery

Mastra provides `restartAllActiveWorkflowRuns()` for resuming workflows after process restart. Workflow snapshots are stored in the configured storage provider (Oracle via OracleStore).

---

## 12. Oracle 26AI Modernization

### HNSW DML Indexes (Replaces IVF)

```sql
-- Before (IVF — requires rebuild after inserts)
CREATE VECTOR INDEX idx_conv_embed
  ON CONVERSATION_EMBEDDINGS(embedding)
  ORGANIZATION NEIGHBOR PARTITIONS
  DISTANCE COSINE
  WITH TARGET ACCURACY 95;

-- After (HNSW — supports real-time DML)
CREATE VECTOR INDEX idx_conv_embed_hnsw
  ON CONVERSATION_EMBEDDINGS(embedding)
  ORGANIZATION INMEMORY NEIGHBOR GRAPH
  DISTANCE COSINE
  WITH TARGET ACCURACY 95
  PARAMETERS (type HNSW, neighbors 16, efConstruction 200);
```

**Benefit**: Embeddings are searchable within 1 second of insertion (no index rebuild). HNSW `neighbors 16` balances accuracy with memory on small instances.

### Direct Float32Array Vector Binding

```typescript
// Before (string conversion — unnecessary overhead)
const vectorString = vectorToOracleString(embedding);
await conn.execute(`INSERT INTO embeddings (id, embedding) VALUES (:id, :vec)`, {
	id,
	vec: vectorString
});

// After (direct TypedArray binding — node-oracledb 6.5+)
await conn.execute(`INSERT INTO embeddings (id, embedding) VALUES (:id, :vec)`, {
	id,
	vec: new Float32Array(embedding)
});

// For queries, bind DB_TYPE_VECTOR for flexible columns:
const result = await conn.execute(
	`SELECT id, embedding FROM embeddings
   WHERE VECTOR_DISTANCE(embedding, :query, COSINE) < :threshold`,
	{
		query: { val: new Float32Array(queryVector), type: oracledb.DB_TYPE_VECTOR },
		threshold: 0.3
	}
);
// result.rows[0].embedding is already a Float32Array
```

**Benefit**: Eliminates string serialization/deserialization overhead for every vector operation.

### JSON Relational Duality Views

```sql
CREATE JSON RELATIONAL DUALITY VIEW workflow_definitions_dv AS
  SELECT JSON {
    'id': d.id,
    'name': d.name,
    'version': d.version,
    'nodes': (SELECT JSON_ARRAYAGG(JSON {
      'id': n.id,
      'type': n.node_type,
      'config': n.config
    }) FROM workflow_nodes n WHERE n.definition_id = d.id)
  }
  FROM workflow_definitions d WITH INSERT UPDATE DELETE;
```

**Benefit**: Workflow definitions stored relationally but queried as JSON documents. Updates through either view are consistent.

### Hybrid Vector Index

```sql
CREATE HYBRID VECTOR INDEX idx_docs_hybrid
  ON documents(content, embedding)
  PARAMETERS (
    text_index_type CONTEXT,
    vector_distance COSINE,
    text_weight 0.3,
    vector_weight 0.7
  );
```

**Benefit**: Single query combines keyword search with semantic similarity. Improves RAG relevance for technical documentation.

### VPD Tenant Isolation

```sql
CREATE OR REPLACE FUNCTION portal_vpd_policy(
  p_schema VARCHAR2, p_table VARCHAR2
) RETURN VARCHAR2 AS
BEGIN
  RETURN 'org_id = SYS_CONTEXT(''PORTAL_CTX'', ''ORG_ID'')';
END;

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_name   => 'workflow_definitions',
    policy_name   => 'portal_tenant_isolation',
    function_schema => USER,
    policy_function => 'portal_vpd_policy',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE'
  );
END;
```

**Benefit**: Database-level tenant isolation. Even if application code misses an `org_id` filter, VPD prevents cross-tenant data access. Admin role gets VPD exemption via application context variable.

---

## 13. Observability

### Prometheus Metrics

8 custom metrics registered in `@portal/server/metrics.ts`:

| Metric                           | Type      | Labels                | Purpose                       |
| -------------------------------- | --------- | --------------------- | ----------------------------- |
| `portal_http_request_duration`   | Histogram | method, route, status | API latency by endpoint       |
| `portal_http_requests_total`     | Counter   | method, route, status | Request volume                |
| `portal_oracle_query_duration`   | Histogram | operation             | DB query performance          |
| `portal_oracle_pool_active`      | Gauge     | —                     | Active Oracle connections     |
| `portal_tool_execution_duration` | Histogram | tool_name, status     | OCI tool call latency         |
| `portal_chat_messages_total`     | Counter   | model, role           | Chat usage by model           |
| `portal_workflow_runs_total`     | Counter   | status                | Workflow execution outcomes   |
| `portal_mcp_server_connections`  | Gauge     | server_name           | Active MCP server connections |

**Endpoint**: `GET /api/metrics` (Prometheus scrape target, auth-gated)

### Structured Logging (Pino)

```typescript
const logger = createLogger('module-name');
// Output: { level: 30, time: ..., module: 'module-name', msg: '...' }
```

- **Redaction**: Auth headers, cookie values, API keys automatically redacted
- **Serializers**: Custom serializers for request/response objects
- **Request context**: `X-Request-Id` propagated through logger child instances
- **Level**: Configurable via `LOG_LEVEL` env var (default: `info`)

### Error Tracking (Sentry)

- **Dynamic import**: `@sentry/sveltekit` loaded only when `SENTRY_DSN` is set
- **Breadcrumbs**: HTTP requests, Oracle queries, tool executions
- **Context**: User ID, org ID, permissions (via `toSentryExtras()`)
- **Source maps**: Uploaded during build for production stack traces
- **Performance**: Transaction sampling configurable via `SENTRY_TRACES_SAMPLE_RATE`
- **AI Tracing** (Phase 10): `@mastra/sentry` SentryExporter maps Mastra spans → Sentry AI operations (see Section 10, AD-15)
- **Upgrade**: `@sentry/sveltekit` 10.32.1 → 10.38.0 (6 patch versions behind)

### OpenTelemetry (Phase 10)

```typescript
// apps/api/src/plugins/otel.ts — must register FIRST in plugin chain
import otelPlugin from '@fastify/otel';

app.register(otelPlugin, {
	wrapRoutes: true,
	exposeApi: true
});
```

`@fastify/otel` replaces the deprecated `@opentelemetry/instrumentation-fastify` (deprecated June 2025). Emits standard W3C trace context headers, integrates with Sentry's OpenTelemetry SDK mode.

### Request Tracing

```
Client → Nginx → Fastify (X-Request-Id generated if missing)
                    ├── @fastify/otel W3C trace context (Phase 10)
                    ├── @mastra/sentry AI span mapping (Phase 10)
                    ├── Logged in every Pino entry
                    ├── Forwarded to Oracle queries (comment-tagged)
                    ├── Forwarded to OCI SDK calls
                    └── Returned in response header
```

### Health Checks

| Endpoint        | Type          | Timeout | Content                              |
| --------------- | ------------- | ------- | ------------------------------------ |
| `/healthz`      | Liveness      | —       | Plain text "ok"                      |
| `/health`       | Readiness     | 3s      | JSON: Oracle pool, memory, uptime    |
| `/nginx-health` | Load balancer | —       | HTTP 200 from nginx (access_log off) |

---

## 14. Testing Strategy

### Vitest Configuration

```typescript
// vitest.config.ts (root)
export default defineConfig({
	test: {
		projects: ['apps/api', 'apps/frontend'],
		mockReset: true // Clears ALL mock implementations between tests
	}
});
```

### Test Structure

| Location                     | Count | Focus                                      |
| ---------------------------- | ----- | ------------------------------------------ |
| `apps/api/src/tests/`        | 32+   | Route handlers, plugins, services          |
| `apps/frontend/src/tests/`   | TBD   | Component tests, store tests               |
| `packages/server/src/tests/` | TBD   | Repository tests, auth tests (after split) |

### Testing Patterns

**buildTestApp pattern** (Fastify integration tests):

```typescript
function buildTestApp(options?: { skipAuth?: boolean; testUser?: TestUser }) {
	const app = Fastify();
	// Register plugins in correct order
	// skipAuth: bypasses Oracle/session/RBAC
	// testUser: injects mock user/session/permissions
	return app;
}
```

**mockReset: true gotcha** — Every test must re-configure mocks in `beforeEach`:

```typescript
const mockFn = vi.fn();
vi.mock('module', () => ({ fn: (...args) => mockFn(...args) }));

beforeEach(() => {
	mockFn.mockResolvedValue({ data: 'test' }); // Re-configure after reset
});
```

**vi.mock() TDZ pattern** — Use `globalThis` registry for mock references:

```typescript
vi.mock('module', () => {
	if (!(globalThis as any).__testMocks) (globalThis as any).__testMocks = {};
	const mocks = { list: vi.fn(), get: vi.fn() };
	(globalThis as any).__testMocks.repo = mocks;
	return { repository: new Proxy({}, { get: (_, p) => mocks[p] }) };
});
```

### Coverage Targets

| Area              | Target | Notes                               |
| ----------------- | ------ | ----------------------------------- |
| Route handlers    | 80%    | All CRUD operations, error paths    |
| Auth plugin       | 90%    | Critical security boundary          |
| Workflow executor | 85%    | All node types, retry, compensation |
| Oracle repos      | 75%    | CRUD + edge cases (empty, null)     |
| Svelte components | 60%    | Key interactions, not every variant |

---

## 15. CI/CD & Deployment

### GitHub Actions Workflows

| Workflow     | Trigger    | Steps                                     |
| ------------ | ---------- | ----------------------------------------- |
| `ci.yml`     | PR, push   | Install → lint → typecheck → test → build |
| `deploy.yml` | Tag/manual | Build → Docker push → SSH deploy → health |
| `docker.yml` | Release    | Multi-stage Docker build → registry push  |

### Git Hooks

**Pre-commit** (`.githooks/pre-commit`):

- ESLint on staged files (workspace-scoped)
- TypeScript type check (workspace-scoped)
- Prettier format check

**Pre-push** (`.githooks/pre-push`):

- Semgrep security scan
- CodeQL analysis
- Trufflehog secret detection
- Spectral + OWASP API lint (requires OpenAPI export)
- Cherrybomb API security scan
- Full test suite (`vitest run`)

### Deployment Pipeline

```
Developer → git push → pre-push hooks (6 scanners + tests)
         → GitHub Actions CI (lint, typecheck, test, build)
         → Tag release → deploy.yml
         → Docker build (multi-stage, hardened)
         → Push to registry
         → SSH to OCI instance
         → docker compose pull && docker compose up -d
         → Health check verification
```

### Feature Flags

| Flag          | Purpose                     | Phase 10 Action          |
| ------------- | --------------------------- | ------------------------ |
| `FASTIFY_URL` | Fastify backend URL for SSR | Keep (session hydration) |

> `FASTIFY_ENABLED` and `FASTIFY_PROXY_ROUTES` were deleted during the Phase C cleanup (Fastify now handles 100% of `/api/*` traffic without a feature flag).

---

## 16. Security

| Area                  | Mechanism                                                              |
| --------------------- | ---------------------------------------------------------------------- |
| Auth boundary         | Single Fastify auth plugin (deny-by-default)                           |
| Tenant isolation      | VPD policies at database level + org_id in all queries                 |
| Credential encryption | AES-256-GCM (existing crypto.ts)                                       |
| API key hashing       | SHA-256 (existing api-keys.ts)                                         |
| SSRF prevention       | `isValidWebhookUrl()` blocks private IPs                               |
| SQL injection         | Bind parameters + `validateColumnName()`                               |
| XSS                   | DOMPurify for markdown rendering                                       |
| CSRF                  | Better Auth built-in (double-submit cookie)                            |
| CSP                   | `crypto.randomUUID()` nonce per request                                |
| MCP sandboxing        | Docker containers (512MB, cap-drop ALL)                                |
| Webhook signatures    | HMAC-SHA256 via `X-Webhook-Signature`                                  |
| Rate limiting         | Dual: nginx `limit_req` + Fastify `@fastify/rate-limit`                |
| AI guardrails         | PromptInjectionDetector, PIIDetector, ModerationProcessor (see AD-17)  |
| Load shedding         | `@fastify/under-pressure` — 503 before OOM/event loop stall (Phase 10) |
| TLS                   | 1.2 + 1.3, ECDHE ciphers, HSTS                                         |
| Container hardening   | read_only, no-new-privileges, tmpfs                                    |
| Circuit breaking      | `@fastify/circuit-breaker` for OCI SDK calls (Phase 10, P2)            |
| Graceful shutdown     | `fastify-graceful-shutdown` — drain connections, flush Pino (Phase 10) |

---

## 17. Dependency Inventory

### Current Dependencies (All Workspaces)

#### Runtime — Core Framework

| Package                | Version | Latest | Status       | Notes          |
| ---------------------- | ------- | ------ | ------------ | -------------- |
| fastify                | 5.7.4   | 5.7.4  | Current      |                |
| @sveltejs/kit          | 2.50.2  | 2.50.2 | Current      |                |
| @sveltejs/adapter-node | 5.5.2   | 5.5.2  | Current      |                |
| svelte                 | 5.49.2  | 5.50.1 | Minor behind | Safe to update |
| zod                    | 4.3.6   | 4.3.6  | Current      | v4 stable      |
| typescript             | 5.9.3   | 5.9.3  | Current      |                |

#### Runtime — Fastify Plugins

| Package                   | Version | Latest | Status       | Notes          |
| ------------------------- | ------- | ------ | ------------ | -------------- |
| @fastify/cookie           | 11.0.2  | 11.0.2 | Current      |                |
| @fastify/cors             | 11.2.0  | 11.2.0 | Current      |                |
| @fastify/helmet           | 13.0.2  | 13.0.2 | Current      |                |
| @fastify/rate-limit       | 10.3.0  | 10.3.0 | Current      |                |
| @fastify/sensible         | 6.0.4   | 6.0.4  | Current      |                |
| @fastify/swagger          | 9.6.1   | 9.7.0  | Minor behind | Safe to update |
| @fastify/swagger-ui       | 5.2.5   | 5.2.5  | Current      |                |
| fastify-plugin            | 5.1.0   | 5.1.0  | Current      |                |
| fastify-type-provider-zod | 6.1.0   | 6.1.0  | Current      |                |

#### Runtime — AI / Mastra

| Package                        | Version | Latest | Status       | Notes                                   |
| ------------------------------ | ------- | ------ | ------------ | --------------------------------------- |
| ai                             | 6.0.73  | 6.0.78 | Patch behind | Safe to update                          |
| @ai-sdk/anthropic              | 3.0.39  | 3.0.40 | Patch behind | Safe to update                          |
| @ai-sdk/google                 | 3.0.22  | 3.0.23 | Patch behind | Safe to update                          |
| @ai-sdk/openai                 | 3.0.26  | 3.0.26 | Current      |                                         |
| @ai-sdk/svelte                 | 4.0.73  | 4.0.78 | Patch behind | Safe to update                          |
| @acedergren/oci-genai-provider | 0.2.0   | 0.2.0  | Current      | Private package                         |
| @mastra/core                   | 1.2.0   | 1.2.0  | Current      |                                         |
| @mastra/fastify                | 1.1.1   | 1.1.1  | Current      |                                         |
| @mastra/mcp                    | 1.0.0   | 1.0.0  | Current      | Replace custom client with official SDK |
| @mastra/memory                 | 1.1.0   | 1.1.0  | Current      |                                         |
| @mastra/rag                    | 2.1.0   | 2.1.0  | Current      |                                         |
| @mastra/sentry                 | —       | latest | **NEW**      | AI span → Sentry mapping (AD-15)        |
| @mastra/evals                  | —       | latest | **NEW**      | Agent quality scoring (AD-16)           |

#### Runtime — Auth & Database

| Package        | Version | Latest | Status  | Notes                               |
| -------------- | ------- | ------ | ------- | ----------------------------------- |
| better-auth    | 1.4.18  | 1.4.18 | Current |                                     |
| oracledb       | 6.10.0  | 6.10.0 | Current | Native vector support since 6.5     |
| better-sqlite3 | 12.6.2  | 12.6.2 | Current | Still best-in-class for sync SQLite |

#### Runtime — UI & Utilities

| Package                | Version | Latest  | Status       | Notes                                 |
| ---------------------- | ------- | ------- | ------------ | ------------------------------------- |
| @tanstack/svelte-query | 6.0.18  | 6.0.18  | Current      |                                       |
| @xyflow/svelte         | 1.5.0   | 1.5.0   | Current      | Workflow designer canvas              |
| @sentry/sveltekit      | 10.32.1 | 10.38.0 | Minor behind | 6 versions behind, update recommended |
| marked                 | 17.0.1  | 17.0.1  | Current      |                                       |
| dompurify              | 3.3.1   | 3.3.1   | Current      |                                       |
| dockerode              | 4.0.9   | 4.0.9   | Current      |                                       |
| clsx                   | 2.1.1   | 2.1.1   | Current      |                                       |
| svelte-sonner          | 1.0.7   | 1.0.7   | Current      |                                       |
| tailwind-merge         | 3.4.0   | 3.4.0   | Current      |                                       |
| uuid                   | 13.0.0  | 13.0.0  | Current      |                                       |
| pino                   | 10.3.0  | 10.3.1  | Patch behind | Safe to update                        |

#### Dev Dependencies

| Package                      | Version | Latest     | Status           | Notes                                      |
| ---------------------------- | ------- | ---------- | ---------------- | ------------------------------------------ |
| vitest                       | 4.0.18  | 4.0.18     | Current          |                                            |
| vite                         | 6.4.1   | **7.3.1**  | **Major behind** | Vite 7: new plugin API, evaluate carefully |
| eslint                       | 9.39.2  | **10.0.0** | **Major behind** | ESLint 10: flat config only, no legacy     |
| @eslint/js                   | 9.39.2  | **10.0.1** | **Major behind** | Must pair with eslint 10                   |
| @sveltejs/vite-plugin-svelte | 5.1.1   | **6.2.4**  | **Major behind** | Requires Vite 7                            |
| typescript-eslint            | 8.54.0  | 8.55.0     | Minor behind     | Safe to update                             |
| tailwindcss                  | 4.1.18  | 4.1.18     | Current          | v4 stable                                  |
| postcss                      | 8.5.6   | 8.5.6      | Current          |                                            |
| bits-ui                      | 2.15.5  | 2.15.5     | Current          |                                            |
| tailwind-variants            | 3.2.2   | 3.2.2      | Current          |                                            |
| tsx                          | 4.21.0  | 4.21.0     | Current          |                                            |
| svelte-check                 | 4.3.6   | 4.3.6      | Current          |                                            |
| @tailwindcss/typography      | 0.5.19  | 0.5.19     | Current          |                                            |
| @tailwindcss/vite            | 4.1.18  | 4.1.18     | Current          |                                            |

#### Deprecated (Must Remove)

| Package          | Reason                        | Action                      |
| ---------------- | ----------------------------- | --------------------------- |
| @types/dompurify | DOMPurify 3.x ships own types | Remove from devDependencies |

#### New Dependencies

##### Core (Phase A)

| Package                   | Version | Purpose                                 | License    | Weekly DL |
| ------------------------- | ------- | --------------------------------------- | ---------- | --------- |
| oci-sdk                   | 2.125.0 | Official Oracle Cloud TypeScript SDK    | UPL/Apache | 15K+      |
| @modelcontextprotocol/sdk | ^1.26.0 | Official MCP TypeScript SDK             | MIT        | 24K+      |
| terraform-generator       | latest  | Programmatic HCL generation (AST-based) | MIT        | 50K+      |

##### Fastify Plugins — P0 (Phase A)

| Package                       | Version | Purpose                                                          | License | Weekly DL |
| ----------------------------- | ------- | ---------------------------------------------------------------- | ------- | --------- |
| @fastify/under-pressure       | latest  | Load shedding (maxEventLoopDelay, maxHeapUsedBytes, maxRssBytes) | MIT     | 150K+     |
| fastify-graceful-shutdown     | latest  | Zero-downtime deploys — drain connections, flush Pino            | MIT     | 20K+      |
| @fastify/otel                 | latest  | OpenTelemetry (replaces deprecated instrumentation-fastify)      | MIT     | 10K+      |
| iovalkey                      | latest  | Valkey/Redis client for OCI Cache (ioredis fork, TypeScript)     | MIT     | 50K+      |
| @scalar/fastify-api-reference | latest  | Modern API docs (AD-42: replaces @fastify/swagger-ui)            | MIT     | 100K+     |

##### Fastify Plugins — P1 (Phase B-C)

| Package           | Version | Purpose                                              | License | Weekly DL |
| ----------------- | ------- | ---------------------------------------------------- | ------- | --------- |
| @fastify/sse      | latest  | SSE for workflow progress, agent streaming (AD-40)   | MIT     | 15K+      |
| @fastify/compress | latest  | Gzip/Brotli response compression (~60-70% reduction) | MIT     | 200K+     |
| @fastify/schedule | latest  | Lightweight cron (cleanup jobs, metric aggregation)  | MIT     | 30K+      |

##### Fastify Plugins — P2 (Evaluate Phase D+)

| Package                  | Version | Purpose                                                             | License | Weekly DL |
| ------------------------ | ------- | ------------------------------------------------------------------- | ------- | --------- |
| @fastify/websocket       | latest  | Bidirectional comms — only if collaborative features needed (AD-40) | MIT     | 200K+     |
| @fastify/request-context | latest  | AsyncLocalStorage for org/user context                              | MIT     | 50K+      |
| @fastify/circuit-breaker | latest  | Circuit breaker for OCI SDK calls                                   | MIT     | 10K+      |
| @fastify/multipart       | latest  | File upload for workflow import/export                              | MIT     | 200K+     |

##### Frontend Libraries (Phase B-E)

| Package               | Version | Purpose                                                             | License    | Weekly DL |
| --------------------- | ------- | ------------------------------------------------------------------- | ---------- | --------- |
| sveltekit-superforms  | latest  | Form validation for admin, setup wizard, workflow config            | MIT        | 52K+      |
| layerchart            | latest  | Charting on D3 — admin metrics, cost comparison, workflow analytics | MIT        | 8K+       |
| fuse.js               | latest  | Client-side fuzzy search for tool palette, MCP catalog              | Apache-2.0 | 1.2M+     |
| formsnap              | latest  | Superforms companion — accessible form controls, error handling     | MIT        | 12K+      |
| @tanstack/table-core  | latest  | Headless table for admin listings (tools, servers, audit log)       | MIT        | 800K+     |
| paneforge             | latest  | Resizable panel layouts for workflow designer split views           | MIT        | 6K+       |
| svelte-dnd-action     | latest  | Drag-and-drop for kanban boards, workflow node palettes             | MIT        | 15K+      |
| @formkit/auto-animate | latest  | List animations for dynamic admin tables, kanban transitions        | MIT        | 200K+     |

##### DX / Quality (Phase A)

| Package              | Version | Purpose                                             | License | Weekly DL |
| -------------------- | ------- | --------------------------------------------------- | ------- | --------- |
| syncpack             | latest  | Dependency version sync across monorepo workspaces  | MIT     | 100K+     |
| zod-validation-error | latest  | Human-readable Zod error messages for API responses | MIT     | 500K+     |

##### Mastra Packages (Phase B-E)

| Package        | Version | Purpose                                 | License | Weekly DL |
| -------------- | ------- | --------------------------------------- | ------- | --------- |
| @mastra/sentry | latest  | AI-specific Sentry span mapping (AD-15) | MIT     | 5K+       |
| @mastra/evals  | latest  | Agent quality scoring framework (AD-16) | MIT     | 3K+       |

### Build vs Buy Decisions

#### REPLACE: Custom MCP Client → @modelcontextprotocol/sdk

| Aspect          | Detail                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| **Current**     | 750 LOC custom client in `packages/shared/src/server/mcp-client/` (7 files)                    |
| **Replacement** | `@modelcontextprotocol/sdk` v1.26.0 — official TypeScript SDK                                  |
| **Rationale**   | Official SDK gets automatic protocol updates, better community support, 24K+ projects using it |
| **Migration**   | 2-3 days. Replace MCPClient class, rebuild MCPManager on top of SDK Client, update transports  |
| **Risk**        | Low — well-documented SDK with clear API                                                       |

#### REPLACE: Custom Terraform Generator → terraform-generator

| Aspect          | Detail                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| **Current**     | 577 LOC string-concatenation HCL generator                                                                   |
| **Replacement** | `terraform-generator` — AST-based HCL generation with JSON output option                                     |
| **Rationale**   | String concatenation is fragile. AST-based generation prevents syntax errors. CDKTF was deprecated Dec 2025. |
| **Migration**   | 2-3 days. Rewrite generator functions to use TerraformGenerator API, preserve public API                     |
| **Risk**        | Low — well-documented, 50K+ weekly downloads                                                                 |

#### WRAP: OCI CLI Tools → oci-sdk (Gradual)

| Aspect        | Detail                                                                           |
| ------------- | -------------------------------------------------------------------------------- |
| **Current**   | 60+ CLI wrappers (~4,000 LOC) using `child_process.execFileSync('oci', args)`    |
| **Target**    | Hybrid: SDK for high-frequency tools, keep CLI for edge cases                    |
| **Rationale** | SDK calls are 3-5x faster (no subprocess), natively typed, better error handling |
| **Migration** | 4-6 weeks incremental. Start with compute/networking (highest frequency)         |
| **Risk**      | Medium — large surface area but low per-tool risk                                |

**OCI SDK v2.125.0** (`npm install oci-sdk`):

- Per-service client packages (e.g., `core.ComputeClient`, `objectstorage.ObjectStorageClient`)
- Config file authentication (`~/.oci/config`) or instance principal
- Dual-licensed UPL/Apache-2.0, Node.js only

```typescript
// Before (CLI wrapper — 2-5s per call)
const result = executeOCI(['compute', 'instance', 'list', '--compartment-id', compartmentId]);
const parsed = JSON.parse(result.stdout);

// After (SDK — <500ms per call)
import * as core from 'oci-sdk/lib/core';
const computeClient = new core.ComputeClient({ authenticationDetailsProvider });
const response = await computeClient.listInstances({ compartmentId });
// response.items is already typed as Instance[]
```

#### KEEP: Custom Implementations (No Packaged Alternative)

| Implementation       | LOC | Why Keep                                                                                         |
| -------------------- | --- | ------------------------------------------------------------------------------------------------ |
| OracleVectorStore    | 437 | No Oracle vector store exists in any framework. Already implements MastraVector interface.       |
| Agent State (Oracle) | 400 | Migrated to OracleStore (MastraStorage impl). VPD tenant isolation. thread_id for Mastra memory. |
| Auth (Better Auth)   | 150 | Already external package. Custom parts are OCI-specific business logic (IDCS, Oracle adapter).   |
| Pricing Comparison   | 500 | No multi-cloud pricing npm package exists. Static OCI data + Azure API is the right approach.    |

---

## 18. Risks & Roadmap

### Phased Rollout

```
Phase A: Dependency Updates + Fastify Hardening (1-2 weeks)
├── Patch/minor updates (ai, svelte, sentry, pino, swagger)
├── Remove @types/dompurify
├── Add oci-sdk v2.125.0, @modelcontextprotocol/sdk v1.26.0
├── Add P0 Fastify plugins: @fastify/under-pressure,
│   fastify-graceful-shutdown, @fastify/otel (AD-40: websocket deferred)
├── Add @mastra/sentry, @mastra/evals
├── Add DX: syncpack, zod-validation-error
├── Replace zodToJsonSchema() with z.toJSONSchema() (Zod 4 built-in)
├── Run knip in CI (already installed)
├── Add iovalkey + cache module (AD-39: Valkey caching layer)
├── Switch @fastify/swagger-ui → @scalar/fastify-api-reference (AD-42)
├── Set up Grafana + Tempo observability backend (AD-48)
├── Add rate-limiter-flexible with Oracle adapter for per-user limits (AD-49)
├── Configure @fastify/schedule + Oracle queue table for background jobs (AD-50)
├── DEFERRED: Vite 7 + ESLint 10 (AD-41: blocked by typescript-eslint)
└── Run syncpack to align dependency versions

Phase B: Package Split + Frontend Libraries (2 weeks)
├── Create @portal/types (extract types + Zod schemas)
├── Create @portal/server (extract server modules)
├── Create @portal/ui (extract Svelte components)
├── Update all imports across monorepo
├── Add sveltekit-superforms for admin/setup/workflow forms
├── Add LayerChart for dashboard metrics and cost comparison
├── Add fuse.js for fuzzy search in tool palette/MCP catalog
└── Validate build + test suite passes

Phase C: Fastify-First Migration (2-3 weeks) ✅ COMPLETE
├── ✅ Move Better Auth to Fastify (catch-all route, toWebRequest pattern)
├── ✅ Migrate all SvelteKit +server.ts routes to Fastify (frontend hosts SSR + static only)
├── ✅ Update SvelteKit to cookie-forwarding only
├── ✅ Add @fastify/compress (gzip + brotli, threshold: 1KB)
├── ✅ Add AWS + Azure MCP servers to cross-cloud catalog (AD-45: GCP deferred)
├── ✅ Remove 11 stale SvelteKit route duplicates
├── ✅ Verify nginx config (already routes /api/* to Fastify)
├── ✅ Test OIDC flow end-to-end with OCI IDCS
├── ✅ 59 integration tests for v1-tools + session continue
├── ✅ Raw SSE streaming verified (no @fastify/sse plugin needed)
├── ✅ Delete 15 SvelteKit +server.ts stubs (914450a5)
├── ✅ Remove FASTIFY_PROXY_ROUTES / FASTIFY_ENABLED feature flags (Fastify always on)
└── NOTE: Mastra Studio embedding dropped — replaced by Phase G (AD-53)

Phase D: OCI SDK Migration (3-4 weeks)
├── Add oci-sdk auth provider (config file + instance principal)
├── Create executor-sdk.ts adapter
├── Migrate top-10 tools by call frequency
├── Benchmark: CLI exec vs SDK API call latency
├── Gradually migrate remaining tools
└── Keep CLI fallback for unmigrated tools

Phase E: Workflow Designer Completion + AI Hardening (2-3 weeks)
├── Implement ai-step node (Mastra agent.generate())
├── Implement loop node (Mastra .foreach() with concurrency)
├── Implement parallel node (Mastra .parallel())
├── Add retry policies with exponential backoff
├── Add compensation/saga pattern
├── Add workflow streaming via Mastra writer argument
├── Add workflow lifecycle callbacks (onFinish, onError)
├── Add typed suspendSchema/resumeSchema for approval nodes
├── Add Agent Guardrails (PromptInjectionDetector, PIIDetector, TokenLimiter)
├── Configure @mastra/evals scorers on CloudAdvisor agent
├── Add crash recovery via restartAllActiveWorkflowRuns()
├── Update frontend editor components for new node types
└── A2A Agent Card DEFERRED to post-Phase E (AD-43: Mastra A2A #8411 bugs)

Phase F: Oracle 26AI Modernization (1-2 weeks) — AD-52: all parallel
├── Migration 015: HNSW DML vector indexes (parallelizable with 016/017)
├── Migration 016: JSON Relational Duality Views (parallelizable with 015/017)
├── Migration 017: VPD tenant isolation policies (parallelizable with 015/016)
├── Replace vectorToOracleString with direct Float32Array binding
├── Update OracleVectorStore for HNSW + DB_TYPE_VECTOR
├── Optional: Hybrid Vector Index for RAG
└── Benchmark vector query performance (3x target)

Phase G: Self-Built Admin Experience (2-3 weeks) — AD-53
├── G-1: Agent Playground (/admin/agents)
│   ├── Agent selection + streaming chat interface
│   ├── Real-time tool call visualization
│   ├── Token usage, latency, model metrics per request
│   └── System prompt editing + parameter tuning
├── G-2: Workflow Execution Monitor (/admin/workflows/runs)
│   ├── Live SSE-powered workflow step progress
│   ├── Pause/resume/cancel controls
│   ├── Step-by-step inputs/outputs inspection
│   └── Execution history with filtering and search
├── G-3: Tool Tester (/admin/tools/playground)
│   ├── Tool selection with argument builder
│   ├── Raw OCI response vs slimmed output comparison
│   ├── Approval flow preview for dangerous tools
│   └── Execution time and category display
├── G-4: Observability Dashboard (/admin/observability)
│   ├── Agent traces (tool calls, ordering, latency)
│   ├── Workflow run timelines
│   ├── Error rates and latency percentiles
│   └── Cost tracking per agent/workflow/model
├── Design iteration: Multiple UI iterations per page (AD-54)
│   ├── Use shadcn-svelte, responsive-design, visual-design skills
│   ├── Browser feedback loops for design selection
│   └── Branch per iteration, merge winner
├── Verify OracleStore MastraStorage compliance (AD-55)
│   └── OracleStore already implements full interface (1244 LOC)
│       — verify edge cases, add missing integration tests
└── All pages gated behind RBAC admin role
```

### Phase Dependencies

```
A (deps+hardening) ──► B (split+frontend) ──► C (fastify-first) ✅ mostly done
                                                  │
A (deps+hardening) ──────────────────────────► D (oci-sdk) [independent of B/C]
                                                  │
B (split+frontend) ──► E (workflows+AI) [needs @portal/types + @portal/server]
                                                  │
A (deps+hardening) ──────────────────────────► F (oracle) [independent, needs only A]
                                                  │
C (fastify-first) ──► G (admin experience) [needs Fastify API + Mastra REST]
                           │
                           ├── G-1, G-3 can start immediately after C
                           ├── G-2 benefits from E (workflow completion)
                           └── G-4 needs A (Grafana/Tempo setup)
```

**Parallelizable**: D, F, and G-1/G-3 can run in parallel. G-2 benefits from E but can start with basic workflow support. G-4 needs Grafana from Phase A.

### Completed Work (Pre-Phase A) [DRIFT DETECTED]

The following was implemented on `main` before Phase A kickoff (11 commits, 2026-02-09 to 2026-02-10):

**Premium MCP Server Management (Phase 10.0)**

| Component                                                                               | Status | Commit Range                 |
| --------------------------------------------------------------------------------------- | ------ | ---------------------------- |
| Migration 013: `mcp_servers`, `mcp_credentials`, `mcp_tool_cache`, `mcp_resource_cache` | Done   | b3ce83b3                     |
| MCP types + Zod schemas (12+ types)                                                     | Done   | bd88ef5b                     |
| MCP server repository (CRUD, encrypted credentials, AES-256-GCM)                        | Done   | 1132452d                     |
| MCPConnectionManager (Mastra client lifecycle)                                          | Done   | 11dcd3b1                     |
| Admin MCP API routes (7 endpoints: CRUD, catalog install, metrics)                      | Done   | d59370ac                     |
| Dynamic MCP toolset integration into CloudAdvisor                                       | Done   | c869b59a                     |
| Frontend admin/integrations page (4 new components)                                     | Done   | 8bb8bc0b                     |
| Dependencies added: `@mastra/mcp` v1.0.0, `dockerode` v4.0.9                            | Done   | c77b9d00                     |
| Unit tests: repository, routes, connection manager (3 test suites)                      | Done   | ae5ce1de, f47510ba, 6f62d839 |
| PRD documentation (Phase 10.1 external integrations planned)                            | Done   | 665b185c, ce3539a7           |

**New Routes** (not in original PRD scope — landed on `main`):

- `POST /api/v1/admin/mcp/servers` — Create MCP server
- `GET /api/v1/admin/mcp/servers` — List with filtering
- `GET /api/v1/admin/mcp/servers/:id` — Get with decrypted credentials
- `PUT /api/v1/admin/mcp/servers/:id` — Update server config
- `DELETE /api/v1/admin/mcp/servers/:id` — Remove server
- `POST /api/v1/admin/mcp/catalog/install` — Install from catalog
- `GET /api/v1/admin/mcp/metrics` — Tool call metrics + cache stats

**New Frontend Components**:

- `IntegrationCatalogCard.svelte` — Displays available MCP servers from catalog
- `IntegrationServerCard.svelte` — Shows connected servers with status + actions
- `MCPServerModal.svelte` — Create/edit server configuration modal
- `ToolPlaygroundCard.svelte` — Test tools from a connected server

### Technical Risks

| #   | Risk                                                 | Probability | Impact | Mitigation                                                                                                                                    |
| --- | ---------------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Vite 7 breaks SvelteKit build                        | Medium      | High   | Test in branch first. Pin Vite 6 if Svelte adapter isn't ready.                                                                               |
| R2  | ESLint 10 flat config migration                      | Medium      | Medium | Already using flat config (eslint.config.js). Test plugin compatibility.                                                                      |
| R3  | Better Auth Fastify migration breaks OIDC            | Medium      | High   | Keep callback path identical (/api/auth/\*). Test with OCI IDCS before cutover.                                                               |
| R4  | oci-sdk missing functionality vs CLI                 | Low         | Medium | Hybrid approach: SDK for supported operations, CLI fallback for gaps.                                                                         |
| R5  | Package split breaks import paths                    | High        | Medium | Automated import rewriting via `jscodeshift`. Run full test suite.                                                                            |
| R6  | VPD policies conflict with admin queries             | Low         | High   | Admin role gets VPD exemption via application context variable.                                                                               |
| R7  | HNSW index memory pressure on small instances        | Medium      | Medium | Configure HNSW neighbors=16 (not 64). Monitor memory via OCI metrics.                                                                         |
| R8  | @modelcontextprotocol/sdk v2 breaking changes        | Low         | Medium | Pin to ^1.26.0. MCPConnectionManager wraps SDK (buffer layer).                                                                                |
| R9  | 37 route migration introduces regressions            | High        | High   | Migrate routes in batches. Keep proxy fallback during transition.                                                                             |
| R10 | OCI SDK auth config differs from CLI                 | Medium      | Medium | Document both auth methods. Instance principal for prod, config file for dev.                                                                 |
| R11 | Float32Array vector binding breaks legacy queries    | Low         | Medium | Test with existing data first. Fallback to string conversion if needed.                                                                       |
| R12 | ~~Mastra Studio auth bypass~~ REMOVED (AD-53)        | —           | —      | Studio embedding dropped. Self-built admin pages inherit existing RBAC — no new auth surface.                                                 |
| R13 | @mastra/evals scorer costs (LLM calls for scoring)   | Medium      | Medium | Use 10% sampling rate. Use gpt-4o-mini (cheapest). Disable in test environments.                                                              |
| R14 | Agent Guardrails false positives block legit queries | Medium      | Medium | Start with `warn` strategy, switch to `block` after tuning. Log all detections.                                                               |
| R15 | New Fastify plugins increase startup time            | Low         | Low    | Benchmark cold start. Lazy-load non-critical plugins (schedule, compress).                                                                    |
| R16 | MCP consolidation breaks custom client consumers     | Low         | Low    | Custom client is unused in production. Deprecate with README notice. Keep for reference.                                                      |
| R17 | A2A protocol instability (pre-1.0)                   | Medium      | Medium | Defer to post-Phase E. Mastra A2A has known bugs. Production-ready A2A planned late 2026.                                                     |
| R18 | Cross-CSP MCP servers require customer credentials   | Medium      | High   | Reuse MCPConnectionManager's AES-256-GCM credential encryption. Admin-only installation.                                                      |
| R19 | OCI Cache (Valkey) adds infrastructure dependency    | Low         | Medium | Graceful degradation: fall back to direct Oracle queries if Valkey unavailable. ~$28/mo minimum.                                              |
| R20 | Vite 7/ESLint 10 ecosystem lag                       | Medium      | Low    | DEFERRED (AD-41). No security impact from staying on Vite 6/ESLint 9. Monitor typescript-eslint v9.                                           |
| R21 | Phase G admin experience scope creep                 | Medium      | Medium | Strict 4-page scope (agents, workflows, tools, observability). Design iteration adds time but improves quality. Cap at 2 iterations per page. |
| R22 | Browser feedback loop adds latency to design process | Low         | Low    | Offset by catching design issues early. Limited to Phase G admin pages only, not all frontend work.                                           |

---

## 19. Decision Log

| ID    | Decision                                                     | Date       | Rationale                                                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AD-1  | Replace custom MCP client with @modelcontextprotocol/sdk     | 2026-02-10 | Official SDK, automatic protocol updates, 24K+ users                                                                                                                                                                                                                  |
| AD-2  | Replace Terraform generator with terraform-generator         | 2026-02-10 | AST-based > string concat, CDKTF deprecated                                                                                                                                                                                                                           |
| AD-3  | Gradual oci-sdk migration (hybrid CLI+SDK)                   | 2026-02-10 | 3-5x faster, typed, but 60+ tools need incremental migration                                                                                                                                                                                                          |
| AD-4  | Keep OracleVectorStore (no alternative)                      | 2026-02-10 | No Oracle vector store exists in any framework                                                                                                                                                                                                                        |
| AD-5  | Keep Better Auth (already external)                          | 2026-02-10 | No Fastify-native auth matches feature set                                                                                                                                                                                                                            |
| AD-6  | Keep pricing service (no alternative)                        | 2026-02-10 | No multi-cloud pricing npm package exists                                                                                                                                                                                                                             |
| AD-7  | Use Mastra workflow primitives for remaining node types      | 2026-02-10 | .then(), .parallel(), .foreach() map to designer node types                                                                                                                                                                                                           |
| AD-8  | Split @portal/shared into 3 packages                         | 2026-02-10 | Faster builds, cleaner boundaries, framework isolation                                                                                                                                                                                                                |
| AD-9  | Move Better Auth entirely to Fastify                         | 2026-02-10 | Single auth boundary, eliminates dual-runtime auth                                                                                                                                                                                                                    |
| AD-10 | VPD for tenant isolation                                     | 2026-02-10 | Database-level security, defense-in-depth                                                                                                                                                                                                                             |
| AD-11 | Direct Float32Array vector binding                           | 2026-02-10 | node-oracledb 6.5+ supports native TypedArrays                                                                                                                                                                                                                        |
| AD-12 | Remove Inngest (use Mastra suspend/resume instead)           | 2026-02-10 | Mastra provides built-in durability, crash recovery, sleep                                                                                                                                                                                                            |
| AD-13 | Better Auth Fastify via toWebRequest pattern                 | 2026-02-10 | Official integration pattern from Better Auth docs                                                                                                                                                                                                                    |
| AD-14 | ~~Mastra Studio as debugging UI~~ → SUPERSEDED by AD-53      | 2026-02-10 | Studio can't be embedded (standalone Hono + React app). Replaced by self-built admin experience.                                                                                                                                                                      |
| AD-15 | Add @mastra/sentry for AI-specific observability             | 2026-02-10 | Maps Mastra spans → Sentry AI operations (gen_ai.invoke_agent, etc.)                                                                                                                                                                                                  |
| AD-16 | Add @mastra/evals for agent quality scoring                  | 2026-02-10 | Scorer framework with 10% production sampling, results visible in Studio                                                                                                                                                                                              |
| AD-17 | Add Mastra Agent Guardrails (input/output processors)        | 2026-02-10 | PromptInjectionDetector, PIIDetector, ModerationProcessor for AI defense-in-depth                                                                                                                                                                                     |
| AD-18 | Adopt Mastra workflow lifecycle callbacks                    | 2026-02-10 | onFinish/onError for audit logging, Sentry integration, admin notifications                                                                                                                                                                                           |
| AD-19 | Use typed suspendSchema/resumeSchema for approvals           | 2026-02-10 | Runtime validation of suspend/resume payloads via Zod schemas                                                                                                                                                                                                         |
| AD-20 | Adopt Mastra workflow streaming (writer argument)            | 2026-02-10 | Real-time step progress + agent stream piping to client                                                                                                                                                                                                               |
| AD-21 | Add @fastify/websocket for real-time updates                 | 2026-02-10 | Workflow execution live updates, agent streaming, admin notifications                                                                                                                                                                                                 |
| AD-22 | Add @fastify/under-pressure for load shedding                | 2026-02-10 | Auto-503 on event loop delay/heap pressure — prevents OOM crashes                                                                                                                                                                                                     |
| AD-23 | Add @fastify/otel (replace deprecated OTel instrumentation)  | 2026-02-10 | Official Fastify OpenTelemetry plugin, W3C trace context                                                                                                                                                                                                              |
| AD-24 | Add sveltekit-superforms for admin/workflow forms            | 2026-02-10 | Type-safe form validation, 52K weekly DL, Svelte 5 compatible, Zod integration                                                                                                                                                                                        |
| AD-25 | Add LayerChart for admin dashboard visualization             | 2026-02-10 | D3-based charting, shadcn-svelte integration, cost comparison + workflow analytics                                                                                                                                                                                    |
| AD-26 | Skip Felte (prefer Superforms for forms)                     | 2026-02-10 | Superforms has 10x adoption, better Svelte 5 support, built-in Zod integration                                                                                                                                                                                        |
| AD-27 | Skip SVAR DataGrid (evaluate later)                          | 2026-02-10 | Commercial licensing, limited Svelte 5 runes support. Revisit when enterprise tables needed                                                                                                                                                                           |
| AD-28 | Use z.toJSONSchema() (Zod 4 built-in)                        | 2026-02-10 | Replace hand-rolled zodToJsonSchema() in portal-mcp-server.ts (~80 LOC savings)                                                                                                                                                                                       |
| AD-29 | Consolidate MCP implementations (deprecate custom client)    | 2026-02-10 | Custom MCPClient/MCPManager unused. Mastra MCPConnectionManager is production. Deduplicate PortalMCPServer.                                                                                                                                                           |
| AD-30 | Add cross-CSP MCP catalog entries (AWS, Azure, GCP)          | 2026-02-10 | Official MCP servers: awslabs/mcp (AWS), @azure/mcp, GCP managed. Add as admin catalog entries.                                                                                                                                                                       |
| AD-31 | Adopt Generative UI (AI SDK tool → Svelte component)         | 2026-02-10 | Map tool results to rich components: InstanceTable, CostChart, TerraformViewer, ApprovalCard.                                                                                                                                                                         |
| AD-32 | Defer A2A Agent Card to post-Phase E                         | 2026-02-10 | Mastra A2A has bugs (#8411). IBM ACP merged into A2A (dead). Oracle AgentSpec Python-only. Wait.                                                                                                                                                                      |
| AD-33 | Skip IBM ACP (merged into A2A)                               | 2026-02-10 | ACP merged with A2A under Linux Foundation (Sep 2025). No independent implementation needed.                                                                                                                                                                          |
| AD-34 | Skip Oracle Agent Spec (Python-only, no TS SDK)              | 2026-02-10 | WayFlow runtime Python-only. Monitor for TypeScript SDK. Mastra's programmatic approach preferred.                                                                                                                                                                    |
| AD-35 | Migrate agent_state from SQLite to Oracle (OracleStore)      | 2026-02-10 | Add org_id (VPD) + thread_id. Implement MastraStorage backed by Oracle. Drop SQLite dependency.                                                                                                                                                                       |
| AD-36 | Adopt formsnap + @tanstack/table-core for admin views        | 2026-02-10 | formsnap: accessible Superforms companion (12K DL). @tanstack/table-core: headless table for data-heavy admin pages (800K DL).                                                                                                                                        |
| AD-37 | Use paneforge for resizable panels in workflow designer      | 2026-02-10 | Split-view layout: canvas + inspector panel. Svelte 5 compatible, 6K DL. Better than custom CSS resize.                                                                                                                                                               |
| AD-38 | Use svelte-dnd-action for drag-and-drop interactions         | 2026-02-10 | Kanban boards, node palette drag-to-canvas. 15K DL, Svelte 5 runes support, lightweight.                                                                                                                                                                              |
| AD-39 | OCI Cache with Valkey for app-level caching (defer DBIM)     | 2026-02-10 | Valkey: MCP tool cache, OCI API responses, settings, agent context. ~$28-85/mo. DBIM deferred to 16+ ECPU phase. iovalkey client.                                                                                                                                     |
| AD-40 | SSE as primary streaming transport (defer WebSocket)         | 2026-02-10 | 95% of real-time needs are server→client. AI SDK + Mastra use SSE natively. Drop @fastify/websocket from Phase A scope.                                                                                                                                               |
| AD-41 | Defer Vite 7 + ESLint 10 to post-Phase 10                    | 2026-02-10 | ESLint 10 BLOCKED: typescript-eslint 8.x has no ESLint 10 support. Vite 7 low-priority, monorepo risks. Wait for ecosystem.                                                                                                                                           |
| AD-42 | Switch to @scalar/fastify-api-reference (replace Swagger UI) | 2026-02-10 | Modern API docs, dark mode, interactive playground, code generation. Drop-in replacement, 10 LOC change. Phase A.                                                                                                                                                     |
| AD-43 | Defer A2A Agent Card to post-Phase E                         | 2026-02-10 | Mastra A2A has known bugs (#8411). Wait for v1.0 stability. Low risk — no production consumers yet.                                                                                                                                                                   |
| AD-44 | Deprecate custom MCP, keep Mastra MCPConnectionManager only  | 2026-02-10 | Custom MCPClient unused in production. MCPConnectionManager has Docker, Oracle, encryption, admin UI. Confirms AD-29.                                                                                                                                                 |
| AD-45 | AWS + Azure MCP servers first in cross-cloud catalog         | 2026-02-10 | Both have mature MCP servers (awslabs/mcp, @azure/mcp). Covers 80%+ of multi-cloud customers. GCP deferred.                                                                                                                                                           |
| AD-46 | All 8 Generative UI components at once                       | 2026-02-10 | InstanceTable, CostChart, MetricsChart, BucketGrid, TerraformViewer, AlarmPanel, ResourceList, ApprovalCard. Ship as a batch.                                                                                                                                         |
| AD-47 | Clean agent_state SQLite → Oracle migration in Phase A       | 2026-02-10 | New OracleStore with org_id + thread_id columns. No data migration needed — sessions are ephemeral. Confirms AD-35.                                                                                                                                                   |
| AD-48 | Grafana + Tempo for observability backend                    | 2026-02-10 | OSS stack. Full control. Self-hosted Grafana, Tempo, Prometheus. Most flexible option vs SaaS alternatives.                                                                                                                                                           |
| AD-49 | Per-user rate limiting with Oracle store for LLM endpoints   | 2026-02-10 | rate-limiter-flexible with Oracle adapter. Different limits for chat (10/min) vs read endpoints (60/min). Phase A.                                                                                                                                                    |
| AD-50 | @fastify/schedule + Oracle queue table for background jobs   | 2026-02-10 | Zero new infrastructure. Oracle table for job queue, toad-scheduler for cron. Avoids Redis/BullMQ dependency.                                                                                                                                                         |
| AD-51 | Split @portal/shared into 3 packages (confirms AD-8)         | 2026-02-10 | Cleaner boundaries. @portal/types has 0 runtime deps. Faster builds. Framework isolation. Confirmed during dashboard Q&A.                                                                                                                                             |
| AD-52 | All Oracle 26AI features (Phase F) in parallel               | 2026-02-10 | Migrations 015/016/017 are independent SQL. Can run together if tested well. Reduces Phase F timeline by ~40%.                                                                                                                                                        |
| AD-53 | Self-built admin experience over Mastra Studio embedding     | 2026-02-11 | Studio is standalone (Hono + React on :4111), not embeddable. Custom SvelteKit pages consuming Mastra REST API give full control over UX, RBAC integration, and design system consistency. Supersedes AD-14.                                                          |
| AD-54 | Browser feedback loops for frontend design iteration         | 2026-02-11 | Use claude-in-chrome MCP tools for visual feedback. Create multiple design iterations per admin page, branch per iteration, use browser screenshots to inform selection. Skills: shadcn-svelte, responsive-design, visual-design-foundations, svelte5-best-practices. |
| AD-55 | OracleStore MastraStorage already complete — verify + test   | 2026-02-11 | OracleStore (1244 LOC) implements all 3 MastraStorage domains (workflows, memory, scores). No new implementation needed — add integration tests and verify edge cases. Drift detected from PRD Phase A which listed this as TODO.                                     |

---

## 20. Migration Checklist

### Pre-Migration

- [ ] Branch from main: `phase-10/foundation-rewrite`
- [ ] Run full test suite — baseline: all passing (1213+ tests)
- [ ] Export current OpenAPI spec for comparison
- [ ] Document current IDP callback URLs
- [ ] Backup Oracle schema (datapump export)

### Phase A: Dependency Updates + Fastify Hardening

- [ ] `pnpm update ai @ai-sdk/anthropic @ai-sdk/google @ai-sdk/svelte pino @fastify/swagger @sentry/sveltekit svelte typescript-eslint`
- [ ] Remove `@types/dompurify` from `apps/frontend/package.json`
- [ ] `pnpm add oci-sdk` to `packages/shared` (or `packages/server` after split)
- [ ] `pnpm add @modelcontextprotocol/sdk` to `packages/shared`
- [ ] `pnpm add -D syncpack` to root
- [ ] `npx syncpack fix-mismatches` — align dependency versions across workspaces
- [ ] Add `knip` to CI pipeline (already installed, not running in CI)
- [ ] `pnpm add @fastify/under-pressure fastify-graceful-shutdown @fastify/otel` to `apps/api` (AD-40: @fastify/websocket deferred — SSE covers 95% of use cases)
- [ ] Register `@fastify/otel` FIRST in Fastify plugin chain
- [ ] Configure `@fastify/under-pressure` thresholds (maxEventLoopDelay: 1000, maxHeapUsedBytes: 80%)
- [ ] Wire `fastify-graceful-shutdown` with Pino flush + Oracle pool drain
- [ ] `pnpm add @mastra/sentry @mastra/evals` to `apps/api`
- [ ] Configure `SentryExporter` in Mastra telemetry config
- [ ] `pnpm add zod-validation-error` to `packages/shared`
- [ ] Replace `zodToJsonSchema()` with `z.toJSONSchema()` in `portal-mcp-server.ts`
- [ ] ~~Evaluate Vite 7 in separate branch~~ **DEFERRED** (AD-41: ESLint 10 blocked by typescript-eslint, Vite 7 monorepo risks — defer to post-Phase 10)
- [ ] `pnpm add iovalkey` to `apps/api` (AD-39) — Valkey cache client (ioredis-compatible)
- [ ] Create `packages/shared/src/server/cache/` module (connection factory, key namespaces, Fastify plugin)
- [ ] Add cache-aside pattern to MCP tool discovery, OCI API responses, admin settings
- [ ] `pnpm remove @fastify/swagger-ui && pnpm add @scalar/fastify-api-reference` to `apps/api` (AD-42)
- [ ] Update `apps/api/src/app.ts` Swagger UI registration → Scalar (~10 LOC)
- [ ] Deprecate custom MCPClient/MCPManager (AD-29) — add README notice, keep as reference
- [ ] Deduplicate PortalMCPServer (remove packages/shared version, keep apps/api version with auth)
- [ ] Migrate agent_state from SQLite to Oracle (AD-35) — add org_id, thread_id columns
- [x] ~~Implement OracleStore (MastraStorage interface)~~ [DRIFT DETECTED] Already complete (1244 LOC, all 3 domains). Verify in Phase G (AD-55).
- [ ] `pnpm add rate-limiter-flexible` to `apps/api` (AD-49) — per-user rate limiting with Oracle adapter
- [ ] Configure rate-limiter-flexible: 10/min chat, 60/min read, Oracle persistence store
- [ ] Set up Grafana + Tempo docker-compose observability stack (AD-48)
- [ ] Configure @fastify/schedule with toad-scheduler + Oracle queue table (AD-50)
- [ ] Run full test suite — verify no regressions

### Phase B: Package Split + Frontend Libraries

- [ ] Create `packages/types/` with Zod schemas and TypeScript types
- [ ] Create `packages/server/` with server-only modules
- [ ] Create `packages/ui/` with Svelte components
- [ ] Update `pnpm-workspace.yaml` to include new packages
- [ ] Rewrite imports across all workspaces
- [ ] `pnpm add sveltekit-superforms` to `apps/frontend`
- [ ] Migrate admin forms (IDP, AI Provider, Settings) to Superforms
- [ ] Migrate setup wizard forms to Superforms
- [ ] `pnpm add layerchart` to `apps/frontend`
- [ ] Create admin dashboard metrics charts (tool usage, workflow runs, cost comparison)
- [ ] `pnpm add fuse.js` to `apps/frontend`
- [ ] Add fuzzy search to tool palette, MCP catalog, workflow list
- [ ] `pnpm add formsnap` to `apps/frontend` (AD-36) — pair with Superforms for accessible form controls
- [ ] `pnpm add @tanstack/table-core` to `apps/frontend` (AD-36) — headless tables for admin tool/server/audit listings
- [ ] `pnpm add paneforge` to `apps/frontend` (AD-37) — resizable split-view panels for workflow designer
- [ ] `pnpm add svelte-dnd-action` to `apps/frontend` (AD-38) — drag-and-drop for kanban boards, node palettes
- [ ] `pnpm add @formkit/auto-animate` to `apps/frontend` — smooth list animations for dynamic admin tables
- [ ] Build Generative UI components (AD-31): InstanceTable, CostChart, MetricsChart, TerraformViewer
- [ ] Build ApprovalCard using AI SDK built-in tool approval flow (needsApproval + addToolApprovalResponse)
- [ ] Adopt `createAIContext()` for shared Chat state (replace prop drilling)
- [ ] Add streaming data parts for real-time progress during tool execution
- [ ] Run `madge --circular` — verify no new circular deps
- [ ] Run full test suite and type checks across all packages

### Phase C: Fastify-First Migration [COMPLETE]

- [x] Implement Better Auth catch-all route in Fastify (toWebRequest pattern)
- [x] Configure `trustedOrigins` for cross-origin support
- [x] Register CORS before Better Auth handler
- [x] Migrate every SvelteKit +server.ts route to Fastify (stubs deleted in 914450a5)
- [x] Update SvelteKit hooks to cookie-forwarding only
- [x] Update +layout.server.ts to fetch session from Fastify /api/auth/session
- [x] Configure @fastify/compress (gzip + brotli, threshold: 1024 bytes)
- [x] Verify raw SSE streaming works (no @fastify/sse plugin needed — raw `reply.raw.write()`)
- [x] Test OIDC flow end-to-end with OCI IDCS
- [x] Verify nginx config — /api/\* routes already direct to Fastify
- [x] Add AWS MCP server to catalog (awslabs/mcp CloudControl) (AD-30/AD-45)
- [x] Add Azure MCP server to catalog (@azure/mcp) (AD-30/AD-45)
- [x] 59 integration tests for v1-tools + session continue
- [x] CodeRabbit review + fix (6 Wave 3 findings addressed)
- [x] Delete remaining 15 SvelteKit +server.ts stubs (all have Fastify equivalents)
- [x] Remove `FASTIFY_PROXY_ROUTES` and `FASTIFY_ENABLED` feature flags (Fastify always on)
- [x] Remove SvelteKit proxy middleware code (hooks.server.ts no longer proxies)
- ~~Configure Mastra Studio~~ **DROPPED** (AD-53: Studio not embeddable, replaced by Phase G)
- ~~Add GCP MCP server~~ **DEFERRED** (AD-45: AWS + Azure covers 80%+ multi-cloud)

### Phase G: Self-Built Admin Experience (AD-53)

- [ ] **G-1: Agent Playground** (`/admin/agents`)
  - [ ] Agent list with model/status metadata
  - [ ] Streaming chat playground using Mastra REST API (`POST /api/mastra/agents/:id/stream`)
  - [ ] Real-time tool call visualization (SSE data parts)
  - [ ] Token usage, latency, model metrics per interaction
  - [ ] System prompt editor with parameter tuning
- [ ] **G-2: Workflow Execution Monitor** (`/admin/workflows/runs`)
  - [ ] Live SSE-powered step progress (`GET /api/mastra/workflows/:id/runs/:runId/stream`)
  - [ ] Pause/resume/cancel controls
  - [ ] Step-by-step inputs/outputs inspection
  - [ ] Execution history with filtering/search
- [ ] **G-3: Tool Tester** (`/admin/tools/playground`)
  - [ ] Tool selection with category filter + fuzzy search (Fuse.js)
  - [ ] Dynamic argument builder from tool schema
  - [ ] Raw OCI response vs slimmed output comparison
  - [ ] Approval flow preview for dangerous tools
- [ ] **G-4: Observability Dashboard** (`/admin/observability`)
  - [ ] Agent traces (tool calls, ordering, latency) via Grafana/Tempo API
  - [ ] Workflow run timelines with LayerChart
  - [ ] Error rates and latency percentiles
  - [ ] Cost tracking per agent/workflow/model
- [ ] **Design iteration** (AD-54): Multiple UI iterations per page
  - [ ] Use shadcn-svelte, responsive-design, visual-design-foundations skills
  - [ ] Browser feedback loops via claude-in-chrome for visual validation
  - [ ] Branch per iteration, merge winner
- [ ] **OracleStore verification** (AD-55): Verify MastraStorage compliance
  - [ ] Add integration tests for OracleStore workflows domain
  - [ ] Add integration tests for OracleStore memory domain
  - [ ] Add integration tests for OracleStore scores domain
  - [ ] Verify edge cases (empty results, large payloads, concurrent access)
- [ ] All pages gated behind RBAC admin role

### Phase D: OCI SDK

- [ ] Configure oci-sdk auth provider (config file + instance principal)
- [ ] Create `executor-sdk.ts` adapter with error wrapping as OCIError
- [ ] Migrate top-10 tools by call frequency, benchmark latency
- [ ] Run tool-specific tests with SDK executor
- [ ] Gradually migrate remaining tools

### Phase E: Workflow Designer + AI Hardening

- [ ] Implement ai-step node: Mastra agent.generate() + output schema
- [ ] Implement loop node: Mastra .foreach() with concurrency config
- [ ] Implement parallel node: Mastra .parallel() with merge step
- [ ] Add retry policy to tool/ai-step nodes (exponential backoff)
- [ ] Add compensation handlers (reverse execution on failure)
- [ ] Add workflow streaming via Mastra writer argument + @fastify/sse
- [ ] Add workflow lifecycle callbacks (onFinish → audit log, onError → Sentry)
- [ ] Add typed suspendSchema/resumeSchema for approval nodes
- [ ] Add PromptInjectionDetector as inputProcessor on CloudAdvisor
- [ ] Add PIIDetector (redact strategy) as hybrid processor
- [ ] Add TokenLimiterProcessor (4000 tokens) as outputProcessor
- [ ] Configure @mastra/evals scorers: relevancy + toxicity with 10% sampling
- [ ] Verify scorer results appear in Mastra Studio Scorers tab
- [ ] Add crash recovery via restartAllActiveWorkflowRuns()
- [ ] Update workflow definition schema (new node configs)
- [ ] Update frontend editor components for new node types
- [ ] (Post-E) Evaluate Mastra A2A stability; if stable, expose CloudAdvisor Agent Card (AD-32)

### Phase F: Oracle 26AI (AD-52: all 3 migrations parallelizable)

- [ ] Migration 015: HNSW DML indexes (neighbors=16, efConstruction=200) — parallelizable
- [ ] Migration 016: JSON Duality Views for workflow definitions — parallelizable
- [ ] Migration 017: VPD policies for tenant isolation — parallelizable
- [ ] Replace vectorToOracleString() with direct Float32Array binding
- [ ] Update OracleVectorStore to use DB_TYPE_VECTOR
- [ ] Benchmark vector search performance (3x target)
- [ ] Test VPD with admin and non-admin roles

### Post-Migration

- [ ] Run full test suite — all passing
- [ ] Run Semgrep security scan
- [ ] Run `pnpm outdated` — zero deprecated, zero major gaps
- [ ] Run `knip` — zero unused exports or dependencies
- [ ] Run `syncpack lint` — zero version mismatches
- [ ] Compare OpenAPI spec — no unintended changes
- [ ] Verify self-built admin experience (agents, workflows, tools, observability) accessible with RBAC admin role
- [ ] Verify Agent Guardrails block prompt injection attempts
- [ ] Verify @mastra/evals scorers recording to database
- [ ] Update CLAUDE.md with new package structure
- [ ] Update `.claude/reference/` docs
- [ ] Verify zero +server.ts files remain in SvelteKit

---

## 21. Changelog

| Date       | Change Type | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-10 | Created     | Comprehensive Phase 10 PRD with dependency audit, build-vs-buy analysis, 6-phase roadmap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-02-10 | Updated v2  | Full foundation rewrite coverage: separation of concerns, authn/authz, backend/frontend/middleware architecture, observability, testing, CI/CD, Mastra workflow API patterns, Oracle Float32Array binding, all 37 SvelteKit API routes enumerated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-02-10 | Updated v3  | Ecosystem expansion: Mastra Studio elevated to admin tool (AD-14), @mastra/sentry (AD-15), @mastra/evals (AD-16), Agent Guardrails (AD-17), workflow lifecycle/streaming/snapshots (AD-18-20). Fastify plugins: websocket, under-pressure, otel, sse, compress, schedule, graceful-shutdown (AD-21-23). Frontend: sveltekit-superforms (AD-24), LayerChart (AD-25), fuse.js. DX: syncpack, z.toJSONSchema(), knip CI, zod-validation-error. Decisions AD-14 through AD-28. Updated all 6 phases and migration checklist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-02-10 | Updated v4  | Agent interoperability: MCP consolidation (AD-29), cross-CSP MCP catalog (AD-30), Generative UI with AI SDK (AD-31), A2A deferred (AD-32), IBM ACP skip (AD-33), Oracle AgentSpec skip (AD-34), agent_state SQLite→Oracle migration (AD-35). Risks R16-R18. Updated Phase A (MCP dedup, OracleStore), Phase B (Generative UI components), Phase C (cross-CSP catalog), Phase E (A2A evaluation).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-02-10 | Updated v5  | [DRIFT DETECTED] MCP Server Management (11 commits) landed on main pre-Phase A — documented as Completed Work. [ADDED] Frontend libraries from Svelte 5 ecosystem research: formsnap (AD-36), @tanstack/table-core (AD-36), paneforge (AD-37), svelte-dnd-action (AD-38), @formkit/auto-animate. [ADDED] Decisions AD-36 through AD-38. [CHANGED] Phase B migration checklist expanded with 5 new dependency install steps. Header updated to Draft v5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-02-10 | Updated v5a | Architecture decisions from debated topics: OCI Cache with Valkey (AD-39), SSE primary transport (AD-40), Vite 7/ESLint 10 deferred (AD-41), Scalar API docs (AD-42). [CHANGED] @fastify/websocket demoted P0→P2, @fastify/sse elevated to primary. cache-manager removed (iovalkey direct). Scalar promoted P2→P0. Risks R19-R20. Phase A checklist updated with Valkey + Scalar + deferred Vite 7. Dependency inventory reorganized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-02-10 | Updated v6  | Dashboard Q&A decisions (AD-43 through AD-52): A2A deferred to post-Phase E (AD-43), MCP consolidated to Mastra only (AD-44), AWS+Azure first in cross-cloud catalog (AD-45), all 8 GenUI components shipped together (AD-46), clean agent_state Oracle migration (AD-47), Grafana+Tempo observability (AD-48), per-user rate limiting with Oracle (AD-49), Oracle job queue with @fastify/schedule (AD-50), package split confirmed (AD-51), Oracle 26AI parallel migrations (AD-52). [CHANGED] Phase A checklist +4 items (rate limiter, Grafana, schedule). Phase C GCP deferred. Phase E A2A explicit deferral. Phase F migrations marked parallelizable. Agent task plan companion document created with 107 atomic tasks across 6 phases.                                                                                                                                                                                                                                                                  |
| 2026-02-11 | Updated v7  | [CHANGED] AD-14 superseded by AD-53: Mastra Studio can't be embedded (standalone Hono + React). Self-built admin experience replaces Studio embedding. [ADDED] Phase G: Self-Built Admin Experience (Agent Playground, Workflow Monitor, Tool Tester, Observability Dashboard) with 4 sub-phases. [ADDED] US-6 (Admin Experience), US-7 (Frontend Design Iteration). [ADDED] AD-53 (self-built admin), AD-54 (browser feedback loops), AD-55 (OracleStore already complete). [DRIFT DETECTED] OracleStore fully implements MastraStorage (1244 LOC, all 3 domains) — Phase A TODO marked as done. [DRIFT DETECTED] Phase C mostly complete (22/37 routes migrated, 15 stubs remain). [CHANGED] Phase C checklist updated with completion markers. [CHANGED] Phase dependencies DAG updated with Phase G. [REMOVED] R12 (Studio auth bypass — no longer applicable). [ADDED] R21 (Phase G scope creep), R22 (browser feedback latency). [CHANGED] Non-Goals: Studio embedding explicitly excluded with rationale. |
