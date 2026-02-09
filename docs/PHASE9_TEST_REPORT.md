# Phase 9 Test Report — Fastify Backend Migration

**Date**: 2026-02-09
**Branch**: `feature/backport-ai-chat-improvements`
**Test Framework**: Vitest with `mockReset: true`
**Total Tests**: 28 test files in `apps/api/src/` (tests/, plugins/, mastra/)

## Test Suite Summary

### Core Tests (`tests/`)

| Test File                           | Coverage Area                                                               |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `app-factory.test.ts`               | App creation, plugins, CORS, Helmet, Zod, error handler, security hardening |
| `server-lifecycle.test.ts`          | Server startup, shutdown, env config, Sentry/Oracle lifecycle               |
| `auth-middleware.test.ts`           | RBAC module, auth contract, dual auth, public/protected routes              |
| `oracle-plugin.test.ts`             | Plugin registration, decorator types, option handling                       |
| `health-endpoint.test.ts`           | /healthz liveness, /health deep check, degraded status                      |
| `webhook-secret-encryption.test.ts` | AES-256-GCM encryption, key derivation, migration                           |
| `plugins/oracle.test.ts`            | Oracle plugin lifecycle, pool init, migrations, graceful fallback           |
| `plugins/auth.test.ts`              | Session resolution, cookie parsing, auth exclusion paths                    |
| `plugins/rbac.test.ts`              | Permission decoration, role mapping, hasPermission hook                     |
| `routes/tools.test.ts`              | Tool listing, execution, approval flow, rate limiting, dual auth            |
| `routes/sessions.test.ts`           | Session CRUD, search, LIKE escaping, org-scoped access                      |
| `routes/activity.test.ts`           | Activity queries, pagination, Oracle fallback                               |
| `routes/chat.test.ts`               | AI chat streaming, session context, SSE responses                           |
| `routes/metrics.test.ts`            | Prometheus text format, metric types, auth bypass                           |

### Plugin Unit Tests (`plugins/`)

| Test File                        | Coverage Area                                               |
| -------------------------------- | ----------------------------------------------------------- |
| `plugins/cors.test.ts`           | CORS origin validation, credentials, dev vs production      |
| `plugins/error-handler.test.ts`  | PortalError mapping, unknown error wrapping, response shape |
| `plugins/helmet.test.ts`         | CSP directives, HSTS, security headers                      |
| `plugins/rate-limit.test.ts`     | Rate limit config, skip-on-error, per-endpoint limits       |
| `plugins/request-logger.test.ts` | Request logging, header redaction, timing                   |

### Mastra Tests (`mastra/`)

| Test File                                    | Coverage Area                                               |
| -------------------------------------------- | ----------------------------------------------------------- |
| `mastra/agents/cloud-advisor.test.ts`        | CloudAdvisor agent configuration, tool binding              |
| `mastra/models/provider-registry.test.ts`    | Provider registry, model resolution, fallback               |
| `mastra/rag/oci-embedder.test.ts`            | OCI GenAI embedding, batch processing, dimension validation |
| `mastra/rag/oracle-vector-store.test.ts`     | Vector store CRUD, cosine similarity search                 |
| `mastra/storage/oracle-store.test.ts`        | OracleStore (MastraStorage), 20+ methods                    |
| `mastra/storage/oracle-store-memory.test.ts` | MemoryOracle, conversation thread storage                   |
| `mastra/storage/oracle-store-scores.test.ts` | ScoresOracle, evaluation metric storage                     |
| `mastra/tools/registry.test.ts`              | Tool registry, 60+ tool definitions, category mapping       |
| `mastra/workflows/executor.test.ts`          | Workflow executor, topological sort, cycle detection        |

## Coverage Matrix

### Plugins (8 files)

- **Oracle plugin**: Pool initialization, migration execution, graceful fallback on DB unavailability, decorator registration, `SKIP_MIGRATIONS` env var
- **Auth plugin**: Better Auth session resolution via `getSession()`, cookie-based auth, path exclusion patterns, request context decoration (`user`, `permissions`)
- **RBAC plugin**: `requirePermission` decorator, role-to-permission mapping (viewer/operator/admin), `admin:all` wildcard, `hasPermission` preHandler hook
- **CORS plugin**: Origin validation, credentials configuration, dev vs production behavior
- **Error handler**: PortalError mapping, unknown error wrapping, safe response shape
- **Helmet**: CSP directives, HSTS, comprehensive security header verification
- **Rate limit**: Configuration, skip-on-error behavior, per-endpoint limits
- **Request logger**: Request/response logging, header redaction, timing

### Routes (5 files)

- **Tools**: Tool registry listing, tool execution with OCI CLI, server-side approval token flow (`recordApproval`/`consumeApproval` with `orgId`), rate limit validation, auth guard (401/403), request tracing
- **Sessions**: Create/list/get/delete sessions, search with LIKE escaping, org-scoped queries, `userId` ownership enforcement, enriched session listing (message count, last message)
- **Activity**: Activity feed with pagination, Oracle query construction, fallback to empty on DB errors, timestamp filtering
- **Chat**: AI chat streaming via SSE, session context, `streamText` integration
- **Metrics**: Prometheus text exposition format, counter/gauge/histogram serialization, metrics endpoint skips auth

### Mastra (9 files)

- **CloudAdvisor agent**: Agent configuration, tool binding, system prompts
- **Provider registry**: Model provider resolution, OCI GenAI + Azure fallback
- **OCI embedder**: Embedding generation, batch processing, dimension validation
- **Oracle vector store**: Vector CRUD, cosine similarity search, index management
- **OracleStore**: MastraStorage implementation (20+ methods), thread/message/run storage
- **MemoryOracle**: Conversation memory, thread management
- **ScoresOracle**: Evaluation metrics storage (5 methods)
- **Tool registry**: 60+ OCI tool definitions, category mapping, schema validation
- **Workflow executor**: Topological sort, cycle detection, safe expression evaluation

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
