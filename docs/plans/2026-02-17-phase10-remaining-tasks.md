# Task Plan: Phase 10 — Foundation Rewrite, Workflow Designer & Oracle 26AI Modernization (Remaining)

Generated from PRD: `.claude/reference/PRD.md` (Draft v7)
Generated at: 2026-02-17T00:00:00Z

## Status at Generation

| Phase | Status        | Notes                                                             |
| ----- | ------------- | ----------------------------------------------------------------- |
| A     | ~60% complete | 8 P0 plugins installed; DX/migration tasks remain                 |
| B     | In-progress   | `@portal/types` + `@portal/server` created; `@portal/ui` skeleton |
| C     | ✅ COMPLETE   | All 37 routes migrated; Better Auth on Fastify                    |
| D     | Not started   | oci-sdk installed; executor not yet written                       |
| E     | Not started   | Node types unimplemented; AI hardening pending                    |
| F     | Not started   | Migrations not yet run; vector binding pending                    |
| G     | ✅ COMPLETE   | All 4 admin pages live on main                                    |

V5 DAG Validation: **PASS** — A → B → (C✅); A → D; B → E; A → F; C → G✅. No cycles.

---

## Phase A-R: Dependency Updates + Fastify Hardening (Remaining)

Prerequisite: None (Phase A ~60% done; these are the remaining items)

### Wave 1: Foundation (Config / Package Updates)

| ID       | Task                                                                   | Agent | Files                                               | Depends | Verify              |
| -------- | ---------------------------------------------------------------------- | ----- | --------------------------------------------------- | ------- | ------------------- |
| A-R-1.01 | Update `svelte` to latest + `@sentry/sveltekit` to ≥10.38.0            | haiku | `apps/frontend/package.json`                        | —       | `npx svelte-check`  |
| A-R-1.02 | Remove `@types/dompurify` from devDeps (DOMPurify 3.x ships own types) | haiku | `apps/frontend/package.json`                        | —       | `npx tsc --noEmit`  |
| A-R-1.03 | Add `syncpack` to root devDeps + run `npx syncpack fix-mismatches`     | haiku | `package.json` (root), all workspace `package.json` | —       | `npx syncpack lint` |
| A-R-1.04 | Add `zod-validation-error` to `packages/shared`                        | haiku | `packages/shared/package.json`                      | —       | `npx tsc --noEmit`  |

### Wave 2: Implementation

| ID       | Task                                                                                           | Agent  | Files                                                                  | Depends  | Verify                            |
| -------- | ---------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- | -------- | --------------------------------- |
| A-R-2.01 | Replace `zodToJsonSchema()` with `z.toJSONSchema()` in `portal-mcp-server.ts` (Zod 4 built-in) | haiku  | `apps/api/src/mastra/mcp/portal-mcp-server.ts`                         | A-R-1.04 | `npx tsc --noEmit`                |
| A-R-2.02 | Migrate `agent_state` SQLite → Oracle: add `org_id`, `thread_id` columns (AD-35/AD-47)         | sonnet | `packages/server/src/agent-state/`, Oracle migration file              | —        | `npx vitest run apps/api`         |
| A-R-2.03 | Set up Grafana + Tempo docker-compose observability stack (AD-48)                              | sonnet | `infrastructure/docker/observability/docker-compose.yml`, config files | —        | `docker compose up grafana tempo` |

---

## Phase B-R: Package Split + Frontend Libraries (Remaining)

Prerequisite: Phase A-R should be substantially complete (package structure stable)

### Wave 1: Package Foundation

| ID       | Task                                                                                              | Agent | Files                                                                       | Depends  | Verify                               |
| -------- | ------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------- | -------- | ------------------------------------ |
| B-R-1.01 | Create `@portal/ui` package structure: `src/components/`, `src/stores/`, `src/utils/`, `index.ts` | haiku | `packages/ui/src/`, `packages/ui/package.json`, `packages/ui/tsconfig.json` | —        | `cd packages/ui && npx tsc --noEmit` |
| B-R-1.02 | Extract `Badge`, `Spinner`, `LoadingSpinner` Svelte components to `@portal/ui`                    | haiku | `packages/ui/src/components/`, `apps/frontend/src/lib/components/ui/`       | B-R-1.01 | `npx svelte-check`                   |

### Wave 2: UI Component Extraction + Forms

| ID       | Task                                                                                    | Agent  | Files                                                                        | Depends  | Verify             |
| -------- | --------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- | -------- | ------------------ |
| B-R-2.01 | Extract `CodeBlock`, `Collapsible` to `@portal/ui`; update all import sites             | haiku  | `packages/ui/src/components/`, `apps/frontend/src/lib/components/ui/`        | B-R-1.02 | `npx svelte-check` |
| B-R-2.02 | Migrate admin forms (IDP, AI Provider, Settings) to Superforms + zod4Client adapter     | sonnet | `apps/frontend/src/routes/admin/idp/`, `admin/models/`, `admin/settings/`    | —        | `npx svelte-check` |
| B-R-2.03 | Migrate setup wizard forms to Superforms                                                | sonnet | `apps/frontend/src/routes/setup/`, `apps/frontend/src/lib/components/setup/` | —        | `npx svelte-check` |
| B-R-2.04 | Create admin dashboard metrics charts with LayerChart (tool usage, workflow runs, cost) | sonnet | `apps/frontend/src/routes/admin/`, `apps/frontend/src/lib/components/admin/` | —        | `npx svelte-check` |
| B-R-2.05 | Add Fuse.js fuzzy search to tool palette + MCP catalog pages                            | haiku  | `apps/frontend/src/lib/utils/fuzzy-search.ts`, admin pages                   | —        | `npx svelte-check` |

### Wave 3: Generative UI + Chat State

| ID       | Task                                                                                                                                                     | Agent  | Files                                                                        | Depends | Verify             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- | ------- | ------------------ |
| B-R-3.01 | Build Generative UI component batch (AD-46): `InstanceTable`, `CostChart`, `MetricsChart`, `TerraformViewer`, `AlarmPanel`, `ResourceList`, `BucketGrid` | sonnet | `apps/frontend/src/lib/components/genui/`                                    | —       | `npx svelte-check` |
| B-R-3.02 | Build `ApprovalCard` using AI SDK built-in tool approval flow (`needsApproval` + `addToolApprovalResponse`)                                              | sonnet | `apps/frontend/src/lib/components/genui/ApprovalCard.svelte`                 | —       | `npx svelte-check` |
| B-R-3.03 | Adopt `createAIContext()` for shared Chat state (replace prop drilling in `+page.svelte`)                                                                | sonnet | `apps/frontend/src/lib/components/chat/ai-context.svelte.ts`, `+page.svelte` | —       | `npx svelte-check` |

### Wave 4: Validation

| ID       | Task                                                                             | Agent | Files         | Depends        | Verify                                                                                      |
| -------- | -------------------------------------------------------------------------------- | ----- | ------------- | -------------- | ------------------------------------------------------------------------------------------- |
| B-R-4.01 | Run `npx madge --circular` — verify no circular deps introduced by package split | haiku | (verify only) | B-R-1–B-R-3.03 | `npx madge --circular packages/`                                                            |
| B-R-4.02 | Full test suite + type checks across all packages                                | haiku | (verify only) | B-R-4.01       | `npx vitest run && cd apps/frontend && npx svelte-check && cd apps/api && npx tsc --noEmit` |

---

## Phase D: OCI SDK Migration

Prerequisite: Phase A (oci-sdk already installed). Independent of Phase B/C.

### Wave 1: Foundation

| ID     | Task                                                                                                 | Agent  | Files                                             | Depends | Verify                                     |
| ------ | ---------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------- | ------- | ------------------------------------------ |
| D-1.01 | Configure oci-sdk auth provider (config file `~/.oci/config` + instance principal fallback)          | sonnet | `apps/api/src/mastra/tools/sdk-auth.ts` (new)     | —       | `npx tsc --noEmit`                         |
| D-1.02 | Create `executor-sdk.ts` adapter: wraps SDK calls, maps exceptions to `OCIError`, connection pooling | sonnet | `apps/api/src/mastra/tools/executor-sdk.ts` (new) | D-1.01  | `npx vitest run apps/api/src/tests/tools/` |

### Wave 2: Tool Migration (High-Frequency First)

| ID     | Task                                                                                                             | Agent  | Files                                                              | Depends | Verify                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------ | ------- | ------------------------------------------ |
| D-2.01 | Migrate top-10 OCI tools by call frequency: Compute (list/get/launch instances) + Networking (list VCNs/subnets) | sonnet | `apps/api/src/mastra/tools/categories/compute.ts`, `networking.ts` | D-1.02  | `npx vitest run apps/api/src/tests/tools/` |
| D-2.02 | Benchmark CLI exec vs SDK latency on migrated tools (p95 target: <500ms)                                         | haiku  | `scripts/benchmark-sdk.ts` (new)                                   | D-2.01  | Script output shows p95 <500ms             |

### Wave 3: Remaining Migration

| ID     | Task                                                                                          | Agent  | Files                                                   | Depends | Verify                                     |
| ------ | --------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------- | ------- | ------------------------------------------ |
| D-3.01 | Migrate remaining OCI tools (object storage, database, identity) — keep CLI fallback for gaps | sonnet | `apps/api/src/mastra/tools/categories/` (all remaining) | D-2.02  | `npx vitest run apps/api/src/tests/tools/` |

---

## Phase E: Workflow Designer Completion + AI Hardening

Prerequisite: Phase B must be substantially complete (workflow types in `@portal/types`).

### Wave 1: Missing Node Types

| ID     | Task                                                                             | Agent  | Files                                                   | Depends | Verify                                         |
| ------ | -------------------------------------------------------------------------------- | ------ | ------------------------------------------------------- | ------- | ---------------------------------------------- |
| E-1.01 | Implement `ai-step` node: Mastra `agent.generate()` + configurable output schema | sonnet | `apps/api/src/mastra/workflows/nodes/ai-step.ts` (new)  | —       | `npx vitest run apps/api/src/tests/workflows/` |
| E-1.02 | Implement `loop` node: Mastra `.foreach()` with configurable concurrency limit   | sonnet | `apps/api/src/mastra/workflows/nodes/loop.ts` (new)     | —       | `npx vitest run apps/api/src/tests/workflows/` |
| E-1.03 | Implement `parallel` node: Mastra `.parallel()` with named branch results merge  | sonnet | `apps/api/src/mastra/workflows/nodes/parallel.ts` (new) | —       | `npx vitest run apps/api/src/tests/workflows/` |

### Wave 2: Executor Features

| ID     | Task                                                                                     | Agent  | Files                                                                            | Depends | Verify                                         |
| ------ | ---------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------- | ------- | ---------------------------------------------- |
| E-2.01 | Add retry policies: exponential backoff (base × 2^attempt), maxRetries=3, maxDelay=30s   | sonnet | `apps/api/src/mastra/workflows/retry.ts` (new), executor integration             | E-1.01  | `npx vitest run apps/api/src/tests/workflows/` |
| E-2.02 | Add compensation/saga pattern: reverse-order handlers on failure, results in audit trail | sonnet | `apps/api/src/mastra/workflows/compensation.ts` (new)                            | E-1.01  | `npx vitest run apps/api/src/tests/workflows/` |
| E-2.03 | Add workflow streaming via Mastra `writer` argument + SSE endpoint                       | sonnet | `apps/api/src/mastra/workflows/streaming.ts`, `apps/api/src/routes/workflows.ts` | —       | `npx vitest run apps/api/src/tests/workflows/` |
| E-2.04 | Add workflow lifecycle callbacks: `onFinish` → Oracle audit log; `onError` → Sentry      | haiku  | `apps/api/src/mastra/workflows/lifecycle.ts` (new)                               | E-2.03  | `npx vitest run apps/api/src/tests/workflows/` |

### Wave 3: AI Hardening

| ID     | Task                                                                                          | Agent  | Files                                                                      | Depends | Verify                                             |
| ------ | --------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- | ------- | -------------------------------------------------- |
| E-3.01 | Add typed `suspendSchema`/`resumeSchema` for approval nodes (Zod runtime validation)          | haiku  | `apps/api/src/mastra/workflows/nodes/approval.ts`                          | E-1.01  | `npx tsc --noEmit`                                 |
| E-3.02 | Add `PromptInjectionDetector` as `inputProcessor` + `PIIDetector` (redact strategy) as hybrid | sonnet | `apps/api/src/mastra/agents/charlie.ts`, `apps/api/src/mastra/processors/` | —       | `npx vitest run apps/api/src/tests/`               |
| E-3.03 | Add `TokenLimiterProcessor` (4000-token output cap) as `outputProcessor`                      | haiku  | `apps/api/src/mastra/processors/token-limiter.ts` (new)                    | E-3.02  | `npx vitest run apps/api/src/tests/`               |
| E-3.04 | Configure `@mastra/evals` scorers: `relevancy` + `toxicity` at 10% sampling on CloudAdvisor   | haiku  | `apps/api/src/mastra/agents/charlie.ts`, `apps/api/src/mastra/evals/`      | —       | Scorer results visible in Mastra Studio            |
| E-3.05 | Add crash recovery via `restartAllActiveWorkflowRuns()` in Fastify startup hook               | haiku  | `apps/api/src/app.ts`, `apps/api/src/mastra/workflows/recovery.ts`         | E-2.03  | Manual: kill API mid-run, restart, verify recovery |

### Wave 4: Frontend

| ID     | Task                                                                                        | Agent  | Files                                                                              | Depends       | Verify             |
| ------ | ------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- | ------------- | ------------------ |
| E-4.01 | Update workflow editor components for new node types (ai-step, loop, parallel) node editors | sonnet | `apps/frontend/src/lib/components/workflows/` (AIStepNode, LoopNode, ParallelNode) | E-1.01–E-1.03 | `npx svelte-check` |

---

## Phase F: Oracle 26AI Modernization

Prerequisite: Phase A (Oracle connection pool stable). Independent of B, D, E. Migrations F-1.01/02/03 are **fully parallelizable** (AD-52).

### Wave 1: Migrations (Run in Parallel)

| ID     | Task                                                                                           | Agent  | Files                                                                      | Depends | Verify                       |
| ------ | ---------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- | ------- | ---------------------------- |
| F-1.01 | Migration 015: HNSW DML vector indexes (`neighbors=16`, `efConstruction=200`) [parallelizable] | haiku  | `packages/shared/src/server/oracle/migrations/015-hnsw-indexes.sql` (new)  | —       | Migration runs without error |
| F-1.02 | Migration 016: JSON Relational Duality Views for workflow definitions [parallelizable]         | haiku  | `packages/shared/src/server/oracle/migrations/016-duality-views.sql` (new) | —       | Migration runs without error |
| F-1.03 | Migration 017: VPD tenant isolation policies for all org-scoped tables [parallelizable]        | sonnet | `packages/shared/src/server/oracle/migrations/017-vpd-policies.sql` (new)  | —       | Migration runs without error |

### Wave 2: Implementation

| ID     | Task                                                                                       | Agent  | Files                                            | Depends | Verify                                   |
| ------ | ------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------ | ------- | ---------------------------------------- |
| F-2.01 | Replace `vectorToOracleString()` with direct `Float32Array` binding using `DB_TYPE_VECTOR` | sonnet | `apps/api/src/mastra/rag/oracle-vector-store.ts` | F-1.01  | `npx vitest run apps/api/src/tests/rag/` |
| F-2.02 | Update `OracleVectorStore` for HNSW indexes + `DB_TYPE_VECTOR` type throughout             | sonnet | `apps/api/src/mastra/rag/oracle-vector-store.ts` | F-2.01  | `npx vitest run apps/api/src/tests/rag/` |

### Wave 3: Validation

| ID     | Task                                                                                    | Agent | Files                                    | Depends | Verify                                                  |
| ------ | --------------------------------------------------------------------------------------- | ----- | ---------------------------------------- | ------- | ------------------------------------------------------- |
| F-3.01 | Benchmark vector search performance: HNSW vs IVF (3x improvement target)                | haiku | `scripts/benchmark-vector.ts` (new)      | F-2.02  | Script shows ≥3x improvement                            |
| F-3.02 | Test VPD isolation: non-admin role cannot see other org data; admin role gets exemption | haiku | `apps/api/src/tests/plugins/vpd.test.ts` | F-1.03  | `npx vitest run apps/api/src/tests/plugins/vpd.test.ts` |

---

## Phase Dependencies

```
A-R (remaining deps) ─────► (unblocks E via clean @portal/types)
                               │
B-R-1 (ui package) ──────────► B-R-2 (extract primitives)
                                        │
                                        ▼
              B-R-2 ─────────────────► B-R-3 (genui, chat state)
                                        │
                                        ▼
                                       B-R-4 (validate)
                                        │
                                        ▼
                               E (workflow + AI hardening)

D ────── independent ────────────────────────────────────► any order

F-1.01 ─┐
F-1.02 ─┼── parallel ──► F-2.01 ──► F-2.02 ──► F-3.01 ──► F-3.02
F-1.03 ─┘
```

**Parallelizable now** (no blockers):

- Phase A-R Wave 1 tasks (A-R-1.01 through A-R-1.04)
- Phase D Wave 1 (D-1.01)
- Phase F Wave 1 (F-1.01, F-1.02, F-1.03 — all parallel with each other)
- Phase B-R Wave 2 tasks B-R-2.02, B-R-2.03, B-R-2.04, B-R-2.05 (independent)

---

## Summary

| Metric                   | Value                         |
| ------------------------ | ----------------------------- |
| **Total tasks**          | **41**                        |
| Phase A-R                | 7 tasks (2 waves)             |
| Phase B-R                | 13 tasks (4 waves)            |
| Phase D                  | 5 tasks (3 waves)             |
| Phase E                  | 12 tasks (4 waves)            |
| Phase F                  | 7 tasks (3 waves)             |
| **haiku agents**         | 17 tasks                      |
| **sonnet agents**        | 24 tasks                      |
| **Parallelizable today** | D + F migrations + A-R Wave 1 |
