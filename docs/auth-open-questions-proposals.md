# Auth Spec §11 — Open Questions Proposals

**Date**: 2026-02-22
**Branch**: `feat/auth-spec-hardening`

## Summary

| Item | Topic                     | Recommendation                                                                  | Effort                      | Priority |
| ---- | ------------------------- | ------------------------------------------------------------------------------- | --------------------------- | -------- |
| D-1  | Idle timeout (15-30 min)  | Client-side `IdleTimer` component + optional server-side `lastActivityAt`       | 1.5 days                    | Medium   |
| D-2  | MFA enforcement           | IDCS-level MFA (zero code) — Option B (Better Auth plugin) for local auth later | 0.5 days (A) / 3-4 days (B) | High     |
| D-3  | Concurrent session limits | `session.create.before` hook with FIFO eviction                                 | 1 day                       | Low      |
| D-4  | Self-service onboarding   | Leverage existing `organization` plugin invitation endpoints                    | 2-4 days                    | Medium   |
| D-5  | Refresh token handling    | **Already implemented** via `updateAge: 24h` sliding window                     | 0 days                      | None     |

---

## D-1: Idle Timeout (15-30 min)

### Current State

No idle timeout mechanism exists. Sessions live for 30 days (`expiresIn`) with 24h sliding window refresh (`updateAge`). Sign-out is purely user-initiated via buttons in `AppSidebar.svelte` and `UserMenu.svelte`.

### Proposed Approach

Implement a client-side Svelte store that tracks user interaction events (`mousemove`, `keydown`, `click`, `scroll`, `touchstart`) with a debounced listener (~1s). After N minutes of inactivity (configurable via admin settings, default 30 min), show a warning modal ("Session expiring in 60 seconds"). If no interaction occurs, call `authClient.signOut()`.

Key design considerations:

- **Cross-tab sync**: Use `BroadcastChannel` or `localStorage` events so activity in one tab prevents sign-out in others
- **Visibility**: Pause timer when tab is hidden (`document.visibilitychange`)
- **Server-side defense-in-depth**: Optionally add a `lastActivityAt` timestamp on `auth_sessions` and check it in the auth plugin's `onRequest` hook

### Files Affected

| Action | File                                                                 |
| ------ | -------------------------------------------------------------------- |
| New    | `apps/frontend/src/lib/stores/idle-timer.ts`                         |
| New    | `apps/frontend/src/lib/components/IdleWarningModal.svelte`           |
| Modify | `apps/frontend/src/routes/+layout.svelte` (mount when authenticated) |
| Modify | `apps/frontend/src/routes/+layout.server.ts` (pass timeout setting)  |

### Complexity: 1.5 days

### Decision Needed

Should the server also enforce idle timeout (defense-in-depth), or is client-side sign-out sufficient? Client-side only means a stolen session cookie works for up to 30 days.

---

## D-2: MFA Enforcement

### Current State

Better Auth 1.4.18 ships a `twoFactor` plugin with TOTP, OTP, and backup code support — but it is **not registered**. The Oracle adapter already includes `'two_factor'` in `ALLOWED_TABLES` (oracle-adapter.ts:32) but the table doesn't exist yet. All users currently authenticate via OIDC through OCI IDCS.

### Proposed Approach

**Option A (Recommended for OIDC-only): IDCS-level MFA**

Configure the IDCS application's sign-on policy to require MFA (TOTP or push notification). Zero code changes in CloudNow — IDCS handles the MFA challenge during the OIDC flow before the callback reaches Better Auth. Document the configuration steps in the admin guide.

**Option B (If local auth is added later): Better Auth `twoFactor` plugin**

Register `twoFactor()` server-side and `twoFactorClient()` client-side. Create a migration for the `two_factor` table. Build a TOTP setup page (QR code + verification) and a post-login interstitial that checks `user.twoFactorEnabled`.

**Blocker for Option B**: The `twoFactor` plugin requires a `password` field for enable/disable, but CloudNow users authenticate via OIDC and may not have a password.

### Files Affected (Option A)

Documentation only — no code changes.

### Files Affected (Option B)

| Action | File                                                         |
| ------ | ------------------------------------------------------------ |
| Modify | `packages/server/src/auth/config.ts` (add twoFactor plugin)  |
| Modify | `apps/frontend/src/lib/auth-client.ts` (add twoFactorClient) |
| New    | `packages/server/src/oracle/migrations/023-two-factor.sql`   |
| New    | `apps/frontend/src/routes/mfa/+page.svelte`                  |
| New    | `apps/frontend/src/routes/mfa/verify/+page.svelte`           |

### Complexity: 0.5 days (A) / 3-4 days (B)

---

## D-3: Concurrent Session Limits

### Current State

Better Auth core already provides session management endpoints (`list-sessions`, `revoke-session`, `revoke-other-sessions`). The `auth_sessions` table exists with `user_id`, `expires_at`, `created_at` columns. The `databaseHooks.session.create.before` hook is available and unused.

### Proposed Approach

Add a `databaseHooks.session.create.before` hook that:

1. Counts active sessions: `SELECT COUNT(*) FROM auth_sessions WHERE user_id = :userId AND expires_at > SYSTIMESTAMP`
2. If count >= limit (configurable, default 5), use FIFO eviction: delete the oldest session to make room

This approach is user-friendly — users can always log in, but oldest sessions are evicted. The limit should be configurable via admin settings.

### Files Affected

| Action         | File                                                                  |
| -------------- | --------------------------------------------------------------------- |
| Modify         | `packages/server/src/auth/config.ts` (add session.create.before hook) |
| New (optional) | `packages/server/src/auth/session-limits.ts` (extracted module)       |
| New            | `apps/api/src/tests/auth/session-limits.test.ts`                      |

### Complexity: 1 day

### Decision Needed

Reject login (show error) vs. FIFO eviction (silently kill oldest session)?

---

## D-4: Self-Service User Onboarding (Invitations)

### Current State

The infrastructure is **largely in place**:

- `organization` plugin registered with `allowUserToCreateOrganization: false`
- `org_invitations` table exists (migration 003)
- Oracle adapter maps `invitation` → `org_invitations`
- Client-side `organizationClient()` registered
- Invitation endpoints available: `createInvitation`, `acceptInvitation`, `rejectInvitation`, `cancelInvitation`, `listInvitations`

What's missing: the `sendInvitationEmail` callback is not configured, and there's no UI for managing invitations.

### Proposed Approach

1. **Configure `sendInvitationEmail`** in organization plugin options — sends email via OCI Email Delivery or SMTP with an acceptance link
2. **Build admin invitation UI** under `/admin/members` — enter email, select role, send invitation, view/cancel pending invitations
3. **Build acceptance flow** at `/invite/accept` — show org name and role, let user accept/reject after OIDC authentication

If email delivery is deferred (admin copies invitation link manually), complexity drops significantly.

### Files Affected

| Action | File                                                                |
| ------ | ------------------------------------------------------------------- |
| Modify | `packages/server/src/auth/config.ts` (sendInvitationEmail callback) |
| New    | `packages/server/src/auth/invitation-email.ts`                      |
| New    | `apps/frontend/src/routes/invite/accept/+page.svelte`               |
| New    | `apps/frontend/src/routes/admin/members/+page.svelte`               |

### Complexity: 2 days (link-based) / 4 days (with email delivery)

### Dependencies

- Email delivery service (OCI Email Delivery or SMTP relay)
- Invited users must have IDCS accounts to authenticate

---

## D-5: Refresh Token Handling

### Current State: Already Implemented

Better Auth's `updateAge` setting implements a **sliding window session refresh**:

```typescript
session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24        // refresh token every 24h
}
```

How it works:

1. On every `getSession()` call (every Fastify request via auth plugin), Better Auth checks if the session token was last updated > 24h ago
2. If so, it rotates the token, extends `expires_at` by another 30 days, and sends a new `Set-Cookie` header
3. The auth routes handler (`auth.ts:91-98`) properly forwards all `Set-Cookie` headers including rotation cookies
4. The SvelteKit layout also calls `getSession` on every SSR page load, triggering rotation

### No Changes Needed

The current implementation is correct and complete. The only potential enhancement is an **absolute session lifetime cap** (e.g., "sessions must expire after 12 hours regardless of activity") — this is not a standard requirement but could be added by checking `session.createdAt` in the auth plugin if needed.

### Complexity: 0 days (as-is) / 0.5 days (if absolute cap needed)

---

**Last Updated**: 2026-02-22
