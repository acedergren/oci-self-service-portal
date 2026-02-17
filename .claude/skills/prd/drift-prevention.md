# Drift Prevention Reference

Loaded during `/prd --update` and `/prd --audit-deps` modes.

## Dependency Freshness Checks

### Commands

```bash
# Check all workspaces for outdated packages
pnpm outdated --recursive

# Check a specific workspace
pnpm outdated --filter @portal/api
pnpm outdated --filter @portal/frontend
pnpm outdated --filter @portal/shared

# Security audit
pnpm audit

# Check a specific package on npm
npm view <package-name> version deprecated
```

### What to Flag

| Severity | Condition                                      | Action                                        |
| -------- | ---------------------------------------------- | --------------------------------------------- |
| Critical | Package has known CVE in current version       | Upgrade immediately or find alternative       |
| Critical | Package is marked deprecated on npm            | Plan migration to replacement                 |
| High     | Major version behind (e.g., v3 → v5 available) | Evaluate breaking changes, add to PRD backlog |
| Medium   | Minor version behind with relevant fixes       | Schedule update in next phase                 |
| Low      | Patch version behind                           | Update opportunistically                      |

### New Dependency Evaluation

Before adding a dependency to the PRD, check:

1. **Last published**: More than 12 months ago? May be abandoned.
2. **Open issues**: High issue count with no maintainer response? Risk.
3. **License**: Compatible with project license (check `package.json` license field)?
4. **Bundle size**: Run `npx bundlephobia <package>` or check bundlephobia.com.
5. **Alternatives**: Is there a lighter or more maintained alternative?
6. **Tree-shaking**: Does it support ESM and tree-shaking?

## Architectural Drift Detection

### File Path Verification

Compare PRD-referenced file paths against the actual codebase:

```bash
# For each file path in the PRD's "Affected Files" columns,
# verify the file exists
ls <path-from-prd>
```

**Drift indicator**: PRD references a file that has been moved, renamed, or deleted.
**Fix**: Update the PRD path or investigate why the file changed.

### Pattern Matching

Check that PRD architecture decisions align with what's actually in the codebase:

| Decision Area             | Check                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Plugin registration order | Compare PRD description against `apps/api/src/app.ts`                              |
| Route structure           | Compare PRD routes against `apps/api/src/routes/` directory                        |
| Component hierarchy       | Compare PRD components against `apps/frontend/src/lib/components/`                 |
| Shared package exports    | Compare PRD exports against `packages/shared/src/index.ts`                         |
| Database migrations       | Compare PRD migration plan against `packages/shared/src/server/oracle/migrations/` |

### Common Drift Indicators

- **Orphaned imports**: File imports a module that no longer exports the imported symbol
- **Unused config**: Environment variable referenced in PRD but not in `.env.example` or code
- **Stale types**: TypeScript interface in PRD doesn't match actual type definition
- **Dead routes**: API route in PRD has been removed or replaced
- **Missing migrations**: Database change in PRD without a corresponding migration file

## Oracle-Specific Drift Checks

| Check                | How                                                         | Drift Signal                           |
| -------------------- | ----------------------------------------------------------- | -------------------------------------- |
| Migration numbering  | `ls packages/shared/src/server/oracle/migrations/`          | Gap in sequence numbers                |
| Pool configuration   | Read `packages/shared/src/server/oracle/connection-pool.ts` | Pool settings differ from PRD          |
| Repository patterns  | Check repositories use `MERGE INTO` for upserts             | `INSERT` followed by `UPDATE` (TOCTOU) |
| Column case handling | Check repositories use `fromOracleRow()`                    | Direct UPPERCASE column access         |
| Bind parameters      | Check SQL queries use `:paramName` syntax                   | String interpolation in SQL            |
| Blockchain tables    | Check DDL uses `NO DROP`/`NO DELETE` clauses                | Missing immutability constraints       |

## Mastra-Specific Drift Checks

| Check                | How                                          | Drift Signal                                    |
| -------------------- | -------------------------------------------- | ----------------------------------------------- |
| Agent registration   | Read `apps/api/src/mastra/agents/`           | Agent defined in PRD but not registered         |
| Tool registry        | Read `packages/shared/src/tools/registry.ts` | Tool in PRD not in registry                     |
| Provider config      | Read `apps/api/src/mastra/models/`           | Provider in PRD not configured                  |
| Workflow definitions | Read `apps/api/src/mastra/workflows/`        | Workflow in PRD not implemented                 |
| MCP server config    | Read `packages/shared/src/server/mcp/`       | MCP tool in PRD not exposed                     |
| RAG pipeline         | Read `apps/api/src/mastra/rag/`              | Embedding model or vector store config mismatch |

## Auth & Security Drift Checks

| Check              | How                                                     | Drift Signal                         |
| ------------------ | ------------------------------------------------------- | ------------------------------------ |
| RBAC permissions   | Read `packages/shared/src/server/auth/rbac.ts`          | Permission in PRD not defined        |
| Auth middleware    | Read `apps/api/src/plugins/auth.ts`                     | Auth check described in PRD missing  |
| API key scoping    | Check API key routes enforce org isolation              | IDOR vulnerability                   |
| Webhook signatures | Check webhook handlers verify HMAC-SHA256               | Missing signature validation         |
| CSP headers        | Check helmet config in `apps/api/src/plugins/helmet.ts` | CSP policy weaker than PRD specifies |

## Drift Report Format

```
Dependency Drift Report
=======================

Critical:
  [!] @fastify/swagger v5.0.0 → v6.1.0 available (breaking changes)
  [!] better-auth: deprecated, successor: better-auth-v2

High:
  [~] mastra v0.4.2 → v0.6.0 available (new agent API)

Medium:
  [~] vitest v3.0.0 → v4.1.0 available (Vitest 4 support)

Architectural Drift:
  [!] PRD references apps/api/src/routes/workflows.ts — file moved to apps/api/src/routes/workflows/index.ts
  [~] PRD lists 58 tools — registry now has 63 (5 added without PRD update)

Security Drift:
  [OK] No security drift detected
```
