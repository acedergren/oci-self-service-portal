# OCI Self-Service Portal

Monorepo for the OCI self-service portal: SvelteKit frontend + Fastify 5 API + shared packages.

## Quick Start

```bash
pnpm install                     # Install all workspace dependencies
pnpm dev                         # SvelteKit dev server (port 5173)
pnpm lint                        # ESLint across all workspaces
pnpm build                       # Production build (needs BETTER_AUTH_SECRET)
npx vitest run                   # Run all tests (~1200+)
npx vitest run apps/api          # API tests only
npx vitest run apps/frontend     # Frontend tests only
```

**Type checking:**

```bash
cd apps/frontend && npx svelte-check   # Frontend type check
cd apps/api && npx tsc --noEmit        # API type check
cd packages/shared && npx tsc --noEmit # Shared types check
```

## Monorepo Structure

```
oci-self-service-portal/
├── apps/
│   ├── frontend/              # SvelteKit UI (adapter-node)
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── tools/             # 60+ OCI CLI tool wrappers for AI SDK
│   │       │   ├── server/
│   │       │   │   ├── oracle/        # Connection pool, migrations, repositories
│   │       │   │   ├── auth/          # Better Auth, OIDC, RBAC, auth-factory
│   │       │   │   ├── admin/         # Admin console repositories + crypto
│   │       │   │   ├── workflows/     # Visual workflow executor + repository
│   │       │   │   └── mcp/           # MCP portal server
│   │       │   └── components/        # 51 Svelte components (portal, workflow, setup, mobile, UI)
│   │       └── routes/
│   │           ├── api/               # SvelteKit API routes (chat, sessions, tools, v1, webhooks, admin, setup, workflows)
│   │           ├── admin/             # Admin console UI (IDP, AI Models, Settings)
│   │           └── workflows/         # Workflow designer pages
│   │
│   └── api/                   # Fastify 5 backend
│       └── src/
│           ├── plugins/       # cors, error-handler, helmet, mastra, oracle, rate-limit, rbac, request-logger, session
│           ├── routes/        # health, sessions, activity, chat, search, mcp, tools/, workflows
│           ├── mastra/        # Mastra framework integration
│           │   ├── agents/          # CloudAdvisor agent
│           │   ├── models/          # Provider registry, model types
│           │   ├── rag/             # OracleVectorStore, OCI embedder
│           │   ├── mcp/             # MCP server (tool discovery + execution)
│           │   ├── storage/         # OracleStore (MastraStorage impl)
│           │   ├── tools/           # 60+ OCI tool wrappers for Mastra
│           │   └── workflows/       # Workflow executor
│           ├── services/      # approvals, tools adapter, workflow-repository
│           └── config.ts      # Centralized env config with Zod validation
│
└── packages/
    └── shared/                # Shared types across frontend and API
        └── src/
            ├── errors.ts            # PortalError hierarchy
            ├── index.ts             # Re-exports
            ├── api/types.ts         # API response types
            ├── auth/rbac.ts         # Roles, permissions, type guards
            ├── tools/types.ts       # Tool definition types
            ├── workflows/           # graph-utils.ts, types.ts
            └── server/
                ├── oracle/          # migrations/, connection pool, repositories
                ├── auth/            # auth-factory, Better Auth core
                ├── logger.ts        # Pino logger factory
                └── metrics.ts       # Prometheus metrics
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

## Naming Conventions

### File Naming

| Category           | Convention                       | Example                                         |
| ------------------ | -------------------------------- | ----------------------------------------------- |
| TypeScript modules | `kebab-case.ts`                  | `oracle-adapter.ts`, `error-handler.ts`         |
| Svelte components  | `PascalCase.svelte`              | `SearchBox.svelte`, `AgentWorkflowPanel.svelte` |
| SvelteKit routes   | `+server.ts`, `+page.svelte`     | `routes/api/v1/workflows/+server.ts`            |
| Tests              | `[module].test.ts` (colocated)   | `rbac.test.ts` next to `rbac.ts`                |
| Migrations         | `NNN-name.sql` (zero-padded)     | `006-api-keys.sql`, `009-admin.sql`             |
| Fastify plugins    | `kebab-case.ts` + `fp()` wrapper | `plugins/rate-limit.ts`                         |

### TypeScript Naming

| Category              | Convention                         | Example                                                        |
| --------------------- | ---------------------------------- | -------------------------------------------------------------- |
| Types & interfaces    | `PascalCase`                       | `SessionResponse`, `PortalError`, `ActivityRow`                |
| Classes               | `PascalCase`                       | `WorkflowExecutor`, `ValidationError`                          |
| Functions             | `camelCase`                        | `requireCompartmentId()`, `toPortalError()`                    |
| Scalar constants      | `UPPER_SNAKE_CASE`                 | `MAX_CONCURRENT_CLI`, `MAX_STEPS`                              |
| Zod schemas           | `PascalCaseSchema`                 | `SessionResponseSchema`, `ActivityQuerySchema`                 |
| Schema type inference | `type X = z.infer<typeof XSchema>` | `type SessionResponse = z.infer<typeof SessionResponseSchema>` |
| Object/map constants  | `UPPER_SNAKE_CASE`                 | `PERMISSIONS`, `ROLE_PERMISSIONS`                              |
| Enum/union values     | `lowercase`                        | `'draft' \| 'published' \| 'archived'`                         |
| Permissions           | `resource:action`                  | `'tools:read'`, `'admin:all'`, `'workflows:execute'`           |
| Error codes           | `UPPER_SNAKE_CASE`                 | `VALIDATION_ERROR`, `AUTH_ERROR`, `OCI_ERROR`                  |
| Fastify plugins       | `camelCasePlugin`                  | `errorHandlerPlugin`, `oraclePlugin`                           |

### Database Naming (Oracle)

| Category           | Convention                    | Example                                             |
| ------------------ | ----------------------------- | --------------------------------------------------- |
| Tables             | `snake_case` (plural)         | `chat_sessions`, `workflow_definitions`, `api_keys` |
| Columns            | `snake_case`                  | `created_at`, `org_id`, `token_hash`, `duration_ms` |
| Primary keys       | `id UUID`                     | `id UUID PRIMARY KEY`                               |
| Foreign keys       | `[table]_id`                  | `user_id`, `org_id`, `session_id`                   |
| Timestamps         | `TIMESTAMP(6) WITH TIME ZONE` | `created_at`, `updated_at`, `expires_at`            |
| Check constraints  | `chk_[table]_[purpose]`       | `chk_exec_args`, `chk_approval_level`               |
| Unique constraints | `uq_[table]_[fields]`         | `uq_api_key_hash`, `uq_org_oidc_issuer_subject`     |
| Indexes            | `idx_[table]_[purpose]`       | `idx_chat_sessions_user`, `idx_workflow_runs_org`   |
| Hashes             | `VARCHAR2(64)`                | SHA-256 hex = 64 chars                              |
| JSON columns       | `IS JSON` constraint          | `CHECK (config IS JSON)`                            |

### API Routes

| Convention              | Example                                     |
| ----------------------- | ------------------------------------------- |
| Versioned base path     | `/api/v1/`                                  |
| Resource collections    | `/api/v1/workflows` (GET=list, POST=create) |
| Resource instances      | `/api/v1/workflows/[id]` (GET, PUT, DELETE) |
| Actions on resources    | `/api/v1/workflows/[id]/run` (POST)         |
| Query params: camelCase | `?limit=50&offset=0&search=text`            |
| Route params: camelCase | `[id]`, `[runId]`, `[name]`                 |

### Import Order

```typescript
// 1. Node built-ins / external packages
import { execFile } from 'child_process';
import { z } from 'zod';

// 2. Framework imports
import { json } from '@sveltejs/kit';
import type { FastifyPluginAsync } from 'fastify';

// 3. Local $lib / package imports
import { OCIError } from '$lib/server/errors.js';
import { createLogger } from '$lib/server/logger.js';
import type { SessionUser } from '@portal/shared';

// 4. Relative imports
import { errorResponse } from '../errors.js';
```

- Always use `.js` extensions in import paths (ESM requirement)
- Use `type` keyword for type-only imports: `import type { SessionUser } from './session.js'`
- Verify import paths against actual package exports before using them
- Prefer dynamic imports for optional dependencies (e.g., `@ai-sdk/azure`)

### Git Commit Format

```
type(scope): description [optional-tracking-id]

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

**Types**: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
**Scopes**: `security`, `phaseX.Y`, `api`, `frontend`, `database`, `auth`, `workflows`

### Environment Variables

- Always `UPPER_SNAKE_CASE`: `ORACLE_CONNECT_STRING`, `BETTER_AUTH_SECRET`, `CORS_ORIGIN`
- Validate with Zod at startup via `loadConfig()` in `apps/api/src/config.ts`
- **Never store secrets in `.env` files** — use OCI Vault via `/manage-secrets`
- `.env` files are for non-sensitive config only (region, endpoints, feature flags)

## Framework Notes

### Fastify 5 — Decorator Timing

- **Decorator types are locked at creation**: `fastify.decorate('foo', null)` permanently sets the type to `null`. Always pass the real value or a properly-typed stub. See `apps/api/src/app.ts:109-111`.
- **Module augmentation for TypeScript**: Fastify decorators need `declare module 'fastify'` blocks. Session plugin augments `FastifyRequest`, RBAC augments `FastifyInstance`.
- **Decorate before register in tests**: When testing a plugin that reads a decorator, decorate the mock _before_ calling `fastify.register(plugin)`.

### Fastify 5 — Auth Hook Ordering

- **Plugin registration order is load-bearing**: error-handler → request-logger → helmet → CORS → rate-limit → cookie → oracle → session → RBAC. See `apps/api/src/app.ts:68-129`.
- **`fp()` declares dependencies**: Plugins providing shared decorators must use `fastify-plugin` with `dependencies` array.
- **Deny-by-default auth gate**: `onRequest` hook rejects unauthenticated requests not in `PUBLIC_ROUTES`. Forgetting an endpoint = 401s.

### Fastify 5 — Response & Streaming

- **`reply.send(undefined)` → `FST_ERR_SEND_UNDEFINED`**: Always return an object or use `reply.code(204).send()`.
- **SSE streaming**: Use `reply.raw.writeHead()` + `reply.raw.write()`. Do NOT use `reply.send()` — it closes the response.
- **`app.inject()` in tests**: Use `JSON.parse(response.body)` for parsing. Always `await fastify.close()` in `afterEach`.

### Fastify 5 — Testing

- **`skipAuth` + `testUser`**: `buildApp({ skipAuth: true, testUser: {...} })` bypasses Oracle/session/RBAC in tests.
- **`PUBLIC_ROUTES` set**: All unauthenticated endpoints must be listed in the deny-by-default auth gate.
- **Type provider**: Route modules use `fastify.withTypeProvider<ZodTypeProvider>()` for Zod schema validation.
- **`withConnection()` decorator**: Check `fastify.hasDecorator("withConnection")` before using.
- **Zod type provider requirement**: Routes with Zod schemas require `app.setValidatorCompiler(validatorCompiler)` and `app.setSerializerCompiler(serializerCompiler)` in test `buildApp()`
- **Reference-type decorators**: Arrays on `request` must use `{ getter, setter }` with a Symbol key (Fastify 5 restriction):

```typescript
const PERMS_KEY = Symbol('permissions');
fastify.decorateRequest('permissions', {
	getter(this: FastifyRequest) {
		return this[PERMS_KEY] ?? [];
	},
	setter(this: FastifyRequest, v: string[]) {
		this[PERMS_KEY] = v;
	}
});
```

### Vitest 4

- **`projects` replaces `workspace`**: Root config uses `defineConfig({ test: { projects: [...] } })`. Old `vitest.workspace.ts` is gone.
- **`defineProject` not `defineConfig`**: Workspace member configs must use `defineProject` (avoids duplicate collection).
- **`$lib` alias**: Frontend vitest config needs `resolve.alias: { '$lib': resolve(__dirname, './src/lib') }`.
- **`import.meta.dirname`**: Use instead of `process.cwd()` for paths relative to the test file in a monorepo.
- **Mock hoisting order**: `vi.mock()` hoisted in declaration order. If mock A depends on mock B, declare B first.
- **`vi.hoisted()` for shared state**: `const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }))`.
- **`mockReset: true` gotcha**: Global `mockReset: true` clears mock return values between tests. Every test file using `vi.mock()` **must** re-configure mocks in `beforeEach`:

```typescript
// Top-level: define the mock fn
const mockFn = vi.fn();
vi.mock('module', () => ({ fn: (...args) => mockFn(...args) }));

// In beforeEach: re-configure after reset clears it
beforeEach(() => {
	mockFn.mockResolvedValue({ data: 'test' });
});
```

### SvelteKit / Build

- **Non-HTTP exports in +server.ts**: Must prefix with `_` (e.g., `_MODEL_ALLOWLIST`) or build fails
- **Server/client boundary**: +page.svelte cannot import from `$lib/server/`; use +page.server.ts `load()`
- **BETTER_AUTH_SECRET**: Required at build time; SvelteKit runs builds with NODE_ENV=production
- **npm 403 vs pnpm**: `npm` CLI hits 403 with expired `~/.npmrc` auth; `pnpm` resolves fine
- **`$state.raw()` for Svelte Flow**: Use for @xyflow/svelte nodes/edges (xyflow mutates directly)

## RAG Pipeline (OCI GenAI + Oracle 26AI)

The Mastra plugin (`apps/api/src/plugins/mastra.ts`) wires the RAG pipeline:

- **Embedding**: `createOCI().embeddingModel("cohere.embed-english-v3.0")` — 1024 dimensions, 96 texts/batch
- **Vector Storage**: `OracleVectorStore` implements `MastraVector` — `VECTOR(dim, FLOAT32)` + `VECTOR_DISTANCE(..., COSINE)`
- **Semantic Recall**: `semanticRecall: { topK: 3, messageRange: { before: 2, after: 1 }, scope: "resource" }`
- **Search Route**: `GET /api/v1/search` — uses `embed({ model: fastify.ociEmbedder, value: text })` from `ai` package
- **Key pattern**: Use `embed()` from `ai` package — NOT the old custom function signature

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
- **Webhook signatures**: HMAC-SHA256 via `X-Portal-Signature: sha256=<hex>`
- **CSP nonce**: `crypto.randomUUID()` per request in production
- **AES-256-GCM**: Webhook secret encryption at rest (migration 009)

### Git & Workflow

- **NEVER `git add -A` or `git add .`** — always stage specific files by name
- **When tests fail after refactor**: Question whether the TESTS are wrong first, not just the code
- **Commit early and often**: After each logical unit of work, not batched at the end

## Claude Code Automations

### Hooks (`.claude/settings.json`)

**PreToolUse (blockers)**:

- **Pre-commit**: Lint staged files + typecheck — blocks on failure
- **Pre-push**: Semgrep security scan — blocks on findings
- **Block bulk staging**: Rejects `git add -A` / `git add .`
- **Doc drift warning**: On push, warns if architecture/security/migration files changed without doc updates
- **Sensitive file blocker**: Blocks edits to `.env`, `.pem/.key`, wallet, credential files
- **Migration validator**: Validates `NNN-name.sql` pattern, warns on version gaps

**PostToolUse (auto-fixers)**:

- **Prettier**: Runs `prettier --write` after edits
- **ESLint fix**: Runs `eslint --fix` on `.ts`/`.svelte`
- **Related tests**: Finds and runs matching `.test.ts` file (60s timeout)

### Skills (`.claude/skills/`)

- `/manage-secrets <name> <value>` — Full OCI Vault CRUD
- `/oracle-migration <name> - <description>` — Scaffold Oracle migration
- `/phase-kickoff <N> - <title>` — Create branch, test shells, roadmap entry
- `/doc-sync [audit|fix]` — Audit/fix doc drift
- `/quality-commit [--review]` — Full quality gate pipeline: lint + typecheck + Semgrep + tests + commit

### Subagents (`.claude/agents/`)

- `security-reviewer` (Opus) — OWASP Top 10 + project-specific security review
- `oracle-query-reviewer` (Opus) — Oracle-specific SQL pitfalls and patterns

### MCP Servers (`.mcp.json`)

- `sentry` — Investigate production errors
- `serena` — Semantic code intelligence (symbol-level navigation, refactoring)
- `context7` — Up-to-date library documentation lookups
- `oci-api` — OCI CLI command execution

## Infrastructure & DevOps

### Docker Compose (Phase 9)

- **Location**: `infrastructure/docker/phase9/`
- **Services**: nginx (TLS termination) + api (Fastify) + frontend (SvelteKit) + certbot (optional Let's Encrypt)
- **Network**: All services on `portal-network` bridge; only nginx exposes host ports (80/443)
- **API/Frontend are internal-only**: Use `expose:` not `ports:` — only reachable via nginx reverse proxy
- **Build context**: `../../..` (monorepo root) because Dockerfiles need `packages/shared/` as sibling

### Container Hardening

- All containers: `read_only: true`, `no-new-privileges: true`, `tmpfs` for writable dirs
- nginx: `tmpfs` for `/var/cache/nginx`, `/var/run`, `/tmp` with size limits
- Resource limits: Configurable via `.env` (`API_MEMORY_LIMIT`, `API_CPU_LIMIT`, `FRONTEND_MEMORY_LIMIT`, `FRONTEND_CPU_LIMIT`)
- Health checks: nginx via `wget --spider`, api/frontend via `curl -f` to `/health` endpoints

### TLS / Certificates

- **Single variable**: `TLS_CERTS_DIR` (default `./certs`) points to directory containing `fullchain.pem`, `privkey.pem`, `dhparam.pem`
- **DH params required**: Generate with `openssl dhparam -out certs/dhparam.pem 2048` (takes ~30s)
- **Self-signed dev cert**: `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout certs/privkey.pem -out certs/fullchain.pem -subj "/CN=localhost"`
- **Let's Encrypt**: Enable certbot profile with `docker compose --profile letsencrypt up -d`
- See `infrastructure/docker/phase9/CERTIFICATES.md` for full guide

### Nginx Configuration

- **Proxy directive order**: Every `location` block follows: `proxy_pass` → `proxy_http_version` → `Connection` → `Host` → forwarding headers → `Upgrade ""` → timeouts → location-specific
- **H2C smuggling prevention**: All locations set `proxy_set_header Upgrade ""` to block Upgrade header
- **Health endpoints**: Both HTTP `/nginx-health` and HTTPS `/health` have `access_log off` to suppress noise
- **Security headers**: Defined once at `server` level (not per-location) to avoid nginx header-redefinition behavior
- **Rate limiting**: nginx `limit_req` as defence-in-depth alongside Fastify `@fastify/rate-limit`
- **SSE/streaming**: `proxy_buffering off` + `X-Accel-Buffering no` + `proxy_cache off` on `/api/` for AI chat streaming

### Feature Flag Migration

- **SvelteKit proxy**: `FASTIFY_ENABLED=true` in SvelteKit hooks causes `/api/*` to proxy to Fastify backend
- **Selective routing**: `FASTIFY_PROXY_ROUTES=/api/health,/api/sessions,/api/v1/` proxies only listed prefixes
- **Auth excluded**: `/api/auth/*` is NEVER proxied (Better Auth OIDC callbacks require SvelteKit cookie handling)
- **Proxy placement**: After request tracing, BEFORE auth/DB init (Fastify handles its own middleware)
- **Request ID forwarding**: `X-Request-Id` header propagated to Fastify for distributed trace correlation
- **502 fallback**: Returns `{"error": "Backend unavailable"}` when Fastify is unreachable

### Git Hooks

- **Location**: `.githooks/` directory, auto-installed via `prepare` script in package.json
- **Install**: `git config core.hooksPath .githooks` (runs automatically on `pnpm install`)
- **Pre-commit**: ESLint + type check + Prettier, scoped to changed workspaces only
- **Pre-push**: Semgrep (security), CodeQL (security-extended), test suite, CodeRabbit note
- **Skip**: `git push --no-verify` for emergencies only
- **Required tools**: semgrep (`brew install semgrep`), codeql (`brew install codeql`)

### Observability

- **Logger**: Pino via `createLogger(module)` with custom serializers, redacts auth/cookie headers
- **Metrics**: Custom Prometheus registry at `/api/metrics`
- **Sentry**: Dynamic import, no-op when DSN missing
- **Health**: `/healthz` liveness probe (plain text "ok") + `/health` deep check with 3s `Promise.race` timeout
- **Tracing**: `X-Request-Id` header propagation

---

Last updated: February 9, 2026
