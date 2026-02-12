# Agents Guide

This repo is optimized for running software engineering agents (human + AI) against a pnpm monorepo.

If you are an agent, read `CLAUDE.md` first. This file mirrors the actionable parts in a shorter, role-oriented format.

## Repo Snapshot

- Monorepo: SvelteKit frontend + Fastify 5 API + shared packages
- Package manager: pnpm workspaces
- Primary folders: `apps/` and `packages/`

## Behavioral Rules

- Stay focused; do not expand scope beyond the request.
- Verify before assuming (paths, exports, config).
- Fail fast on blockers (hooks, permissions, missing deps).

## Scope Discipline

- Do not refactor or fix unrelated issues unless explicitly asked.
- If you find something interesting but out-of-scope, note it and stop.

## Git Hygiene

- Never use bulk staging: do not run `git add -A` or `git add .`.
- Commit early and often (one logical unit at a time).
- Run lint + typecheck + relevant tests before committing.

## Pre-commit Hooks

- If hooks fail due to pre-existing errors unrelated to your change:
  - report the failure clearly
  - do not attempt to fix unrelated lint across the repo
  - suggest using `--no-verify` or adjusting hook configuration

## Quick Start

```bash
pnpm install                     # Install all workspace dependencies
pnpm dev                         # SvelteKit dev server (port 5173)
pnpm lint                        # ESLint across all workspaces
pnpm build                       # Production build (needs BETTER_AUTH_SECRET)
npx vitest run                   # Run all tests
npx vitest run apps/api          # API tests only
npx vitest run apps/frontend     # Frontend tests only
```

Type checking:

```bash
cd apps/frontend && npx svelte-check
cd apps/api && npx tsc --noEmit
cd packages/shared && npx tsc --noEmit
```

## Monorepo Conventions

- Use `git mv` to preserve history when moving files.
- Shared types live in `packages/shared` (until Phase 10 package split lands).
- After moves, update import paths across all consuming packages.
- After structural changes, run `pnpm -r build` and the full test suite.

## Repo Structure (Key Paths)

- Frontend (SvelteKit): `apps/frontend/src/`
- API (Fastify 5): `apps/api/src/`
- Shared logic: `packages/shared/src/`

## Error Model

The codebase uses a structured `PortalError` hierarchy:

```text
PortalError
|-- ValidationError (400)
|-- AuthError (401/403)
|-- NotFoundError (404)
|-- RateLimitError (429)
|-- OCIError (502)
`-- DatabaseError (503)
```

Guidelines:

- Prefer wrapping unknown errors with `toPortalError(err)`.
- Never expose internal details in HTTP responses (`toResponseBody()`).

## Naming + Framework Gotchas

- Naming: `kebab-case.ts`, `PascalCase.svelte`, `PascalCase` types, `camelCase` functions.
- ESM: imports use `.js` extensions.
- Fastify 5: `reply.send(undefined)` throws; always send a value.
- Plugin order is load-bearing in both runtime and tests.

References:

- Naming conventions: `.claude/reference/naming-conventions.md`
- Framework notes: `.claude/reference/framework-notes.md`

## Testing Rules (Vitest)

- Vitest uses `mockReset: true` across workspaces.
- Do not chain `mockResolvedValueOnce` across tests; it gets reset.
- Reconfigure mock return values in `beforeEach`.

Test helpers:

- API integration tests generally use `buildTestApp()` in `apps/api/src/tests/routes/test-helpers.ts`.

## Security + Oracle Footguns

- Never interpolate user input into SQL; always use bind parameters.
- IDOR: verify org ownership via `resolveOrgId()`.
- SSRF: validate webhook URLs; HTTPS only.
- For Oracle writes: prefer `MERGE INTO` for atomic upserts.

## Phase 10 Pointers

- Product requirements: `.claude/reference/PRD.md`
- Phase 10 execution plan: `.claude/reference/phase-10-task-plan.md`

## When You Are Blocked

- State what you tried, the exact failure, and what input you need.
- Do not work around by broad refactors or disabling safety checks.
