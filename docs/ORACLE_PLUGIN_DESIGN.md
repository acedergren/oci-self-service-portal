# Oracle DB Fastify Plugin — Architecture Design

**Plugin**: `apps/api/src/plugins/oracle.ts`
**Phase**: 9 (Fastify Backend Migration)
**Status**: Implemented

## Overview

The Oracle plugin wraps the shared Oracle connection pool (`@portal/shared/server/oracle/connection`) as a Fastify 5 plugin. It handles pool lifecycle, exposes connection borrowing via a decorator, and runs database migrations on startup.

## Plugin Signature

```typescript
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

export interface OraclePluginOptions {
  config?: Partial<OracleConfig>;  // Falls back to env vars
  migrate?: boolean;               // Run migrations on startup (default: true)
}

const oraclePlugin: FastifyPluginAsync<OraclePluginOptions> = async (fastify, opts) => { ... };

export default fp(oraclePlugin, {
  name: 'oracle',
  fastify: '5.x'
});
```

## Fastify Decorators

### `fastify.oracle` (instance decorator)

Type: `OracleDecorator`

```typescript
export interface OracleDecorator {
	withConnection: <T>(fn: (conn: OracleConnection) => Promise<T>) => Promise<T>;
	getPoolStats: () => Promise<PoolStats | null>;
	isAvailable: () => boolean;
}
```

- `withConnection(fn)` — Borrows a connection from the pool, executes `fn`, auto-releases. This is the primary data access pattern.
- `getPoolStats()` — Returns pool health metrics (connectionsOpen, connectionsInUse, poolMin, poolMax).
- `isAvailable()` — Returns `true` when pool was initialized AND `isPoolInitialized()` reports ready.

### `request.dbAvailable` (request decorator)

Type: `boolean`

Set on every request via an `onRequest` hook. Routes can check this to provide graceful fallback when Oracle is down:

```typescript
app.get('/api/sessions', async (request, reply) => {
	if (!request.dbAvailable) {
		return reply.status(503).send({ error: 'Database unavailable' });
	}
	// ... proceed with DB query
});
```

## Lifecycle Hooks

### `onRequest` — set `request.dbAvailable`

```
Client → onRequest: dbAvailable = oracle.isAvailable() → handler
```

### `onClose` — close pool on shutdown

```
SIGTERM → fastify.close() → onClose: closePool() → process exit
```

## Startup Flow

```
1. initPool(config)         → connect to Oracle ADB
2. runMigrations()          → apply schema changes (001–008)
3. migratePlaintextSecrets()→ encrypt webhook secrets
4. decorate fastify.oracle  → expose pool to routes
5. decorateRequest dbAvailable
6. register onRequest + onClose hooks
```

## Error Handling: Fail-Open

If `initPool()` throws (Oracle unreachable, bad credentials, etc.), the plugin **does not crash the server**. Instead:

1. Logs a warning: `Oracle initialization failed — running in fallback mode`
2. Sets `available = false`
3. `request.dbAvailable` will be `false` on every request
4. Routes that check `dbAvailable` can serve fallback responses

This matches the SvelteKit pattern where all services have fallback to JSONL/in-memory/SQLite.

## Example Usage

### In a route handler

```typescript
import type { FastifyInstance } from 'fastify';

export async function sessionRoutes(app: FastifyInstance) {
	app.get('/api/sessions', async (request, reply) => {
		if (!request.dbAvailable) {
			return reply.status(503).send({ error: 'Database unavailable' });
		}

		const sessions = await app.oracle.withConnection(async (conn) => {
			const result = await conn.execute('SELECT * FROM portal_sessions WHERE user_id = :userId', {
				userId: request.user?.id
			});
			return result.rows;
		});

		return { sessions };
	});
}
```

### In health checks

```typescript
app.get('/health', async (request, reply) => {
	const stats = await app.oracle.getPoolStats();
	return {
		status: app.oracle.isAvailable() ? 'ok' : 'degraded',
		database: {
			available: app.oracle.isAvailable(),
			pool: stats
		}
	};
});
```

## Dependency Graph

```
oracle.ts
├── @portal/shared/server/oracle/connection  (initPool, closePool, withConnection, getPoolStats, isPoolInitialized)
├── @portal/shared/server/oracle/migrations  (runMigrations)
├── @portal/shared/server/oracle/repositories/webhook-repository  (migratePlaintextSecrets)
└── @portal/shared/server/logger  (createLogger)
```

## Registration Order

The Oracle plugin MUST be registered first, before auth and RBAC:

```typescript
// In app.ts
await app.register(oraclePlugin, { migrate: process.env.SKIP_MIGRATIONS !== 'true' });
await app.register(authPlugin, { excludePaths: ['/healthz', '/health', '/api/metrics'] });
await app.register(rbacPlugin);
```

## Test Strategy

Tests mock `@portal/shared/server/oracle/connection` entirely. Key patterns:

1. **`mockReset: true` compatibility** — `vi.mock()` factories provide bare `vi.fn()` stubs. A top-level `beforeEach` re-establishes `.mockResolvedValue()` and `.mockImplementation()` since `mockReset` clears them between tests.
2. **Plugin isolation** — Tests register the plugin on a fresh `Fastify()` instance per test.
3. **Fail-open verification** — Tests confirm that `initPool` rejection doesn't crash the plugin.

See: `apps/api/src/tests/plugins/oracle.test.ts` (25 tests), `apps/api/src/tests/oracle-plugin.test.ts` (8 tests)

## Design Decisions

| Decision                         | Rationale                                                                 |
| -------------------------------- | ------------------------------------------------------------------------- |
| `fp()` (encapsulation breaking)  | Decorators must be visible to all routes, not scoped to a sub-plugin      |
| Separate `request.dbAvailable`   | Avoids null checks on `fastify.oracle` — the decorator always exists      |
| Migrations in plugin             | Single responsibility: "Oracle is ready" means pool + schema              |
| `onClose` not `onReady` for init | Init runs at registration time (async plugin body), not in `onReady` hook |
