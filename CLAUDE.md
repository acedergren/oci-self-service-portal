# OCI Self-Service Portal

Monorepo for the OCI self-service portal: SvelteKit frontend + Fastify 5 API + shared packages.

## Agent Behavior

- **Stay focused**: Do not expand scope beyond what was requested. If you notice something interesting but out-of-scope, mention it briefly and move on.
- **Verify before assuming**: Check actual file paths, package exports, and config before referencing them in code or docs.
- **Fail fast on blockers**: If blocked by a hook, permission, or missing dependency, report it immediately rather than working around it silently.

## Task Scope Discipline

Stay strictly within the assigned task scope. Do NOT expand into unsolicited research, refactoring, or fixing unrelated issues unless explicitly asked. If you notice something worth investigating, mention it briefly and wait for approval before acting.

## Pre-commit Hooks

When pre-commit hooks fail due to pre-existing lint errors unrelated to your changes, report the failure clearly and do NOT attempt to fix all pre-existing lint issues. Instead, suggest the user run with `--no-verify` or fix the hook configuration. Never get stuck in a loop trying to fix lint errors you didn't introduce.

## Quick Start

```bash
pnpm install                     # Install all workspace dependencies
pnpm dev                         # SvelteKit dev server (port 5173)
pnpm lint                        # ESLint across all workspaces
pnpm build                       # Production build (needs BETTER_AUTH_SECRET)
npx vitest run                   # Run all tests (1213+ passing)
npx vitest run apps/api          # API tests only
npx vitest run apps/frontend     # Frontend tests only
```

**Type checking:**

```bash
cd apps/frontend && npx svelte-check   # Frontend type check
cd apps/api && npx tsc --noEmit        # API type check
cd packages/shared && npx tsc --noEmit # Shared types check
```

## Monorepo Conventions

- This is a pnpm monorepo with apps/ and packages/ directories
- Use `git mv` to preserve history when moving files
- Shared types go in `packages/shared`
- Always update import paths across ALL consuming packages after moves
- Run `pnpm -r build` and full test suite after structural changes

## Monorepo Structure

```
oci-self-service-portal/
├── apps/
│   ├── frontend/              # SvelteKit UI (adapter-node)
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── auth-client.ts     # Better Auth client
│   │       │   ├── components/        # 54 Svelte components (portal, workflow, setup, mobile, UI, admin)
│   │       │   ├── stores/            # Svelte stores
│   │       │   └── utils/             # Client-side utilities
│   │       └── routes/
│   │           ├── api/               # SvelteKit API routes (chat, sessions, tools, v1, webhooks, admin, setup, workflows)
│   │           ├── admin/             # Admin console UI (IDP, AI Models, Settings)
│   │           └── workflows/         # Workflow designer pages
│   │
│   └── api/                   # Fastify 5 backend
│       └── src/
│           ├── plugins/       # auth, cache, cors, error-handler, helmet, mastra, oracle, otel, rate-limit, rate-limiter-oracle, rbac, request-logger, under-pressure
│           ├── routes/        # activity, admin/, audit, auth, chat, graph, health, mcp, metrics, models, openapi, schemas, search, sessions, setup, tools/, tools, webhooks, workflows
│           ├── mastra/        # Mastra framework integration
│           │   ├── agents/          # CloudAdvisor agent
│           │   ├── models/          # Provider registry, model types
│           │   ├── rag/             # OracleVectorStore, OCI embedder
│           │   ├── mcp/             # MCP server (tool discovery + execution)
│           │   ├── storage/         # OracleStore (MastraStorage impl)
│           │   ├── tools/           # 60+ OCI tool wrappers for Mastra
│           │   └── workflows/       # Workflow executor
│           └── services/      # approvals, cache, mcp-connection-manager, tools adapter, workflow-repository
│
└── packages/
    └── shared/                # Shared business logic across frontend and API
        └── src/
            ├── errors.ts            # PortalError hierarchy
            ├── index.ts             # Re-exports
            ├── api/types.ts         # API response types
            ├── tools/               # 60+ OCI CLI tool wrappers, registry, types
            ├── workflows/           # graph-utils.ts, types.ts
            └── server/
                ├── admin/           # IDP, AI provider, settings repositories, setup token, crypto
                ├── agent-state/     # Oracle-backed agent state management
                ├── api/             # API response types
                ├── auth/            # auth-factory, Better Auth, RBAC, IDCS provisioning, API keys
                ├── mcp/             # MCP portal server
                ├── mcp-client/      # MCP client with stdio/SSE transports
                ├── oracle/          # migrations/, connection pool, repositories
                ├── workflows/       # graph-utils, workflow types
                ├── approvals.ts     # Approval token management
                ├── crypto.ts        # AES-256-GCM encryption utilities
                ├── embeddings.ts    # OCI GenAI embedding helpers
                ├── errors.ts        # PortalError hierarchy
                ├── feature-flags.ts # Feature flag evaluation
                ├── health.ts        # Deep health check runner
                ├── logger.ts        # Pino logger factory
                ├── metrics.ts       # Prometheus metrics
                ├── rate-limiter.ts  # Rate limit config and utilities
                ├── sentry.ts        # Sentry SDK integration
                ├── session.ts       # Session repository
                ├── tracing.ts       # Request ID generation
                ├── url-validation.ts # SSRF prevention (webhook URL validation)
                └── webhooks.ts      # Webhook signature and delivery
```

## Error Hierarchy

```
PortalError (base)
├── ValidationError   → 400 VALIDATION_ERROR
├── AuthError         → 401/403 AUTH_ERROR
├── NotFoundError     → 404 NOT_FOUND
├── RateLimitError    → 429 RATE_LIMIT
├── OCIError          → 502 OCI_ERROR
└── DatabaseError     → 503 DATABASE_ERROR
```

- `toJSON()` → Pino structured logs (includes stack)
- `toSentryExtras()` → Sentry context (excludes stack)
- `toResponseBody()` → HTTP response (never exposes internals)
- `isPortalError()` → type guard
- `toPortalError(err)` → wraps unknown errors as `INTERNAL_ERROR(500)`

## Naming & Framework Conventions

> Full tables and code examples in `.claude/reference/naming-conventions.md`

Key rules: `kebab-case.ts` files, `PascalCase.svelte` components, `PascalCase` types, `camelCase` functions, `UPPER_SNAKE_CASE` constants. `.js` extensions in all imports (ESM). Commit format: `type(scope): description`.

> Fastify 5, Vitest 4, SvelteKit, and RAG pipeline patterns in `.claude/reference/framework-notes.md`

Critical reminders: Plugin registration order is load-bearing. `mockReset: true` clears mocks between tests — re-configure in `beforeEach`. `reply.send(undefined)` throws in Fastify 5. Use `embed()` from `ai` package for RAG.

> Product requirements, phasing, architecture decisions, and success criteria in `.claude/reference/PRD.md`

> Phase 10 agent task plan (107 tasks, git worktree strategy, verification gates) in `.claude/reference/phase-10-task-plan.md`

## Test Infrastructure

**Versions**: Vitest 4.0.18, Fastify 5.7.4. Run: `npx vitest run apps/api` (API), `npx vitest run apps/frontend` (frontend).

**TDD workflow**: Write tests first. Ensure all tests pass and TypeScript compiles cleanly before committing. Do not start work on a subsequent phase until the current one is green.

### Vitest Configuration

Both workspaces use `mockReset: true` — the single most important config detail:

```
apps/api/vitest.config.ts     — mockReset: true, @portal/shared aliased to packages/shared/src
apps/frontend/vitest.config.ts — $lib, $lib/server, $lib/tools aliased to source dirs
```

**Vitest 4 breaking change**: `mockReset` now resets to the _original implementation_ (not an empty function). This means `vi.mock()` factory implementations survive reset, but inner `vi.fn()` mock return values get cleared. Always reconfigure mock return values in `beforeEach`.

### Test File Layout

```
apps/api/src/
├── plugins/*.test.ts          — Unit tests alongside plugins (cors, helmet, rate-limit)
├── mastra/**/*.test.ts        — Agent, RAG, storage, workflow tests
└── tests/
    ├── plugins/*.test.ts      — Plugin integration tests (auth, rbac, oracle)
    ├── routes/*.test.ts       — Route tests (chat, tools, sessions, webhooks, ...)
    ├── routes/test-helpers.ts  — Shared buildTestApp(), simulateSession(), mocks
    ├── admin/*.test.ts        — Repository tests (MCP, settings)
    └── *.test.ts              — App factory, lifecycle, auth middleware
apps/frontend/src/tests/       — Organized by phase (phase4/, phase5/, ..., phase9/)
```

### Mock Patterns (surviving mockReset: true)

**1. Forwarding pattern** — standard for most mocks:

```typescript
const mockGetSession = vi.fn();
vi.mock('@portal/shared/server/auth/config', () => ({
	auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } }
}));
// In beforeEach: mockGetSession.mockResolvedValue(null);
```

The factory arrow function survives `mockReset` because it's the "original implementation". The inner `mockGetSession` can be reconfigured per test via `beforeEach`.

**2. Object-bag pattern** — for plugins with many exports (oracle plugin):

```typescript
const mocks = {
	initPool: vi.fn().mockResolvedValue(undefined),
	closePool: vi.fn().mockResolvedValue(undefined)
	// ...
};
vi.mock('module', () => ({
	initPool: (...args: unknown[]) => mocks.initPool(...args)
}));
function resetMocksToDefaults(): void {
	/* re-set all mocks */
}
beforeEach(resetMocksToDefaults);
```

**3. Counter-based sequencing** — for multi-query operations (MCP repository):

```typescript
let callCount = 0;
mockExecute.mockImplementation(async () => {
	callCount++;
	if (callCount === 1) return insertResult;
	if (callCount === 2) return selectResult;
});
```

Preferred over chaining `mockResolvedValueOnce` calls which get cleared by mockReset.

**4. globalThis registry** — for vi.mock() TDZ issues (when factories can't reference module-scope variables):

```typescript
if (!(globalThis as any).__testMocks) (globalThis as any).__testMocks = {};
const mocks = { listByOrg: vi.fn() };
(globalThis as any).__testMocks.repository = mocks;
// In tests: const mocks = (globalThis as any).__testMocks;
```

### Fastify Testing Patterns

**buildTestApp()** — centralized in `tests/routes/test-helpers.ts`:

```typescript
import { buildTestApp, simulateSession } from './test-helpers.js';
const app = await buildTestApp({ withRbac: true }); // Zod validators + fake auth + RBAC
simulateSession(app, { id: 'user-1' }, ['tools:execute']);
await app.ready();
const res = await app.inject({ method: 'POST', url: '/api/chat', payload: {...} });
```

**Key rules:**

- Always register auth hooks BEFORE test user injection hooks to avoid 401 errors
- Fastify 5 `decorateRequest` requires `null` initial value (not `undefined`)
- Reference-type decorators (arrays) need `{ getter, setter }` with Symbol key
- Always `await app.close()` in `afterEach` — Fastify holds resources open
- Use `fp()` (fastify-plugin) with `{ name: 'auth', fastify: '5.x' }` for fake plugins
- `reply.send(undefined)` throws in Fastify 5 — always send a value
- When testing with mocked SQL, ensure query matching is specific enough to avoid subquery false matches

**Logger mock** — standard shape used across all tests:

```typescript
vi.mock('@portal/shared/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));
```

### Common Pitfalls

- **Don't chain `mockResolvedValueOnce`** — they get cleared by mockReset between tests. Use counter-based `mockImplementation` instead.
- **Dynamic imports after `vi.mock()`** — modules under test must be imported AFTER mocks: `const { createApp } = await import('../app.js');`
- **Plugin order is load-bearing** — oracle → auth → rbac → swagger → routes. Tests must mirror this.
- **`vi.clearAllMocks()` vs `mockReset`** — `clearAllMocks` only clears call history; `mockReset` (our config) also resets implementations back to original factory.
- **Avoid `vi.importActual` for modules with side effects** — use selective re-exports instead.

## Writing Style

For content writing tasks (LinkedIn posts, docs, communications): Use a direct, practical, humble tone. Avoid superlatives, self-congratulatory language, and AI-sounding polish. Write like a senior engineer talking to peers, not a marketing team. When in doubt, understate rather than overstate. Keep it conversational and grounded. When drafting LinkedIn posts, blog content, or public-facing text, default to a human voice — not a marketing voice.

## Anti-Patterns & Gotchas

### Oracle Database

- **NEVER combine `--all` and `--limit`** in OCI CLI tools (Zod defaults always emit both)
- **UPPERCASE column keys**: `OUT_FORMAT_OBJECT` returns UPPERCASE — use `fromOracleRow()` for camelCase
- **NEVER SELECT-then-INSERT/UPDATE**: Use `MERGE INTO` for atomic upserts (TOCTOU)
- **Fire-and-forget updates**: Must use a separate `withConnection()` call, not reuse a closing connection
- **LIKE injection**: Always escape `%`, `_`, `\` in user search terms + add `ESCAPE '\'` clause
- **Blockchain tables**: `NO DROP UNTIL 365 DAYS IDLE`, `NO DELETE UNTIL 365 DAYS AFTER INSERT`

### Security

- **NEVER grant default permissions** on auth errors — fail to 503/redirect
- **NEVER trust client-supplied approval flags** — use server-side `recordApproval()`/`consumeApproval()`
- **NEVER interpolate user input into SQL** — use bind parameters (`:paramName`)
- **Column/table names can't be bind variables** — validate with `validateColumnName()`/`validateTableName()`
- **IDOR prevention**: All endpoints verify org ownership via `resolveOrgId()`
- **SSRF prevention**: `isValidWebhookUrl()` blocks private IPs, requires HTTPS
- **Webhook signatures**: HMAC-SHA256 via `X-Webhook-Signature: sha256=<hex>`
- **CSP nonce**: `crypto.randomUUID()` per request in production
- **AES-256-GCM**: Webhook secret encryption at rest (migration 009)

### Git & Workflow

- **NEVER `git add -A` or `git add .`** — always stage specific files by name
- **When tests fail after refactor**: Question whether the TESTS are wrong first, not just the code
- **Commit early and often**: After each logical unit of work, not batched at the end
- **Pre-validate before committing**: Run lint + typecheck + full test suite BEFORE staging and committing, not as part of the pre-commit hook discovery. If pre-commit hooks block due to pre-existing lint errors in files you didn't touch, fix them first or use `--no-verify` with a documented note. Never leave work uncommitted because of pre-commit hook failures.
- **TDD by default**: Write tests first (TDD). Ensure all tests pass and TypeScript compiles cleanly. Commit with conventional message format. Do not start any subsequent phase until the current one is green.

## Agent Team Coordination

When operating as part of a multi-agent team:

- Pick up assigned tasks promptly — do not go idle waiting for repeated messages
- Confirm task receipt immediately via SendMessage
- If a task is already completed by another agent, verify and report back quickly without re-investigating
- Shut down cleanly when requested by the team lead

## Infrastructure & Automations

> Full Docker, nginx, TLS, feature flags, observability, hooks, skills, MCP servers, and agent team protocol in `.claude/reference/infrastructure.md`

---

Last updated: February 10, 2026
