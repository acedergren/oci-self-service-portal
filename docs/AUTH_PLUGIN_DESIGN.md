# Better Auth Fastify Integration — Architecture Design

**Plugin**: `apps/api/src/plugins/auth.ts`
**Phase**: 9 (Fastify Backend Migration)
**Status**: Implemented

## Overview

The auth plugin bridges Better Auth (designed for Web API `Request`/`Response`) with Fastify's request model. It resolves sessions on every request, maps roles to RBAC permissions, and decorates requests with auth context for downstream route handlers.

## Plugin Signature

```typescript
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

export interface AuthPluginOptions {
  excludePaths?: string[];  // Paths that skip session resolution (default: ['/healthz', '/health'])
}

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => { ... };

export default fp(authPlugin, {
  name: 'auth',
  fastify: '5.x'
});
```

## Fastify Decorators

### `request.user` — Authenticated user

Type: `User | null`

The Better Auth `User` object with `id`, `name`, `email`, `image`, `emailVerified`, `createdAt`, `updatedAt`. Null when anonymous.

### `request.session` — Active session

Type: `(Session & Record<string, unknown>) | null`

The Better Auth `Session` object extended with arbitrary fields (e.g., `role`, `activeOrganizationId`). Null when no valid session cookie.

### `request.permissions` — Resolved RBAC permissions

Type: `string[]`

Array of permission strings (e.g., `['tools:read', 'sessions:read', 'workflows:read']`). Resolved from the session's role via `getPermissionsForRole()`. Defaults to `[]` when anonymous.

Uses a Symbol-based getter/setter to work with Fastify 5's reference-type decorator requirements:

```typescript
const PERMISSIONS_KEY = Symbol('fastify.request.permissions');

fastify.decorateRequest('permissions', {
	getter(this: FastifyRequest): string[] {
		if (!this[PERMISSIONS_KEY]) this[PERMISSIONS_KEY] = [];
		return this[PERMISSIONS_KEY];
	},
	setter(this: FastifyRequest, value: string[]) {
		this[PERMISSIONS_KEY] = value;
	}
});
```

### `request.apiKeyContext` — API key metadata

Type: `ApiKeyContext | null`

Set by the RBAC plugin's `requireAuth()` hook when a `portal_` API key is provided. Contains `keyId`, `orgId`, `permissions`.

## Request-to-WebRequest Bridge

Better Auth expects `Request` objects (Web API Fetch standard). The plugin converts Fastify requests:

```typescript
function toWebRequest(request: FastifyRequest): Request {
	const url = `${request.protocol}://${request.hostname}${request.url}`;
	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers)) {
		if (value) {
			headers.set(key, Array.isArray(value) ? value.join(', ') : value);
		}
	}
	return new Request(url, { method: request.method, headers });
}
```

This is the critical bridge pattern. Better Auth reads the `cookie` header from the Web Request to find the session token.

## Request Flow

```
Client Request
  │
  ▼
onRequest hook
  │
  ├── Is URL in excludeSet? ──yes──→ return (skip auth)
  │
  ├── toWebRequest(request)
  │
  ├── auth.api.getSession({ headers })
  │         │
  │         ├── session found ──→ request.user = user
  │         │                     request.session = session
  │         │                     request.permissions = getPermissionsForRole(role)
  │         │
  │         └── no session ────→ request.user = null
  │                               request.session = null
  │                               request.permissions = []
  │
  └── catch (err) ──→ log.debug (fail-open, don't block request)
  │
  ▼
Route Handler (request.user / request.permissions available)
```

## Excluded Paths

Paths in `excludePaths` skip session resolution entirely. Query params are stripped before matching:

```typescript
if (excludeSet.has(request.url.split('?')[0])) {
	return; // Skip session resolution
}
```

Default excludes: `/healthz`, `/health`. App.ts adds `/api/metrics`.

## Role-to-Permission Mapping

The plugin resolves permissions from the session role using `@portal/shared/server/auth/rbac`:

| Role       | Permissions                                                                             |
| ---------- | --------------------------------------------------------------------------------------- |
| `viewer`   | tools:read, sessions:read, workflows:read                                               |
| `operator` | viewer + tools:execute, tools:approve, sessions:write, activity:read, workflows:execute |
| `admin`    | All 13 permissions including admin:all, admin:users, tools:danger, workflows:write      |

Unknown roles fall back to `viewer` permissions.

## Error Handling: Fail-Open

Session resolution errors **do not block requests**. This is critical:

- `getSession()` throwing → logged at debug level, request proceeds with empty auth
- Network timeout → request proceeds as anonymous
- Invalid cookie → request proceeds as anonymous

Individual routes guard access via RBAC `preHandler` hooks (see RBAC_HOOKS_DESIGN.md).

## Example Usage

### Accessing auth context in a route

```typescript
app.get('/api/sessions', {
	preHandler: requireAuth('sessions:read'),
	handler: async (request, reply) => {
		// request.user is guaranteed non-null (requireAuth verified it)
		const userId = request.user!.id;
		const orgId = resolveOrgId(request);

		const sessions = await listSessionsForUser(userId, orgId);
		return { sessions };
	}
});
```

### Checking permissions without RBAC hook

```typescript
app.get('/api/profile', async (request, reply) => {
	if (!request.user) {
		return reply.status(401).send({ error: 'Not authenticated' });
	}

	const isAdmin = request.permissions.includes('admin:all');
	return {
		user: request.user,
		isAdmin,
		permissions: request.permissions
	};
});
```

## Dependency Graph

```
auth.ts
├── @portal/shared/server/auth/config     (auth.api.getSession)
├── @portal/shared/server/auth/rbac       (getPermissionsForRole)
├── @portal/shared/server/api/types       (ApiKeyContext type)
└── @portal/shared/server/logger          (createLogger)
```

## Registration Order

Auth depends on Oracle (for DB-backed sessions) and is required by RBAC:

```
Oracle → Auth → RBAC → Routes
```

## Test Strategy

Tests mock `@portal/shared/server/auth/config` to control `getSession()` responses. Key patterns:

1. **`mockGetSession` delegate** — Top-level `const mockGetSession = vi.fn()`, wired into `vi.mock()` factory. Tests configure it per scenario.
2. **`buildApp()` helper** — Creates a Fastify instance with the auth plugin + test routes. Accepts `registerRoutes` callback for adding routes before `app.ready()`.
3. **Excluded paths** — Routes must be registered before `app.ready()` (Fastify 5 rejects post-ready route registration).
4. **Fail-open** — Tests verify that `getSession()` throwing doesn't crash the hook.

See: `apps/api/src/tests/plugins/auth.test.ts` (14 tests)

## Design Decisions

| Decision                          | Rationale                                                            |
| --------------------------------- | -------------------------------------------------------------------- |
| `onRequest` not `preHandler`      | Session resolution runs for all requests, not per-route              |
| `toWebRequest()` bridge           | Better Auth is framework-agnostic, expects Web API Request           |
| Symbol for permissions            | Fastify 5 requires getter/setter for reference-type decorators       |
| `excludeSet` with URL splitting   | Efficient O(1) lookup, query params don't affect matching            |
| `session.role` not `getOrgRole()` | Simplification — org role resolution is deferred to route-level      |
| Fail-open on auth errors          | Matches SvelteKit pattern; routes handle their own auth requirements |

## Known Limitations

1. **Role from `session.role` vs `getOrgRole(userId, orgId)`** — The SvelteKit hooks use `getOrgRole()` for multi-tenant org-scoped roles. The current Fastify plugin simplifies to `session.role`. This works for single-org deployments but may need enhancement for multi-org.

2. **No IDCS group claim processing** — The SvelteKit hooks run `provisionFromIdcsGroups()` in `databaseHooks.session.create.after`. This is handled by the shared Better Auth config, not the Fastify plugin.
