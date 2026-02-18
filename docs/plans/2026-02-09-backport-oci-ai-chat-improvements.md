# Backport oci-ai-chat Improvements to oci-self-service-portal

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port all improvements from `oci-ai-chat` (in `/Users/acedergr/Projects/oci-genai-examples/oci-ai-chat/`) into `oci-self-service-portal` (this repo), adapting to this repo's conventions.

**Architecture:** Two repos diverged during a repo split. This repo (`oci-self-service-portal`) is canonical with better architecture (richer `packages/shared`, Zod 4, Fastify 5.7.4, `@portal/*` naming). But `oci-ai-chat` accumulated ~30K LOC of improvements: admin console, Mastra/RAG, API plugins, security hardening, services layer, and 600+ additional tests. We port feature-by-feature, adapting each to this repo's conventions.

**Tech Stack:** SvelteKit 5, Fastify 5.7.4, Zod 4, Oracle ADB 26AI, Mastra, AI SDK 6, Vitest 4, pnpm monorepo

---

## Critical Context for the Implementing Agent

### This Repo's Conventions (MUST follow)

- **Package names**: `@portal/shared`, `@portal/frontend`, `@portal/api` — NOT `@acedergren/*`
- **Zod version**: 4.3.6 — NOT Zod 3. Source code uses Zod 3 and MUST be adapted.
- **Fastify**: 5.7.4 with `fastify-type-provider-zod@6.1.0` (Zod 4 compatible)
- **Vitest**: 4.0.18 everywhere. Use `defineProject` in workspace members, not `defineConfig`.
- **Migrations live at**: `packages/shared/src/server/oracle/migrations/` (NOT `apps/frontend/`)
- **Shared package is "fat"**: Contains server logic, repositories, tools, pricing, terraform, workflows, query, stubs — NOT just types
- **TypeScript**: 5.9.3
- No `.claude/` directory exists yet — create it fresh

### Source Repo Reference (read-only)

All source files come from: `/Users/acedergr/Projects/oci-genai-examples/oci-ai-chat/`
Abbreviation in this plan: `$SRC` = that path.

### Zod 3 → 4 Migration Rules

When porting ANY `.ts` file that imports `zod`:

- `z.ZodType` → check if it should be `z.ZodTypeAny` or `z.$ZodType`
- `z.preprocess()` → may need `z.pipe()` instead
- `z.nativeEnum()` → verify still works (usually fine)
- `z.infer<typeof schema>` → still works
- `fastify-type-provider-zod` v6 uses Zod 4 — route schemas must be Zod 4

### Import Path Translation

Every ported file needs these replacements:

- `@acedergren/portal-shared` → `@portal/shared`
- `@acedergren/oci-ai-chat-frontend` → `@portal/frontend`
- `@acedergren/oci-ai-chat-api` → `@portal/api`
- `$lib/server/oracle/` → check if it should be `@portal/shared/server/oracle/` (this repo moved Oracle layer to shared)
- `$lib/server/auth/` → check if it should be `@portal/shared/server/auth/`

### Verification After Every Task

```bash
pnpm install          # deps resolve
pnpm lint             # 0 new errors
pnpm test             # no new failures vs baseline
pnpm build            # builds successfully
```

---

## Task 1: Establish Baseline & Create Branch

**Files:**

- None (git operations only)

**Step 1: Record current test baseline**

```bash
cd /Users/acedergr/Projects/oci-self-service-portal
git checkout feature/phase9-fastify-migration
pnpm install
pnpm test 2>&1 | tail -20
```

Record the number of passing/failing tests. Expected: ~423 passing, ~233 failing.

**Step 2: Create migration branch**

```bash
git checkout -b feature/backport-ai-chat-improvements
```

**Step 3: Commit**

No files changed yet — just branch creation.

---

## Task 2: Port Oracle Migrations

**Files:**

- Create: `packages/shared/src/server/oracle/migrations/010-admin.sql`
- Create: `packages/shared/src/server/oracle/migrations/011-mastra-storage.sql`
- Create: `packages/shared/src/server/oracle/migrations/012-scores-extra-columns.sql`

Self-service already has `009-webhook-secret-encryption.sql`, so the oci-ai-chat migrations (009, 010, 011) must be renumbered to 010, 011, 012.

**Step 1: Copy and renumber migrations**

```bash
SRC=/Users/acedergr/Projects/oci-genai-examples/oci-ai-chat/apps/frontend/src/lib/server/oracle/migrations
DEST=/Users/acedergr/Projects/oci-self-service-portal/packages/shared/src/server/oracle/migrations

cp "$SRC/009-admin.sql" "$DEST/010-admin.sql"
cp "$SRC/010-mastra-storage.sql" "$DEST/011-mastra-storage.sql"
cp "$SRC/011-scores-extra-columns.sql" "$DEST/012-scores-extra-columns.sql"
```

**Step 2: Verify migration content**

Read each file. Expected:

- `010-admin.sql` (188 lines): IDP config table, AI provider table, portal_settings KV store, indexes
- `011-mastra-storage.sql` (121 lines): mastra_threads, mastra_messages, mastra_resources, mastra_workflow_snapshots, mastra_scores
- `012-scores-extra-columns.sql` (12 lines): ALTER TABLE mastra_scores ADD 4 columns

**Step 3: Commit**

```bash
git add packages/shared/src/server/oracle/migrations/010-admin.sql \
        packages/shared/src/server/oracle/migrations/011-mastra-storage.sql \
        packages/shared/src/server/oracle/migrations/012-scores-extra-columns.sql
git commit -m "feat(database): add admin, mastra-storage, and scores migrations (010-012)

Ported from oci-ai-chat. Renumbered 009→010, 010→011, 011→012
to avoid conflict with existing 009-webhook-secret-encryption.sql.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Port Claude Code Ecosystem

**Files:**

- Create: `.claude/settings.json`
- Create: `.claude/settings.local.json`
- Create: `.claude/hooks/` (9 hook scripts)
- Create: `.claude/skills/` (7 skill definitions)
- Create: `.claude/agents/` (2 agent definitions)

**Step 1: Copy entire .claude directory from source**

```bash
SRC=/Users/acedergr/Projects/oci-genai-examples/oci-ai-chat/.claude
DEST=/Users/acedergr/Projects/oci-self-service-portal/.claude

mkdir -p "$DEST"
cp -r "$SRC/settings.json" "$DEST/"
cp -r "$SRC/settings.local.json" "$DEST/" 2>/dev/null || true
cp -r "$SRC/hooks" "$DEST/"
cp -r "$SRC/skills" "$DEST/"
cp -r "$SRC/agents" "$DEST/"
cp -r "$SRC/docs" "$DEST/" 2>/dev/null || true
```

**Step 2: Update package name references**

In ALL files under `.claude/`, replace:

- `@acedergren/portal-shared` → `@portal/shared`
- `@acedergren/oci-ai-chat` → `@portal/frontend`
- Any hardcoded paths pointing to `oci-genai-examples/oci-ai-chat` → `oci-self-service-portal`

**Step 3: Verify hooks are executable**

```bash
chmod +x .claude/hooks/*.sh
```

**Step 4: Commit**

```bash
git add .claude/
git commit -m "feat(tooling): port Claude Code ecosystem (hooks, skills, agents)

9 hooks (lint, semgrep, bulk-staging block, sensitive files, migration validation, etc.)
7 skills (manage-secrets, oracle-migration, quality-commit, doc-sync, phase-kickoff, linkedin-post)
2 agents (security-reviewer, oracle-query-reviewer)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Port Admin Server-Side Code

**Files:**

- Create: `packages/shared/src/server/admin/idp-repository.ts` (485 lines)
- Create: `packages/shared/src/server/admin/ai-provider-repository.ts` (435 lines)
- Create: `packages/shared/src/server/admin/settings-repository.ts` (291 lines)
- Create: `packages/shared/src/server/admin/types.ts` (293 lines)
- Create: `packages/shared/src/server/admin/setup-token.ts` (140 lines)
- Create: `packages/shared/src/server/admin/strip-secrets.ts` (55 lines)
- Create: `packages/shared/src/server/admin/index.ts` (32 lines)

Admin server code goes into `packages/shared/src/server/admin/` because this repo's convention is to put server logic in the shared package.

**Step 1: Copy source files**

```bash
SRC=/Users/acedergr/Projects/oci-genai-examples/oci-ai-chat/apps/frontend/src/lib/server/admin
DEST=/Users/acedergr/Projects/oci-self-service-portal/packages/shared/src/server/admin

mkdir -p "$DEST"
cp "$SRC"/*.ts "$DEST/"
```

**Step 2: Adapt imports**

In EVERY file under `$DEST/`:

- Replace `$lib/server/oracle/` imports → use relative imports to `../oracle/` (both are in `packages/shared/src/server/`)
- Replace `$lib/server/errors` → `../errors`
- Replace `$lib/server/logger` → `../logger`
- Replace `$lib/server/crypto` → `../crypto` (verify `crypto.ts` exists in shared already)
- Replace any `@acedergren/*` → `@portal/*`

**Step 3: Adapt Zod schemas for Zod 4**

Open `types.ts` and check every `z.` call. Common fixes:

- `z.preprocess(...)` → `z.pipe(z.unknown(), z.transform(...))`
- `z.ZodType` type annotations → `z.ZodTypeAny`

**Step 4: Add admin exports to shared package**

Edit `packages/shared/package.json` to add export:

```json
"./server/admin/*": "./src/server/admin/*.ts"
```

If this pattern already exists (e.g., `"./server/*": "./src/server/*.ts"`), it may already cover admin — verify.

**Step 5: Run type check**

```bash
cd packages/shared && npx tsc --noEmit
```

Fix any type errors from Zod 4 or import path mismatches.

**Step 6: Commit**

```bash
git add packages/shared/src/server/admin/
git commit -m "feat(admin): port admin server-side code (IDP, AI providers, settings, setup token)

7 modules: idp-repository, ai-provider-repository, settings-repository,
types, setup-token, strip-secrets, index.
Adapted imports for @portal/* and Zod 4.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Port Admin Frontend Routes

**Files:**

- Create: `apps/frontend/src/routes/admin/+page.ts` (7 lines)
- Create: `apps/frontend/src/routes/admin/+layout.server.ts` (22 lines)
- Create: `apps/frontend/src/routes/admin/+layout.svelte` (239 lines)
- Create: `apps/frontend/src/routes/admin/idp/+page.server.ts` (21 lines)
- Create: `apps/frontend/src/routes/admin/idp/+page.svelte` (880 lines)
- Create: `apps/frontend/src/routes/admin/models/+page.server.ts` (21 lines)
- Create: `apps/frontend/src/routes/admin/models/+page.svelte` (892 lines)
- Create: `apps/frontend/src/routes/admin/settings/+page.server.ts` (21 lines)
- Create: `apps/frontend/src/routes/admin/settings/+page.svelte` (821 lines)

**Step 1: Copy admin routes**

```bash
SRC=/Users/acedergr/Projects/oci-genai-examples/oci-ai-chat/apps/frontend/src/routes/admin
DEST=/Users/acedergr/Projects/oci-self-service-portal/apps/frontend/src/routes/admin

mkdir -p "$DEST/idp" "$DEST/models" "$DEST/settings"
cp -r "$SRC"/* "$DEST/"
```

**Step 2: Adapt imports in all files**

- `$lib/server/admin/` → `@portal/shared/server/admin/` (admin code lives in shared package now)
- `$lib/server/auth/` → check if auth imports should come from `@portal/shared/server/auth/`
- Any `@acedergren/*` → `@portal/*`
- Verify Svelte 5 component syntax is compatible (both repos use Svelte 5.49.1)

**Step 3: Verify no broken imports**

```bash
cd apps/frontend && npx svelte-check
```

Fix errors — most will be import paths.

**Step 4: Commit**

```bash
git add apps/frontend/src/routes/admin/
git commit -m "feat(admin): port admin console pages (IDP, AI models, settings)

3 admin pages with server loaders + shared layout.
Adapted imports for @portal/shared.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Port Setup Wizard

**Files:**

- Create: `apps/frontend/src/routes/setup/+page.server.ts` (36 lines)
- Create: `apps/frontend/src/routes/setup/+page.svelte` (10 lines)
- Create: `apps/frontend/src/routes/setup/+layout.svelte` (43 lines)
- Create: `apps/frontend/src/routes/api/setup/status/+server.ts` (61 lines)
- Create: `apps/frontend/src/routes/api/setup/idp/+server.ts` (53 lines)
- Create: `apps/frontend/src/routes/api/setup/idp/test/+server.ts` (171 lines)
- Create: `apps/frontend/src/routes/api/setup/ai-provider/+server.ts` (53 lines)
- Create: `apps/frontend/src/routes/api/setup/ai-provider/test/+server.ts` (115 lines)
- Create: `apps/frontend/src/routes/api/setup/settings/+server.ts` (49 lines)
- Create: `apps/frontend/src/routes/api/setup/complete/+server.ts` (79 lines)
- Create: `apps/frontend/src/lib/components/setup/SetupWizard.svelte` (223 lines)
- Create: `apps/frontend/src/lib/components/setup/SetupStepper.svelte` (168 lines)
- Create: `apps/frontend/src/lib/components/setup/shared/SecretInput.svelte` (148 lines)
- Create: `apps/frontend/src/lib/components/setup/shared/TestConnectionButton.svelte` (181 lines)
- Create: `apps/frontend/src/lib/components/setup/steps/IdentityStep.svelte` (464 lines)
- Create: `apps/frontend/src/lib/components/setup/steps/AIModelsStep.svelte` (567 lines)
- Create: `apps/frontend/src/lib/components/setup/steps/ReviewStep.svelte` (527 lines)
- Create: `apps/frontend/src/lib/components/setup/steps/FeaturesStep.svelte` (559 lines)

**Step 1: Copy setup routes and components**

```bash
SRC=/Users/acedergr/Projects/oci-genai-examples/oci-ai-chat/apps/frontend/src
DEST=/Users/acedergr/Projects/oci-self-service-portal/apps/frontend/src

# Setup page routes
mkdir -p "$DEST/routes/setup"
cp -r "$SRC/routes/setup"/* "$DEST/routes/setup/"

# Setup API routes
mkdir -p "$DEST/routes/api/setup/status" "$DEST/routes/api/setup/idp/test" \
         "$DEST/routes/api/setup/ai-provider/test" "$DEST/routes/api/setup/settings" \
         "$DEST/routes/api/setup/complete"
cp -r "$SRC/routes/api/setup"/* "$DEST/routes/api/setup/"

# Setup components
mkdir -p "$DEST/lib/components/setup/shared" "$DEST/lib/components/setup/steps"
cp -r "$SRC/lib/components/setup"/* "$DEST/lib/components/setup/"
```

**Step 2: Adapt all imports (same pattern as Task 5)**

- `$lib/server/admin/` → `@portal/shared/server/admin/`
- `@acedergren/*` → `@portal/*`

**Step 3: Run svelte-check**

```bash
cd apps/frontend && npx svelte-check
```

**Step 4: Commit**

```bash
git add apps/frontend/src/routes/setup/ \
        apps/frontend/src/routes/api/setup/ \
        apps/frontend/src/lib/components/setup/
git commit -m "feat(admin): port setup wizard (4 steps, 7 API routes, 8 components)

Identity, AI Models, Features, and Review steps.
API routes for status, IDP test, AI provider test, settings, completion.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Port Admin Tests

**Files:**

- Create: `apps/frontend/src/tests/admin/crypto.test.ts` (265 lines)
- Create: `apps/frontend/src/tests/admin/types.test.ts` (650 lines)
- Create: `apps/frontend/src/tests/admin/idp-repository.test.ts` (424 lines)
- Create: `apps/frontend/src/tests/admin/setup-token.test.ts` (189 lines)
- Create: `apps/frontend/src/tests/admin/strip-secrets.test.ts` (204 lines)

**Step 1: Copy test files**

```bash
SRC=/Users/acedergr/Projects/oci-genai-examples/oci-ai-chat/apps/frontend/src/tests/admin
DEST=/Users/acedergr/Projects/oci-self-service-portal/apps/frontend/src/tests/admin

mkdir -p "$DEST"
cp "$SRC"/*.test.ts "$DEST/"
```

**Step 2: Adapt imports**

- Admin module imports now come from `@portal/shared/server/admin/` (Task 4 placed them there)
- Zod schemas in test assertions may need Zod 4 adjustments

**Step 3: Run admin tests**

```bash
cd /Users/acedergr/Projects/oci-self-service-portal
npx vitest run apps/frontend/src/tests/admin/ --reporter=verbose
```

Expected: 115 tests. Fix any failures.

**Step 4: Commit**

```bash
git add apps/frontend/src/tests/admin/
git commit -m "test(admin): port 5 admin test suites (crypto, types, IDP, token, secrets)

115 tests covering AES-256-GCM encryption, type guards, IDP CRUD,
setup token validation, and secret stripping.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Add Mastra Dependencies

**Files:**

- Modify: `apps/api/package.json`

**Step 1: Add Mastra packages**

```bash
cd /Users/acedergr/Projects/oci-self-service-portal/apps/api
pnpm add @mastra/core@^1.2.0 @mastra/fastify@^1.1.1 @mastra/memory@^1.1.0 @mastra/rag@2.1.0
```

**Step 2: Check Mastra's peer deps for Zod compatibility**

```bash
cat node_modules/@mastra/core/package.json | grep -A5 peerDependencies
```

If Mastra expects Zod 3, we may need a newer Mastra version or a Zod compatibility shim. **This is a critical checkpoint — stop and investigate if there's a conflict.**

**Step 3: Add AI SDK provider packages (if missing)**

Check if these exist in `apps/api/package.json`:

```bash
pnpm add @ai-sdk/anthropic @ai-sdk/google @ai-sdk/openai
```

Only add if not already present.

**Step 4: Verify install**

```bash
cd /Users/acedergr/Projects/oci-self-service-portal
pnpm install
```

**Step 5: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): add Mastra framework and AI SDK provider dependencies

@mastra/core, @mastra/fastify, @mastra/memory, @mastra/rag
+ AI SDK providers (anthropic, google, openai)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Port Mastra Directory

**Files:**

- Create: `apps/api/src/mastra/` (40 files, 11,232 lines total)

This is the largest single port. Subdirectories:

- `agents/` — CloudAdvisor agent (2 files, 409 lines)
- `models/` — Provider registry (4 files, 663 lines)
- `rag/` — OCI embedder + Oracle vector store (4 files, 1,262 lines)
- `storage/` — Oracle MastraStorage implementation (4 files, 2,659 lines)
- `workflows/` — Workflow executor (2 files, 662 lines)
- `tools/` — 60+ OCI tool wrappers (17 files, ~4,288 lines)
- `mcp/` — Portal MCP server (1 file, 289 lines)

**Step 1: Copy entire mastra directory**

```bash
SRC=/Users/acedergr/Projects/oci-genai-examples/oci-ai-chat/apps/api/src/mastra
DEST=/Users/acedergr/Projects/oci-self-service-portal/apps/api/src/mastra

cp -r "$SRC" "$DEST"
```

**Step 2: Adapt imports globally**

In ALL `.ts` files under `$DEST/`:

- `@acedergren/portal-shared` → `@portal/shared`
- `@acedergren/oci-genai-provider` → verify package name matches what's installed
- Zod imports: verify Zod 4 compatibility in all schema definitions
- Oracle imports: `oracle-vector-store.ts` and `oracle-store.ts` use Oracle SQL — verify they reference `@portal/shared/server/oracle/` connection patterns

**Step 3: Check for duplicate tools**

This repo already has tools in `packages/shared/src/tools/`. The Mastra tools in `apps/api/src/mastra/tools/` may DUPLICATE them. Compare:

- `$DEST/tools/categories/compute.ts` vs `packages/shared/src/tools/categories/compute.ts`

If they're the same, make Mastra tools import from `@portal/shared/tools/` instead of having their own copies. If they differ (Mastra tools use Mastra's `createTool()` vs shared tools use AI SDK `tool()`), keep both but document the distinction.

**Step 4: Check for duplicate pricing/terraform**

Same issue — `apps/api/src/mastra/tools/lib/pricing/` may duplicate `packages/shared/src/pricing/`. Deduplicate.

**Step 5: Type check**

```bash
cd apps/api && npx tsc --noEmit
```

Fix errors. Most will be import paths and Zod version mismatches.

**Step 6: Run Mastra tests**

```bash
npx vitest run apps/api/src/mastra/ --reporter=verbose
```

Expected: ~310 tests across agent, models, RAG, storage, workflows, tools. Fix failures.

**Step 7: Commit**

```bash
git add apps/api/src/mastra/
git commit -m "feat(api): port Mastra framework integration (agents, RAG, storage, tools, MCP)

CloudAdvisor agent, OCI embedder, Oracle vector store, Oracle MastraStorage,
workflow executor, 60+ OCI tool wrappers, portal MCP server.
40 files, 11,232 lines. Adapted for @portal/* and Zod 4.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Port API Plugins

**Files:**

- Create: `apps/api/src/plugins/helmet.ts` (16 lines)
- Create: `apps/api/src/plugins/helmet.test.ts` (36 lines)
- Create: `apps/api/src/plugins/cors.ts` (19 lines)
- Create: `apps/api/src/plugins/cors.test.ts` (58 lines)
- Create: `apps/api/src/plugins/rate-limit.ts` (16 lines)
- Create: `apps/api/src/plugins/rate-limit.test.ts` (43 lines)
- Create: `apps/api/src/plugins/request-logger.ts` (51 lines)
- Create: `apps/api/src/plugins/request-logger.test.ts` (153 lines)
- Create: `apps/api/src/plugins/error-handler.ts` (31 lines)
- Create: `apps/api/src/plugins/error-handler.test.ts` (155 lines)
- Create: `apps/api/src/plugins/session.ts` (130 lines)
- Create: `apps/api/src/plugins/session.test.ts` (265 lines)
- Create: `apps/api/src/plugins/mastra.ts` (139 lines)
- Create: `apps/api/src/plugins/mastra.test.ts` (111 lines)
- Modify: `apps/api/src/plugins/oracle.ts` (merge improvements)
- Modify: `apps/api/src/plugins/rbac.ts` (merge improvements)
- Modify: `apps/api/src/plugins/index.ts` (update exports)

**IMPORTANT:** This repo already has `oracle.ts` (90 lines), `auth.ts` (113 lines), `rbac.ts` (167 lines). Do NOT blindly overwrite them — they have Zod 4 and Fastify 5.7.4 adaptations.

**Step 1: Copy NEW plugins (that don't exist here)**

```bash
SRC=/Users/acedergr/Projects/oci-genai-examples/oci-ai-chat/apps/api/src/plugins
DEST=/Users/acedergr/Projects/oci-self-service-portal/apps/api/src/plugins

# Only copy files that DON'T exist in DEST
for file in helmet.ts helmet.test.ts cors.ts cors.test.ts rate-limit.ts rate-limit.test.ts \
            request-logger.ts request-logger.test.ts error-handler.ts error-handler.test.ts \
            session.ts session.test.ts mastra.ts mastra.test.ts; do
  cp "$SRC/$file" "$DEST/$file"
done
```

**Step 2: Merge oracle.ts improvements**

Diff the two `oracle.ts` files:

- Source (129 lines) vs target (90 lines)
- The source has: health check integration, connection pool diagnostics, `withConnection` decorator with richer error handling
- Merge these improvements INTO the existing target file. Keep the target's Zod 4 / Fastify 5.7 patterns.

**Step 3: Merge rbac.ts improvements**

Diff the two `rbac.ts` files:

- Source (171 lines) vs target (167 lines)
- Very similar size — compare for security fixes (IDOR org-scoping, permission checks)
- Merge security improvements if any.

**Step 4: Decide on auth.ts vs session.ts**

The source repo split auth into `session.ts` (Better Auth session handling) and kept RBAC separate. The target repo has `auth.ts` which combines auth + session. Decide:

- Option A: Keep `auth.ts`, add session improvements to it
- Option B: Replace `auth.ts` with `session.ts` pattern from source

Recommend Option A (less disruption) unless `auth.ts` is significantly worse.

**Step 5: Adapt all new plugins for Zod 4**

Check every new plugin file for Zod usage and adapt.

**Step 6: Update plugin index**

Edit `apps/api/src/plugins/index.ts` to export all new plugins.

**Step 7: Run plugin tests**

```bash
npx vitest run apps/api/src/plugins/ --reporter=verbose
```

**Step 8: Commit**

```bash
git add apps/api/src/plugins/
git commit -m "feat(api): port security plugins (helmet, cors, rate-limit, logger, error-handler, session, mastra)

14 new files. Merged improvements into existing oracle.ts and rbac.ts.
All adapted for Zod 4 and Fastify 5.7.4.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Port API Routes

**Files:**

- Create: `apps/api/src/routes/schemas.ts` (141 lines)
- Create: `apps/api/src/routes/search.ts` (84 lines)
- Create: `apps/api/src/routes/mcp.ts` (97 lines)
- Create: `apps/api/src/routes/mcp.test.ts` (216 lines)
- Create: `apps/api/src/routes/workflows.ts` (535 lines)
- Create: `apps/api/src/routes/workflows.test.ts` (565 lines)
- Create: `apps/api/src/routes/tools/index.ts` (2 lines)
- Create: `apps/api/src/routes/tools/execute.ts` (124 lines)
- Create: `apps/api/src/routes/tools/execute.test.ts` (251 lines)
- Create: `apps/api/src/routes/tools/approve.ts` (94 lines)
- Create: `apps/api/src/routes/tools/approve.test.ts` (202 lines)
- Modify: `apps/api/src/routes/health.ts` (merge improvements: 157 lines in source vs 39 lines in target)
- Modify: `apps/api/src/routes/sessions.ts` (merge: 235 vs 162 lines)

**IMPORTANT:** Routes that exist in both repos (health, sessions, activity, chat) must be MERGED, not overwritten. The target versions have Zod 4 schemas.

**Step 1: Copy NEW routes**

```bash
SRC=/Users/acedergr/Projects/oci-genai-examples/oci-ai-chat/apps/api/src/routes
DEST=/Users/acedergr/Projects/oci-self-service-portal/apps/api/src/routes

for file in schemas.ts search.ts mcp.ts mcp.test.ts workflows.ts workflows.test.ts; do
  cp "$SRC/$file" "$DEST/$file"
done

mkdir -p "$DEST/tools"
cp "$SRC/tools"/* "$DEST/tools/"
```

**Step 2: Copy test files for existing routes (that don't have tests)**

```bash
for file in health.test.ts sessions.test.ts activity.test.ts chat.test.ts; do
  cp "$SRC/$file" "$DEST/$file"
done
```

**Step 3: Merge health.ts improvements**

Source health route (157 lines) has: deep health checks (DB connection, pool stats, Mastra status). Target (39 lines) is basic. Merge the deep checks into the target's structure.

**Step 4: Merge sessions.ts improvements**

Source (235 lines) vs target (162 lines). Source adds: org-scoped session queries, pagination, search. Merge into target.

**Step 5: Adapt all for Zod 4**

All route schemas must use Zod 4 syntax.

**Step 6: Register new routes in app factory**

Edit `apps/api/src/app.ts` to register: search, mcp, workflows, tools/execute, tools/approve routes.

**Step 7: Run route tests**

```bash
npx vitest run apps/api/src/routes/ --reporter=verbose
```

**Step 8: Commit**

```bash
git add apps/api/src/routes/
git commit -m "feat(api): port API routes (search, mcp, workflows, tools + tests)

New: schemas, search, mcp, workflows, tools/execute, tools/approve
Merged: health (deep checks), sessions (org-scoping, pagination)
8 test files ported.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 12: Port Services Layer

**Files:**

- Create: `apps/api/src/services/tools.ts` (76 lines)
- Create: `apps/api/src/services/approvals.ts` (146 lines)
- Create: `apps/api/src/services/workflow-repository.ts` (827 lines)

**Step 1: Check for overlap with packages/shared**

Before copying, check what already exists:

- `packages/shared/src/server/approvals.ts` — may overlap with `services/approvals.ts`
- `packages/shared/src/server/workflows/` — may overlap with `services/workflow-repository.ts`
- `packages/shared/src/tools/executor.ts` — may overlap with `services/tools.ts`

If the shared versions are more complete, make the API services THIN WRAPPERS that call into shared. If the oci-ai-chat services have additional Fastify-specific logic, keep them as services that compose shared modules.

**Step 2: Copy service files**

```bash
SRC=/Users/acedergr/Projects/oci-genai-examples/oci-ai-chat/apps/api/src/services
DEST=/Users/acedergr/Projects/oci-self-service-portal/apps/api/src/services

mkdir -p "$DEST"
cp "$SRC"/*.ts "$DEST/"
```

**Step 3: Adapt imports and deduplicate**

- Replace `@acedergren/*` → `@portal/*`
- Where service duplicates shared logic, refactor to import from `@portal/shared/server/`

**Step 4: Type check**

```bash
cd apps/api && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add apps/api/src/services/
git commit -m "feat(api): port services layer (tools adapter, approvals, workflow repository)

Thin wrappers composing @portal/shared server modules with Fastify-specific logic.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 13: Port Security Hardening Fixes

This task ports specific security fixes that were applied to oci-ai-chat AFTER the repos diverged. These are surgical fixes, not bulk copies.

**Step 1: Audit which fixes already exist**

Check each fix against this repo's codebase:

| Fix                                    | Source location                                             | Check in self-service-portal                               |
| -------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| Atomic DELETE for workflows            | `$SRC/apps/frontend/src/lib/server/workflows/repository.ts` | Check `packages/shared/src/server/workflows/repository.ts` |
| LIKE escaping in search                | `$SRC/apps/frontend/src/lib/server/oracle/` repositories    | Check `packages/shared/src/server/oracle/repositories/`    |
| CSP nonce regex fix                    | `$SRC/apps/frontend/src/hooks.server.ts`                    | Check `apps/frontend/src/hooks.server.ts`                  |
| ESCAPE clause in SQL                   | Various repository files                                    | Grep for `LIKE` without `ESCAPE` in shared                 |
| Workflow IDOR org-scoping              | Workflow repository + routes                                | Check workflow queries filter by `org_id`                  |
| SSRF prevention (`isValidExternalUrl`) | `$SRC/apps/frontend/src/lib/server/admin/`                  | Should be in Task 4's code                                 |
| Setup token guard                      | `$SRC/apps/frontend/src/lib/server/admin/setup-token.ts`    | Should be in Task 4's code                                 |
| Secret stripping                       | `$SRC/apps/frontend/src/lib/server/admin/strip-secrets.ts`  | Should be in Task 4's code                                 |

**Step 2: Apply missing fixes**

For each fix NOT already present, apply it. Use diff to understand the exact change, then apply to the correct file in this repo.

**Step 3: Run affected tests**

```bash
pnpm test
```

**Step 4: Commit**

```bash
git add -p  # stage only security-related changes
git commit -m "fix(security): port security hardening fixes from oci-ai-chat

Applied: [list the fixes that were actually missing]
Already present: [list fixes that already existed]

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 14: Fix Existing Test Failures

**Context:** This repo currently has 233 test failures. Root cause is Oracle connection pool initialization in test environment — tests try to create real Oracle connections instead of mocking.

**Step 1: Identify the mock pattern from oci-ai-chat**

Read how oci-ai-chat mocks Oracle connections in test files. Look at:

- `$SRC/apps/frontend/src/tests/phase4/` — security tests
- `$SRC/apps/frontend/src/tests/phase7/` — workflow tests

Common pattern:

```typescript
vi.mock('$lib/server/oracle/connection', () => ({
	withConnection: vi.fn(async (fn) => fn(mockConnection)),
	getPool: vi.fn(() => mockPool)
}));
```

**Step 2: Apply mock pattern to failing tests**

Run the test suite and categorize failures:

```bash
pnpm test 2>&1 | grep "FAIL" | head -30
```

For each failing test file, add the Oracle mock at the top.

**Step 3: Fix tests iteratively**

Run, fix, repeat until all pass:

```bash
npx vitest run --reporter=verbose 2>&1 | tail -5
```

Target: 0 failures.

**Step 4: Commit**

```bash
git add -p
git commit -m "fix(test): resolve 233 test failures with proper Oracle connection mocking

Applied consistent vi.mock() pattern for Oracle connection pool
across all test files that touch database repositories.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 15: Port Remaining Test Files

**Step 1: Identify test files in oci-ai-chat that don't exist here**

```bash
# List all test files in source
find /Users/acedergr/Projects/oci-genai-examples/oci-ai-chat/apps -name "*.test.ts" | sort > /tmp/src-tests.txt

# List all test files in target
find /Users/acedergr/Projects/oci-self-service-portal/apps -name "*.test.ts" | sort > /tmp/dest-tests.txt

# Compare (adjust paths for diff)
diff /tmp/src-tests.txt /tmp/dest-tests.txt
```

**Step 2: Copy missing test files**

For each test file that exists in source but not target, copy and adapt imports.

**Step 3: Run full suite**

```bash
pnpm test
```

Target: 800+ passing, 0 failing.

**Step 4: Commit**

```bash
git add apps/frontend/src/tests/ apps/api/src/
git commit -m "test: port remaining test files from oci-ai-chat

Added tests for: [list areas covered]
Total: [X] passing, 0 failing.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 16: Update App Factory Plugin Chain

**Files:**

- Modify: `apps/api/src/app.ts`

The app factory needs to register all new plugins in the correct order.

**Step 1: Read current app.ts**

Understand the current plugin registration chain.

**Step 2: Read oci-ai-chat's app.ts for reference**

`$SRC/apps/api/src/app.ts` — has the 9-step plugin chain:

1. error-handler
2. request-logger
3. helmet
4. CORS
5. rate-limit
6. cookie
7. oracle
8. session
9. RBAC

Plus route registration including: health, sessions, activity, chat, search, mcp, tools, workflows.

**Step 3: Update this repo's app.ts**

Add missing plugins and routes to match. Keep this repo's Fastify 5.7 patterns.

**Step 4: Type check and test**

```bash
cd apps/api && npx tsc --noEmit
pnpm test
```

**Step 5: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "feat(api): wire all plugins and routes into app factory

Plugin chain: error-handler → logger → helmet → cors → rate-limit → cookie → oracle → session → rbac → mastra
Routes: health, sessions, activity, chat, search, mcp, tools, workflows

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 17: Update Dockerfile

**Files:**

- Modify: `Dockerfile`

**Step 1: Read current Dockerfile**

Check for stale references to deleted packages (agent-state, mcp-client, oci-genai-provider, oci-genai-query).

**Step 2: Update build steps**

- Remove any COPY/build commands for deleted packages
- Add Mastra dependencies (should be handled by `pnpm install` if in package.json)
- Ensure multi-stage build includes `apps/api` build step

**Step 3: Test Docker build**

```bash
docker build -t oci-self-service-portal:test .
```

**Step 4: Commit**

```bash
git add Dockerfile
git commit -m "fix(docker): update Dockerfile for Mastra deps and remove stale package refs

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 18: Update Documentation

**Files:**

- Modify: `docs/ROADMAP.md`
- Modify: `docs/ARCHITECTURE.md` (if exists)
- Modify: `docs/SECURITY.md` (if exists)
- Modify: `README.md`

**Step 1: Port ROADMAP.md updates**

Copy the phase completion status from `$SRC/docs/ROADMAP.md`:

- Mark Phase 9A (Admin Console) as complete
- Mark API Security Hardening as complete
- Mark Stabilization Sprint as complete
- Add current test counts

**Step 2: Port architecture additions**

If ARCHITECTURE.md exists, add sections for:

- Admin console architecture
- Mastra integration (agents, RAG pipeline, MCP)
- Plugin chain documentation

**Step 3: Port security additions**

If SECURITY.md exists, add sections for:

- Setup token guard
- Secret stripping
- SSRF prevention
- Admin security model

**Step 4: Commit**

```bash
git add docs/ README.md
git commit -m "docs: update documentation with admin console, Mastra, and security additions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 19: Final Verification

**Step 1: Full clean build**

```bash
rm -rf node_modules apps/frontend/node_modules apps/api/node_modules packages/shared/node_modules
pnpm install
pnpm lint
pnpm test
pnpm build
```

**Step 2: Docker build**

```bash
docker build -t oci-self-service-portal:verify .
```

**Step 3: Record final stats**

```
Tests: [X] passing, [Y] failing
Lint: [X] errors, [Y] warnings
Build: success/fail
Docker: success/fail
```

**Step 4: Final commit (if any fixes needed)**

```bash
git add -p
git commit -m "chore: final verification fixes for backport migration

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary Table

| Task | Description           | Files  | LOC    | Key Risk                  |
| ---- | --------------------- | ------ | ------ | ------------------------- |
| 1    | Baseline & branch     | 0      | 0      | —                         |
| 2    | Oracle migrations     | 3      | 321    | Renumbering               |
| 3    | Claude Code ecosystem | ~21    | ~600   | Path updates              |
| 4    | Admin server code     | 7      | 1,731  | Zod 4 adaptation          |
| 5    | Admin frontend routes | 9      | 2,924  | Import paths              |
| 6    | Setup wizard          | 18     | 3,448  | Import paths              |
| 7    | Admin tests           | 5      | 1,732  | Mock adaptation           |
| 8    | Mastra dependencies   | 1      | —      | Zod 4 compat              |
| 9    | Mastra directory      | 40     | 11,232 | Deduplication with shared |
| 10   | API plugins           | 17     | 2,265  | Don't overwrite target    |
| 11   | API routes            | 13     | 3,311  | Merge, don't overwrite    |
| 12   | Services layer        | 3      | 1,049  | Deduplicate with shared   |
| 13   | Security fixes        | varies | varies | Audit first               |
| 14   | Fix 233 test failures | varies | varies | Oracle mock pattern       |
| 15   | Port remaining tests  | varies | varies | Import adaptation         |
| 16   | App factory wiring    | 1      | ~200   | Plugin order              |
| 17   | Dockerfile update     | 1      | ~50    | Build verification        |
| 18   | Documentation         | 4      | ~500   | —                         |
| 19   | Final verification    | 0      | 0      | Full-stack check          |
