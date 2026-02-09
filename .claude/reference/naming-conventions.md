# Naming Conventions Reference

## File Naming

| Category           | Convention                       | Example                                         |
| ------------------ | -------------------------------- | ----------------------------------------------- |
| TypeScript modules | `kebab-case.ts`                  | `oracle-adapter.ts`, `error-handler.ts`         |
| Svelte components  | `PascalCase.svelte`              | `SearchBox.svelte`, `AgentWorkflowPanel.svelte` |
| SvelteKit routes   | `+server.ts`, `+page.svelte`     | `routes/api/v1/workflows/+server.ts`            |
| Tests              | `[module].test.ts` (colocated)   | `rbac.test.ts` next to `rbac.ts`                |
| Migrations         | `NNN-name.sql` (zero-padded)     | `006-api-keys.sql`, `009-admin.sql`             |
| Fastify plugins    | `kebab-case.ts` + `fp()` wrapper | `plugins/rate-limit.ts`                         |

## TypeScript Naming

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

## Database Naming (Oracle)

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

## API Routes

| Convention              | Example                                     |
| ----------------------- | ------------------------------------------- |
| Versioned base path     | `/api/v1/`                                  |
| Resource collections    | `/api/v1/workflows` (GET=list, POST=create) |
| Resource instances      | `/api/v1/workflows/[id]` (GET, PUT, DELETE) |
| Actions on resources    | `/api/v1/workflows/[id]/run` (POST)         |
| Query params: camelCase | `?limit=50&offset=0&search=text`            |
| Route params: camelCase | `[id]`, `[runId]`, `[name]`                 |

## Import Order

```typescript
// 1. Node built-ins / external packages
import { execFile } from "child_process";
import { z } from "zod";

// 2. Framework imports
import { json } from "@sveltejs/kit";
import type { FastifyPluginAsync } from "fastify";

// 3. Local $lib / package imports
import { OCIError } from "$lib/server/errors.js";
import { createLogger } from "$lib/server/logger.js";

// 4. Relative imports
import { errorResponse } from "../errors.js";
```

- Always use `.js` extensions in import paths (ESM requirement)
- Use `type` keyword for type-only imports: `import type { SessionUser } from './session.js'`
- Verify import paths against actual package exports before using them
- Prefer dynamic imports for optional dependencies (e.g., `@ai-sdk/azure`)

## Git Commit Format

```
type(scope): description [optional-tracking-id]

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

**Types**: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
**Scopes**: `security`, `phaseX.Y`, `api`, `frontend`, `database`, `auth`, `workflows`

## Environment Variables

- Always `UPPER_SNAKE_CASE`: `ORACLE_CONNECT_STRING`, `BETTER_AUTH_SECRET`, `CORS_ORIGIN`
- Validate with Zod at startup via `loadConfig()` in `apps/api/src/config.ts`
- **Never store secrets in `.env` files** — use OCI Vault via `/manage-secrets`
- `.env` files are for non-sensitive config only (region, endpoints, feature flags)
