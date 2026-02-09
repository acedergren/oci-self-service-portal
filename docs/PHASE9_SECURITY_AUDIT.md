# Phase 9 Security Audit Report

**Auditor**: Security Specialist (automated agent)
**Date**: 2026-02-07
**Scope**: Phase 9 Fastify Backend Migration
**Repository**: `oci-self-service-portal` branch `feature/phase9-fastify-migration`
**Cross-reviewed with**: CodeRabbit code-reviewer agent (22 findings)

## Summary

| Severity   | Count | Fixed | Accepted | Deferred        |
| ---------- | ----- | ----- | -------- | --------------- |
| Critical   | 0     | -     | -        | -               |
| High       | 2     | 1     | 0        | 1 (in progress) |
| Medium     | 3     | 3     | 0        | 0               |
| Low        | 4     | 1     | 3        | 0               |
| Semgrep FP | 2     | 2     | 0        | 0               |

**Overall assessment**: The Fastify migration preserves all security patterns from the SvelteKit
implementation. The dual-auth model (session + API key), RBAC preHandler hooks, and Oracle fallback
patterns are well-architected. No critical vulnerabilities found.

---

## Findings

### HIGH (from cross-reference with code reviewer)

#### H-1: CORS credentials + wildcard misconfiguration

- **File**: `apps/api/src/app.ts:69,128-131`
- **Severity**: HIGH
- **Status**: In progress (task #38, assigned to backend-developer-2)
- **Issue**: `corsOrigin` defaults to `'*'` with `credentials: true`. Per the CORS spec,
  `Access-Control-Allow-Origin: *` is incompatible with `credentials: true` — browsers silently
  reject credentialed cross-origin requests. This breaks session-cookie auth for cross-origin
  deployments without any error message.
- **Fix**: Require `CORS_ORIGIN` env var in production (fail fast if missing). Default to
  same-origin only, not wildcard.
- **Security risk**: Session auth silently fails cross-origin. API key auth via Bearer header
  in non-credentialed requests is unrestricted from any origin.

#### H-2: X-API-Key header contract mismatch

- **File**: `apps/api/src/plugins/rbac.ts:15-25`
- **Severity**: HIGH
- **Status**: FIXED
- **Issue**: Tests assert `X-API-Key` header support but `rbac.ts` only checked
  `Authorization: Bearer portal_*`. Clients relying on `X-API-Key` header got 401s.
- **Fix applied**: Extracted `extractApiKey()` helper that checks both `Authorization: Bearer portal_*`
  and `X-API-Key: portal_*` headers. Both `requireAuth()` and `requireAuthenticated()` now use
  this shared helper. `Authorization` header takes precedence if both are present.
- **Found by**: Code reviewer (not in security audit scope — test/code mismatch)
- **Commit**: `fix(security): implement X-API-Key header support in RBAC middleware`

### MEDIUM

#### M-1: Missing LIKE ESCAPE clause in session search

- **File**: `packages/shared/src/server/oracle/repositories/session-repository.ts:217`
- **Severity**: MEDIUM
- **Status**: FIXED
- **Issue**: Session search escaped `%` and `_` manually but omitted the Oracle `ESCAPE` clause.
  Without `ESCAPE '\'`, Oracle doesn't recognize `\` as the escape character, making the manual
  escaping ineffective. Users could inject `%` wildcards for search enumeration.
- **Fix applied**: Added `ESCAPE '\'` to the SQL LIKE clause and added `\\` to the JS regex
  escape pattern to also escape literal backslashes.
- **Commit**: `fix(security): LIKE escape, approval org-scoping, auth log level`

#### M-2: Cross-org approval consumption (IDOR)

- **File**: `apps/api/src/routes/tools.ts:115` + `packages/shared/src/server/approvals.ts:68`
- **Severity**: MEDIUM
- **Status**: FIXED
- **Issue**: `consumeApproval(toolCallId, toolName)` checked `tool_call_id` and `tool_name` but
  NOT `org_id`. While approval _creation_ was org-scoped, consumption was not — any authenticated
  user with the UUID could consume a cross-org approval.
- **Risk**: Low probability (UUIDs are unguessable, 5-min TTL) but violates defense-in-depth for
  multi-tenant isolation.
- **Fix applied**: Added optional `orgId` parameter to both `recordApproval()` and
  `consumeApproval()`. Oracle SQL uses NULL-safe comparison:
  `(org_id = :orgId OR (org_id IS NULL AND :orgId2 IS NULL))`. In-memory fallback also checks
  orgId match. Both callers in `tools.ts` now pass `resolveOrgId(request)`.
- **Note**: The `approved_tool_calls` table doesn't exist in any migration file — code falls back
  to in-memory. Future migration should include `org_id VARCHAR2(255)` column.
- **Commit**: `fix(security): LIKE escape, approval org-scoping, auth log level`

#### M-3: Auth errors logged at DEBUG level

- **File**: `apps/api/src/plugins/auth.ts:106`
- **Severity**: MEDIUM (upgraded from LOW after code reviewer concurrence)
- **Status**: FIXED
- **Issue**: `log.debug` for session resolution failures. In production (typically INFO+ log level),
  persistent auth backend failures (DB down, config error) would appear as mass unauthenticated
  requests with no warning-level alerts.
- **Fix applied**: Changed `log.debug` to `log.warn`.
- **Commit**: `fix(security): LIKE escape, approval org-scoping, auth log level`

### LOW

#### L-1: CORS defaults to `origin: '*'`

- **File**: `apps/api/src/app.ts:69`
- **Severity**: LOW (subsumes into H-1 for the full fix)
- **Status**: Accepted for dev; addressed by H-1 for production
- **Issue**: Wildcard CORS default is fine for local development but must be explicitly configured
  in production via `CORS_ORIGIN` env var.

#### L-2: X-Request-Id header trusted from external input

- **File**: `apps/api/src/app.ts:118-119`
- **Severity**: LOW
- **Status**: Accepted
- **Issue**: External `X-Request-Id` accepted without format validation. Could inject long strings,
  newlines, or ANSI codes for log pollution. Standard practice for distributed tracing — upstream
  request IDs should be forwarded.
- **Recommendation**: Validate format (alphanumeric + hyphens, max 64 chars) in a future hardening
  pass.

#### L-3: Cookie secret non-production fallback

- **File**: `apps/api/src/app.ts:195`
- **Severity**: LOW
- **Status**: Accepted
- **Issue**: `'dev-secret-change-in-production'` fallback exists. Production guard at line 78
  catches `NODE_ENV=production`, but if `NODE_ENV` is unset entirely, the insecure default is used.
- **Mitigation**: The fatal check at line 78-81 covers the production deployment path.

#### L-4: `trustProxy: true` unconditionally trusts all proxies

- **File**: `apps/api/src/app.ts:88`
- **Severity**: LOW
- **Status**: Accepted
- **Issue**: Trusts all `X-Forwarded-*` headers. Correct for the documented nginx deployment but
  overly permissive if Fastify is exposed directly.
- **Recommendation**: Use `trustProxy: 1` (single hop) in production for defense-in-depth.

### Semgrep Findings (False Positives)

#### S-1: `gcm-no-tag-length` in crypto.ts — FALSE POSITIVE

- **File**: `packages/shared/src/server/crypto.ts:81,110`
- **Status**: FIXED (nosemgrep directives added)
- **Analysis**: Node.js `createCipheriv`/`createDecipheriv` defaults to 16-byte (128-bit) GCM auth
  tags — the maximum and recommended length. The code explicitly manages 16-byte tags via
  `WEBHOOK_ENCRYPTION_TAG_BYTES = 16`. The auth tag is correctly extracted from the ciphertext
  payload at a fixed offset and verified via `decipher.setAuthTag()`.
- **Nosemgrep**: Added to line 81 (`getAuthTag`) and line 110 (`createDecipheriv`) with
  explanatory comments.
- **Commit**: `fix(security): add nosemgrep comments for false positive findings`

#### S-2: `path-join-resolve-traversal` in migrations.ts — FALSE POSITIVE

- **File**: `packages/shared/src/server/oracle/migrations.ts:27`
- **Status**: FIXED (nosemgrep directive enhanced with explanation)
- **Analysis**: Triple mitigation in place:
  1. Filenames come from `readdirSync()` (OS-level, not attacker-controlled)
  2. Regex validates only `[0-9a-zA-Z_-]` characters in filenames (`/^(\d+)-([a-zA-Z0-9_-]+)\.sql$/`)
  3. `resolve()` + `startsWith(MIGRATIONS_DIR + '/')` check as defense-in-depth
- **Nosemgrep**: Enhanced existing directive with explanation of the regex validation and
  startsWith guard.
- **Commit**: `fix(security): add nosemgrep comments for false positive findings`

---

## Positive Findings

The following security patterns are correctly implemented:

1. **Dual auth pattern**: `requireAuth(permission)` cleanly handles session + API key with proper
   401 (unauthenticated) vs 403 (unauthorized) distinction. `admin:all` bypass is correctly checked.

2. **RBAC org-scoping**: `resolveOrgId()` works for both auth paths (session
   `activeOrganizationId` and API key `orgId`). Approval endpoints properly scope by org.

3. **Session IDOR prevention**: `deleteSession(id, userId)` uses atomic
   `WHERE id = :id AND user_id = :userId` — no TOCTOU race.

4. **Approval atomicity**: `consumeApproval()` uses atomic `DELETE` with expiry check in a single
   SQL statement. No SELECT-then-DELETE race condition.

5. **Helmet security headers**: Comprehensive CSP with nonces, HSTS with preload, X-Frame-Options
   deny, Permissions-Policy, referrer policy, and defense-in-depth via nginx doubling headers.

6. **Error handling**: `PortalError` hierarchy prevents internal stack traces from leaking.
   `errorResponse()` produces safe HTTP response bodies.

7. **API key security**: SHA-256 hashed storage, soft-delete revocation (hashes never removed),
   expiry checks, key_prefix-only display, `last_used_at` audit trail.

8. **Webhook encryption**: AES-256-GCM with 12-byte random IV, 16-byte auth tag verification,
   base64url encoding. Key decoded from hex/base64url/base64 with length validation.

9. **Cookie security**: `httpOnly: true`, `Secure` in production, `SameSite=lax` default,
   browser `SameSite=None` + insecure guard (falls back to `lax`).

10. **Rate limiting**: Fail-open design (`skipOnError: true`), per-window limits (60 req/min API,
    20 req/min chat), proper 429 responses with retry-after hint.

11. **Plugin dependency order**: Oracle -> Auth -> RBAC enforced via `fastify-plugin` `dependencies`
    array. Prevents registration order bugs.

---

## Cross-Reference with Code Reviewer

The CodeRabbit code-reviewer independently reviewed the same codebase and produced 22 findings
(0 Critical, 3 High, 5 Medium, 7 Low, 7 Nitpick).

### Overlapping Findings (both reviewers found)

| Finding                    | Security Audit | Code Review | Agreed Severity |
| -------------------------- | -------------- | ----------- | --------------- |
| Auth errors at DEBUG level | L-1            | M-1         | MEDIUM          |
| CORS wildcard default      | L-2            | H-1         | HIGH            |
| Cookie secret fallback     | L-4            | L-4         | LOW             |
| trustProxy:true            | L-3            | L-6         | LOW             |

### Security Audit Only

| Finding                      | Severity | Rationale                                             |
| ---------------------------- | -------- | ----------------------------------------------------- |
| M-1: LIKE ESCAPE clause      | MEDIUM   | Oracle-specific SQL — not visible in Fastify routes   |
| M-2: Cross-org approval IDOR | MEDIUM   | Multi-tenant isolation gap in shared approvals module |
| L-2: X-Request-Id validation | LOW      | Log injection via untrusted header                    |
| S-1: GCM tag length FP       | FP       | Confirmed default 128-bit is correct                  |
| S-2: Path traversal FP       | FP       | Confirmed triple mitigation is adequate               |

### Code Reviewer Only

| Finding                          | Severity | Notes                       |
| -------------------------------- | -------- | --------------------------- |
| H-3: X-API-Key header mismatch   | HIGH     | Test/code contract broken   |
| M-2: errorResponse() shape       | MEDIUM   | Fastify convention mismatch |
| M-3: pendingApprovals not shared | MEDIUM   | Single-worker limitation    |
| M-4: Dockerfile copies dev deps  | MEDIUM   | Image bloat, not security   |
| M-5: /healthz not in nginx       | MEDIUM   | Documentation gap           |
| L-1: Inconsistent error shapes   | LOW      | DX issue                    |
| L-2: Zod import path fragility   | LOW      | CI risk                     |
| L-3: Unnecessary `as` casts      | LOW      | Type safety bypass          |
| L-5: process.env replacement     | LOW      | Test fragility              |
| L-7: Empty **tests** directory   | LOW      | Cleanup                     |
| N-1 through N-7                  | NITPICK  | Various improvements        |

---

## Fixes Applied

| Fix                                    | Files Changed                                                             | Commit                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Nosemgrep: gcm-no-tag-length           | `packages/shared/src/server/crypto.ts`                                    | `fix(security): add nosemgrep comments for false positive findings`    |
| Nosemgrep: path-join-resolve-traversal | `packages/shared/src/server/oracle/migrations.ts`                         | `fix(security): add nosemgrep comments for false positive findings`    |
| M-1: LIKE ESCAPE clause                | `packages/shared/.../session-repository.ts`                               | `fix(security): LIKE escape, approval org-scoping, auth log level`     |
| M-2: Approval org_id isolation         | `packages/shared/src/server/approvals.ts`, `apps/api/src/routes/tools.ts` | `fix(security): LIKE escape, approval org-scoping, auth log level`     |
| M-3: Auth log level                    | `apps/api/src/plugins/auth.ts`                                            | `fix(security): LIKE escape, approval org-scoping, auth log level`     |
| H-2: X-API-Key header support          | `apps/api/src/plugins/rbac.ts`                                            | `fix(security): implement X-API-Key header support in RBAC middleware` |

---

## Recommendations for Future Phases

### Short-term (before production)

1. **H-1**: Require `CORS_ORIGIN` in production — fail fast if missing
2. **Migration**: Create `approved_tool_calls` table with `org_id` column

### Medium-term (next hardening pass)

4. Validate `X-Request-Id` format (alphanumeric + hyphens, max 64 chars)
5. Use `trustProxy: 1` instead of `true` in production
6. Align XSS header strategy: nginx sets `X-XSS-Protection: 0`, Helmet sets `1`
7. Standardize error response shapes across all routes using `errorResponse()`
8. Add auth resolution failure metric counter for monitoring dashboards

### Long-term (multi-worker scaling)

9. Move `pendingApprovals` fully to Oracle DB (currently in-memory Map with DB fallback)
10. Consider Redis for rate limiting and approval state in clustered deployments
11. Implement API key rate limiting separate from session rate limiting

---

_Report generated by security-specialist agent, Phase 9 implementation team._
