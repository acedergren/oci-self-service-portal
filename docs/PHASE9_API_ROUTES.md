# Phase 9 API Routes Reference

Fastify 5 API routes registered in `apps/api/src/app.ts`. All routes use the Zod type provider for request/response validation.

## Plugin Registration Order

```
oracle  ->  auth  ->  rbac  ->  swagger (optional)  ->  routes
```

1. **oracle** (`fp()` wrapped): Initializes Oracle connection pool, runs migrations, decorates `fastify.oracle` and `request.dbAvailable`
2. **auth** (`fp()` wrapped): Resolves session via Better Auth `toWebRequest()` bridge, decorates `request.user`, `request.session`, `request.permissions`
3. **rbac** (`fp()` wrapped): Registers standalone guards (`requireAuth`, `resolveOrgId`) used as `preHandler` hooks
4. **swagger** (optional): OpenAPI spec + Swagger UI at `/api/docs`, gated by `admin:all`

## Authentication

Dual auth via `requireAuth(permission)` preHandler:

| Method           | Header          | Format                         |
| ---------------- | --------------- | ------------------------------ |
| Session cookie   | `Cookie`        | Better Auth session cookie     |
| API key (Bearer) | `Authorization` | `Bearer portal_<64-hex-chars>` |
| API key (header) | `X-API-Key`     | `portal_<64-hex-chars>`        |

Returns **401** if unauthenticated, **403** if lacking the required permission.

## Route Summary

| Method | Path                 | Permission       | Auth     | Description                              |
| ------ | -------------------- | ---------------- | -------- | ---------------------------------------- |
| GET    | `/healthz`           | none             | public   | Liveness probe (plain text "ok")         |
| GET    | `/health`            | none             | public   | Deep health check with subsystem details |
| GET    | `/api/metrics`       | none             | public   | Prometheus metrics (text format)         |
| GET    | `/api/docs/*`        | `admin:all`      | required | OpenAPI Swagger UI (dev only by default) |
| GET    | `/api/sessions`      | `sessions:read`  | required | List sessions with message counts        |
| POST   | `/api/sessions`      | `sessions:write` | required | Create a new chat session                |
| DELETE | `/api/sessions/:id`  | `sessions:write` | required | Delete a session (user-scoped)           |
| GET    | `/api/activity`      | `tools:read`     | required | List recent tool executions              |
| GET    | `/api/tools/execute` | `tools:execute`  | required | Get tool approval requirements           |
| POST   | `/api/tools/execute` | `tools:execute`  | required | Execute a tool                           |
| GET    | `/api/tools/approve` | `tools:approve`  | required | List pending approvals (org-scoped)      |
| POST   | `/api/tools/approve` | `tools:approve`  | required | Approve or reject a tool execution       |

## Route Details

### Health Routes (`routes/health.ts`)

#### `GET /healthz`

Lightweight liveness probe for load balancers.

- **Auth**: None (excluded from auth plugin)
- **Response**: `text/plain` body `ok`, status 200

#### `GET /health`

Deep health check with 3-second `Promise.race` timeout.

- **Auth**: None (excluded from auth plugin)
- **Response (200)**:
  ```json
  {
  	"status": "ok|degraded|error",
  	"checks": {
  		"database": { "status": "ok", "latencyMs": 5 },
  		"connection_pool": { "status": "ok", "latencyMs": 1 },
  		"oci_cli": { "status": "ok", "latencyMs": 200 },
  		"sentry": { "status": "ok", "latencyMs": 0 },
  		"metrics": { "status": "ok", "latencyMs": 0 }
  	},
  	"timestamp": "2026-02-07T12:00:00.000Z",
  	"uptime": 3600,
  	"version": "0.1.0"
  }
  ```
- **Response (503)**: Returned when `status === 'error'` or timeout exceeded

### Metrics Routes (`routes/metrics.ts`)

#### `GET /api/metrics`

Prometheus-format metrics from the custom registry.

- **Auth**: None (excluded from auth plugin)
- **Response**: `text/plain; charset=utf-8` Prometheus exposition format

### Session Routes (`routes/sessions.ts`)

#### `GET /api/sessions`

List enriched sessions (with message count, last message).

- **Auth**: `sessions:read`
- **Query** (Zod validated):
  | Param | Type | Default | Validation |
  |-------|------|---------|------------|
  | `limit` | number | 50 | 1-100, int |
  | `offset` | number | 0 | min 0, int |
  | `search` | string | - | optional |
- **Response (200)**:
  ```json
  {
  	"sessions": [
  		{
  			"id": "uuid",
  			"title": "Session title",
  			"model": "default",
  			"region": "eu-frankfurt-1",
  			"status": "active",
  			"messageCount": 12,
  			"lastMessage": "2026-02-07T12:00:00.000Z",
  			"createdAt": "2026-02-07T10:00:00.000Z",
  			"updatedAt": "2026-02-07T12:00:00.000Z"
  		}
  	],
  	"total": 42
  }
  ```
- **DB fallback**: Returns `{ sessions: [], total: 0, message: "Database not available" }` when `dbAvailable=false`

#### `POST /api/sessions`

Create a new chat session.

- **Auth**: `sessions:write`
- **Body** (Zod validated):
  | Field | Type | Default | Validation |
  |-------|------|---------|------------|
  | `model` | string | `"default"` | - |
  | `region` | string | `"eu-frankfurt-1"` | - |
  | `title` | string | - | optional |
- **Response (201)**: `{ "session": { ... } }`
- **Response (503)**: Database not available

#### `DELETE /api/sessions/:id`

Delete a session. User-scoped (IDOR prevention).

- **Auth**: `sessions:write`
- **Params**: `id` (UUID, Zod validated)
- **Response (200)**: `{ "success": true }`
- **Response (404)**: Session not found or not owned by caller
- **Response (503)**: Database not available

### Activity Routes (`routes/activity.ts`)

#### `GET /api/activity`

List recent tool executions for the current user.

- **Auth**: `tools:read`
- **Query** (Zod validated):
  | Param | Type | Default | Validation |
  |-------|------|---------|------------|
  | `limit` | number | 20 | 1-100, int |
  | `offset` | number | 0 | min 0, int |
- **Response (200)**:
  ```json
  {
  	"items": [
  		{
  			"id": "row-id",
  			"type": "compute",
  			"action": "list-instances (executed)",
  			"time": "2026-02-07T12:00:00.000Z",
  			"status": "completed|pending|failed"
  		}
  	],
  	"total": 15
  }
  ```
- **DB fallback**: Returns `{ items: [], total: 0, message: "Database not available" }`

### Tool Routes (`routes/tools.ts`)

#### `GET /api/tools/execute?toolName=xxx`

Get approval requirements for a tool before execution.

- **Auth**: `tools:execute`
- **Query**: `toolName` (string, min 1)
- **Response (200)**:
  ```json
  {
  	"toolName": "terminate-instance",
  	"category": "compute",
  	"approvalLevel": "confirm",
  	"requiresApproval": true,
  	"warning": "This will terminate the instance",
  	"impact": "Instance and all attached resources will be destroyed",
  	"description": "Terminate a compute instance"
  }
  ```
- **Response (404)**: Unknown tool

#### `POST /api/tools/execute`

Execute a tool. Approval-required tools must have a server-side approval consumed first.

- **Auth**: `tools:execute`
- **Body** (Zod validated):
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | `toolCallId` | string | no | Required for approval-gated tools |
  | `toolName` | string | yes | Tool identifier |
  | `args` | object | yes | Tool arguments |
  | `sessionId` | string | no | Chat session context |
- **Response (200)**:
  ```json
  {
    "success": true,
    "toolCallId": "tc-1",
    "toolName": "list-instances",
    "data": { ... },
    "duration": 150,
    "approvalLevel": "none"
  }
  ```
- **Response (403)**: Tool requires approval (not yet approved, or missing `toolCallId`)
- **Response (404)**: Unknown tool
- **Side effects**: Metrics counter, duration histogram, audit log

#### `GET /api/tools/approve`

List pending approvals. Org-scoped (IDOR prevention via `resolveOrgId`).

- **Auth**: `tools:approve`
- **Response (200)**:
  ```json
  {
  	"pending": [
  		{
  			"toolCallId": "tc-1",
  			"toolName": "terminate-instance",
  			"args": { "instanceId": "ocid1..." },
  			"sessionId": "sess-1",
  			"createdAt": "2026-02-07T12:00:00.000Z",
  			"age": 5000
  		}
  	],
  	"count": 1
  }
  ```

#### `POST /api/tools/approve`

Approve or reject a pending tool execution. Org-scoped.

- **Auth**: `tools:approve`
- **Body** (Zod validated):
  | Field | Type | Required |
  |-------|------|----------|
  | `toolCallId` | string | yes (min 1) |
  | `approved` | boolean | yes |
  | `reason` | string | no |
- **Response (200)**:
  ```json
  {
  	"success": true,
  	"approved": true,
  	"toolCallId": "tc-1",
  	"message": "Tool execution approved"
  }
  ```
- **Response (404)**: No pending approval found (or wrong org)
- **Side effects**: `recordApproval()` on approve, audit log, removes from pending map

### OpenAPI Docs (`@fastify/swagger-ui`)

#### `GET /api/docs/*`

Swagger UI and OpenAPI JSON spec.

- **Auth**: `admin:all` (via `uiHooks.onRequest`)
- **Config**: Enabled when `enableDocs` option is true or `NODE_ENV !== 'production'`
- **Spec endpoint**: `/api/docs/json` (OpenAPI 3.0 JSON)

## Error Response Format

All errors use the `PortalError` hierarchy, serialized via `errorResponse()`:

```json
{
	"status": 400,
	"error": "Validation Error",
	"code": "VALIDATION_ERROR",
	"message": "test field is required"
}
```

| Error Class       | Code               | HTTP Status |
| ----------------- | ------------------ | ----------- |
| `ValidationError` | `VALIDATION_ERROR` | 400         |
| `AuthError`       | `AUTH_ERROR`       | 401 or 403  |
| `NotFoundError`   | `NOT_FOUND`        | 404         |
| `RateLimitError`  | `RATE_LIMIT`       | 429         |
| `OCIError`        | `OCI_ERROR`        | 502         |
| `DatabaseError`   | `DATABASE_ERROR`   | 503         |
| (unknown)         | `INTERNAL_ERROR`   | 500         |

## RBAC Permission Matrix

| Role         | Permissions                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------- |
| **viewer**   | `tools:read`, `sessions:read`, `workflows:read`                                                     |
| **operator** | viewer + `tools:execute`, `tools:approve`, `sessions:write`, `workflows:execute`, `workflows:write` |
| **admin**    | all 13 permissions including `admin:all`, `tools:danger`, `admin:read`, `admin:write`               |

Unknown roles fall back to viewer permissions.

## Test Coverage

Every route is tested for:

- 401 unauthenticated
- 403 insufficient permissions
- 400 Zod validation failures
- Happy path with correct response shape
- DB fallback behavior (`dbAvailable=false`)
- IDOR prevention (user/org scoping)

Current count: **204 tests** across 13 files.
