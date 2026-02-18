---
name: api-audit
description: Audit API routes against shared types — scan routes, plugins, and types for mismatches. Read-only, no changes.
---

# API Route & Type Audit Skill

Scan the Fastify API routes and plugins, catalog every endpoint, and cross-reference against shared type definitions to find mismatches. **Read-only — do not modify any files.**

## Steps

### 1. Scan Route Files

Use the Explore agent or direct Grep/Read to scan `apps/api/src/routes/` recursively. For each route registration, extract:

- **HTTP method** (GET, POST, PUT, PATCH, DELETE)
- **Path** (e.g., `/api/chat`, `/api/admin/settings`)
- **Auth requirements** (public, session-required, RBAC permissions)
- **Request schema** (Zod schema name or inline shape, if defined)
- **Response schema** (Zod schema name or inline shape, if defined)

Look for patterns:

- `fastify.get(...)`, `fastify.post(...)`, etc.
- `{ preHandler: [...] }` hooks for auth
- `{ schema: { body, querystring, params, response } }` for validation
- `onRequest` hooks referencing `requireAuth`, `requirePermission`, or `rbac`

### 2. Scan Plugin Files

Scan `apps/api/src/plugins/` for:

- Auth middleware registration (which routes get auth protection)
- RBAC permission mappings
- Rate limiting configurations per route
- Any route-level decorators or hooks

### 3. Catalog Shared Types

Scan `packages/types/src/` and `packages/shared/src/types/` for:

- Zod schemas used as request/response validators
- TypeScript interfaces/types that correspond to API payloads
- Exported schema names and their shapes

### 4. Cross-Reference and Detect Mismatches

Compare the route catalog against type definitions to find:

| Category              | What to check                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------- |
| **Missing schemas**   | Routes without request/response Zod validation                                           |
| **Type drift**        | Route handler using a type that differs from the shared schema                           |
| **Orphan types**      | Schemas in `packages/types` not referenced by any route                                  |
| **Auth gaps**         | Routes missing auth hooks that should have them (based on path patterns like `/admin/*`) |
| **Method mismatches** | Frontend fetch calls using wrong HTTP method for a route                                 |

### 5. Report Findings

Output a markdown table with these columns:

```
| Route | Method | Auth | Request Schema | Response Schema | Issue |
|-------|--------|------|----------------|-----------------|-------|
```

Group findings by severity:

1. **Critical**: Auth gaps, missing validation on mutation endpoints
2. **Warning**: Type drift, missing response schemas
3. **Info**: Orphan types, routes with inline schemas that could use shared ones

Include a summary count at the top:

- Total routes scanned
- Routes with full schema coverage
- Routes with partial coverage
- Routes with no schema validation
- Type mismatches found

## Arguments

- `$ARGUMENTS`: Optional scope filter
  - Example: `/api-audit admin` — only audit `/admin/*` routes
  - Example: `/api-audit chat` — only audit chat-related routes
  - If empty, audit all routes

## Execution Strategy

Use **two parallel Explore agents** for speed:

1. **Agent A**: Scan `apps/api/src/routes/` + `apps/api/src/plugins/` — catalog all endpoints
2. **Agent B**: Scan `packages/types/src/` + `packages/shared/src/types/` — catalog all shared schemas

Then synthesize their findings into the cross-reference table.

## Key Rules

1. **Read-only** — do not create, modify, or delete any files
2. **Be specific** — report exact file paths and line numbers for each finding
3. **No false positives** — only report genuine mismatches, not stylistic differences
4. **Include context** — for each mismatch, show the relevant type/schema snippet
