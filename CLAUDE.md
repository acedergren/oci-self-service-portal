# OCI Self-Service Portal

Monorepo for the OCI self-service portal: SvelteKit frontend + Fastify 5 API + shared packages.

## Agent Behavior

- **Stay focused**: Do not expand scope beyond what was requested. If you notice something interesting but out-of-scope, mention it briefly and move on.
- **Verify before assuming**: Check actual file paths, package exports, and config before referencing them in code or docs.
- **Fail fast on blockers**: If blocked by a hook, permission, or missing dependency, report it immediately rather than working around it silently.

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

## Monorepo Structure

```
oci-self-service-portal/
├── apps/
│   ├── frontend/              # SvelteKit UI (adapter-node)
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── auth-client.ts     # Better Auth client
│   │       │   ├── components/        # 51 Svelte components (portal, workflow, setup, mobile, UI)
│   │       │   ├── stores/            # Svelte stores
│   │       │   └── utils/             # Client-side utilities
│   │       └── routes/
│   │           ├── api/               # SvelteKit API routes (chat, sessions, tools, v1, webhooks, admin, setup, workflows)
│   │           ├── admin/             # Admin console UI (IDP, AI Models, Settings)
│   │           └── workflows/         # Workflow designer pages
│   │
│   └── api/                   # Fastify 5 backend
│       └── src/
│           ├── plugins/       # auth, cors, error-handler, helmet, mastra, oracle, rate-limit, rbac, request-logger
│           ├── routes/        # activity, audit, auth, chat, graph, health, mcp, metrics, models, openapi, schemas, search, sessions, setup, tools/, tools, webhooks, workflows
│           ├── mastra/        # Mastra framework integration
│           │   ├── agents/          # CloudAdvisor agent
│           │   ├── models/          # Provider registry, model types
│           │   ├── rag/             # OracleVectorStore, OCI embedder
│           │   ├── mcp/             # MCP server (tool discovery + execution)
│           │   ├── storage/         # OracleStore (MastraStorage impl)
│           │   ├── tools/           # 60+ OCI tool wrappers for Mastra
│           │   └── workflows/       # Workflow executor
│           └── services/      # approvals, tools adapter, workflow-repository
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
                ├── agent-state/     # SQLite-based agent state management
                ├── auth/            # auth-factory, Better Auth, RBAC, IDCS provisioning, API keys
                ├── mcp/             # MCP portal server
                ├── mcp-client/      # MCP client with stdio/SSE transports
                ├── oracle/          # migrations/, connection pool, repositories
                ├── logger.ts        # Pino logger factory
                ├── metrics.ts       # Prometheus metrics
                ├── crypto.ts        # AES-256-GCM encryption utilities
                ├── feature-flags.ts # Feature flag evaluation
                ├── approvals.ts     # Approval token management
                └── embeddings.ts    # OCI GenAI embedding helpers
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

## Writing Style

For content writing tasks (LinkedIn posts, docs, communications): Use a direct, practical, humble tone. Avoid superlatives, self-congratulatory language, and AI-sounding polish. Write like a senior engineer talking to peers, not a marketing team. When in doubt, understate rather than overstate.

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

## Infrastructure & Automations

> Full Docker, nginx, TLS, feature flags, observability, hooks, skills, MCP servers, and agent team protocol in `.claude/reference/infrastructure.md`

---

Last updated: February 9, 2026
