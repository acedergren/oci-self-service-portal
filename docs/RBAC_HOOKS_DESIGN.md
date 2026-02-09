# RBAC PreHandler Hooks — Architecture Design

**Plugin**: `apps/api/src/plugins/rbac.ts`
**Phase**: 9 (Fastify Backend Migration)
**Status**: Implemented

## Overview

The RBAC plugin provides standalone preHandler hook factories for route-level authorization. Unlike the auth plugin (which runs on every request), RBAC hooks are applied per-route and enforce specific permission requirements. Supports dual auth: session cookies and API keys.

## Plugin Signature

```typescript
import fp from 'fastify-plugin';

// The plugin itself is minimal — just validates dependencies
const rbacPlugin: FastifyPluginAsync = async (fastify) => {
	log.info('RBAC plugin registered');
};

export default fp(rbacPlugin, {
	name: 'rbac',
	dependencies: ['auth'], // Requires auth decorators
	fastify: '5.x'
});
```

The real functionality is in the **exported functions**, not the plugin body.

## Exported Functions

### `requireAuth(permission: Permission)`

Returns a Fastify `preHandler` hook that enforces a specific permission.

```typescript
export function requireAuth(
	permission: Permission
): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
```

**Auth resolution order:**

```
1. Session auth  → request.user + request.permissions (set by auth plugin)
                    ├── has permission or admin:all → allow
                    └── lacks permission → 403 Forbidden

2. API key auth  → request.apiKeyContext (set by prior requireAuth call)
                    ├── has permission → allow
                    └── lacks permission → 403 Forbidden

3. API key from header → Authorization: Bearer portal_<64-hex-chars>
                          ├── validateApiKey() succeeds
                          │   ├── has permission → allow
                          │   └── lacks permission → 403 Forbidden
                          └── validateApiKey() fails → fall through

4. No auth       → 401 Unauthorized
```

**Response formats:**

```json
// 401 — No authentication
{
  "error": "Unauthorized",
  "message": "Authentication required. Provide a session cookie or API key.",
  "statusCode": 401
}

// 403 — Authenticated but insufficient permissions
{
  "error": "Forbidden",
  "message": "Insufficient permissions: tools:execute required",
  "statusCode": 403
}
```

### `requireAuthenticated()`

Returns a preHandler that only checks for authentication (no permission check).

```typescript
export function requireAuthenticated(): (
	request: FastifyRequest,
	reply: FastifyReply
) => Promise<void>;
```

Useful for endpoints that just need a logged-in user without specific permissions (e.g., profile page, user settings).

### `resolveOrgId(request: FastifyRequest): string | null`

Utility to extract the organization ID from the current auth context:

```typescript
export function resolveOrgId(request: FastifyRequest): string | null;
```

Resolution order:

1. `request.apiKeyContext?.orgId` (API key carries org scope)
2. `request.session?.activeOrganizationId` (session carries active org)
3. `null` (no org context)

## Route-Level Usage

### Permission-protected endpoint

```typescript
import { requireAuth, resolveOrgId } from '../plugins/rbac.js';

export async function toolRoutes(app: FastifyInstance) {
	app.post('/api/tools/execute', {
		preHandler: requireAuth('tools:execute'),
		handler: async (request, reply) => {
			const orgId = resolveOrgId(request);
			// request.user is guaranteed non-null by requireAuth
			const result = await executeTool(request.body, request.user!.id, orgId);
			return { result };
		}
	});
}
```

### Auth-only endpoint (no permission check)

```typescript
import { requireAuthenticated } from '../plugins/rbac.js';

export async function profileRoutes(app: FastifyInstance) {
	app.get('/api/profile', {
		preHandler: requireAuthenticated(),
		handler: async (request) => {
			return { user: request.user, permissions: request.permissions };
		}
	});
}
```

### Multiple hooks on a single route

```typescript
app.delete('/api/workflows/:id', {
  preHandler: [
    requireAuth('workflows:write'),
    async (request) => {
      // Additional validation after auth
      const orgId = resolveOrgId(request);
      if (!orgId) throw new ValidationError('Organization context required');
    }
  ],
  handler: async (request, reply) => { ... }
});
```

## Permission Matrix

Routes map to permissions as follows:

| Route                    | Method | Permission          | Hook                               |
| ------------------------ | ------ | ------------------- | ---------------------------------- |
| `/api/sessions`          | GET    | `sessions:read`     | `requireAuth('sessions:read')`     |
| `/api/sessions`          | POST   | `sessions:write`    | `requireAuth('sessions:write')`    |
| `/api/sessions/:id`      | DELETE | `sessions:write`    | `requireAuth('sessions:write')`    |
| `/api/activity`          | GET    | `sessions:read`     | `requireAuth('sessions:read')`     |
| `/api/tools/execute`     | POST   | `tools:execute`     | `requireAuth('tools:execute')`     |
| `/api/tools/approve`     | POST   | `tools:approve`     | `requireAuth('tools:approve')`     |
| `/api/chat`              | POST   | `tools:execute`     | `requireAuth('tools:execute')`     |
| `/api/workflows`         | GET    | `workflows:read`    | `requireAuth('workflows:read')`    |
| `/api/workflows`         | POST   | `workflows:write`   | `requireAuth('workflows:write')`   |
| `/api/workflows/:id/run` | POST   | `workflows:execute` | `requireAuth('workflows:execute')` |
| `/api/v1/*`              | ALL    | varies              | `requireAuth(...)` per endpoint    |
| `/health`, `/healthz`    | GET    | none                | (excluded from auth)               |
| `/api/metrics`           | GET    | none                | (excluded from auth)               |

## Dual Auth Flow Diagram

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Auth Plugin │     │ RBAC Hook    │     │ Route Handler│
│  (onRequest) │────▶│ (preHandler) │────▶│              │
└──────────────┘     └──────────────┘     └──────────────┘

Session cookie path:
  Cookie → auth.api.getSession() → request.user/session/permissions
  → requireAuth checks request.permissions → allow/deny

API key path:
  Authorization: Bearer portal_xxx → requireAuth detects portal_ prefix
  → validateApiKey(key) → request.apiKeyContext.permissions
  → requireAuth checks key permissions → allow/deny
```

## admin:all Bypass

The `admin:all` permission acts as a superuser flag. When present in session permissions, it bypasses any specific permission check:

```typescript
if (hasPermission(perms, permission) || hasPermission(perms, 'admin:all')) {
	return; // Authorized
}
```

Note: `admin:all` bypass only applies to session auth. API keys must have the exact permission requested.

## Dependency Graph

```
rbac.ts
├── @portal/shared/server/auth/rbac       (hasPermission, Permission type)
├── @portal/shared/server/auth/api-keys   (validateApiKey)
└── @portal/shared/server/logger          (createLogger)
```

## Test Strategy

Tests use a minimal Fastify instance with a fake auth plugin that simulates session decorators:

1. **`buildApp()` helper** — Registers a fake auth plugin (decorates user/session/permissions/apiKeyContext) + real RBAC plugin
2. **`simulateSession()` helper** — Sets request decorators via `onRequest` hook to simulate authenticated users
3. **`mockValidateApiKey` delegate** — External `vi.fn()` wired into `vi.mock()` for API key scenarios
4. **Isolation** — Each test creates a fresh Fastify instance

Test coverage (16 tests in `plugins/rbac.test.ts`):

- Unauthenticated requests → 401
- Session auth with/without required permission
- admin:all bypass
- API key validation success/failure
- API key with insufficient permissions
- Non-portal tokens ignored
- resolveOrgId from API key, session, and null contexts
- requireAuthenticated with session, API key, and no auth

## Design Decisions

| Decision                               | Rationale                                                            |
| -------------------------------------- | -------------------------------------------------------------------- |
| Standalone functions, not plugin hooks | Routes choose their own auth requirements — no one-size-fits-all     |
| `preHandler` not `onRequest`           | Runs after auth plugin's `onRequest`, has access to user/permissions |
| API key resolved in requireAuth        | Lazy resolution — only validates API key when actually needed        |
| `portal_` prefix check                 | Avoids calling `validateApiKey()` for non-portal tokens (JWTs, etc.) |
| `dependencies: ['auth']`               | Ensures auth decorators exist before RBAC hooks run                  |
| 401 before 403                         | Standard HTTP semantics: authenticate first, then authorize          |

## Migration Notes (SvelteKit → Fastify)

| SvelteKit Pattern                            | Fastify Equivalent                                |
| -------------------------------------------- | ------------------------------------------------- |
| `requirePermission(event, 'tools:read')`     | `preHandler: requireAuth('tools:read')`           |
| `requireApiAuth(event, 'tools:read')`        | `preHandler: requireAuth('tools:read')` (unified) |
| `resolveOrgId(event)` from `hooks.server.ts` | `resolveOrgId(request)` from `rbac.ts`            |
| `event.locals.user`                          | `request.user`                                    |
| `event.locals.session`                       | `request.session`                                 |
| `event.locals.permissions`                   | `request.permissions`                             |
| `event.locals.apiKeyContext`                 | `request.apiKeyContext`                           |

The Fastify RBAC unifies `requirePermission()` (session-only) and `requireApiAuth()` (dual auth) into a single `requireAuth()` that handles both paths.
