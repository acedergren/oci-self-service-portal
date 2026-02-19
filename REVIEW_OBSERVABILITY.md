# Observability & Error Handling Review — CloudNow Portal

**Date**: 2026-02-19
**Reviewer**: Observability Analyst Agent
**Scope**: Unhandled rejections, error consistency, PII in logs, health checks, frontend boundaries, Mastra event emissions, structured logging

---

## Summary

CloudNow has **strong error response consistency** via the `PortalError` hierarchy and a global Fastify error handler. Structured logging is properly implemented. However, **five production gaps** were identified: (1) raw `Error()` throws in two route handlers that bypass the hierarchy, (2) fire-and-forget promises without error handlers in the chat route, (3) silent swallowing of compensation failures in the Charlie workflow, (4) **inconsistent error response shapes** across routes (3-4 different formats), and (5) **frontend SSR load functions and chat page catch blocks silently swallow errors** without user feedback. Frontend error boundary is well-designed but lacks nested boundaries for admin routes. Health endpoint is comprehensive but missing Mastra/AI agent checks.

---

## Findings

### [CRITICAL] Frontend SSR load functions silently swallow API errors

Four `+page.server.ts` files catch API errors and return empty/null data with only `console.error()`:

| File                                                                | Impact                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| `apps/frontend/src/routes/admin/settings/+page.server.ts:14-16`     | Settings page shows empty state instead of error        |
| `apps/frontend/src/routes/admin/idp/+page.server.ts:14-16`          | IDP management shows empty list — admin may reconfigure |
| `apps/frontend/src/routes/admin/integrations/+page.server.ts:15-17` | MCP integrations page shows empty state                 |
| `apps/frontend/src/routes/admin/models/+page.server.ts:14-16`       | AI models page shows empty list                         |

- **Risk**: If the API is down or the user lacks permissions, admin pages render with empty data and **no error indication**. Admins think there are no IDPs/models/settings configured, when in fact the prefetch failed. Particularly dangerous for the settings page where an admin might overwrite valid settings thinking they don't exist.
- **Effort**: S
- **Fix**: Return an `error` flag alongside the null data so the page component can show an alert:

```typescript
} catch (error) {
  console.error('Failed to prefetch portal settings:', error);
  return { initialSettings: null, prefetchError: 'Failed to load settings' };
}
```

### [CRITICAL] Chat page swallows errors without user feedback

Multiple catch blocks in `apps/frontend/src/routes/chat/+page.svelte` log to console but never show the user anything:

| Line      | Error                   | User sees                                                 |
| --------- | ----------------------- | --------------------------------------------------------- |
| `258-259` | Session load failure    | Nothing — chat works but no history                       |
| `316-318` | Tool execution failure  | Nothing — `message` variable computed but never displayed |
| `346-347` | Rejection log failure   | Nothing                                                   |
| `400-401` | Tool info fetch failure | Nothing — approval UI broken silently                     |

- **Risk**: Users interact with a broken chat UI without knowing it. Tool approvals fail silently. Session history disappears without explanation.
- **Effort**: M
- **Fix**: Surface errors via toast notifications or inline error messages. The `message` variable at line 317 is already computed — just display it.

### [HIGH] Raw Error() throws in route handlers bypass error hierarchy

- **File**: `apps/api/src/routes/workflows.ts:92` and `apps/api/src/routes/cloud-advisor.ts:62`
- **Risk**: When the oracle plugin is unavailable, both routes throw `new Error('Database not available')` and `new Error('Oracle not available...')` instead of structured `PortalError` instances. This bypasses the error hierarchy and reaches the global error handler with an untyped error, which gets logged as "Unhandled error" and returns generic "Internal server error" (500) instead of "Database not available" (503).
- **Effort**: S
- **Fix**: Replace with `throw new DatabaseError('Oracle connection required for workflows')`

### [HIGH] Fire-and-forget workflow invocation without error handling

- **File**: `apps/api/src/routes/chat.ts:140`
- **Risk**: When intent classification routes to 'action', the route uses `void actionRun.start({...})` to fire-and-forget the Charlie action workflow. If the workflow encounters an unhandled rejection during its async execution, it silently fails with no notification to the frontend or structured logging.
- **Effort**: M
- **Fix**: Attach a `.catch()` handler that logs the error and emits a workflow status event:

```typescript
actionRun.start({ inputData: { ... } }).catch(err => {
  request.log.error({ err, runId }, 'Charlie action workflow failed');
  emitWorkflowStream({ type: 'status', runId, status: 'failed', error: err.message, output: null });
});
```

### [HIGH] Three different error response shapes across routes

The codebase uses at least three distinct error response formats:

**Shape A — PortalError `toResponseBody()`** (global error handler):

```json
{ "error": "Not Found", "code": "NOT_FOUND", "statusCode": 404 }
```

**Shape B — Ad-hoc `{ error: string }`** (most common in routes):

```json
{ "error": "No organization context" }
```

Used in: `webhooks.ts:68,92`, `workflows.ts:173,220,248,305,483,719,780`, `sessions.ts:55,155,173`, `activity.ts:111`, `graph.ts:42,51`, `audit.ts:48`, `search.ts:39`, and many more.

**Shape C — Mixed `{ error, message, statusCode }`** (v1-tools):

```json
{ "error": "Not Found", "message": "Tool not found: xyz", "statusCode": 404 }
```

Used in: `v1-tools.ts:81-85,135-139,149-156`

**Shape D — Mixed `{ error, code }`** (tools/execute):

```json
{ "error": "Unknown tool: xyz", "code": "NOT_FOUND" }
```

- **Risk**: Frontend code must handle multiple shapes. API consumers (including external MCP integrations) can't rely on a consistent error contract.
- **Effort**: M
- **Fix**: All ad-hoc error responses should throw `PortalError` subclasses instead of using `reply.status(4xx).send({ error: '...' })`:

```typescript
// Before
return reply.code(400).send({ error: 'Organization context required' });
// After
throw new ValidationError('Organization context required');
```

### [HIGH] Compensation failures silently swallowed without observability

- **File**: `apps/api/src/mastra/workflows/charlie/action.ts:344`
- **Risk**: When the execute step runs compensations (saga rollback) on tool failure, any error during compensation is caught and silently ignored with no logging or event emission. Operators cannot see if rollback failed, leaving cloud resources in partially-committed states.
- **Effort**: M
- **Fix**: Log compensation results to the workflow run. Emit a structured `compensation-failed` event to the stream bus. Include compensation summary in final workflow output so user knows rollback status.

### [HIGH] Chat route SSE error handling gap after headers sent

- **File**: `apps/api/src/routes/chat.ts:287-309`
- **Risk**: The outer `try/finally` block around the streaming section doesn't have a `catch`. If `agent.stream()` or the reader loop throws _after_ SSE headers have been written (`reply.raw.writeHead(200, ...)`), Fastify's error handler cannot send a proper error response because headers are already sent. The error propagates to the global error handler which tries `reply.status(500).send()` — this fails silently because the response is already committed.
- **Effort**: S
- **Fix**: Wrap the streaming section in its own try/catch that writes an SSE error event before ending:

```typescript
try {
	// ... streaming logic
} catch (err) {
	request.log.error({ err }, 'Chat stream error');
	try {
		reply.raw.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
	} catch {}
	reply.raw.end();
}
```

### [MEDIUM] Console.warn() used for production warning instead of structured logging

- **File**: `apps/api/src/mastra/workflows/charlie/action.ts:324`
- **Risk**: When a tool cannot be auto-registered for compensation, the code uses `console.warn()` instead of structured logging. This message is lost in container logs and never surfaces to observability systems.
- **Effort**: S
- **Fix**: Replace with structured Pino log or `emitWorkflowStep()` event.

### [MEDIUM] No nested `+error.svelte` files for admin routes

There are no `+error.svelte` files under `apps/frontend/src/routes/admin/`, `apps/frontend/src/routes/workflows/`, or `apps/frontend/src/routes/chat/`. All errors bubble up to the root error boundary.

- **Risk**: Admin-specific errors (e.g., Oracle unavailable for admin pages) get the generic error page instead of an admin-contextualized recovery flow. Users lose their admin sidebar navigation when an error occurs.
- **Fix**: Add `+error.svelte` to `/admin/` and `/workflows/` layout groups with admin-specific UI that preserves navigation.

### [MEDIUM] Health check doesn't verify Mastra/AI agent availability

- **File**: `packages/server/src/health.ts`
- **Risk**: The deep health check covers database, connection pool, OCI CLI, Sentry, and metrics — but doesn't check whether the Mastra framework or Charlie AI agent are functional. Since chat is the primary feature, a health check reporting "ok" while the AI agent is broken gives false confidence.
- **Fix**: Add a `checkMastra()` health check that verifies `fastify.mastra.getAgent('charlie')` doesn't throw.

### [MEDIUM] No readiness probe differentiation

- **Risk**: The health endpoint doesn't distinguish between Kubernetes liveness and readiness probes. `/healthz` serves as liveness, `/health` as deep check. Adding `/readyz` that checks only critical dependencies (database pool initialized, Mastra loaded) would improve K8s integration.

### [MEDIUM] `tools/execute.ts:112` returns non-PortalError 500

```typescript
return reply.code(500).send({
  success: false, toolCallId, toolName,
  error: 'Tool execution failed', ...
});
```

This bypasses the global error handler by catching and responding inline. The response shape doesn't match `PortalError.toResponseBody()`.

- **Fix**: `throw toPortalError(err, 'Tool execution failed')` and let the global handler format it.

### [MEDIUM] SearchBox swallows chat API errors

- **File**: `apps/frontend/src/lib/components/ui/SearchBox.svelte:31`
- `console.error('Chat API error:', response.status)` — no user-visible feedback.

### [LOW] Template literal logging in startup/shutdown

- **File**: `apps/api/src/app.ts:482`, `apps/api/src/server.ts:31`

```typescript
log.info(`Server listening on ${host}:${port}`);
log.info(`${signal} received, shutting down gracefully`);
```

Should use structured Pino format: `log.info({ host, port }, 'Server listening')`.

### [LOW] No Pino redact configuration as safety net

No `redact` config to automatically scrub sensitive fields from logs. While no PII is currently logged, there's no protection if a developer accidentally adds `request.body` to a log call for an auth endpoint.

- **Fix**: Add: `redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.secret', '*.apiKey']`

### [LOW] `/api/metrics` endpoint has no authentication

- **File**: `apps/api/src/routes/metrics.ts:10`
- Prometheus metrics are unprotected. Reveals operational details (request rates, error rates, pool usage) useful for reconnaissance.
- **Fix**: Gate behind admin auth or IP allowlist in production.

### [LOW] Global handler logs unknown errors with limited context

- **File**: `apps/api/src/plugins/error-handler.ts:24`
- When a non-PortalError exception is caught, only `{ message, name }` is logged. Full stack trace is lost for debugging (Sentry captures it separately in production, but local logs are sparse).
- **Fix**: In development, log full error object. In production, let Sentry handle it.

---

## Positive Findings

### [POSITIVE] Frontend error boundary properly contained and safe

- **File**: `apps/frontend/src/routes/+error.svelte:1-157`
- **Status**: ✓ **Well-implemented**
- Shows friendly messages for 404/403/401/500/503, limits detail exposure to summary message only (line 26-27), provides recovery actions ("Go Home", "Ask Charlie"). Does not expose stack traces or internal errors.

### [POSITIVE] Health endpoint comprehensive and resilient

- **File**: `apps/api/src/routes/health.ts:1-54` and `packages/server/src/health.ts:1-189`
- **Status**: ✓ **Well-implemented**
- Deep health check verifies database, connection pool, OCI CLI, Sentry, metrics. Uses 3s timeout with `Promise.race`. Distinguishes 'ok', 'degraded', 'error' states. Critical vs non-critical differentiation. Includes uptime and version.

### [POSITIVE] Error response consistency through PortalError hierarchy

- **File**: `packages/types/src/errors.ts`
- **Status**: ✓ **Well-designed**
- All route errors _should_ use PortalError or subclasses (ValidationError, AuthError, NotFoundError, RateLimitError, OCIError, DatabaseError). Each carries code, statusCode, and structured context. Applied consistently in ~70% of routes.

### [POSITIVE] Structured logging prevents PII leakage

- **Status**: ✓ **Good practice observed**
- All log statements use Pino's structured object pattern. No emails, tokens, or user credentials are logged. `stripIdpSecrets()` / `stripAiProviderSecrets()` used before responding with provider data. Error handler filters unknown errors to only log `message` and `name`.

### [POSITIVE] Crash recovery for workflow runs

- **File**: `apps/api/src/routes/workflows.ts:1201-1224`
- The `onReady` hook marks stale "running" workflow runs as "failed" on server restart. Prevents phantom running states after crashes.

### [POSITIVE] Graceful shutdown well-implemented

- **File**: `apps/api/src/server.ts`
- SIGTERM/SIGINT handlers, Fastify close triggers all onClose hooks (Oracle pool), Sentry flush.

### [POSITIVE] IDOR prevention in chat approval flow

- **File**: `apps/api/src/routes/chat.ts:164-184`
- When the LLM classifies a message as 'approval' intent, the route validates that the targeted workflow run belongs to the current user's org before resuming (lines 167-183).

---

## Summary Table

| Severity | Count | Category                                                                                                                              |
| -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| CRITICAL | 2     | Frontend SSR error swallowing, chat page silent failures                                                                              |
| HIGH     | 5     | Raw Error throws, fire-and-forget promise, error response shapes, compensation swallowing, SSE error gap                              |
| MEDIUM   | 6     | Console.warn in prod, no nested error boundaries, no Mastra health check, no readiness probe, tools/execute bypass, SearchBox swallow |
| LOW      | 4     | Template literal logs, no Pino redact, unprotected /api/metrics, limited unknown error logging                                        |
| POSITIVE | 7     | Error boundary, health endpoint, PortalError hierarchy, structured logging, crash recovery, graceful shutdown, IDOR prevention        |

---

## Priority Fixes (Recommended Order)

1. **Immediate**: Surface prefetch errors in admin SSR pages — prevents admins from overwriting data (S effort)
2. **Immediate**: Add user-visible error feedback in chat page catch blocks (M effort)
3. **Immediate**: Add `.catch()` to fire-and-forget `actionRun.start()` in chat.ts:140 (S effort)
4. **Soon**: Replace raw `Error()` throws in workflows.ts:92 and cloud-advisor.ts:62 with PortalError subclasses (S effort)
5. **Soon**: Normalize error response shapes — throw PortalError subclasses instead of ad-hoc objects (M effort)
6. **Soon**: Emit compensation failure events and include summary in workflow output (M effort)
7. **Soon**: Add SSE error events for stream failures after headers are sent (S effort)
8. **Nice-to-have**: Add Mastra health check to `/health` endpoint (S effort)
9. **Nice-to-have**: Add Pino redact configuration as safety net (S effort)
10. **Nice-to-have**: Add nested `+error.svelte` for admin routes (S effort)

---

## Verification Commands

```bash
# Search for remaining raw Error() in routes
grep -r "throw new Error" apps/api/src/routes/

# Search for console.log/warn/error in production code (exclude test files)
grep -rn "console\.\(log\|warn\|error\)" apps/api/src/ --include="*.ts" | grep -v ".test."

# Check ad-hoc error response shapes (should throw PortalError instead)
grep -rn "reply\.\(status\|code\)(4[0-9][0-9])\.send({" apps/api/src/routes/

# Verify frontend catch blocks show user feedback
grep -B3 -A5 "console.error" apps/frontend/src/routes/ --include="*.svelte" --include="*.ts"

# Check health endpoint response
curl -s localhost:3000/health | jq '.status, .checks | keys'
```

---

**Overall Risk Level**: 🟡 **MEDIUM** — Infrastructure for proper error handling is solid (global handler, event bus, structured logging). The gaps are mostly in edge cases (fire-and-forget, SSE errors after headers sent) and frontend error visibility. Priority fixes are small, focused changes with measurable impact on production debuggability.
