# Backend Requirements: Fastify API Migration (Phase 9)

## Context
We're splitting the SvelteKit monolith into a frontend (UI-only SvelteKit) and a backend (Fastify API). The frontend needs all existing API functionality preserved. This doc describes what data the frontend needs — backend owns how to structure and serve it.

**Who uses it**: Authenticated users (OCI IAM OIDC), API key consumers (external integrations)
**Problem it solves**: Independent scaling, OpenAPI auto-docs, cleaner separation of concerns

Open to suggestions on how to best structure any of this. Push back if anything complicates things unnecessarily.

---

## Screens/Components

### AI Chat (Main Page + Self-Service Portal)
**Purpose**: Conversational AI interface with OCI tool execution

**Data I need to display**:
- Streaming chat responses (AI SDK `toUIMessageStream` format)
- Tool call results (structured JSON from 60+ OCI CLI tools)
- Available AI models (name, ID, capabilities — for model selector dropdown)
- Current session context (session ID, whether it's new or continued)
- Approval prompts for dangerous tool operations (tool name, parameters, risk reason)

**Actions**:
- Send a chat message → stream AI response with tool calls
- Execute a tool directly (bypass chat) → get structured JSON result
- Approve/deny a dangerous tool execution → execute or cancel the pending tool
- Switch AI model mid-conversation → persist model choice

**States to handle**:
- **Streaming**: Partial response arriving, tool calls in progress
- **Approval pending**: Waiting for user to approve a dangerous operation
- **Tool executing**: OCI CLI running (can take 5-30s for some operations)
- **Error**: Model unavailable, OCI CLI failure, rate limited, auth expired
- **Rate limited**: Too many requests — need remaining count and reset time

**Business rules affecting UI**:
- RBAC permissions determine which tools are available (viewer can't execute, operator can execute, admin can approve dangerous ops)
- Rate limits are per-user — need to show remaining quota
- Some tools require confirmation before execution (danger-level tools)

---

### Sessions Management
**Purpose**: List, switch, and manage chat conversation history

**Data I need to display**:
- List of user's sessions (title, last message preview, message count, when last active)
- Session search results filtered by text query
- Session detail (full conversation for a selected session)
- Usage stats per session (tokens used, estimated cost)

**Actions**:
- List all my sessions → paginated list, most recent first
- Search sessions by keyword → filtered results
- Switch to a session → load its conversation context
- Create a new session → get back session ID
- Delete a session → remove from list

**States to handle**:
- **Empty**: No sessions yet (first-time user)
- **Loading**: Fetching session list or detail
- **Error**: Database unavailable — this should be a clear 503, not silent fallback
- **Stale**: Session belongs to different user (should never see it)

**Business rules affecting UI**:
- Sessions are scoped to the authenticated user — I should never see another user's sessions
- Switching sessions sets a cookie that the chat endpoint reads

---

### Recent Activity Feed
**Purpose**: Show what OCI tools the user has executed recently

**Data I need to display**:
- List of recent tool executions (tool name, category, when, success/failure)
- Filterable by category (compute, storage, networking, etc.)
- Paginated (default 20 items)

**Actions**:
- Load activity feed → paginated list
- Filter by tool category → filtered results

**States to handle**:
- **Empty**: No tool executions yet
- **Error**: Activity data unavailable

---

### Visual Workflow Designer
**Purpose**: Canvas-based editor for multi-step OCI automation workflows

**Data I need to display**:
- List of saved workflows (name, description, last modified, run status)
- Workflow definition (nodes, edges, configuration — for the canvas)
- Execution run status (per-step results, overall progress)
- Approval requests for workflow steps that need human confirmation

**Actions**:
- List workflows → paginated, filtered by search
- Create a workflow → get back workflow ID
- Save/update a workflow definition → persist node graph + configuration
- Delete a workflow → remove from list
- Trigger a workflow run → get back run ID
- Check run status → step-by-step progress
- Approve a pending workflow step → continue execution

**States to handle**:
- **Running**: Workflow in progress, steps completing in real-time
- **Awaiting approval**: Step paused waiting for human
- **Failed**: Step errored, show which step and why
- **Completed**: All steps done, show results

**Business rules affecting UI**:
- Three workflow permissions: read, write, execute (RBAC)
- Workflows are scoped to the user's organization
- Only the workflow owner or org admin can delete

---

### Health / Metrics / Monitoring
**Purpose**: Operational health for admins and Prometheus scraping

**Data I need to display**:
- Overall system health status (ok/degraded/error)
- Individual check results (database, connection pool, OCI CLI, Sentry, metrics)
- Prometheus-format metrics (for external scraping, not UI rendering)

**Actions**:
- Check system health → structured health report
- Scrape metrics → Prometheus text format

**States to handle**:
- **Healthy**: All checks pass
- **Degraded**: Non-critical check failed (e.g., Sentry unreachable)
- **Error**: Critical check failed (e.g., database down)

**Business rules affecting UI**:
- Health endpoint should be accessible without authentication (for load balancers)
- Metrics endpoint should be exempt from rate limiting

---

### REST API v1 (External Integrations)
**Purpose**: Programmatic access for external systems via API keys

**Data I need to display** (these are API-only, no UI — but frontend should know they exist):
- Tool listing and execution via API keys
- Webhook subscription management
- Semantic search (vector similarity)
- Blockchain audit chain verification
- Property graph analytics (user-activity, tool-affinity, org-impact)
- Workflow triggering and status via API keys

**Business rules affecting UI**:
- API key auth is separate from session auth
- Both can coexist — the dual auth system checks session first, then API key
- API keys have org-level scoping

---

### Auth (Stays in SvelteKit)
**Purpose**: Better Auth + OCI IAM OIDC — this does NOT migrate to Fastify

**Why it stays**: Better Auth's SvelteKit integration handles OAuth callbacks, CSRF, session cookies natively. Moving this would require reimplementing the entire auth flow.

**What the API backend needs to know**:
- It will receive session cookies set by SvelteKit's auth
- It needs to validate these cookies to identify the user
- API key auth is independent and can live in Fastify

---

## State Management: Eliminating SQLite Fallback

Currently, `session.ts` falls back to SQLite (`agent-state` package) when Oracle is unavailable. This creates split-brain state — sessions created in SQLite are invisible to Oracle when it comes back.

**What I need instead**:
- When the database is unavailable, return a clear error (503) so I can show "Service temporarily unavailable"
- Don't silently create sessions in a different store
- The user experience is better with an honest error than with phantom sessions

**Impact on schema**: No schema changes needed. The Oracle tables already handle everything. We're just removing the fallback, not adding functionality.

Let me know if there's a reason to keep any fallback behavior I'm not seeing.

---

## Uncertainties
- [ ] Not sure if the chat streaming endpoint can work through a Fastify proxy without buffering issues (SSE / `toUIMessageStream`)
- [ ] Don't understand if Better Auth session cookies will be readable by Fastify (cross-service cookie sharing)
- [ ] Guessing that the feature flag proxy (`shouldProxyToFastify`) will handle the gradual migration, but not sure about WebSocket/SSE streams
- [ ] Not sure whether MCP server connections should live in Fastify (backend) or stay in SvelteKit (closer to the chat endpoint)
- [ ] The `@portal/shared/query` package has TanStack Query fetchers that hardcode `/api/*` paths — will these need a configurable base URL when API lives on a different port?

## Questions for Backend
- Would it make sense to keep the chat streaming endpoint in SvelteKit initially (since it's tightly coupled to AI SDK + auth) and only migrate the CRUD endpoints to Fastify first?
- Should API key management move to Fastify even though session auth stays in SvelteKit? Or should all auth-related endpoints stay together?
- Is there a simpler way to share auth state between SvelteKit and Fastify than cookie-forwarding? (e.g., JWT tokens, shared session store in Oracle)
- For the `oci-genai-query` fetchers — should they get a configurable `API_BASE_URL` env var, or should SvelteKit always proxy to Fastify transparently?

## Discussion Log
*Awaiting backend responses...*

---

## Package Inlining Decisions (Agreed)

| Package | Decision | Rationale |
|---------|----------|-----------|
| `agent-state` | **Delete** | SQLite fallback creates split-brain. Fail with 503 instead. Removes `better-sqlite3` native dep from Docker. |
| `mcp-client` | **Inline → `packages/shared/src/mcp/`** | Lightweight (zod only). Both frontend and API may need MCP access. |
| `oci-genai-query` | **Inline → `apps/frontend/src/lib/query/`** | Purely frontend (TanStack Query). API never needs cache keys. |
| `oci-genai-provider` | **Keep as `workspace:*`** | Reusable across multiple apps. Not inlining. |
