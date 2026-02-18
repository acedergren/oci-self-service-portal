# Infrastructure & DevOps Reference

## Docker Compose (Phase 9)

- **Location**: `infrastructure/docker/phase9/`
- **Services**: nginx (TLS termination) + api (Fastify) + frontend (SvelteKit) + certbot (optional Let's Encrypt)
- **Network**: All services on `portal-network` bridge; only nginx exposes host ports (80/443)
- **API/Frontend are internal-only**: Use `expose:` not `ports:` — only reachable via nginx reverse proxy
- **Build context**: `../../..` (monorepo root) because Dockerfiles need `packages/shared/` as sibling

## Container Hardening

- All containers: `read_only: true`, `no-new-privileges: true`, `tmpfs` for writable dirs
- nginx: `tmpfs` for `/var/cache/nginx`, `/var/run`, `/tmp` with size limits
- Resource limits: Configurable via `.env` (`API_MEMORY_LIMIT`, `API_CPU_LIMIT`, `FRONTEND_MEMORY_LIMIT`, `FRONTEND_CPU_LIMIT`)
- Health checks: nginx via `wget --spider`, api/frontend via `curl -f` to `/health` endpoints

## TLS / Certificates

- **Single variable**: `TLS_CERTS_DIR` (default `./certs`) points to directory containing `fullchain.pem`, `privkey.pem`, `dhparam.pem`
- **DH params required**: Generate with `openssl dhparam -out certs/dhparam.pem 2048` (takes ~30s)
- **Self-signed dev cert**: `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout certs/privkey.pem -out certs/fullchain.pem -subj "/CN=localhost"`
- **Let's Encrypt**: Enable certbot profile with `docker compose --profile letsencrypt up -d`
- See `infrastructure/docker/phase9/CERTIFICATES.md` for full guide

## Nginx Configuration

- **Proxy directive order**: Every `location` block follows: `proxy_pass` → `proxy_http_version` → `Connection` → `Host` → forwarding headers → `Upgrade ""` → timeouts → location-specific
- **H2C smuggling prevention**: All locations set `proxy_set_header Upgrade ""` to block Upgrade header
- **Health endpoints**: Both HTTP `/nginx-health` and HTTPS `/health` have `access_log off` to suppress noise
- **Security headers**: Defined once at `server` level (not per-location) to avoid nginx header-redefinition behavior
- **Rate limiting**: nginx `limit_req` as defence-in-depth alongside Fastify `@fastify/rate-limit`
- **SSE/streaming**: `proxy_buffering off` + `X-Accel-Buffering no` + `proxy_cache off` on `/api/` for AI chat streaming

## Feature Flag Migration

- **SvelteKit proxy**: `FASTIFY_ENABLED=true` in SvelteKit hooks causes `/api/*` to proxy to Fastify backend
- **Selective routing**: `FASTIFY_PROXY_ROUTES=/api/health,/api/sessions,/api/v1/` proxies only listed prefixes
- **Auth excluded**: `/api/auth/*` is NEVER proxied (Better Auth OIDC callbacks require SvelteKit cookie handling)
- **Proxy placement**: After request tracing, BEFORE auth/DB init (Fastify handles its own middleware)
- **Request ID forwarding**: `X-Request-Id` header propagated to Fastify for distributed trace correlation
- **502 fallback**: Returns `{"error": "Backend unavailable"}` when Fastify is unreachable

## Git Hooks

- **Location**: `.githooks/` directory, auto-installed via `prepare` script in package.json
- **Install**: `git config core.hooksPath .githooks` (runs automatically on `pnpm install`)
- **Pre-commit**: ESLint + type check + Prettier, scoped to changed workspaces only
- **Pre-push**: Semgrep, CodeQL, Trufflehog (secrets), Spectral+OWASP (API lint), Cherrybomb (API security), tests, CodeRabbit
- **Skip**: `git push --no-verify` for emergencies only
- **Required tools**: semgrep (`brew install semgrep`), codeql (`brew install codeql`), trufflehog (`brew install trufflehog`)
- **OpenAPI export**: Spectral and Cherrybomb need `npx tsx apps/api/scripts/export-openapi.ts` to generate spec from Fastify swagger

## Observability

- **Logger**: Pino via `createLogger(module)` with custom serializers, redacts auth/cookie headers
- **Metrics**: Custom Prometheus registry at `/api/metrics`
- **Sentry**: Dynamic import, no-op when DSN missing
- **Health**: `/healthz` liveness probe (plain text "ok") + `/health` deep check with 3s `Promise.race` timeout
- **Tracing**: `X-Request-Id` header propagation

## Claude Code Automations

### Hooks (`.claude/settings.json`)

**PreToolUse — Bash matcher (blockers)**:

- **Pre-commit**: Lint staged files + typecheck — blocks on failure
- **Pre-push**: Semgrep security scan — blocks on findings
- **Block bulk staging**: Rejects `git add -A` / `git add .`
- **Doc drift warning**: On push, warns if architecture/security/migration files changed without doc updates

**PreToolUse — Edit|Write matcher (blockers)**:

- **Sensitive file blocker**: Blocks edits to `.env`, `.pem/.key`, wallet, credential files
- **Migration validator**: Validates `NNN-name.sql` pattern, warns on version gaps

**PostToolUse — Edit|Write matcher (auto-fixers)**:

- **Prettier**: Runs `prettier --write` after edits
- **ESLint fix**: Runs `eslint --fix` on `.ts`/`.svelte`
- **Related tests**: Finds and runs matching `.test.ts` file (60s timeout)
- **Circular deps**: Runs `madge --circular` on edited `.ts` files (warning only)

### Skills (`.claude/skills/`)

- `/manage-secrets <name> <value>` — Full OCI Vault CRUD
- `/oracle-migration <name> - <description>` — Scaffold Oracle migration
- `/phase-kickoff <N> - <title>` — Create branch, test shells, roadmap entry
- `/doc-sync [audit|fix]` — Audit/fix doc drift
- `/quality-commit [--review]` — Full quality gate pipeline: lint + typecheck + Semgrep + tests + commit
- `/linkedin-post` — Draft, humanize, preview, and publish LinkedIn posts via the LinkedIn API
- `/health-check` — Full codebase diagnostic: 15 gates including typecheck, tests, Semgrep, CodeQL, Trufflehog, Spectral, Cherrybomb, nodejsscan, madge, knip, pnpm audit, publint, attw (headless)
- `/security-fuzz` — CATS DAST fuzzer against running Fastify API (requires live server)
- `/oc-execute <plan-file>` — Orchestrator: reads plan, routes tasks to `/oc-*` workers, executes in batches with checkpoints
- `/oc-quality` — Delegate quality gates (tsc, lint, tests) to OpenCode on free models (default: Grok Code Fast)
- `/oc-review` — Delegate code review to OpenCode on free models (default: Grok Code Fast)
- `/oc-test-gen` — Delegate test generation to OpenCode on free models (default: Grok Code Fast)
- `/oc-refactor` — Delegate refactoring to OpenCode on free models (default: Grok Code Fast)
- All `/oc-*` skills support `--opus`, `--sonnet`, `--haiku`, `--codex` for model escalation via GitHub Copilot

### Subagents (`.claude/agents/`)

- `security-reviewer` (Opus) — OWASP Top 10 + project-specific security review
- `oracle-query-reviewer` (Opus) — Oracle-specific SQL pitfalls and patterns

### MCP Servers

**Claude.ai plugins** (configured in Claude.ai settings):

- `sentry` — Investigate production errors
- `serena` — Semantic code intelligence (symbol-level navigation, refactoring)
- `context7` — Up-to-date library documentation lookups
- `oci-api` — OCI CLI command execution (get help, run commands)
- `oci-monitoring` — Read-only monitoring: logs, metrics, alarms
- `oci-database` — Oracle DB operations (list, get, create, manage PDBs)
- `oci-compute` — Compute instance management
- `oci-networking` — VCN, subnet, security list operations
- `oci-identity` — Tenancy, compartments, auth tokens
- `deepwiki` — AI-powered documentation for GitHub repositories
- `svelte` — Official Svelte MCP for docs, examples, code fixes

**Local servers** (`~/.claude/mcp.json`):

- `oracle-db-doc` — Oracle database documentation MCP server

### Agent Team Protocol

Agent teams follow the global protocol defined in `~/.claude/CLAUDE.md`:

- **Model selection**: Sonnet for implementation, Opus for architecture/security, Haiku for docs/QA
- **Commit discipline**: Stage specific files, commit after each logical unit, `type(scope): description` format
- **Quality gates per commit**: Type check → lint → tests → Semgrep (security changes)
- **Multi-agent rules**: Acknowledge before starting, no scope expansion, commit before reporting done, stop on shutdown
- **Tool preferences**: `context7` for docs, `oci-api` MCP before raw CLI, `serena` for symbolic navigation
