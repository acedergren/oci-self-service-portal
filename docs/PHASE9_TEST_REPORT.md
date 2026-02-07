# Phase 9 Test Report — Fastify Backend Migration

**Date**: 2026-02-06
**Branch**: `feature/phase0-foundation-hardening`
**Test Framework**: Vitest 3.0.4 with `mockReset: true`
**Total Tests**: 204 passing, 0 failures across 13 test files

## Test Suite Summary

| Test File                           | Tests | Duration | Coverage Area                                                               |
| ----------------------------------- | ----: | -------- | --------------------------------------------------------------------------- |
| `app-factory.test.ts`               |    31 | 413ms    | App creation, plugins, CORS, Helmet, Zod, error handler, security hardening |
| `plugins/oracle.test.ts`            |    25 | 342ms    | Oracle plugin lifecycle, pool init, migrations, graceful fallback           |
| `routes/tools.test.ts`              |    36 | 588ms    | Tool listing, execution, approval flow, rate limiting, dual auth            |
| `routes/sessions.test.ts`           |    21 | 558ms    | Session CRUD, search, LIKE escaping, org-scoped access                      |
| `auth-middleware.test.ts`           |    16 | 139ms    | RBAC module, auth contract, dual auth, public/protected routes              |
| `plugins/rbac.test.ts`              |    16 | 119ms    | Permission decoration, role mapping, hasPermission hook                     |
| `plugins/auth.test.ts`              |    13 | 390ms    | Session resolution, cookie parsing, auth exclusion paths                    |
| `server-lifecycle.test.ts`          |    12 | 65ms     | Server startup, shutdown, env config, Sentry/Oracle lifecycle               |
| `routes/activity.test.ts`           |     9 | 295ms    | Activity queries, pagination, Oracle fallback                               |
| `health-endpoint.test.ts`           |     9 | 205ms    | /healthz liveness, /health deep check, degraded status                      |
| `oracle-plugin.test.ts`             |     8 | 12ms     | Plugin registration, decorator types, option handling                       |
| `routes/metrics.test.ts`            |     4 | 186ms    | Prometheus text format, metric types, auth bypass                           |
| `webhook-secret-encryption.test.ts` |     4 | 404ms    | AES-256-GCM encryption, key derivation, migration                           |

## Coverage Matrix

### Plugins (3 files, 54 tests)

- **Oracle plugin**: Pool initialization, migration execution, graceful fallback on DB unavailability, decorator registration (`db`, `withConnection`), `SKIP_MIGRATIONS` env var
- **Auth plugin**: Better Auth session resolution via `getSession()`, cookie-based auth, path exclusion patterns (`/healthz`, `/health`, `/api/metrics`), request context decoration (`user`, `permissions`)
- **RBAC plugin**: `requirePermission` decorator, role-to-permission mapping (viewer/operator/admin), `admin:all` wildcard, `hasPermission` preHandler hook

### Routes (4 files, 70 tests)

- **Tools**: Tool registry listing, tool execution with OCI CLI, server-side approval token flow (`recordApproval`/`consumeApproval` with `orgId`), rate limit validation, auth guard (401/403), request tracing
- **Sessions**: Create/list/get/delete sessions, search with LIKE escaping, org-scoped queries, `userId` ownership enforcement, enriched session listing (message count, last message)
- **Activity**: Activity feed with pagination, Oracle query construction, fallback to empty on DB errors, timestamp filtering
- **Metrics**: Prometheus text exposition format, counter/gauge/histogram serialization, metrics endpoint skips auth

### App Factory (1 file, 31 tests)

- Fastify instance creation with Zod type provider
- CORS configuration (credentials + explicit origin)
- Helmet security headers (CSP, HSTS, X-Frame-Options, referrer policy)
- Rate limiting with `@fastify/rate-limit`
- Request tracing (`X-Request-Id` propagation)
- Global error handler (PortalError mapping)
- Production guards (`BETTER_AUTH_SECRET`, `CORS_ORIGIN` required)
- Cookie configuration aligned with Better Auth

### Auth & Security (2 files, 20 tests)

- RBAC: 13 permissions across 3 roles, `getPermissionsForRole()`, `hasPermission()`, unknown role fallback
- Dual auth contract: session cookies + API key (`portal_` prefix + 64 hex chars), `Bearer` and `X-API-Key` headers
- Webhook secret encryption: AES-256-GCM with HKDF key derivation, ciphertext migration path

### Server Lifecycle (1 file, 12 tests)

- Oracle pool init with graceful failure handling
- Migration execution sequencing
- Sentry initialization (conditional on `SENTRY_DSN`)
- Environment-driven config: `PORT`, `HOST`, `ENABLE_RATE_LIMIT`, `ENABLE_TRACING`
- Graceful shutdown: Oracle pool close + Sentry flush

## Testing Patterns

### Mock Reset Strategy

Vitest is configured with `mockReset: true` (`apps/api/vitest.config.ts:17`), which clears all mock implementations between tests. This requires:

1. **Forwarding pattern** for mocks that need per-test configuration:

   ```typescript
   const mockFn = vi.fn();
   vi.mock('module', () => ({
   	exportedFn: (...args: unknown[]) => mockFn(...args)
   }));

   beforeEach(() => {
   	mockFn.mockResolvedValue(defaultValue);
   });
   ```

2. **Static factory mocks** for mocks that return the same value across all tests:
   ```typescript
   vi.mock('module', () => ({
   	fn: vi.fn().mockReturnValue(staticValue)
   }));
   ```
   Note: `mockReturnValue` survives `mockReset`, but `mockResolvedValue` does not.

### Integration Testing via `app.inject()`

All route tests use Fastify's `app.inject()` for HTTP-level integration tests without starting a server:

```typescript
const app = await createApp({ enableRateLimit: false });
await app.ready();
const response = await app.inject({ method: 'GET', url: '/health' });
expect(response.statusCode).toBe(200);
```

### Session Simulation

Authenticated requests mock Better Auth's `getSession()`:

```typescript
const { auth } = await import('@portal/shared/server/auth/config');
(auth.api.getSession as Mock).mockResolvedValue({
	session: { id: 'sess-1', userId: 'user-1' },
	user: { id: 'user-1', role: 'admin', orgId: 'org-1' }
});
```

### Oracle Connection Mocking

All Oracle interactions are mocked via `withConnection`:

```typescript
vi.mock('@portal/shared/server/oracle/connection', () => ({
	withConnection: vi.fn(async (fn) =>
		fn({
			execute: vi.fn().mockResolvedValue({ rows: [] }),
			close: vi.fn(),
			commit: vi.fn(),
			rollback: vi.fn()
		})
	)
}));
```

## Lint Status

- **Errors**: 0
- **Warnings**: 11 (all `@typescript-eslint/no-explicit-any` in test mocking code — acceptable baseline)

## Build Status

- **SvelteKit frontend**: Builds successfully (`adapter-node`)
- **API package**: TypeScript compilation clean
- **Shared package**: TypeScript compilation clean

## Known Issues

1. **`no-explicit-any` warnings**: 11 instances in test files where `any` is used for mock typing. Acceptable tradeoff for test mock flexibility.
2. **`@sentry/node` external dependency warning**: SvelteKit build treats `@sentry/node` as external — expected behavior for optional dependency.
3. **Test timing sensitivity**: `app-factory.test.ts` security hardening tests require production environment variables (`BETTER_AUTH_SECRET`, `CORS_ORIGIN`) in `beforeEach` — must be kept in sync with `app.ts` production guards.

## Validation Commands

```bash
# Run all API tests
pnpm --filter api test

# Run with verbose output
pnpm --filter api test -- --reporter=verbose

# Run specific test file
pnpm --filter api test -- src/tests/routes/tools.test.ts

# Lint check
pnpm --filter api lint

# Full build
pnpm build
```
