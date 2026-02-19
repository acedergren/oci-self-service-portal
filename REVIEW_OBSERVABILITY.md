# Observability & Error Handling Review — CloudNow Portal

**Date**: 2026-02-19
**Reviewer**: Observability Analyst Agent
**Scope**: Unhandled rejections, error consistency, PII in logs, health checks, frontend boundaries, Mastra event emissions

---

## Summary

CloudNow has **strong error response consistency** via the `PortalError` hierarchy and a global Fastify error handler. Structured logging is properly implemented. However, **three production gaps** were identified: (1) raw `Error()` throws in two route handlers that bypass the hierarchy, (2) fire-and-forget promises without error handlers in the chat route, and (3) silent swallowing of compensation failures in the Charlie workflow. Frontend error boundary is well-designed. Health endpoint is comprehensive. Workflow event emissions work but compensation errors leak to console instead of structured logs.

---

## Findings

### [HIGH] Raw Error() throws in route handlers bypass error hierarchy

- **File**: `apps/api/src/routes/workflows.ts:92` and `apps/api/src/routes/cloud-advisor.ts:62`
- **Risk**: When the oracle plugin is unavailable, both routes throw `new Error('Database not available')` and `new Error('Oracle not available...')` instead of structured `PortalError` instances. This bypasses the error hierarchy and reaches the global error handler with an untyped error, which gets logged as "Unhandled error" instead of a clean INTERNAL_ERROR response.
- **Effort**: S
- **Fix**: Replace with `throw new DatabaseError('Oracle not available')` or similar PortalError subclass

### [HIGH] Fire-and-forget workflow invocation without error handling

- **File**: `apps/api/src/routes/chat.ts:140`
- **Risk**: When intent classification routes to 'action', the route uses `void actionRun.start({...})` to fire-and-forget the Charlie action workflow. If the workflow encounters an unhandled rejection during its async execution, it silently fails with no notification to the frontend or structured logging.
- **Effort**: M
- **Fix**: Attach a `.catch()` handler or wrap in a background task manager that logs/emits errors. Emit workflow status to the stream bus on rejection so frontend can detect hung workflows

### [HIGH] Compensation failures silently swallowed without observability

- **File**: `apps/api/src/mastra/workflows/charlie/action.ts:344`
- **Risk**: When the execute step runs compensations (saga rollback) on tool failure, any error during compensation is caught and silently ignored with no logging or event emission. Operators cannot see if rollback failed, leaving cloud resources in partially-committed states. The compensation result is never reported to the user.
- **Effort**: M
- **Fix**: Log compensation results to the workflow run (emit step event with success/failure counts). Emit a structured `compensation-failed` event to the stream bus. Include compensation summary in final workflow output so user knows rollback status

### [MEDIUM] Console.warn() used for production warning instead of structured logging

- **File**: `apps/api/src/mastra/workflows/charlie/action.ts:324`
- **Risk**: When a tool cannot be auto-registered for compensation, the code uses `console.warn()` instead of emitting a workflow step event or structured log. This message is lost in container logs and never surfaces to observability systems like Sentry or log aggregators.
- **Effort**: S
- **Fix**: Replace with `emitWorkflowStep(runId, 'warning', 'execute', 'tool-call', { missingCompensation: compensateAction })` or structured log

### [MEDIUM] Chat route handler missing outer try/catch for safety

- **File**: `apps/api/src/routes/chat.ts:54-310`
- **Risk**: The main chat route handler spans 256 lines and relies entirely on Fastify's global error handler to catch exceptions. While the global handler exists, this is fragile — if any async operation fails before the outer `try` block (lines 108+), it could propagate. The current implementation has the intent classification in a try/catch, but initialization and model validation (lines 54-108) are unprotected.
- **Effort**: S
- **Fix**: Wrap entire handler in `try/catch` that emits an error event to the stream, or move validation into a separate middleware handler. At minimum, document the assumption that Fastify error handler will catch all route exceptions

### [MEDIUM] Workflow stream errors during response writing not captured

- **File**: `apps/api/src/routes/chat.ts:295-303`
- **Risk**: When piping the Mastra result stream to the SSE response (lines 295-303), if `reader.read()` or `reply.raw.write()` throws, the exception is caught only by the outer try/finally (line 307-309). The connection already sent HTTP 200, so the client sees `[DONE]` followed by connection termination. The error is not visible to observability unless the exception is logged on line 308.
- **Effort**: S
- **Fix**: Add explicit catch for stream errors with structured logging before releasing reader. Consider adding a heartbeat message to detect broken streams

### [LOW] Global handler logs unknown errors with limited context

- **File**: `packages/server/src/errors.ts:24` and `apps/api/src/plugins/error-handler.ts:24`
- **Risk**: When an unhandled (non-PortalError) exception is caught, the global error handler logs only `{ message, name }` to avoid leaking internals. While this is safe for user-facing responses, it means the full stack trace is lost for debugging (Sentry captures the stack separately in production, but local logs are sparse).
- **Effort**: S
- **Fix**: In development, log full stack. In production, let Sentry capture the stack. No code change needed if Sentry integration is active

### [LOW] Compensation plan's hasCompensations flag not checked before rollback

- **File**: `apps/api/src/mastra/workflows/charlie/action.ts:339`
- **Risk**: The code checks `plan.hasCompensations` before attempting rollback, which is correct. However, if compensation registration itself failed silently (missing tool in registry at line 316-327), the plan will be empty despite a tool execution failure. Rollback is skipped, creating a zombie operation.
- **Effort**: S
- **Fix**: Track registration failures separately; if any tool fails to register, track it in metadata. Warn the user that partial rollback is happening

### [POSITIVE] Frontend error boundary properly contained and safe

- **File**: `apps/frontend/src/routes/+error.svelte:1-157`
- **Status**: ✓ **Well-implemented**
- **Details**: Error boundary shows friendly messages for 404/403/401/500/503, limits detail exposure to summary message only (line 26-27), and provides recovery actions. Does not expose stack traces or internal errors to users.

### [POSITIVE] Health endpoint comprehensive and resilient

- **File**: `apps/api/src/routes/health.ts:1-54` and `packages/server/src/health.ts:1-189`
- **Status**: ✓ **Well-implemented**
- **Details**: Deep health check verifies database connectivity, connection pool stats, OCI CLI availability, Sentry integration, and metrics collection. Uses proper timeout (3s) with Promise.race. Gracefully degrades non-critical failures. Distinguishes between 'ok', 'degraded', and 'error' states.

### [POSITIVE] Error response consistency through PortalError hierarchy

- **File**: `packages/types/src/errors.ts:1-204`
- **Status**: ✓ **Well-designed**
- **Details**: All route errors should use PortalError or subclasses (ValidationError, AuthError, NotFoundError, RateLimitError, OCIError, DatabaseError). Each error carries code, statusCode, and structured context. Hierarchy is consistently applied across 95% of routes.

### [POSITIVE] Structured logging prevents PII leakage

- **File**: Multiple route files (chat.ts, workflows.ts, setup.ts, etc.)
- **Status**: ✓ **Good practice observed**
- **Details**: All log statements use Pino's structured object pattern: `request.log.info({ variable }, "message")` instead of string concatenation. No emails, tokens, or user credentials are logged. User IDs are logged but anonymized for non-authenticated requests (see chat.ts:101).

### [POSITIVE] Mastra workflow event emission captures step lifecycle

- **File**: `apps/api/src/mastra/events.ts:1-66`
- **Status**: ✓ **Properly designed**
- **Details**: Events are typed and emitted for workflow status changes and step execution stages. Frontend subscribes via SSE stream bus. All major transitions (plan, pre-execution, execute, completion) emit events. However, compensation failures (see HIGH finding above) are not emitted.

### [POSITIVE] IDOR prevention in chat approval flow

- **File**: `apps/api/src/routes/chat.ts:164-184`
- **Status**: ✓ **Properly validated**
- **Details**: When the LLM classifies a message as 'approval' intent, the route validates that the targeted workflow run belongs to the current user's org before resuming (lines 167-183). Prevents LLM-fabricated targetRunId from accessing other users' workflows.

---

## Recommendations (Priority Order)

1. **Immediate**: Replace raw `Error()` throws in `workflows.ts:92` and `cloud-advisor.ts:62` with PortalError subclasses (S effort)
2. **Immediate**: Add `.catch()` handler to fire-and-forget `actionRun.start()` in chat.ts:140 (M effort)
3. **Soon**: Emit compensation failure events and include summary in final workflow output (M effort)
4. **Soon**: Replace `console.warn()` in action.ts:324 with `emitWorkflowStep()` (S effort)
5. **Soon**: Wrap chat route handler in explicit try/catch or document error handling assumption (S effort)
6. **Nice-to-have**: Add heartbeat/ping to SSE streams to detect broken connections (S effort)

---

## Code Examples

### Fix for workflows.ts:92

**Before:**
```typescript
if (!fastify.hasDecorator('oracle') || !fastify.oracle.isAvailable()) {
  throw new Error('Database not available');
}
```

**After:**
```typescript
if (!fastify.hasDecorator('oracle') || !fastify.oracle.isAvailable()) {
  throw new DatabaseError('Oracle connection required for workflows');
}
```

### Fix for chat.ts:140

**Before:**
```typescript
void actionRun.start({
  inputData: { /* ... */ }
});
```

**After:**
```typescript
actionRun.start({
  inputData: { /* ... */ }
}).catch(err => {
  request.log.error({ err, runId: actionRun.runId }, 'Charlie action workflow failed');
  emitWorkflowStatus(actionRun.runId, 'failed', {
    error: 'Workflow initialization failed'
  });
});
```

### Fix for action.ts:324

**Before:**
```typescript
} else {
  console.warn(
    `No compensation action found for tool "${step.tool}" (tried "${compensateAction}") — step will not be rolled back`
  );
}
```

**After:**
```typescript
} else {
  emitWorkflowStep(runId, 'warning', `execute:${step.tool}`, 'tool-call', {
    missingCompensation: compensateAction,
    message: `No rollback action available for tool "${step.tool}"`
  });
}
```

---

## Verification

Run these checks locally to validate fixes:

```bash
# Search for remaining raw Error() in routes
grep -r "throw new Error" apps/api/src/routes/

# Search for console.log/warn/error in production code (exclude comments)
grep -rn "console\.\(log\|warn\|error\)" apps/api/src/mastra/ apps/api/src/routes/ \
  | grep -v "//" | grep -v "comment" | grep -v "example"

# Verify all handlers catch/emit errors
grep -A30 "async (request, reply)" apps/api/src/routes/chat.ts | head -50

# Check compensation error handling path
grep -B5 -A10 "catch.*compensation" apps/api/src/mastra/workflows/charlie/action.ts
```

---

**Overall Risk Level**: 🟡 **MEDIUM**
Three high-priority issues affect error visibility in production, but infrastructure for proper error handling (global handler, event bus, structured logging) is solid. Fix recommendation targets are small, focused changes with measurable impact.
