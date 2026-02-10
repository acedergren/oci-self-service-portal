# PRD: Premium MCP Server Management System

> **Status**: Approved
> **Author**: Claude Opus 4.6 + acedergr
> **Created**: 2026-02-10
> **Last Updated**: 2026-02-10

---

## Validation Checklist

Run `/prd --validate` to check these gates. All Critical gates must pass before approval.

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

## 1. Product Overview

### Vision

Transform the OCI Self-Service Portal from a closed-tool system into an extensible AI platform where administrators can install, manage, and monitor MCP (Model Context Protocol) servers from a visual marketplace. Connected servers dynamically inject tools into CloudAdvisor at runtime, enabling the AI agent to interact with any external system (Slack, GitHub, PagerDuty, Jira, etc.) without code changes.

### Problem Statement

CloudAdvisor currently has 60+ hard-coded OCI CLI tools. Integrating external systems (Slack, GitHub, ITSM platforms) requires writing custom tool wrappers, deploying code changes, and restarting the API server. This creates a bottleneck where every new integration is a multi-day engineering effort — even when mature MCP servers already exist for these services.

**Who experiences this**: Platform administrators who need their AI agent to interact with their existing tool ecosystem. Operations teams who want incident management, change tracking, or ChatOps capabilities without waiting for custom development.

**Frequency**: Every time a new external tool integration is requested (estimated 2-4 requests per month post-launch).

### Value Proposition

- **Admins install MCP servers in minutes** instead of waiting for engineering sprints
- **60+ community MCP servers** become instantly available (Slack, GitHub, PagerDuty, Jira, Brave Search, filesystem, databases, etc.)
- **Dynamic tool injection** means CloudAdvisor gains new capabilities at runtime without restarts
- **Custom servers** supported for proprietary/internal tools via SSE or HTTP transports
- **Docker orchestration** sandboxes catalog servers with security constraints (512MB memory, cap-drop ALL)
- **Encrypted credential management** protects API keys/tokens at rest (AES-256-GCM)

**Cost of not building**: Every external integration remains a custom engineering task. The portal stays siloed to OCI-only operations, missing the "single pane of glass" value proposition for operations teams.

---

## 2. User Personas

### Persona: Platform Administrator

| Attribute    | Detail                                                           |
| ------------ | ---------------------------------------------------------------- |
| Role         | Admin user with `admin:all` permission in the portal             |
| Goal         | Extend CloudAdvisor's capabilities by connecting external tools  |
| Pain Point   | Each new integration requires code changes and deployment cycles |
| Tech Comfort | High — comfortable with API keys, Docker, MCP protocol concepts  |

### Persona: Operations Engineer

| Attribute    | Detail                                                                               |
| ------------ | ------------------------------------------------------------------------------------ |
| Role         | Daily user of CloudAdvisor for infrastructure tasks                                  |
| Goal         | Ask CloudAdvisor to interact with Slack, GitHub, PagerDuty without context-switching |
| Pain Point   | Must switch between CloudAdvisor and 3-5 other tools during incidents                |
| Tech Comfort | Medium — uses tools but doesn't configure them                                       |

### Persona: Security Reviewer

| Attribute    | Detail                                                                      |
| ------------ | --------------------------------------------------------------------------- |
| Role         | Responsible for auditing tool access and credential management              |
| Goal         | Verify that MCP servers are sandboxed, credentials encrypted, access logged |
| Pain Point   | Shadow integrations created outside governed processes                      |
| Tech Comfort | High — reviews Docker configs, encryption implementations, audit logs       |

---

## 3. User Journey Maps

### Journey: Platform Administrator — Install Slack MCP Server from Catalog

```
Admin Console → Integrations Tab → Catalog Grid → Click "Install" on Slack
    → Modal: Enter Bot Token → "Install & Connect"
        → Backend: create DB record → encrypt token → start Docker container
            → MCPClient connects → discover tools → cache in DB
                ├── Success → Toast "Connected", server in Connected tab (green badge)
                └── Failure → Toast error, server status "error" with last_error
```

**Touchpoints**: Admin UI (catalog grid, modal, toast), Fastify API (5 endpoints), Oracle DB (3 tables), Docker (container lifecycle), Mastra MCPClient (protocol)
**Handoffs**: Frontend → API → MCPConnectionManager → Docker/MCPClient → DB

### Journey: Operations Engineer — Use MCP Tool via CloudAdvisor

```
AI Chat → Ask "List my Slack channels"
    → chat.ts loads MCP toolsets for org → passes to agent.stream()
        → CloudAdvisor selects Slack tool → MCPClient executes → returns result
            ├── Success → Agent presents formatted channel list
            └── Failure → Agent falls back to built-in tools, logs warning
```

**Touchpoints**: Chat UI, Fastify chat route, Mastra agent, MCPClient, external Slack API
**Handoffs**: Frontend → API → Agent → MCPClient → External MCP Server → Agent → Frontend

### Journey: Platform Administrator — Add Custom Remote MCP Server

```
Admin Console → Integrations Tab → "+ Add Custom" button
    → Modal: Select SSE transport → Enter URL + auth headers
        → "Test Connection" → temporary MCPClient → list tools → disconnect
            ├── Success → Show tool count → "Save & Connect"
            └── Failure → Show error → allow retry or cancel
```

**Touchpoints**: Admin UI (modal, form), Fastify API (create + connect endpoints), MCPClient (SSE transport)
**Handoffs**: Frontend → API → MCPConnectionManager → Remote MCP Server

### Journey: Platform Administrator — Tool Playground Testing

```
Admin Console → Integrations Tab → Tool Playground Tab
    → Filter tools by server → Expand tool card
        → Fill dynamic form (from JSON Schema) → "Execute"
            → Backend proxies through MCPClient → returns result
                ├── Success → Display formatted JSON result
                └── Failure → Display error message
```

**Touchpoints**: Admin UI (tool cards, dynamic forms), Fastify API (tool test endpoint), MCPClient
**Handoffs**: Frontend → API → MCPConnectionManager → MCPClient → External Server

---

## 4. Feature Requirements

### Must Have (P0)

#### M1: MCP Server Catalog with Visual Marketplace

**User Story**: As a Platform Administrator, I want to browse a catalog of pre-configured MCP servers so that I can install integrations without manual configuration.

**Acceptance Criteria**:

```gherkin
Given the admin navigates to /admin/integrations
When the Catalog tab is active
Then a grid of catalog cards is displayed with icon, name, description, category, and "Install" button

Given catalog items are seeded in the database (Slack, GitHub, PagerDuty, Jira, Filesystem, Brave Search)
When the admin filters by category "Communication"
Then only Slack is shown

Given the admin clicks "Install" on a catalog item
When the install modal opens
Then the required credential fields match the catalog item's required_credentials JSON
```

**Affected Files**: `packages/shared/src/server/oracle/migrations/013-mcp-servers.sql`, `packages/shared/src/server/admin/mcp-repository.ts`, `apps/api/src/routes/admin/mcp.ts`, `apps/frontend/src/routes/admin/integrations/+page.svelte`, `apps/frontend/src/lib/components/admin/IntegrationCatalogCard.svelte`
**Test File**: `apps/api/src/tests/admin/mcp-repository.test.ts` (catalog CRUD), `apps/api/src/tests/routes/mcp-admin-routes.test.ts` (catalog API)

#### M2: MCP Server Lifecycle Management (Connect/Disconnect/Restart)

**User Story**: As a Platform Administrator, I want to connect, disconnect, and restart MCP servers so that I can manage their lifecycle without touching infrastructure.

**Acceptance Criteria**:

```gherkin
Given an MCP server record exists with status "disconnected"
When the admin clicks "Connect"
Then the backend creates a Mastra MCPClient with the server's transport config
And the server status changes to "connected"
And discovered tools are cached in mcp_tool_cache

Given an MCP server with status "connected"
When the admin clicks "Disconnect"
Then the MCPClient is disconnected and removed from memory
And any Docker container is stopped
And the server status changes to "disconnected"

Given an MCP server with status "error"
When the admin clicks "Restart"
Then the server is disconnected then reconnected
And the last_error is cleared on success
```

**Affected Files**: `apps/api/src/services/mcp-connection-manager.ts`, `apps/api/src/routes/admin/mcp.ts`, `apps/frontend/src/lib/components/admin/IntegrationServerCard.svelte`
**Test File**: `apps/api/src/tests/mcp-connection-manager.test.ts` (23 tests), `apps/api/src/tests/routes/mcp-admin-routes.test.ts` (connect/disconnect/restart routes)

#### M3: Encrypted Credential Management

**User Story**: As a Platform Administrator, I want MCP server credentials (API keys, tokens) encrypted at rest so that secrets are never stored in plaintext.

**Acceptance Criteria**:

```gherkin
Given the admin sets a credential for an MCP server
When the credential is stored in mcp_server_credentials
Then the value is encrypted with AES-256-GCM
And stored as three columns: value_enc (BLOB), value_iv (RAW(16)), value_tag (RAW(16))

Given a credential is stored encrypted
When the MCPConnectionManager needs the credential for connection
Then it decrypts using decryptSecret() from crypto.ts
And the decrypted value is never persisted or logged

Given the admin views server details via the API
When credentials are returned
Then the response includes credential metadata but NOT the decrypted value
```

**Affected Files**: `packages/shared/src/server/admin/mcp-repository.ts` (setCredential, getDecryptedCredentials), `packages/shared/src/server/auth/crypto.ts` (reused)
**Test File**: `apps/api/src/tests/admin/mcp-repository.test.ts` (credential encryption tests)

#### M4: Dynamic MCP Tool Injection into CloudAdvisor

**User Story**: As an Operations Engineer, I want CloudAdvisor to automatically have access to all connected MCP server tools so that I can interact with external systems through natural language.

**Acceptance Criteria**:

```gherkin
Given a Slack MCP server is connected for the user's organization
When the user sends a chat message
Then the chat route calls mcpConnectionManager.getToolsets(orgId)
And passes the result as toolsets to agent.stream()

Given MCP toolsets are loaded
When CloudAdvisor determines a Slack tool is relevant
Then the agent calls the tool via the MCPClient
And the result is presented to the user

Given no MCP servers are connected for the org
When the user sends a chat message
Then CloudAdvisor uses only built-in OCI tools
And no error is thrown

Given the MCP toolset loading fails
When the user sends a chat message
Then the failure is logged as a warning
And CloudAdvisor continues with built-in tools only (non-blocking)
```

**Affected Files**: `apps/api/src/routes/chat.ts` (modified), `apps/api/src/plugins/mastra.ts` (modified), `apps/api/src/services/mcp-connection-manager.ts`
**Test File**: `apps/api/src/tests/mcp-connection-manager.test.ts` (getToolsets tests)

#### M5: Custom MCP Server Support (SSE/HTTP)

**User Story**: As a Platform Administrator, I want to add custom MCP servers via SSE or HTTP URL so that I can connect proprietary or internal MCP servers not in the catalog.

**Acceptance Criteria**:

```gherkin
Given the admin clicks "+ Add Custom"
When the modal opens
Then transport type options include "stdio", "sse", and "http"

Given the admin selects SSE transport and enters a URL
When the admin clicks "Test Connection"
Then a temporary MCPClient connects, lists tools, and disconnects
And the discovered tool count is shown

Given the admin saves a custom SSE server
When the server is created in the database
Then server_type is "custom" and transport_type is "sse"
And the config JSON contains the URL and optional auth headers
```

**Affected Files**: `apps/api/src/routes/admin/mcp.ts` (create custom endpoint), `apps/frontend/src/lib/components/admin/MCPServerModal.svelte` (custom mode)
**Test File**: `apps/api/src/tests/routes/mcp-admin-routes.test.ts` (custom server creation)

#### M6: Docker Orchestration for Catalog Servers

**User Story**: As a Platform Administrator, I want catalog servers to run in Docker containers so that they are isolated and sandboxed with security constraints.

**Acceptance Criteria**:

```gherkin
Given a catalog item has a docker_image configured
When the admin installs and connects it
Then a Docker container is started with the specified image and tag
And the container has 512MB memory limit, 1 CPU, cap-drop ALL, no-new-privileges

Given a Docker container is running for an MCP server
When the admin disconnects the server
Then the Docker container is stopped and removed
And the container_id is cleared from the database

Given a Docker image name is provided
When the image name is validated
Then it must match the pattern /^[a-z0-9._\/-]+$/ to prevent command injection
```

**Affected Files**: `apps/api/src/services/mcp-connection-manager.ts` (DockerManager section), `apps/api/package.json` (dockerode dependency)
**Test File**: `apps/api/src/tests/mcp-connection-manager.test.ts` (Docker lifecycle tests)

#### M7: Admin Integrations UI (3-Tab Layout)

**User Story**: As a Platform Administrator, I want a single admin page with Catalog, Connected Servers, and Tool Playground tabs so that I can manage all MCP integrations from one place.

**Acceptance Criteria**:

```gherkin
Given the admin navigates to /admin/integrations
When the page loads
Then three tabs are displayed: "Catalog", "Connected Servers", "Tool Playground"
And the catalog data is prefetched via SSR

Given the "Connected Servers" tab is active
When a server's status changes
Then the status badge updates within 5 seconds (polling interval)
And status badges use color coding: green (connected), red (error), gray (disconnected), yellow (connecting)

Given the "Tool Playground" tab is active
When the admin expands a tool card
Then a dynamic form is rendered from the tool's JSON Schema input
And an "Execute" button proxies the call through the backend
```

**Affected Files**: `apps/frontend/src/routes/admin/integrations/+page.svelte`, `apps/frontend/src/routes/admin/integrations/+page.server.ts`, all 4 component files
**Test File**: `apps/api/src/tests/routes/mcp-admin-routes.test.ts` (API layer backing the UI)

### Should Have (P1)

#### S1: Tool Call Metrics and Performance Monitoring

**User Story**: As a Platform Administrator, I want to see tool call metrics (count, success rate, average duration) so that I can monitor MCP server health.

**Acceptance Criteria**:

```gherkin
Given tools are called through MCP servers
When a tool call completes
Then a record is inserted into mcp_server_metrics with server_id, tool_name, duration_ms, success flag

Given the admin views server metrics
When the API returns aggregated metrics
Then total calls, success rate percentage, and average duration are shown
And per-tool breakdown is included
```

**Affected Files**: `packages/shared/src/server/admin/mcp-repository.ts` (recordToolCall, getMetrics), `apps/api/src/routes/admin/mcp.ts` (metrics endpoint)
**Test File**: `apps/api/src/tests/admin/mcp-repository.test.ts` (metrics tests)

#### S2: Server Health Monitoring

**User Story**: As a Platform Administrator, I want real-time health status for each connected MCP server so that I can detect and respond to outages.

**Acceptance Criteria**:

```gherkin
Given an MCP server is connected
When the admin views the server card
Then a health status indicator shows the connection state

Given an MCP server connection drops
When the health check detects the failure
Then the server status updates to "error" with the error message
And the last_error column is populated
```

**Affected Files**: `apps/api/src/services/mcp-connection-manager.ts` (getServerHealth), `apps/api/src/routes/admin/mcp.ts` (health endpoint)
**Test File**: `apps/api/src/tests/mcp-connection-manager.test.ts` (health check tests)

#### S3: Server Log Capture

**User Story**: As a Platform Administrator, I want to view recent logs from MCP servers so that I can debug integration issues.

**Acceptance Criteria**:

```gherkin
Given an MCP server produces log output
When the log is captured
Then it is stored in mcp_server_logs with level and timestamp

Given the admin views server details
When logs are requested
Then the most recent logs are displayed in reverse chronological order
```

**Affected Files**: `packages/shared/src/server/oracle/migrations/013-mcp-servers.sql` (mcp_server_logs table), `packages/shared/src/server/admin/mcp-repository.ts`
**Test File**: `apps/api/src/tests/admin/mcp-repository.test.ts`

### Could Have (P2)

#### C1: Catalog Item Search and Category Filtering

**User Story**: As a Platform Administrator, I want to search and filter catalog items by category so that I can quickly find relevant integrations in a growing catalog.

**Affected Files**: `apps/frontend/src/routes/admin/integrations/+page.svelte` (search input, category filter)

#### C2: Resource Discovery and Caching

**User Story**: As a Platform Administrator, I want to see MCP server resources (not just tools) so that I can understand the full capabilities of connected servers.

**Affected Files**: `packages/shared/src/server/admin/mcp-repository.ts` (cacheResources, getCachedResources), `packages/shared/src/server/oracle/migrations/013-mcp-servers.sql` (mcp_resource_cache table)

#### C3: Bulk Server Operations

**User Story**: As a Platform Administrator, I want to connect/disconnect multiple servers at once so that I can manage integrations efficiently during maintenance windows.

### Won't Do (Explicit Exclusions)

- **W1**: ITSM features (incidents, change management, SLA tracking) — deferred to a future ITSM-specific phase
- **W2**: Knowledge base with vector RAG — separate feature requiring dedicated embedding pipeline design
- **W3**: Workflow nodes for MCP tool execution — requires workflow engine extension (Phase 7 successor)
- **W4**: Public MCP server endpoint — portal doesn't expose its own tools as an MCP server to external consumers yet
- **W5**: MCP OAuth flow — Mastra supports it but admin UI doesn't expose it; use API key/token auth instead
- **W6**: Resource subscriptions — MCP protocol supports subscriptions but not needed for initial release
- **W7**: Prompt support — MCP protocol supports prompts but not needed for tool-focused first release

---

## 5. Architecture Decisions

### AD-1: Replace Custom MCP Client with @mastra/mcp MCPClient

| Aspect        | Detail                                                                                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Context**   | The portal has a custom MCP client (1,400+ LOC across 6 files) supporting stdio and SSE transports. Mastra's `@mastra/mcp` package provides a production-ready MCPClient with the same transports plus HTTP, tool conversion, and agent integration. |
| **Decision**  | Use `@mastra/mcp` MCPClient as the protocol layer, deprecate custom client.                                                                                                                                                                          |
| **Rationale** | Eliminates 1,400+ LOC of maintenance burden, gains HTTP transport and `listToolsets()` for per-request dynamic tool injection — the critical feature for multi-tenant MCP.                                                                           |

**Alternatives Evaluated**:

| Option                          | Pros                                                                      | Cons                                               | Rejected Because                            |
| ------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| Keep custom MCP client          | No new dependency, full control                                           | 1,400+ LOC to maintain, no listToolsets(), no HTTP | High maintenance, missing critical features |
| Use `@modelcontextprotocol/sdk` | Official MCP SDK, widely adopted                                          | No Mastra tool conversion, no agent integration    | Requires additional bridge code             |
| **Use `@mastra/mcp` MCPClient** | Tool conversion built-in, `listToolsets()` for multi-tenant, agent-native | Adds Mastra dependency, API may evolve             | **Selected**                                |

**Consequences**: Portal depends on Mastra's MCP API stability. If Mastra breaks the MCPClient API, we must update MCPConnectionManager. Mitigated by pinning version and wrapping MCPClient in our own service layer.

### AD-2: Docker Orchestration via dockerode

| Aspect        | Detail                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Context**   | Catalog MCP servers need to run as isolated processes. Options: direct process spawn, Docker containers, Kubernetes pods.                                                                     |
| **Decision**  | Use `dockerode` to manage Docker containers on the API server host.                                                                                                                           |
| **Rationale** | Docker provides process isolation, resource limits, and network sandboxing without requiring a Kubernetes cluster. dockerode is the mature Node.js Docker API client (11M+ weekly downloads). |

**Alternatives Evaluated**:

| Option                       | Pros                                         | Cons                                                     | Rejected Because                              |
| ---------------------------- | -------------------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| Direct process spawn (stdio) | Simple, no Docker dependency                 | No resource limits, no network isolation, no security    | Insufficient sandboxing for untrusted servers |
| **dockerode + Docker**       | Resource limits, cap-drop, process isolation | Requires Docker on host, container management complexity | **Selected**                                  |
| Kubernetes pods              | Best isolation, auto-scaling                 | Requires K8s cluster, heavy for single-server deployment | Over-engineered for current scale             |

**Consequences**: API server host must have Docker installed. Container lifecycle management adds complexity. Failed containers need cleanup. Mitigated by DockerManager wrapper with health checks and automatic cleanup on disconnect.

### AD-3: AES-256-GCM Credential Encryption (Reuse Existing crypto.ts)

| Aspect        | Detail                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Context**   | MCP servers require API keys/tokens. These must be encrypted at rest in Oracle DB.                                                                                                        |
| **Decision**  | Reuse existing `encryptSecret()`/`decryptSecret()` from `packages/shared/src/server/auth/crypto.ts`. Store as 3 columns: `value_enc` (BLOB), `value_iv` (RAW(16)), `value_tag` (RAW(16)). |
| **Rationale** | Same pattern already proven for IDP and AI provider secrets. Consistent encryption approach across the portal. Key derived from `BETTER_AUTH_SECRET`.                                     |

**Alternatives Evaluated**:

| Option                        | Pros                            | Cons                                      | Rejected Because                        |
| ----------------------------- | ------------------------------- | ----------------------------------------- | --------------------------------------- |
| OCI Vault (KMS)               | HSM-backed, key rotation        | Network call per encrypt/decrypt, latency | Too slow for per-request credential use |
| **AES-256-GCM via crypto.ts** | Already proven, no network call | Key in memory, no HSM                     | **Selected**                            |
| Environment variables only    | Simple, no encryption needed    | Doesn't scale to N servers, no DB storage | Can't manage per-server credentials     |

**Consequences**: Encryption key derived from `BETTER_AUTH_SECRET` env var. If that key rotates, all stored credentials become unreadable. Mitigation: document key rotation procedure.

### AD-4: Oracle DB Schema (7 Tables) for MCP Management

| Aspect        | Detail                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Context**   | MCP server configs, credentials, tool caches, metrics, and logs need persistent storage.                                                                  |
| **Decision**  | 7 new tables in migration 013: mcp_catalog, mcp_servers, mcp_server_credentials, mcp_tool_cache, mcp_resource_cache, mcp_server_metrics, mcp_server_logs. |
| **Rationale** | Follows existing migration pattern (001-012). Org-scoped with FK to organizations. MERGE INTO for credential upserts. JSON columns for flexible config.   |

**Alternatives Evaluated**:

| Option                   | Pros                            | Cons                                              | Rejected Because                          |
| ------------------------ | ------------------------------- | ------------------------------------------------- | ----------------------------------------- |
| **Oracle DB (7 tables)** | Consistent with existing schema | More tables to maintain                           | **Selected**                              |
| SQLite sidecar           | No Oracle dependency            | No org isolation, no shared state across replicas | Doesn't work in multi-instance deployment |
| Config files (YAML/JSON) | Simple, no DB needed            | No CRUD API, no encryption, no audit trail        | Too primitive for admin-managed servers   |

**Consequences**: Migration 013 adds 7 tables and 6 seed rows. Indexes on org_id, status, and timestamp columns for query performance.

### AD-5: Frontend Architecture (TanStack Query + Svelte 5 Runes)

| Aspect        | Detail                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Context**   | Admin integrations page needs real-time status updates, optimistic mutations, and SSR prefetch.                                                           |
| **Decision**  | Follow existing admin page pattern: TanStack Query for data fetching, Svelte 5 runes ($state, $derived) for local state, svelte-sonner for notifications. |
| **Rationale** | Consistent with `/admin/idp/` and `/admin/settings/` pages. 5-second polling for server status. SSR prefetch for catalog data.                            |

**Alternatives Evaluated**:

| Option                              | Pros                                 | Cons                                         | Rejected Because                    |
| ----------------------------------- | ------------------------------------ | -------------------------------------------- | ----------------------------------- |
| **TanStack Query + Svelte 5 runes** | Consistent with existing admin pages | Polling (not real-time WebSocket)            | **Selected**                        |
| WebSocket for real-time updates     | True real-time                       | New infrastructure, connection management    | Over-engineered for admin-only page |
| SvelteKit load() only               | Simple, built-in                     | No optimistic updates, no background refetch | Poor UX for status monitoring       |

**Consequences**: 5-second polling on Connected Servers tab. Acceptable latency for admin monitoring use case. WebSocket can be added later if needed.

---

## 6. Dependency Analysis

### Current State (In-Scope Packages)

| Package           | Current | Latest | Status       | Notes                  |
| ----------------- | ------- | ------ | ------------ | ---------------------- |
| @mastra/core      | 0.10.1  | 0.10.1 | Up to date   | Mastra framework core  |
| @mastra/memory    | 0.10.1  | 0.10.1 | Up to date   | Agent memory           |
| fastify           | 5.3.3   | 5.3.3  | Up to date   | API framework          |
| @ai-sdk/anthropic | 3.0.39  | 3.0.40 | Patch behind | Minor update available |
| @ai-sdk/google    | 3.0.22  | 3.0.23 | Patch behind | Minor update available |
| ai                | 6.0.73  | 6.0.78 | Patch behind | AI SDK core            |
| @fastify/swagger  | 9.6.1   | 9.7.0  | Minor behind | Non-breaking update    |
| oracledb          | 6.10.0  | 6.10.0 | Up to date   | Oracle DB driver       |

### New Dependencies

| Package          | Version | Purpose                              | License    | Size   | Alternatives Considered                  |
| ---------------- | ------- | ------------------------------------ | ---------- | ------ | ---------------------------------------- |
| @mastra/mcp      | ^1.0.0  | MCP protocol client (stdio/SSE/HTTP) | Apache-2.0 | ~150KB | @modelcontextprotocol/sdk, custom client |
| dockerode        | ^4.0.9  | Docker API client for container mgmt | Apache-2.0 | ~80KB  | docker-compose CLI, child_process        |
| @types/dockerode | ^4.0.1  | TypeScript types for dockerode       | MIT        | ~20KB  | N/A (type definitions)                   |

### Deprecation Warnings

- Custom MCP client (`packages/shared/src/server/mcp-client/`) — 6 files, 1,400+ LOC. Superseded by `@mastra/mcp`. Files remain in codebase but are no longer used by the new system.

### CVE Check

- `pnpm audit`: 1 low-severity advisory (`cookie` package via `@sveltejs/kit`). Not in MCP feature scope. Patched version available via SvelteKit update.

---

## 7. Phasing & Dependencies

### Phase Overview

```
Phase 1: Foundation             Phase 2: Repository        Phase 3: Services
├── @mastra/mcp install         ├── mcp-repository.ts      ├── MCPConnectionManager
├── dockerode install           │   (blocked by P1)        │   (blocked by P1, P2)
├── migration 013               ├── credential encryption  └── Docker orchestration
└── mcp-types.ts                └── row converters

Phase 4: API Routes             Phase 5: Agent Bridge      Phase 6: Frontend
├── admin/mcp.ts                ├── chat.ts modification   ├── integrations/+page.svelte
│   (blocked by P2, P3)        │   (blocked by P3)        │   (blocked by P2, P4)
├── Zod validation              └── mastra plugin update   ├── 4 components
└── RBAC gating                                            └── TanStack Query wiring

Phase 7: Tests
├── mcp-repository.test.ts (blocked by P2)
├── mcp-connection-manager.test.ts (blocked by P3)
└── mcp-admin-routes.test.ts (blocked by P4)
```

### Phase 1: Foundation (Dependencies + Schema + Types)

**Goal**: Install packages, create DB schema, define TypeScript types.
**Prerequisites**: None
**Delivers**: M1 (partial — catalog tables), M3 (partial — credential table), M6 (partial — Docker package)
**Estimated scope**: 3 files created, 1 file modified (package.json)
**Parallelizable with**: Nothing (foundation phase)
**Status**: Complete (commits c77b9d00, b3ce83b3, bd88ef5b)

### Phase 2: Repository Layer

**Goal**: Oracle CRUD with encrypted credentials, catalog operations, tool caching.
**Prerequisites**: Phase 1 complete (tables exist, types defined)
**Delivers**: M1 (catalog CRUD), M3 (credential encryption), S1 (metrics recording)
**Estimated scope**: 1 file (740 LOC), 18 repository methods
**Parallelizable with**: Nothing (repository feeds all downstream phases)
**Status**: Complete (commit 1132452d)

### Phase 3: MCPConnectionManager + Docker

**Goal**: Mastra MCPClient lifecycle, Docker container orchestration, toolset aggregation.
**Prerequisites**: Phase 1 (packages), Phase 2 (repository for config/credentials)
**Delivers**: M2 (lifecycle), M4 (getToolsets), M6 (Docker), S2 (health)
**Estimated scope**: 1 file (633 LOC), 10+ methods
**Parallelizable with**: Nothing (service feeds API routes and agent bridge)
**Status**: Complete (commit 11dcd3b1)

### Phase 4: API Routes

**Goal**: REST API for admin console (17 endpoints).
**Prerequisites**: Phase 2 (repository), Phase 3 (MCPConnectionManager)
**Delivers**: M1 (catalog API), M2 (connect API), M3 (credential API), M5 (custom server API), S1 (metrics API)
**Estimated scope**: 1 file (832 LOC), 17 endpoints
**Parallelizable with**: Phase 5 (agent bridge) — independent of API routes
**Status**: Complete (commit d59370ac)

### Phase 5: Agent Bridge

**Goal**: MCP tools available to CloudAdvisor at runtime.
**Prerequisites**: Phase 3 (MCPConnectionManager with getToolsets)
**Delivers**: M4 (dynamic tool injection)
**Estimated scope**: 2 files modified (chat.ts, mastra.ts)
**Parallelizable with**: Phase 4 (API routes), Phase 6 (frontend)
**Status**: Complete (commit c869b59a)

### Phase 6: Frontend

**Goal**: Admin integrations page with 3 tabs and 4 components.
**Prerequisites**: Phase 2 (types), Phase 4 (API endpoints to call)
**Delivers**: M1 (catalog UI), M7 (3-tab layout), C1 (search/filter)
**Estimated scope**: 6 files (2,202 LOC total)
**Parallelizable with**: Phase 5 (agent bridge)
**Status**: Complete (commit 8bb8bc0b)

### Phase 7: Tests

**Goal**: Comprehensive test coverage for repository, services, and routes.
**Prerequisites**: Phase 2 (repository), Phase 3 (services), Phase 4 (routes)
**Delivers**: Quality assurance for M1-M7
**Estimated scope**: 3 files (2,801 LOC), 75+ tests
**Parallelizable with**: Internal parallelism (3 test files are independent)
**Status**: Complete (commits ae5ce1de, 6f62d839, f47510ba)

---

## 8. TDD Protocol

### Test File Mapping

| Requirement    | Test File                                            | Test Type   | Vitest Gotchas                                   |
| -------------- | ---------------------------------------------------- | ----------- | ------------------------------------------------ |
| M1, M3, S1     | `apps/api/src/tests/admin/mcp-repository.test.ts`    | Unit        | globalThis registry for vi.mock() TDZ, mockReset |
| M2, M4, M6, S2 | `apps/api/src/tests/mcp-connection-manager.test.ts`  | Unit        | Mock @mastra/mcp MCPClient, mock dockerode       |
| M1, M2, M3, M5 | `apps/api/src/tests/routes/mcp-admin-routes.test.ts` | Integration | Fastify inject(), Zod type provider, skipAuth    |
| M7             | (Frontend — visual verification)                     | Manual      | Svelte 5 component testing deferred              |

### Testing Strategy

- **Unit tests (repository)**: Mock `withConnection()` and Oracle execute results. Test all 18 repository methods including credential encryption round-trip.
- **Unit tests (services)**: Mock MCPClient constructor, listTools(), listToolsets(), connect(), disconnect(). Mock dockerode container lifecycle.
- **Integration tests (routes)**: Fastify `app.inject()` with `skipAuth: true`. Test all 17 endpoints with Zod schema validation.
- **Manual verification**: Admin UI tested via dev server. E2E with real MCP server (Brave Search) for tool discovery flow.

### Known Vitest Patterns Applied

- `mockReset: true` — all test files use `beforeEach` re-configuration of mock implementations
- `vi.mock()` TDZ — repository test uses `globalThis.__testMocks` registry pattern
- Fastify 5 — `app.inject()` returns JSON body; always `await fastify.close()` in `afterEach`

---

## 9. Risks & Mitigations

| #   | Risk                                               | Probability | Impact | Mitigation                                                                                                                 |
| --- | -------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| R1  | @mastra/mcp API breaking changes                   | Medium      | High   | Pin to `^1.0.0`, wrap MCPClient in MCPConnectionManager service layer, test against embedded docs                          |
| R2  | Docker not available on production host            | Low         | High   | Docker is optional — custom remote servers (SSE/HTTP) work without Docker. Catalog items degrade to "install instructions" |
| R3  | MCP server container escape or resource exhaustion | Low         | High   | 512MB memory limit, 1 CPU, cap-drop ALL, no-new-privileges, bridge network, image allowlist regex                          |
| R4  | Credential encryption key rotation breaks secrets  | Low         | High   | Document key rotation procedure. Future: add key versioning to credential records                                          |
| R5  | MCP tool execution latency affects chat UX         | Medium      | Medium | Non-blocking: getToolsets() failure falls back to built-in tools. Tool timeouts in MCPClient config                        |
| R6  | Community MCP servers unreliable or abandoned      | Medium      | Low    | Catalog is curated with tested images. Status monitoring detects failures. Admins can disconnect                           |
| R7  | Cross-org tool leakage via MCPConnectionManager    | Low         | High   | All queries filter by org_id. getToolsets(orgId) only returns servers for the requesting org                               |

---

## 10. Success Metrics

| Metric                        | Target              | Measurement Method                                 | Timeframe           |
| ----------------------------- | ------------------- | -------------------------------------------------- | ------------------- |
| MCP servers installed         | >= 3 per org        | `SELECT COUNT(*) FROM mcp_servers GROUP BY org_id` | 30 days post-launch |
| Tool call success rate        | >= 95%              | `mcp_server_metrics.success` aggregate             | Rolling 7 days      |
| Average tool call latency     | < 5 seconds         | `AVG(duration_ms)` from mcp_server_metrics         | Rolling 7 days      |
| Admin install completion rate | >= 80%              | Catalog install starts vs. connected status        | 30 days post-launch |
| Agent MCP tool usage          | >= 10 calls/day     | mcp_server_metrics records per day                 | 14 days post-launch |
| Test coverage                 | >= 75 tests passing | `npx vitest run` test count for MCP files          | At release          |

---

## 11. Verification

### Automated Verification

```bash
# All MCP tests pass (75+ tests across 3 files)
npx vitest run apps/api/src/tests/admin/mcp-repository.test.ts
npx vitest run apps/api/src/tests/mcp-connection-manager.test.ts
npx vitest run apps/api/src/tests/routes/mcp-admin-routes.test.ts

# Full test suite passes
npx vitest run

# Lint clean
pnpm lint

# Type check
cd apps/api && npx tsc --noEmit
cd apps/frontend && npx svelte-check
cd packages/shared && npx tsc --noEmit
```

### Manual Verification

- [x] Install Slack from catalog → enters connected state with green badge
- [x] Add custom SSE server → test connection discovers tools → save connects
- [x] Ask CloudAdvisor to use an MCP tool → agent calls tool via MCPClient
- [x] Disconnect server → Docker container stops, status goes gray
- [x] Tool Playground → expand tool, fill form, execute → result displayed
- [x] Credentials encrypted in DB → value_enc is BLOB, not plaintext
- [x] Non-admin user cannot access /admin/integrations or /api/admin/mcp/\* (401/403)

---

## 12. Open Questions

_All resolved during implementation._

---

## 13. Changelog

| Date       | Change Type | Description                                                    |
| ---------- | ----------- | -------------------------------------------------------------- |
| 2026-02-10 | Created     | Initial PRD based on implemented Premium MCP Server Management |
