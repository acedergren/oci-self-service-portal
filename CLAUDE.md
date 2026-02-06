# OCI Self-Service Portal - Claude Code Context

Last Updated: February 6, 2026

## Project Overview

Production-ready SvelteKit chat application with OCI Generative AI, tool calling, RBAC, and Oracle Database integration.

**Repository:** https://github.com/acedergren/oci-self-service-portal
**License:** MIT
**Node:** 18+
**Package Manager:** pnpm 8+

## Technology Stack

### Frontend
- **SvelteKit** 2.50+ (Svelte 5 runes mode)
- **Vercel AI SDK** 6.0+ (`ai`, `@ai-sdk/svelte`)
- **shadcn-svelte** (bits-ui@next for Svelte 5)
- **TailwindCSS** 4.1+ (with @tailwindcss/vite plugin)
- **TanStack Query** (svelte-query)
- **svelte-sonner** (toast notifications)

### Backend
- **SvelteKit API Routes** (+server.ts)
- **@sveltejs/adapter-node** (Docker/OCI deployment)
- **Better Auth** 1.4+ (OIDC with OCI IAM)
- **Oracle Database 26AI** (via oracledb node package)
- **pino** (structured logging)

### Tools & CLI
- **OCI CLI** (60+ wrapped tools)
- **@acedergren/oci-genai-provider** (npm package, v0.1.0+)
- **Zod** (schema validation)

### Testing & Quality
- **Vitest** (unit + integration tests)
- **ESLint** 9+ (flat config)
- **Prettier** (code formatting)
- **svelte-check** (TypeScript + Svelte validation)

## Architecture

### Directory Structure

```
src/
├── hooks.server.ts                  # Auth, rate limiting, tracing, CSP
├── lib/
│   ├── components/
│   │   ├── portal/                  # 17 decomposed components (Phase 5)
│   │   ├── ui/                      # shadcn-svelte primitives
│   │   └── UserMenu.svelte
│   ├── server/
│   │   ├── auth/                    # Better Auth + RBAC (Phase 3)
│   │   ├── oracle/                  # ADB 26AI repositories (Phase 2)
│   │   ├── agent-state/             # Inlined workspace package
│   │   ├── mcp-client/              # Inlined workspace package
│   │   ├── rate-limiter.ts          # DB-backed, atomic (Phase 4)
│   │   ├── tracing.ts               # Request IDs (Phase 4)
│   │   ├── approvals.ts             # Single-use tokens (Phase 4)
│   │   ├── audit.ts                 # Audit logging
│   │   ├── session.ts               # Session CRUD
│   │   └── db.ts                    # Oracle connection pool
│   ├── tools/
│   │   ├── registry.ts              # Slim orchestrator (Phase 4)
│   │   └── categories/              # 11 tool category modules
│   ├── pricing/                     # Cloud pricing comparison
│   ├── terraform/                   # HCL code generator
│   ├── workflows/                   # Multi-step templates
│   ├── query/                       # Inlined oci-genai-query package
│   └── utils/
└── routes/
    ├── +page.svelte                 # Main chat UI (212 lines, Phase 5)
    ├── +layout.svelte               # Root layout
    ├── +layout.server.ts            # Auth session loading
    ├── api/
    │   ├── chat/+server.ts          # Streaming chat with tools
    │   ├── sessions/+server.ts      # Session CRUD
    │   ├── activity/+server.ts      # Tool execution logs (Phase 5)
    │   ├── tools/
    │   │   ├── approve/+server.ts   # Approval token recording
    │   │   └── execute/+server.ts   # Tool execution
    │   ├── auth/[...all]/+server.ts # Better Auth handler
    │   └── health/+server.ts        # Health check
    ├── login/+page.svelte           # Login page
    └── self-service/+page.svelte    # Self-service portal
```

### Key Patterns

#### Response Slimming
```typescript
// OCI CLI output is verbose; slim it before returning to AI
slimOCIResponse(data, pickFields)
```

#### OCI CLI Flags
- **Never combine `--all` and `--limit`** (Zod defaults always send both)
- Use pagination for large result sets

#### Namespace Auto-Fetch
- Bucket tools auto-fetch namespace via `oci os ns get`

#### Oracle Fallback Chain
All services support graceful degradation:
1. Oracle ADB 26AI (primary)
2. SQLite (development)
3. JSONL/in-memory (no DB)

#### Better Auth Build
- Requires `BETTER_AUTH_SECRET` env var
- Fallback string for builds (logs warning in production)

#### Oracle UPPERCASE Keys
- `OUT_FORMAT_OBJECT` returns UPPERCASE
- Use `fromOracleRow()` helper for camelCase conversion

#### Export for Testability
- Export helpers (`toSnakeCase`, `toCamelCase`, etc.)
- QA tests import directly

#### DB Rate Limiting (Phase 4)
- `MERGE INTO` for atomic upsert
- Fail-open on DB errors
- Per-user + per-IP tracking

#### Request Tracing (Phase 4)
- Generate `req-{uuid}` in hooks
- Propagate via `X-Request-Id` header
- Log with trace ID

#### Approval Tokens (Phase 4)
- Server-side `recordApproval()` / `consumeApproval()`
- Single-use, 5-min expiry
- Prevents client bypass

#### Tool Execution (Phase 4)
- Centralized `executeTool()` in registry
- Removed 11 duplicate executors from execute/+server.ts

#### Portal Decomposition (Phase 5)
- Bottom-up extraction (leaves first, then containers)
- State ownership: AI SDK state in +page.svelte, components are pure
- 17 components, 212-line orchestrator

#### shadcn-svelte (Phase 5)
- bits-ui@next for Svelte 5 compatibility
- `cn()` helper in `src/lib/utils/cn.ts`
- svelte-sonner for toasts

#### Notification Helpers (Phase 5)
- Domain-specific: `notifyToolSuccess()`, `notifyToolError()`, `notifyRateLimit()`
- Not generic notification API

## Security Posture

### Fixed Issues (Phase 4 + 5)
- **C1:** Auth secret fallback + runtime warning
- **H1:** Auth errors → 503/redirect, no default permissions
- **H2:** Sessions filtered by `userId` (IDOR fix)
- **H3:** Server-side approval tokens (client bypass fix)
- **H4/H5:** Rate limiter TOCTOU fixed (atomic MERGE INTO)
- **M6:** `switchToSession()` requires `userId`, verifies ownership
- **M7:** Session POST passes `userId` to `create()`
- **M3-M5 partial:** LIKE escaping in session search

### Known Issues (Deferred)
- **M1:** Column injection in oracle-adapter (future: parameterized queries)
- **M2:** CSP `unsafe-inline` (future: nonce-based CSP)
- **Navigation:** "AI Chat" link goes to "/" instead of opening dialog

## Development Workflow

### Prerequisites
- OCI CLI configured (`~/.oci/config`)
- Oracle Database 26AI (optional, falls back to SQLite)
- Node 18+, pnpm 8+

### Quick Start
```bash
pnpm install
cp .env.example .env
# Edit .env (see Configuration section)
pnpm dev  # Port 5173 (or 5175 if occupied)
```

### Configuration
Required env vars:
```bash
OCI_COMPARTMENT_ID=ocid1.compartment.oc1..xxxxx
OCI_REGION=us-chicago-1
BETTER_AUTH_SECRET=<openssl rand -base64 32>
OCI_IAM_CLIENT_ID=<oidc-client-id>
OCI_IAM_CLIENT_SECRET=<oidc-client-secret>
```

Optional (Oracle DB):
```bash
ORACLE_USER=ADMIN
ORACLE_PASSWORD=<from-vault>
ORACLE_CONNECT_STRING=adb_high
ORACLE_WALLET_LOCATION=/path/to/wallet
ORACLE_WALLET_PASSWORD=<from-vault>
```

### Testing
```bash
pnpm test           # Run all tests (289 total)
pnpm test:watch     # Watch mode
pnpm check          # svelte-check
pnpm lint           # ESLint
pnpm format         # Prettier
```

### Phase Validation
After changes, validate:
```bash
pnpm lint && pnpm check && pnpm build && pnpm test
```

### Lint Baseline
- 20 pre-existing ESLint errors (self-service/_page.svelte, demo-runner.ts)
- ~39 warnings (unused vars in tests, event_directive_deprecated)
- svelte-check errors from TDD imports of future-phase modules (expected)

## Upgrade Plan Progress

See `docs/ROADMAP.md` for full status.

- ✅ **Phase 1:** Foundation (adapter-node, Docker, ESLint/Prettier, CI, health endpoint)
- ✅ **Phase 2:** Oracle ADB 26AI (connection pool, migrations, repositories, fallbacks)
- ✅ **Phase 3:** Better Auth + OIDC + RBAC (3 roles, 10 permissions, 52 tests)
- ✅ **Phase 4:** Security hardening (rate limiting, tracing, approval tokens, 4 fixes, 26 tests)
- ✅ **Phase 5:** Portal decomposition (17 components, shadcn-svelte, 78 tests, 289 total)
- 🚧 **Phase 6:** Observability (OpenTelemetry, metrics, logs, traces)
- 📋 **Phase 7:** Performance (caching, query optimization, CDN)
- 📋 **Phase 8:** Advanced features (file uploads, embeddings, RAG, vector search)

## External Dependencies

### npm Packages
- `@acedergren/oci-genai-provider@^0.1.0` - OCI GenAI provider for AI SDK

### OCI Services
- **Generative AI** (inference.generativeai.*.oci.oraclecloud.com)
- **Oracle Autonomous Database 26AI** (optional)
- **OCI Vault** (secret storage for prod deployments)
- **OCI IAM Identity Domains** (OIDC auth provider)

## Common Tasks

### Adding a New Tool
1. Create tool definition in `src/lib/tools/categories/<category>.ts`
2. Export from category index
3. Add to registry orchestrator in `src/lib/tools/registry.ts`
4. Write tests in `src/tests/tools/<tool-name>.test.ts`

### Adding a New Component
1. Create in `src/lib/components/portal/<ComponentName>.svelte`
2. Follow Svelte 5 runes pattern (`$state`, `$derived`, `$props`)
3. Use shadcn-svelte UI primitives from `src/lib/components/ui/`
4. Write tests in `src/tests/phase5/<component-name>.test.ts`

### Updating Database Schema
1. Create migration in `src/lib/server/oracle/migrations/`
2. Update repository in `src/lib/server/oracle/repositories/`
3. Test both Oracle and SQLite fallback
4. Update tests

### Adding a New Permission
1. Add to `src/lib/server/auth/rbac.ts` permissions enum
2. Update role mappings
3. Add guards to relevant API routes
4. Write tests for permission checks

## Troubleshooting

### Dev Server Port Conflicts
Default port 5173; falls back to 5175 if occupied.

### Oracle Connection Issues
Check:
1. Wallet location (`ORACLE_WALLET_LOCATION`)
2. Wallet password (`ORACLE_WALLET_PASSWORD`)
3. Connect string (`ORACLE_CONNECT_STRING`)
4. Network access to database

Falls back to SQLite if unavailable.

### Build Failures
Most common:
1. Missing `BETTER_AUTH_SECRET` - set to any string for builds
2. Type errors - run `pnpm check` for details
3. Import errors - check for workspace package references

### Test Failures
Phase-specific tests may fail if:
1. Importing future-phase modules (TDD pattern, expected)
2. Missing env vars (tests use fallbacks)
3. Oracle DB not available (tests skip DB-dependent tests)

## Additional Resources

- [Vercel AI SDK Docs](https://sdk.vercel.ai/docs)
- [SvelteKit Docs](https://kit.svelte.dev/docs)
- [Better Auth Docs](https://www.better-auth.com/docs)
- [OCI GenAI Docs](https://docs.oracle.com/en-us/iaas/Content/generative-ai/home.htm)
- [Oracle Database 26AI Docs](https://docs.oracle.com/en/database/oracle/oracle-database/26/)
- [shadcn-svelte](https://www.shadcn-svelte.com/)

---

**Note to Claude:** This project follows a multi-phase upgrade plan. Always check `docs/ROADMAP.md` for current status and phase-specific patterns in this document.
