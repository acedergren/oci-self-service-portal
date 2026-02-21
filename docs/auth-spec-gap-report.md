# Auth & Authorization Specification — Gap Report

**Date**: 2026-02-22
**Branch**: `feat/auth-spec-hardening`
**Audited by**: 3 parallel Explore agents (Opus)

## Executive Summary

The CloudNow auth implementation is **architecturally sound** — OIDC+PKCE, 13-permission RBAC, dual auth, Oracle VPD, IDCS provisioning all work correctly. The gaps are **security hardening** items, not missing architecture. 7 implementation gaps confirmed, 1 critical.

---

## Gap Summary

| ID  | Gap                                                                      | Severity     | Plan Task | File(s)                                                                              |
| --- | ------------------------------------------------------------------------ | ------------ | --------- | ------------------------------------------------------------------------------------ |
| G-1 | Cookie SameSite default is `lax`, spec requires `strict`                 | Medium       | B-1       | `packages/server/src/auth/cookies.ts:3`                                              |
| G-2 | Missing `Cache-Control: no-store` + `Pragma: no-cache` on page responses | High         | B-2       | `apps/frontend/src/hooks.server.ts:95-118`                                           |
| G-3 | No `?redirectTo=` preservation on login redirect                         | High         | B-3       | `apps/frontend/src/routes/+layout.server.ts:94`, `login/+page.svelte:7`              |
| G-4 | Admin layout only checks auth, not admin role                            | **Critical** | B-4       | `apps/frontend/src/routes/admin/+layout.server.ts:4-11`                              |
| G-5 | Login page has no `?error=` display                                      | Medium       | B-5       | `apps/frontend/src/routes/login/+page.svelte`                                        |
| G-6 | Auth endpoints use default 60/min rate limit, spec requires 10/min       | High         | B-6       | `apps/api/src/plugins/rate-limiter-oracle.ts`, `packages/server/src/rate-limiter.ts` |
| G-7 | CSRF — already satisfied, no code change needed                          | None         | B-7       | `packages/server/src/auth/config.ts` (verified)                                      |

### Additional Findings (Not in Original Plan)

| ID  | Finding                                                                                  | Severity | Action                        |
| --- | ---------------------------------------------------------------------------------------- | -------- | ----------------------------- |
| A-1 | SECURITY.md claims 15 permissions but code has 13 (`models:read`/`models:write` missing) | Medium   | Doc fix                       |
| A-2 | Operator missing `tools:danger` in RBAC code vs SECURITY.md claim                        | High     | Doc fix (code is intentional) |
| A-3 | `/api/models` excluded from auth entirely                                                | Medium   | Out of scope                  |
| A-4 | `redirectTo` needs open-redirect sanitization (relative paths only)                      | Low      | Included in B-3               |
| A-5 | Fastify helmet doesn't set all spec headers for API responses                            | Low      | Out of scope                  |

---

## Detailed Findings by Spec Section

### Section 1 — Unauthenticated Access Control

| Requirement                    | Status          | Evidence                                           |
| ------------------------------ | --------------- | -------------------------------------------------- |
| Protected routes require auth  | Fully Satisfied | `+layout.server.ts:87-95` — publicPaths guard      |
| Redirect to /login (not 401)   | Fully Satisfied | `+layout.server.ts:94` — `redirect(302, '/login')` |
| /login accessible without auth | Fully Satisfied | Listed in publicPaths                              |
| /setup accessible without auth | Fully Satisfied | Listed in publicPaths + setup check skipped        |

### Section 2 — OIDC Flow

| Requirement                                           | Status          | Evidence                              |
| ----------------------------------------------------- | --------------- | ------------------------------------- |
| PKCE enabled                                          | Fully Satisfied | `config.ts:113` — `pkce: true`        |
| Correct scopes (openid, email, profile, **myscopes**) | Fully Satisfied | `config.ts:112`                       |
| OAuth state cookie SameSite=lax                       | Fully Satisfied | `config.ts:34-37` — explicit override |
| **Session cookies SameSite=strict**                   | **Gap (G-1)**   | `cookies.ts:3` — default is `lax`     |
| HttpOnly=true all cookies                             | Fully Satisfied | `cookies.ts:34`                       |
| Secure=true in production                             | Fully Satisfied | `cookies.ts:16-17`                    |
| Cookie path=/                                         | Fully Satisfied | `cookies.ts:37`                       |
| Discovery URL configurable                            | Fully Satisfied | `config.ts:111`                       |

**G-1 Analysis**: Changing to `strict` is safe for the OIDC flow because the session cookie doesn't exist during the OIDC redirect — it's created _after_ the callback processes within the same origin. The OAuth state cookie (correctly at `lax`) handles the redirect validation.

### Section 3 — IDCS Configuration

| Requirement                    | Status          | Evidence                                             |
| ------------------------------ | --------------- | ---------------------------------------------------- |
| Group-to-role mapping          | Fully Satisfied | `idcs-provisioning.ts:44-55`                         |
| Unknown roles → viewer         | Fully Satisfied | `idcs-provisioning.ts:54` + `rbac.ts:52`             |
| Profile mapper extracts claims | Fully Satisfied | `config.ts:129-148`                                  |
| Post-login org provisioning    | Fully Satisfied | `config.ts:200-234` + `idcs-provisioning.ts:114-188` |

### Section 4 — RBAC

| Requirement                       | Status          | Evidence                                   |
| --------------------------------- | --------------- | ------------------------------------------ |
| 13 permissions defined            | Fully Satisfied | `rbac.ts:11-25`                            |
| 3 roles (viewer, operator, admin) | Fully Satisfied | `rbac.ts:33-45`                            |
| Unknown role → viewer             | Fully Satisfied | `rbac.ts:52`                               |
| Admin has all permissions         | Fully Satisfied | `rbac.ts:44`                               |
| Permission guard implementation   | Fully Satisfied | `rbac.ts:74-88` + `plugins/rbac.ts:41-107` |

**Note**: SECURITY.md claims 15 permissions (including `models:read`/`models:write`) but code has 13. This is a doc drift issue — the code is the source of truth.

### Section 5 — Session Security

| Requirement                      | Status          | Evidence                                     |
| -------------------------------- | --------------- | -------------------------------------------- |
| 30-day expiry                    | Fully Satisfied | `config.ts:192`                              |
| 24h refresh/sliding window       | Fully Satisfied | `config.ts:193`                              |
| Session invalidation on sign-out | Fully Satisfied | Tests verify cookie cleared with `Max-Age=0` |
| **SameSite=strict**              | **Gap (G-1)**   | Same as §2 finding                           |

### Section 6 — Post-Login UX

| Requirement                                   | Status        | Evidence                                                            |
| --------------------------------------------- | ------------- | ------------------------------------------------------------------- |
| **redirectTo preservation**                   | **Gap (G-3)** | `+layout.server.ts:94` redirects to `/login` without `?redirectTo=` |
| **Login page uses redirectTo as callbackURL** | **Gap (G-3)** | `login/+page.svelte:7` hard-codes `callbackURL: '/'`                |

### Section 7 — Error Handling

| Requirement                      | Status          | Evidence                                    |
| -------------------------------- | --------------- | ------------------------------------------- |
| PortalError prevents stack leaks | Fully Satisfied | `errors.ts:87-96` — `toResponseBody()` safe |
| **Login error display**          | **Gap (G-5)**   | `login/+page.svelte` — no `?error=` parsing |

### Section 8 — Logout

| Requirement             | Status          | Evidence                                            |
| ----------------------- | --------------- | --------------------------------------------------- |
| Sign-out clears session | Fully Satisfied | `auth.ts:56-70` via Better Auth handler             |
| Session cookie cleared  | Fully Satisfied | Set-Cookie forwarded from Better Auth               |
| Redirect to /login      | Fully Satisfied | `AppSidebar.svelte:59-67` + `UserMenu.svelte:14-21` |

### Section 9 — Security Headers

| Requirement                     | Status          | Evidence                              |
| ------------------------------- | --------------- | ------------------------------------- |
| CSP with nonce (prod)           | Fully Satisfied | `hooks.server.ts:63-89`               |
| X-Content-Type-Options: nosniff | Fully Satisfied | `hooks.server.ts:99`                  |
| X-Frame-Options: DENY           | Fully Satisfied | `hooks.server.ts:100`                 |
| X-XSS-Protection: 0             | Fully Satisfied | `hooks.server.ts:101`                 |
| Referrer-Policy                 | Fully Satisfied | `hooks.server.ts:102`                 |
| Permissions-Policy              | Fully Satisfied | `hooks.server.ts:103-106`             |
| Cross-Origin-Opener-Policy      | Fully Satisfied | `hooks.server.ts:107`                 |
| Cross-Origin-Resource-Policy    | Fully Satisfied | `hooks.server.ts:108`                 |
| HSTS (production)               | Fully Satisfied | `hooks.server.ts:110-112`             |
| **Cache-Control: no-store**     | **Gap (G-2)**   | Not present in `addSecurityHeaders()` |
| **Pragma: no-cache**            | **Gap (G-2)**   | Not present in `addSecurityHeaders()` |

### Section 10 — Rate Limiting

| Requirement               | Status          | Evidence                               |
| ------------------------- | --------------- | -------------------------------------- |
| Health/metrics exempt     | Fully Satisfied | `rate-limiter-oracle.ts:17`            |
| **Auth endpoints 10/min** | **Gap (G-6)**   | Falls through to default `api: 60/min` |

### Section 11 — Environment Variables

| Requirement                           | Status          | Evidence                |
| ------------------------------------- | --------------- | ----------------------- |
| BETTER_AUTH_SECRET required (prod)    | Fully Satisfied | `hooks.server.ts:23-25` |
| OCI_IAM_CLIENT_ID required (prod)     | Fully Satisfied | `config.ts:87-96`       |
| OCI_IAM_CLIENT_SECRET required (prod) | Fully Satisfied | `config.ts:85`          |
| All configurable via env vars         | Fully Satisfied | `config.ts:111,153,160` |

### Section 12 — CSRF Protection

| Requirement                 | Status          | Evidence                                  |
| --------------------------- | --------------- | ----------------------------------------- |
| CSRF token mechanism active | Fully Satisfied | Better Auth default, not disabled         |
| CSRF endpoint exists        | Fully Satisfied | `GET /api/auth/csrf` via catch-all        |
| CSRF cookie set             | Fully Satisfied | Set-Cookie forwarded via `getSetCookie()` |
| Not accidentally disabled   | Fully Satisfied | No `disableCSRFCheck` in config           |

---

## Implementation Priority

1. **Critical**: G-4 — Admin RBAC guard (any user sees admin pages)
2. **High**: G-2 — Cache-Control headers (authenticated pages cacheable)
3. **High**: G-3 — redirectTo preservation (UX degradation on every login)
4. **High**: G-6 — Auth rate limiting (brute-force at 60/min)
5. **Medium**: G-1 — SameSite=strict (defense-in-depth)
6. **Medium**: G-5 — Login error display (silent auth failures)
7. **None**: G-7 — CSRF verified, no change needed

---

**Last Updated**: 2026-02-22
