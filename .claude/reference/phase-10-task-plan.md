# Phase 10 — Agent Task Plan

> **Companion to**: `.claude/reference/PRD.md` (v6)
> **Created**: 2026-02-10
> **Total Tasks**: 107 (32 Haiku + 75 Sonnet)
> **Estimated Duration**: ~68 hours of agent work

---

## Design Principles

1. **Maximize autonomy**: Each agent gets a self-contained task with clear inputs/outputs
2. **Minimize cross-agent dependencies**: Tasks within a wave should not require agent-to-agent communication
3. **Role-appropriate sizing**: Haiku for mechanical work (15-30 min), Sonnet for judgment calls (30-60 min)
4. **Atomic commits**: Every task produces exactly one commit
5. **Verification gates**: Each wave completes with a passing test suite before the next wave starts

## Task Breakdown Legend

| Field        | Description                                                      |
| ------------ | ---------------------------------------------------------------- |
| **ID**       | `{Phase}-{Wave}.{Seq}` e.g., `A-1.01` = Phase A, Wave 1, Task 01 |
| **Agent**    | `haiku` or `sonnet`                                              |
| **Duration** | 15-30 min (haiku) or 30-60 min (sonnet)                          |
| **Depends**  | Task IDs that must complete first                                |
| **Files**    | Key files created or modified                                    |
| **Verify**   | Command or check to confirm completion                           |

## Phase Dependency DAG

```
A (foundation) ─────► B (split) ────► C (fastify-first) ────► Post-migration
     │                    │                                         ▲
     │                    └──────────► E (workflows) ───────────────┘
     │                                                              ▲
     ├──────────────────► D (oci-sdk) ──────────────────────────────┘
     │                                                              ▲
     └──────────────────► F (oracle) ───────────────────────────────┘
```

**Key insight**: Phases D and F can run in parallel with B/C/E, requiring only Phase A completion.

---

## Phase A: Dependency Updates + Fastify Hardening

**Team**: "foundation" (5-7 agents, 3 waves)
**Total**: 22 tasks, ~13 hours

### Wave A1 — Dependency Installation (all parallel, all haiku)

| ID     | Title                                            | Agent | Duration | Depends | Files                                                   | Verify                       |
| ------ | ------------------------------------------------ | ----- | -------- | ------- | ------------------------------------------------------- | ---------------------------- |
| A-1.01 | Update patch/minor runtime deps                  | haiku | 20 min   | —       | `package.json` (root, api, frontend)                    | `pnpm install && pnpm build` |
| A-1.02 | Add oci-sdk and @modelcontextprotocol/sdk        | haiku | 15 min   | —       | `packages/shared/package.json`                          | `pnpm install`               |
| A-1.03 | Add P0 Fastify plugins                           | haiku | 15 min   | —       | `apps/api/package.json`                                 | `pnpm install`               |
| A-1.04 | Add Mastra packages + iovalkey                   | haiku | 15 min   | —       | `apps/api/package.json`                                 | `pnpm install`               |
| A-1.05 | Remove @types/dompurify + run syncpack           | haiku | 15 min   | A-1.01  | `apps/frontend/package.json`, root                      | `npx syncpack lint`          |
| A-1.06 | Add rate-limiter-flexible + zod-validation-error | haiku | 15 min   | —       | `apps/api/package.json`, `packages/shared/package.json` | `pnpm install`               |

**Gate**: `pnpm install && pnpm build` passes

### Wave A2 — Plugin Configuration & Integration (parallel, mixed)

| ID     | Title                                                          | Agent  | Duration | Depends        | Files                                                                         | Verify                         |
| ------ | -------------------------------------------------------------- | ------ | -------- | -------------- | ----------------------------------------------------------------------------- | ------------------------------ |
| A-2.01 | Register @fastify/otel first in plugin chain                   | sonnet | 45 min   | A-1.03         | `apps/api/src/app.ts`, `apps/api/src/plugins/otel.ts` (new)                   | `npx tsc --noEmit` in apps/api |
| A-2.02 | Configure @fastify/under-pressure thresholds                   | sonnet | 30 min   | A-1.03         | `apps/api/src/app.ts`                                                         | Tests pass, 503 on overload    |
| A-2.03 | Wire fastify-graceful-shutdown with Pino + Oracle drain        | sonnet | 45 min   | A-1.03         | `apps/api/src/app.ts`, `apps/api/src/plugins/oracle.ts`                       | Graceful shutdown test         |
| A-2.04 | Create Valkey cache module                                     | sonnet | 60 min   | A-1.04         | `apps/api/src/plugins/cache.ts` (new), `apps/api/src/services/cache.ts` (new) | Cache hit/miss test            |
| A-2.05 | Replace @fastify/swagger-ui with @scalar/fastify-api-reference | sonnet | 30 min   | A-1.03         | `apps/api/src/app.ts`, `apps/api/package.json`                                | `/api/docs` renders Scalar UI  |
| A-2.06 | Configure @mastra/sentry SentryExporter                        | sonnet | 45 min   | A-1.04         | `apps/api/src/plugins/mastra.ts`                                              | Sentry receives AI spans       |
| A-2.07 | Configure @mastra/evals scorers on CloudAdvisor                | sonnet | 30 min   | A-1.04         | `apps/api/src/mastra/agents/cloud-advisor.ts`                                 | Scorer config present          |
| A-2.08 | Replace zodToJsonSchema() with z.toJSONSchema()                | sonnet | 30 min   | A-1.01         | `packages/shared/src/server/mcp/portal-mcp-server.ts`                         | `npx tsc --noEmit`             |
| A-2.09 | Deprecate custom MCPClient/MCPManager                          | sonnet | 30 min   | —              | `packages/shared/src/server/mcp-client/` (deprecation notices)                | README updated                 |
| A-2.10 | Migrate agent_state SQLite → Oracle (OracleStore)              | sonnet | 60 min   | A-1.02, A-1.04 | `packages/shared/src/server/agent-state/oracle-store.ts` (new), migration SQL | Tests pass                     |
| A-2.11 | Add knip to CI pipeline                                        | haiku  | 15 min   | —              | `.github/workflows/ci.yml`                                                    | `npx knip` runs in CI          |
| A-2.12 | Configure rate-limiter-flexible with Oracle adapter            | sonnet | 45 min   | A-1.06         | `apps/api/src/plugins/rate-limit.ts`                                          | Rate limit tests pass          |

**Gate**: Full test suite passes, `pnpm outdated` clean

### Wave A3 — Observability & Final (sequential after A2)

| ID     | Title                                        | Agent  | Duration | Depends                | Files                                       | Verify                                            |
| ------ | -------------------------------------------- | ------ | -------- | ---------------------- | ------------------------------------------- | ------------------------------------------------- |
| A-3.01 | Set up Grafana + Tempo docker-compose config | sonnet | 45 min   | A-2.01                 | `docker-compose.yml`, `grafana/` config dir | `docker compose up` shows Grafana                 |
| A-3.02 | Configure @fastify/schedule with basic cron  | haiku  | 20 min   | A-1.03                 | `apps/api/src/plugins/schedule.ts` (new)    | Plugin loads without error                        |
| A-3.03 | Write tests for new Fastify plugins          | haiku  | 30 min   | A-2.01, A-2.02, A-2.03 | `apps/api/src/tests/plugins/`               | `npx vitest run apps/api`                         |
| A-3.04 | Run full quality gate                        | haiku  | 15 min   | all A-\*               | —                                           | `npx vitest run && pnpm lint && npx tsc --noEmit` |

**Gate**: Full test suite + type check passes

---

## Phase B: Package Split + Frontend Libraries

**Team**: "package-split" (6-8 agents, 3 waves)
**Total**: 27 tasks, ~17 hours

### Wave B1 — Package Scaffolding (sequential, Sonnet-critical)

| ID     | Title                                             | Agent  | Duration | Depends          | Files                                                 | Verify                                |
| ------ | ------------------------------------------------- | ------ | -------- | ---------------- | ----------------------------------------------------- | ------------------------------------- |
| B-1.01 | Create @portal/types package scaffold             | sonnet | 60 min   | Phase A complete | `packages/types/` (package.json, tsconfig, src/)      | `pnpm build --filter @portal/types`   |
| B-1.02 | Extract Zod schemas + TS types into @portal/types | sonnet | 60 min   | B-1.01           | `packages/types/src/`, `packages/shared/src/`         | `npx tsc --noEmit` in packages/types  |
| B-1.03 | Extract error hierarchy into @portal/types        | sonnet | 30 min   | B-1.02           | `packages/types/src/errors.ts`                        | Import from @portal/types works       |
| B-1.04 | Create @portal/server package scaffold            | sonnet | 60 min   | B-1.03           | `packages/server/` (package.json, tsconfig, src/)     | `pnpm build --filter @portal/server`  |
| B-1.05 | Extract server modules into @portal/server        | sonnet | 60 min   | B-1.04           | `packages/server/src/`, `packages/shared/src/server/` | `npx tsc --noEmit` in packages/server |
| B-1.06 | Create @portal/ui package scaffold                | sonnet | 30 min   | B-1.03           | `packages/ui/` (package.json, tsconfig, src/)         | Package builds                        |
| B-1.07 | Update pnpm-workspace.yaml + turbo.json           | haiku  | 15 min   | B-1.06           | `pnpm-workspace.yaml`, `turbo.json`                   | `pnpm install` resolves               |

### Wave B2 — Import Rewriting (parallel, Sonnet)

| ID     | Title                                              | Agent  | Duration | Depends                | Files                                                    | Verify                         |
| ------ | -------------------------------------------------- | ------ | -------- | ---------------------- | -------------------------------------------------------- | ------------------------------ |
| B-2.01 | Rewrite apps/api imports → @portal/{types,server}  | sonnet | 60 min   | B-1.07                 | `apps/api/src/**/*.ts`                                   | `npx tsc --noEmit` in apps/api |
| B-2.02 | Rewrite apps/frontend imports → @portal/{types,ui} | sonnet | 60 min   | B-1.07                 | `apps/frontend/src/**/*.{ts,svelte}`                     | `npx svelte-check`             |
| B-2.03 | Rewrite cross-package internal imports             | sonnet | 30 min   | B-1.07                 | `packages/server/src/**/*.ts`, `packages/ui/src/**/*.ts` | All packages build             |
| B-2.04 | Verify circular dependency free                    | haiku  | 15 min   | B-2.01, B-2.02, B-2.03 | —                                                        | `npx madge --circular` clean   |
| B-2.05 | Run full test suite after import rewrite           | haiku  | 15 min   | B-2.04                 | —                                                        | `npx vitest run` all pass      |

**Gate**: `pnpm build` + full test suite passes across all workspaces

### Wave B3 — Frontend Libraries + GenUI (parallel, mixed)

| ID     | Title                                                | Agent  | Duration | Depends    | Files                                        | Verify                       |
| ------ | ---------------------------------------------------- | ------ | -------- | ---------- | -------------------------------------------- | ---------------------------- |
| B-3.01 | Install sveltekit-superforms + formsnap              | haiku  | 15 min   | B-2.05     | `apps/frontend/package.json`                 | `pnpm install`               |
| B-3.02 | Install layerchart                                   | haiku  | 15 min   | B-2.05     | `apps/frontend/package.json`                 | `pnpm install`               |
| B-3.03 | Install fuse.js                                      | haiku  | 15 min   | B-2.05     | `apps/frontend/package.json`                 | `pnpm install`               |
| B-3.04 | Install @tanstack/table-core                         | haiku  | 15 min   | B-2.05     | `apps/frontend/package.json`                 | `pnpm install`               |
| B-3.05 | Install paneforge + svelte-dnd-action + auto-animate | haiku  | 15 min   | B-2.05     | `apps/frontend/package.json`                 | `pnpm install`               |
| B-3.06 | Build InstanceTable + ResourceList GenUI components  | sonnet | 60 min   | B-3.01     | `apps/frontend/src/lib/components/genui/`    | Components render            |
| B-3.07 | Build CostChart + MetricsChart GenUI components      | sonnet | 60 min   | B-3.02     | `apps/frontend/src/lib/components/genui/`    | Charts render with mock data |
| B-3.08 | Build TerraformViewer + BucketGrid GenUI components  | sonnet | 60 min   | B-2.05     | `apps/frontend/src/lib/components/genui/`    | Components render            |
| B-3.09 | Build AlarmPanel + ApprovalCard GenUI components     | sonnet | 60 min   | B-3.01     | `apps/frontend/src/lib/components/genui/`    | Components render            |
| B-3.10 | Migrate admin forms to Superforms                    | sonnet | 60 min   | B-3.01     | `apps/frontend/src/routes/admin/**/*.svelte` | Forms validate correctly     |
| B-3.11 | Add fuzzy search to tool palette + MCP catalog       | sonnet | 30 min   | B-3.03     | `apps/frontend/src/lib/components/`          | Search filters work          |
| B-3.12 | Adopt createAIContext() for shared Chat state        | sonnet | 45 min   | B-2.05     | `apps/frontend/src/lib/components/chat/`     | Chat state shared correctly  |
| B-3.13 | Add streaming data parts for tool progress           | sonnet | 45 min   | B-3.12     | `apps/frontend/src/lib/components/chat/`     | Real-time progress visible   |
| B-3.14 | Write component tests for GenUI components           | haiku  | 30 min   | B-3.06-09  | `apps/frontend/src/tests/`                   | Tests pass                   |
| B-3.15 | Run full quality gate                                | haiku  | 15 min   | all B-3.\* | —                                            | Full test suite + type check |

**Gate**: `madge --circular` clean, full test suite + type check passes

---

## Phase C: Fastify-First Migration + Mastra Studio

**Team**: "fastify-first" (5-6 agents, 3 waves)
**Total**: 19 tasks, ~13 hours

### Wave C1 — Auth Migration (sequential, critical path)

| ID     | Title                                                  | Agent  | Duration | Depends          | Files                                                               | Verify                     |
| ------ | ------------------------------------------------------ | ------ | -------- | ---------------- | ------------------------------------------------------------------- | -------------------------- |
| C-1.01 | Implement Better Auth catch-all route in Fastify       | sonnet | 60 min   | Phase B complete | `apps/api/src/routes/auth.ts` (new), `apps/api/src/plugins/auth.ts` | Auth routes respond        |
| C-1.02 | Configure trustedOrigins + CORS for cross-origin       | sonnet | 30 min   | C-1.01           | `apps/api/src/plugins/auth.ts`, `apps/api/src/app.ts`               | Cross-origin auth works    |
| C-1.03 | Update SvelteKit hooks to cookie-forwarding only       | sonnet | 45 min   | C-1.01           | `apps/frontend/src/hooks.server.ts`                                 | No auth logic in SvelteKit |
| C-1.04 | Update +layout.server.ts to fetch session from Fastify | sonnet | 30 min   | C-1.03           | `apps/frontend/src/routes/+layout.server.ts`                        | SSR renders with user data |
| C-1.05 | Test OIDC flow end-to-end with OCI IDCS                | sonnet | 30 min   | C-1.04           | —                                                                   | Login/logout cycle works   |

### Wave C2 — Route Migration (parallel by group, all Sonnet)

| ID     | Title                               | Agent  | Duration | Depends | Files                                                   | Verify              |
| ------ | ----------------------------------- | ------ | -------- | ------- | ------------------------------------------------------- | ------------------- |
| C-2.01 | Migrate 3 auth/session routes       | sonnet | 45 min   | C-1.05  | `apps/api/src/routes/sessions.ts`, delete 3 +server.ts  | Route tests pass    |
| C-2.02 | Migrate 6 chat/AI routes            | sonnet | 60 min   | C-1.05  | `apps/api/src/routes/chat.ts`, delete 6 +server.ts      | Chat flow works     |
| C-2.03 | Migrate 4 tool routes               | sonnet | 45 min   | C-1.05  | `apps/api/src/routes/tools.ts`, delete 4 +server.ts     | Tool execute works  |
| C-2.04 | Migrate 5 workflow routes           | sonnet | 45 min   | C-1.05  | `apps/api/src/routes/workflows.ts`, delete 5 +server.ts | Workflow CRUD works |
| C-2.05 | Migrate 10 admin routes             | sonnet | 60 min   | C-1.05  | `apps/api/src/routes/admin/`, delete 10 +server.ts      | Admin console works |
| C-2.06 | Migrate 9 webhook/setup/misc routes | sonnet | 60 min   | C-1.05  | `apps/api/src/routes/`, delete 9 +server.ts             | Setup wizard works  |

**Gate**: All 37 routes verified, full test suite passes

### Wave C3 — Cleanup & Polish (parallel, mixed)

| ID     | Title                                                | Agent  | Duration | Depends            | Files                                                | Verify                                                 |
| ------ | ---------------------------------------------------- | ------ | -------- | ------------------ | ---------------------------------------------------- | ------------------------------------------------------ |
| C-3.01 | Configure @fastify/sse for streaming endpoints       | sonnet | 30 min   | C-2.02             | `apps/api/src/routes/chat.ts`, `apps/api/src/app.ts` | SSE streams work                                       |
| C-3.02 | Configure @fastify/compress (gzip + brotli)          | haiku  | 20 min   | Phase C-2 complete | `apps/api/src/app.ts`                                | Response compression active                            |
| C-3.03 | Configure Mastra Studio at /admin/studio with RBAC   | sonnet | 45 min   | C-2.05             | `apps/api/src/plugins/mastra.ts`                     | Studio accessible to admins                            |
| C-3.04 | Add AWS + Azure MCP servers to catalog               | sonnet | 30 min   | C-2.05             | `apps/api/src/routes/admin/mcp.ts`, seed data        | Catalog shows AWS/Azure                                |
| C-3.05 | Remove feature flags + proxy middleware              | haiku  | 20 min   | C-2.06             | `apps/frontend/src/hooks.server.ts`, env files       | No proxy code remains                                  |
| C-3.06 | Update nginx config for direct Fastify routing       | haiku  | 15 min   | C-3.05             | `nginx/nginx.conf`                                   | All /api/\* → Fastify                                  |
| C-3.07 | Write route integration tests for migrated endpoints | haiku  | 30 min   | C-2.01-06          | `apps/api/src/tests/routes/`                         | New tests pass                                         |
| C-3.08 | Verify zero +server.ts API routes remain             | haiku  | 15 min   | C-3.05             | —                                                    | `find apps/frontend -name '+server.ts'` = 0 API routes |

**Gate**: Zero +server.ts API routes remain, full test suite passes

---

## Phase D: OCI SDK Migration

**Team**: "oci-sdk" (4-5 agents, 3 waves)
**Total**: 14 tasks, ~9 hours

### Wave D1 — Foundation (sequential)

| ID     | Title                                                 | Agent  | Duration | Depends          | Files                                             | Verify                    |
| ------ | ----------------------------------------------------- | ------ | -------- | ---------------- | ------------------------------------------------- | ------------------------- |
| D-1.01 | Configure oci-sdk auth provider                       | sonnet | 45 min   | Phase A complete | `packages/shared/src/tools/sdk-auth.ts` (new)     | Auth provider initializes |
| D-1.02 | Create executor-sdk.ts adapter with OCIError wrapping | sonnet | 60 min   | D-1.01           | `packages/shared/src/tools/executor-sdk.ts` (new) | Adapter unit tests pass   |
| D-1.03 | Write adapter unit tests                              | haiku  | 30 min   | D-1.02           | `apps/api/src/tests/tools/executor-sdk.test.ts`   | Tests pass                |

### Wave D2 — Top-10 Tools by Frequency (parallel by service)

| ID     | Title                                      | Agent  | Duration | Depends | Files                                               | Verify              |
| ------ | ------------------------------------------ | ------ | -------- | ------- | --------------------------------------------------- | ------------------- |
| D-2.01 | Migrate compute tools (instances, images)  | sonnet | 60 min   | D-1.03  | `packages/shared/src/tools/categories/compute*.ts`  | SDK latency < 500ms |
| D-2.02 | Migrate networking tools (VCN, subnet, SL) | sonnet | 60 min   | D-1.03  | `packages/shared/src/tools/categories/network*.ts`  | SDK latency < 500ms |
| D-2.03 | Migrate object storage tools               | sonnet | 45 min   | D-1.03  | `packages/shared/src/tools/categories/storage*.ts`  | SDK latency < 500ms |
| D-2.04 | Migrate database/ADB tools                 | sonnet | 45 min   | D-1.03  | `packages/shared/src/tools/categories/database*.ts` | SDK latency < 500ms |
| D-2.05 | Migrate IAM/identity tools                 | sonnet | 45 min   | D-1.03  | `packages/shared/src/tools/categories/identity*.ts` | SDK latency < 500ms |

**Gate**: Benchmark latency — SDK < 500ms p95 vs CLI 2-5s

### Wave D3 — Remaining Tools + Benchmarks (parallel)

| ID     | Title                                            | Agent  | Duration | Depends   | Files                                                   | Verify                    |
| ------ | ------------------------------------------------ | ------ | -------- | --------- | ------------------------------------------------------- | ------------------------- |
| D-3.01 | Migrate monitoring/logging tools                 | sonnet | 45 min   | D-2.\*    | `packages/shared/src/tools/categories/monitoring*.ts`   | Tests pass                |
| D-3.02 | Migrate container/registry tools                 | sonnet | 30 min   | D-2.\*    | `packages/shared/src/tools/categories/container*.ts`    | Tests pass                |
| D-3.03 | Migrate load balancer tools                      | sonnet | 30 min   | D-2.\*    | `packages/shared/src/tools/categories/loadbalancer*.ts` | Tests pass                |
| D-3.04 | Migrate remaining edge-case tools (CLI fallback) | sonnet | 45 min   | D-2.\*    | `packages/shared/src/tools/categories/`                 | CLI fallback works        |
| D-3.05 | Write integration tests for all SDK tools        | haiku  | 30 min   | D-3.01-04 | `apps/api/src/tests/tools/`                             | All tool tests pass       |
| D-3.06 | Run latency benchmarks (SDK vs CLI)              | haiku  | 20 min   | D-3.05    | benchmark script                                        | p95 < 500ms for SDK tools |

**Gate**: All migrated tools pass tests, CLI fallback works for unmigrated

---

## Phase E: Workflow Designer + AI Hardening

**Team**: "workflows" (5-6 agents, 3 waves)
**Total**: 17 tasks, ~11 hours

### Wave E1 — Node Implementations (parallel, all Sonnet)

| ID     | Title                               | Agent  | Duration | Depends          | Files                                                              | Verify                   |
| ------ | ----------------------------------- | ------ | -------- | ---------------- | ------------------------------------------------------------------ | ------------------------ |
| E-1.01 | Implement ai-step node              | sonnet | 60 min   | Phase B complete | `apps/api/src/mastra/workflows/`, `packages/shared/src/workflows/` | ai-step unit tests pass  |
| E-1.02 | Implement loop node (.foreach)      | sonnet | 60 min   | Phase B complete | Same as above                                                      | Loop unit tests pass     |
| E-1.03 | Implement parallel node (.parallel) | sonnet | 60 min   | Phase B complete | Same as above                                                      | Parallel unit tests pass |

### Wave E2 — Execution Features (parallel, mixed)

| ID     | Title                                             | Agent  | Duration | Depends        | Files                                    | Verify                         |
| ------ | ------------------------------------------------- | ------ | -------- | -------------- | ---------------------------------------- | ------------------------------ |
| E-2.01 | Add retry policies (exponential backoff)          | sonnet | 45 min   | E-1.\*         | `apps/api/src/mastra/workflows/`         | Retry tests pass               |
| E-2.02 | Add compensation/saga pattern                     | sonnet | 60 min   | E-1.\*         | `apps/api/src/mastra/workflows/`         | Saga reversal tests pass       |
| E-2.03 | Add workflow streaming (writer + SSE)             | sonnet | 45 min   | E-1.\*, C-3.01 | `apps/api/src/routes/workflows.ts`       | SSE events received            |
| E-2.04 | Add lifecycle callbacks (onFinish, onError)       | sonnet | 30 min   | E-1.\*         | `apps/api/src/mastra/workflows/`         | Audit log + Sentry integration |
| E-2.05 | Add typed suspendSchema/resumeSchema              | sonnet | 30 min   | E-1.\*         | `packages/shared/src/workflows/types.ts` | Schema validation tests pass   |
| E-2.06 | Add crash recovery (restartAllActiveWorkflowRuns) | sonnet | 30 min   | E-1.\*         | `apps/api/src/mastra/workflows/`         | Recovery test passes           |
| E-2.07 | Update workflow definition Zod schemas            | haiku  | 20 min   | E-1.\*         | `packages/shared/src/workflows/types.ts` | `npx tsc --noEmit`             |

### Wave E3 — AI Hardening + Frontend (parallel, mixed)

| ID     | Title                                                    | Agent  | Duration | Depends        | Files                                         | Verify                 |
| ------ | -------------------------------------------------------- | ------ | -------- | -------------- | --------------------------------------------- | ---------------------- |
| E-3.01 | Add PromptInjectionDetector + PIIDetector + TokenLimiter | sonnet | 45 min   | E-2.\*         | `apps/api/src/mastra/agents/cloud-advisor.ts` | Guardrail tests pass   |
| E-3.02 | Configure @mastra/evals scorers (10% sampling)           | sonnet | 30 min   | A-2.07         | `apps/api/src/mastra/agents/cloud-advisor.ts` | Scorer results in DB   |
| E-3.03 | Update workflow editor for ai-step node                  | sonnet | 45 min   | E-1.01         | `apps/frontend/src/lib/components/workflow/`  | Node renders in editor |
| E-3.04 | Update workflow editor for loop node                     | sonnet | 45 min   | E-1.02         | `apps/frontend/src/lib/components/workflow/`  | Node renders in editor |
| E-3.05 | Update workflow editor for parallel node                 | sonnet | 45 min   | E-1.03         | `apps/frontend/src/lib/components/workflow/`  | Node renders in editor |
| E-3.06 | Write component tests for new node editors               | haiku  | 30 min   | E-3.03-05      | `apps/frontend/src/tests/`                    | Tests pass             |
| E-3.07 | Write integration tests for guardrails + evals           | haiku  | 30 min   | E-3.01, E-3.02 | `apps/api/src/tests/`                         | Tests pass             |

**Gate**: Full test suite passes, Studio Scorers tab shows results

---

## Phase F: Oracle 26AI Modernization

**Team**: "oracle-26ai" (3-4 agents, 2 waves) — AD-52: all parallel
**Total**: 8 tasks, ~5 hours

### Wave F1 — Migrations (all parallel, Sonnet)

| ID     | Title                               | Agent  | Duration | Depends          | Files                                                          | Verify                      |
| ------ | ----------------------------------- | ------ | -------- | ---------------- | -------------------------------------------------------------- | --------------------------- |
| F-1.01 | Migration 015: HNSW DML indexes     | sonnet | 45 min   | Phase A complete | `packages/shared/src/server/oracle/migrations/015-hnsw.sql`    | Migration runs successfully |
| F-1.02 | Migration 016: JSON Duality Views   | sonnet | 45 min   | Phase A complete | `packages/shared/src/server/oracle/migrations/016-duality.sql` | Migration runs successfully |
| F-1.03 | Migration 017: VPD tenant isolation | sonnet | 60 min   | Phase A complete | `packages/shared/src/server/oracle/migrations/017-vpd.sql`     | Migration runs successfully |

### Wave F2 — Code Updates + Benchmarks (parallel, mixed)

| ID     | Title                                              | Agent  | Duration | Depends        | Files                                                            | Verify                       |
| ------ | -------------------------------------------------- | ------ | -------- | -------------- | ---------------------------------------------------------------- | ---------------------------- |
| F-2.01 | Replace vectorToOracleString() with Float32Array   | sonnet | 45 min   | F-1.01         | `packages/shared/src/server/oracle/`, `apps/api/src/mastra/rag/` | Vector insert/query works    |
| F-2.02 | Update OracleVectorStore for HNSW + DB_TYPE_VECTOR | sonnet | 45 min   | F-1.01, F-2.01 | `apps/api/src/mastra/rag/oracle-vector-store.ts`                 | Vector search works          |
| F-2.03 | Write vector search performance benchmarks         | haiku  | 20 min   | F-2.02         | `apps/api/src/tests/rag/`                                        | 3x improvement documented    |
| F-2.04 | Test VPD with admin and non-admin roles            | haiku  | 20 min   | F-1.03         | `apps/api/src/tests/`                                            | Tenant isolation verified    |
| F-2.05 | Run full quality gate for Phase F                  | haiku  | 15 min   | all F-\*       | —                                                                | Full test suite + type check |

**Gate**: Vector benchmarks show 3x improvement, VPD isolation verified

---

## Cross-Phase Summary

### Task Count by Agent Type

| Phase     | Haiku Tasks | Sonnet Tasks | Total   | Est. Hours |
| --------- | ----------- | ------------ | ------- | ---------- |
| A         | 8           | 14           | 22      | ~13h       |
| B         | 8           | 19           | 27      | ~17h       |
| C         | 6           | 13           | 19      | ~13h       |
| D         | 3           | 11           | 14      | ~9h        |
| E         | 4           | 13           | 17      | ~11h       |
| F         | 3           | 5            | 8       | ~5h        |
| **Total** | **32**      | **75**       | **107** | **~68h**   |

### Optimal Team Deployment Timeline

```
Week 1-2:  Phase A (all agents focused on foundation)
Week 2-3:  Phase B (package split) + Phase D (OCI SDK, started) + Phase F (Oracle, started)
Week 3-4:  Phase B continues + Phase D continues + Phase F wraps up
Week 4-5:  Phase C (fastify-first, needs B complete) + Phase D continues
Week 5-6:  Phase C continues + Phase E (workflows, needs B complete)
Week 6-7:  Phase E continues + Post-migration validation
```

### Maximum Concurrent Agent Capacity

| Time Period | Active Phases  | Peak Agents | Sonnet | Haiku |
| ----------- | -------------- | ----------- | ------ | ----- |
| Week 1      | A              | 12          | 8      | 4     |
| Week 2-3    | B + D + F      | 15          | 11     | 4     |
| Week 4      | C + D          | 11          | 9      | 2     |
| Week 5-6    | C + E          | 13          | 10     | 3     |
| Week 7      | Post-migration | 3           | 1      | 2     |

---

## Verification Plan

### Per-Phase Gates

| Phase | Gate Command                                                | Success Criteria                              |
| ----- | ----------------------------------------------------------- | --------------------------------------------- |
| A     | `pnpm install && pnpm build && npx vitest run && pnpm lint` | All pass, `pnpm outdated` clean               |
| B     | `pnpm build && npx vitest run && npx madge --circular`      | All packages build, no circular deps          |
| C     | `npx vitest run && find apps/frontend -name '+server.ts'`   | All tests pass, 0 API +server.ts files        |
| D     | `npx vitest run apps/api && benchmark-tools.sh`             | All pass, p95 < 500ms                         |
| E     | `npx vitest run && pnpm lint`                               | All workflow nodes tested, guardrails active  |
| F     | `npx vitest run && benchmark-vectors.sh`                    | 3x vector improvement, VPD isolation verified |

### End-to-End Smoke Tests

After all phases:

1. Login via OCI IDCS → session established in Fastify
2. Send chat message → CloudAdvisor responds (SDK tools, < 500ms)
3. Create workflow → all 8 node types available in editor
4. Run workflow → SSE streaming shows progress
5. Vector search → HNSW index returns results
6. Admin console → Mastra Studio accessible
7. MCP catalog → AWS/Azure servers installable
8. `pnpm outdated` → zero deprecated, zero major gaps
9. `npx knip` → zero unused exports
10. `npx syncpack lint` → zero version mismatches

---

## Git Worktree Parallelization Strategy

### Why Worktrees?

Phases D and F only depend on Phase A — they can run in parallel with B/C/E without branch interference. `git worktree` gives each phase its own working directory on a dedicated branch, so multiple agent teams can commit simultaneously without merge conflicts during active development.

### Worktree Setup (after Phase A merges to main)

```bash
# Create worktrees from the post-Phase-A main branch
git worktree add ../portal-phase-B phase-10/B-package-split
git worktree add ../portal-phase-C phase-10/C-fastify-first
git worktree add ../portal-phase-D phase-10/D-oci-sdk
git worktree add ../portal-phase-E phase-10/E-workflows
git worktree add ../portal-phase-F phase-10/F-oracle-26ai
```

### Worktree Layout

```
~/Projects/
├── oci-self-service-portal/    # main branch — Phase A work, then integration
├── portal-phase-B/             # phase-10/B-package-split
├── portal-phase-C/             # phase-10/C-fastify-first (branches from B)
├── portal-phase-D/             # phase-10/D-oci-sdk (branches from A)
├── portal-phase-E/             # phase-10/E-workflows (branches from B)
└── portal-phase-F/             # phase-10/F-oracle-26ai (branches from A)
```

### Parallel Execution Windows

```
Window 1 (Week 1-2):  main worktree          → Phase A (all agents)
Window 2 (Week 2-4):  portal-phase-B         → Phase B agents
                       portal-phase-D         → Phase D agents (parallel with B)
                       portal-phase-F         → Phase F agents (parallel with B+D)
Window 3 (Week 4-6):  portal-phase-C         → Phase C agents (after B merges)
                       portal-phase-E         → Phase E agents (after B merges)
Window 4 (Week 6-7):  main worktree          → Integration merge + smoke tests
```

### Branch + Merge Protocol

1. **Phase A** works directly on `phase-10/A-foundation` branch, merged to `main` when complete
2. **Phases B, D, F** branch from post-A `main` into their worktrees
3. **Phases C, E** branch from post-B merge into their worktrees
4. Each phase merges back to `main` when its quality gate passes
5. Use `/quality-commit` after each task to ensure atomic, well-formatted commits
6. Use `/git-advanced-workflows` for complex merge conflict resolution across worktrees

### Per-Worktree Setup

Each worktree needs its own `node_modules`:

```bash
cd ../portal-phase-D
pnpm install                    # Independent node_modules
npx vitest run                  # Verify baseline passes
```

### Merge Order (critical path)

```
main ← A ← B ← C (sequential — each builds on prior)
main ← A ← D     (independent — merge anytime after A)
main ← A ← F     (independent — merge anytime after A)
main ← B ← E     (needs B, but independent of C/D/F)
```

### Conflict Hotspots

These files are modified by multiple phases — resolve conflicts carefully:

| File                                 | Phases | Strategy                                           |
| ------------------------------------ | ------ | -------------------------------------------------- |
| `apps/api/src/app.ts`                | A, C   | A adds plugins, C adds routes — sequential merge   |
| `package.json` (root + apps)         | A, B   | A adds deps, B restructures — merge A first        |
| `pnpm-workspace.yaml`                | B only | No conflict — B owns this change                   |
| `apps/frontend/src/hooks.server.ts`  | C only | No conflict — C strips auth logic                  |
| `packages/shared/src/tools/`         | D only | No conflict — D owns SDK migration                 |
| `packages/shared/src/server/oracle/` | A, F   | A adds OracleStore, F adds migrations — sequential |

### Worktree Cleanup

After all phases merge:

```bash
git worktree remove ../portal-phase-B
git worktree remove ../portal-phase-C
git worktree remove ../portal-phase-D
git worktree remove ../portal-phase-E
git worktree remove ../portal-phase-F
git branch -d phase-10/B-package-split phase-10/C-fastify-first \
  phase-10/D-oci-sdk phase-10/E-workflows phase-10/F-oracle-26ai
```

### Skills for Team Leads

- **`/quality-commit`** — Run after each task completion. Validates lint + typecheck + tests before committing. Ensures atomic, well-formatted commit messages with proper `type(scope): description` format.
- **`/git-advanced-workflows`** — Use when merging phases back to `main`. Handles rebase vs merge decisions, conflict resolution across worktrees, and ensures the integration branch stays clean.

---

## Continuous QA Watcher Protocol

Every agent team MUST spawn a dedicated QA watcher agent alongside implementation agents. This ensures zero surprise failures at commit time.

### QA Watcher Setup

When the team lead spawns an agent team for any phase, include a QA watcher:

```
Team: "phase-A-foundation"
├── sonnet-lead:     Team lead (orchestrates, reviews)
├── sonnet-impl-1:   Implementation agent
├── sonnet-impl-2:   Implementation agent
├── haiku-impl-3:    Implementation agent
└── haiku-qa:        QA watcher (continuous validation)
```

### QA Watcher Instructions

The QA watcher runs these checks IN PARALLEL (as background bash commands) after every file change reported by implementation agents:

```bash
# Type checking
npx tsc --noEmit 2>&1 | head -50

# Lint changed files
npx eslint --no-warn-ignored <changed-files>

# Security scan changed files
npx semgrep scan --config auto <changed-files> 2>&1 | head -30

# Run related tests
npx vitest run --reporter=verbose <related-test-files>
```

### Implementation Agent Protocol

After EVERY `Edit` or `Write` tool call, implementation agents MUST:

1. **Notify QA watcher** which files changed (via SendMessage)
2. **Wait for QA report** before continuing to next task
3. **Fix issues immediately** if QA reports failures — before starting new feature work
4. **Never proceed** with a failing QA check

### Pre-Commit Gate

When all implementation tasks in a wave are done, run the full suite ONE FINAL TIME:

```bash
pnpm build && npx vitest run && npx semgrep scan --config auto
```

Only create the conventional commit after this passes. This ensures:

- No accumulated type errors from multiple agent edits
- No lint regressions
- No security issues introduced
- No broken tests

### QA Watcher Response Format

```
QA Report for: apps/api/src/plugins/otel.ts
├── tsc:     PASS (0 errors)
├── eslint:  PASS (0 warnings)
├── semgrep: PASS (0 findings)
└── vitest:  PASS (3/3 tests)
Status: ALL CLEAR — proceed with next task
```

Or if issues found:

```
QA Report for: apps/api/src/plugins/cache.ts
├── tsc:     FAIL — TS2345: Argument of type 'string' is not assignable to 'Buffer'
├── eslint:  PASS
├── semgrep: WARN — javascript.lang.security.detect-eval-with-expression
└── vitest:  FAIL — cache.test.ts line 42: Expected 'hit' but received 'miss'
Status: BLOCKED — fix 2 issues before continuing
Suggested fixes:
  1. Line 15: Use Buffer.from(key) instead of raw string
  2. Line 42: Cache TTL not set — add { ttl: 300 } to set() call
```
