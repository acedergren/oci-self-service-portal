# Security Model

This document describes the security architecture, authentication/authorization mechanisms, and hardening measures applied across the OCI Self-Service Portal.

## Table of Contents

1. [Authentication](#authentication)
2. [Authorization (RBAC)](#authorization-rbac)
3. [Input Validation](#input-validation)
4. [Injection Prevention](#injection-prevention)
5. [IDOR Prevention](#idor-prevention)
6. [Rate Limiting](#rate-limiting)
7. [SSRF Prevention](#ssrf-prevention)
8. [Cryptography](#cryptography)
9. [Security Headers](#security-headers)
10. [Error Handling](#error-handling)
11. [Server-Side Approval Tokens](#server-side-approval-tokens)
12. [Audit Trail](#audit-trail)
13. [Webhook Security](#webhook-security)
14. [API Key Management](#api-key-management)
15. [Admin Console Security](#admin-console-security)

## Authentication

### Session-Based Auth (Better Auth)

Primary authentication mechanism for browser-based access. Located in `apps/frontend/src/lib/server/auth/config.ts`.

- **Provider**: Better Auth with OCI IAM OIDC
- **Cookie-based**: Secure, HttpOnly, SameSite=Strict
- **OIDC Integration**: OpenID Connect via OCI Identity Cloud Service (IDCS)
- **Build-time secret**: `BETTER_AUTH_SECRET` required at build time for SvelteKit
- **Runtime validation**: Logs error if secret not set in production

### API Key Authentication

Programmatic access for CI/CD pipelines, monitoring scripts, and external integrations. Located in `packages/shared/src/server/auth/api-keys.ts`.

**Key Format & Storage**:

- **Prefix**: `portal_` for easy identification in logs
- **Generation**: `crypto.randomBytes(32).toString('hex')` — cryptographically random 32-byte keys
- **Storage**: Only SHA-256 hash stored in database; plaintext shown once at creation
- **Key prefix display**: First 8 characters after `portal_` stored separately for quick UI identification

**Validation**:

- Checked before session auth
- Supports both `Authorization: Bearer portal_...` and `X-API-Key: portal_...` headers
- Constant-time comparison via `crypto.timingSafeEqual()` to prevent timing oracle attacks
- Checks revocation status (REVOKED_AT timestamp)
- Validates expiration (EXPIRES_AT)

### Setup Token Guard

Initial configuration endpoints secured with setup token validation. Located in `apps/frontend/src/lib/server/auth/api-keys.ts`.

- **Setup routes**: `/api/setup` endpoints are public until portal configured
- **Token validation**: Bearer token required for all `/api/setup/*` endpoints
- **Initial user**: Created via setup flow with strong password requirements

### Dual Auth Pattern

All API endpoints support either session or API key authentication:

1. API key is checked first
2. If no API key, session auth is checked
3. Both establish `event.locals.user` and `event.locals.permissions`
4. Subsequent RBAC checks work identically for both auth types

## Authorization (RBAC)

Role-Based Access Control with 3 roles and 13 permissions. Located in `packages/shared/src/auth/rbac.ts`.

### Roles

| Role         | Permissions                                                             | Use Case                                             |
| ------------ | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| **viewer**   | tools:read, sessions:read, workflows:read                               | Read-only access for stakeholders                    |
| **operator** | tools:read/execute/approve, sessions:read/write, workflows:read/execute | Day-to-day operations (approve tools, run workflows) |
| **admin**    | All 13 permissions                                                      | Full system access (user/org/audit management)       |

### Permissions

| Permission          | Description                                       |
| ------------------- | ------------------------------------------------- |
| `tools:read`        | View tool definitions and execution results       |
| `tools:execute`     | Execute pre-approved tools (no approval gate)     |
| `tools:approve`     | Approve/reject pending tool executions            |
| `tools:danger`      | Execute danger-level tools (bypasses rate limits) |
| `sessions:read`     | View chat sessions                                |
| `sessions:write`    | Create/modify chat sessions                       |
| `workflows:read`    | View workflow definitions and execution history   |
| `workflows:write`   | Create/modify workflow definitions                |
| `workflows:execute` | Execute workflows                                 |
| `admin:users`       | Manage user accounts                              |
| `admin:orgs`        | Manage organizations                              |
| `admin:audit`       | View audit logs and analytics                     |
| `admin:all`         | Full admin access (shortcut for all perms)        |

### Permission Checks

- **Route-level guard**: `requirePermission(event, 'tools:execute')` in SvelteKit handlers
- **Admin-only endpoints**: Health detail endpoint checks for admin role
- **Fastify API layer**: Deny-by-default auth gate via `onRequest` hook

## Input Validation

All API endpoints validate input using Zod schemas.

### Endpoint-Level Validation

- **Request body**: Validated via Zod schemas in route handlers
- **Query parameters**: Validated before processing
- **Path parameters**: Validated as part of route matching

### Body Size Limits

Global request body size limit: **512 KiB**.

- **Chat endpoint**: Limited to 10 messages max per request
- **Session LIKE search**: Query string length capped to prevent abuse

### Special Cases

**LIKE Pattern Escaping**:

```sql
SELECT * FROM sessions
WHERE name LIKE :pattern ESCAPE '\' AND user_id = :userId
```

- User-supplied patterns must escape `%`, `_`, and `\` characters
- ESCAPE clause added to all LIKE queries
- Prevents attacker-controlled wildcards from being interpreted as patterns

## Injection Prevention

### SQL Injection

- **No string interpolation**: All dynamic SQL uses bind parameters (`:paramName`)
- **Column/table validation**: Dynamic column/table names validated via allowlist regex
  - Column names: `/^[a-z_][a-z0-9_]{0,127}$/` (lowercase, alphanumeric + underscore)
  - Table names: Hardcoded allowlist
  - Path traversal protection in migration loader

**Example**:

```typescript
// SAFE: Bind parameter
await conn.execute('SELECT * FROM sessions WHERE user_id = :userId AND status = :status', {
	userId: '123',
	status: 'active'
});

// UNSAFE: String interpolation (never used)
// await conn.execute(`SELECT * FROM sessions WHERE user_id = '${userId}'`);
```

### Command Injection

- **OCI CLI**: All CLI calls use array-based args, not shell command strings
- **No shell building**: Arguments passed as array to exec functions
- **Tool arguments**: Validated/redacted before storage in audit logs

## IDOR Prevention

Indirect Object Reference (IDOR) attacks prevented via org/user scoping.

### Session Access Control

- All queries filtered by `user_id` AND `org_id`
- `switchToSession()` verifies ownership before allowing access
- Session UPDATE/DELETE operations verify user_id matches

**Example**:

```typescript
// Get sessions for current user only
const result = await conn.execute(
	'SELECT * FROM sessions WHERE org_id = :orgId AND user_id = :userId ORDER BY ...',
	{ orgId, userId }
);
```

### Workflow Access Control

- **List operations**: Filtered by `org_id`
- **Get operations**: Verify `org_id` matches before returning
- **Execution**: POST endpoints check org_id
- **Approval**: Org-scoped to prevent cross-org approval

### API Key Access Control

- **Organization scope**: API keys are org-scoped; cannot access other orgs
- **Revocation**: Scoped by org_id to prevent cross-org revocation

## Rate Limiting

DB-backed rate limiting with in-memory fallback for DB failures. Located in `packages/shared/src/auth/rate-limiter.ts`.

### Architecture

- **Primary**: Oracle MERGE INTO for atomic upsert (TOCTOU-safe)
- **Fallback**: JavaScript Map when DB unavailable
- **Cleanup**: Stale entries expired at 1% per-request probability (automatic)
- **Granular buckets**: Per-endpoint rate limits (not global)

### Per-Endpoint Limits

| Endpoint                  | Limit | Window | Reason                                  |
| ------------------------- | ----- | ------ | --------------------------------------- |
| `/api/chat`               | 20    | 60s    | AI inference (compute-heavy)            |
| `/api/tools/execute`      | 15    | 60s    | OCI CLI calls (expensive)               |
| `/api/workflows/[id]/run` | 5     | 60s    | Workflow execution (resource-intensive) |
| `/api/v1/search`          | 10    | 60s    | Vector search (DB-heavy)                |
| `/api/auth/*`             | 10    | 60s    | Auth attempts (brute-force protection)  |
| `/api/*` (default)        | 60    | 60s    | General API access                      |

### Rate Limit Exempt Paths

- `/api/health`, `/api/healthz` — Health checks (monitoring)
- `/api/metrics` — Prometheus scrape endpoint

## SSRF Prevention

Server-Side Request Forgery attacks blocked via URL validation. Located in `packages/shared/src/auth/url-validation.ts`.

### Blocks

- **Non-HTTPS**: Only HTTPS URLs allowed
- **Private IPs**: 10.x, 127.x, 172.16-31.x, 192.168.x, 169.254.x
- **Loopback**: localhost, [::1], ::1
- **Cloud metadata**: Link-local 169.254.x (AWS metadata endpoint)
- **Internal hostnames**: \*.internal domain suffix
- **Zero address**: 0.0.0.0

### Webhook URL Validation

Webhooks validate URL before registration and before delivery:

```typescript
export function isValidWebhookUrl(url: string): boolean {
	return isValidExternalUrl(url); // SSRF checks applied
}
```

**Delivery validation**:

- Re-validates URL before each delivery attempt
- Logs and fails webhook if URL fails validation
- Prevents race condition where URL validation changes between registration and delivery

## Cryptography

### Secrets at Rest (Admin API Keys)

**AES-256-GCM encryption** in `apps/frontend/src/lib/server/admin/crypto.ts`:

- **Algorithm**: AES-256-GCM for authenticated encryption
- **Key derivation**: HKDF-SHA256 from BETTER_AUTH_SECRET (domain-specific salt)
- **IV**: 12-byte random per encryption (optimal for GCM)
- **Auth tag**: 16-byte tag ensures integrity
- **Storage**: Ciphertext, IV, and tag stored separately in Oracle

**Example usage**:

```typescript
const { encrypted, iv, tag } = await encryptSecret(apiKeyPlaintext);
// Store all three in Oracle columns

// Decrypt later
const plaintext = await decryptSecret(encrypted, iv, tag);
```

### Webhook Signatures

**HMAC-SHA256**:

- **Generation**: `createHmac('sha256', secret).update(payload).digest('hex')`
- **Verification**: Timing-safe comparison via `crypto.timingSafeEqual()`
- **Header**: `X-Webhook-Signature: sha256=<hex>`

**Defense against timing attacks**:

```typescript
export function verifySignature(payload: string, signature: string, secret: string): boolean {
	const expected = generateSignature(payload, secret);
	try {
		// Constant-time comparison prevents timing oracle
		return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
	} catch {
		return false; // If lengths don't match, fail safely
	}
}
```

### API Key Hashing

**SHA-256** for API key storage (no salt needed as keys are random):

```typescript
function hashKey(key: string): string {
	return crypto.createHash('sha256').update(key).digest('hex');
}
```

### CSP Nonce

**Per-request UUID** for Content Security Policy:

- **Production**: `crypto.randomUUID()` per request
- **Development**: Disabled for HMR compatibility
- **Injected into**: `<script nonce="{uuid}">` tags

## Security Headers

Applied globally.

### All Responses

| Header                           | Value                                     | Purpose                                         |
| -------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| **Content-Security-Policy**      | Nonce-based (prod) or unsafe-inline (dev) | Script execution control                        |
| **X-Content-Type-Options**       | nosniff                                   | Prevent MIME type sniffing                      |
| **X-Frame-Options**              | DENY                                      | Prevent clickjacking                            |
| **X-XSS-Protection**             | 0                                         | Disable browser XSS filters (CSP replaces them) |
| **Referrer-Policy**              | strict-origin-when-cross-origin           | Limit referrer leakage                          |
| **Permissions-Policy**           | Blocks camera, mic, payment, etc.         | Disable sensitive APIs                          |
| **Cross-Origin-Opener-Policy**   | same-origin                               | Isolate from popup windows                      |
| **Cross-Origin-Resource-Policy** | same-origin                               | Cross-origin resource blocking                  |

### Production-Only Headers

| Header                        | Value                               |
| ----------------------------- | ----------------------------------- |
| **Strict-Transport-Security** | max-age=31536000; includeSubDomains |

### API Responses

| Header            | Value                               |
| ----------------- | ----------------------------------- |
| **Cache-Control** | no-store, no-cache, must-revalidate |
| **Pragma**        | no-cache                            |

## Error Handling

Structured error hierarchy prevents information leakage. Located in `packages/shared/src/errors.ts`.

### Error Types

```typescript
// All errors inherit from PortalError
new ValidationError(message, context); // 400
new AuthError(message, statusCode); // 401 or 403
new NotFoundError(message, context); // 404
new RateLimitError(message, context); // 429
new OCIError(message, context); // 502 (gateway error)
new DatabaseError(message, context); // 503 (service unavailable)
```

### Response Body (Safe)

Never exposes stack traces or internal context:

```typescript
// Returns to API clients
{
  error: "Validation failed",
  code: "VALIDATION_ERROR",
  requestId: "req-uuid"  // For debugging
}
```

### Internal Logging (Full Context)

For structured logs and error tracking:

```typescript
{
  name: "ValidationError",
  code: "VALIDATION_ERROR",
  message: "Validation failed",
  statusCode: 400,
  context: { field: "userId" },
  stack: "...",
  cause: "..."
}
```

## Server-Side Approval Tokens

Tool approval tokens generated and validated server-side to prevent client bypass. Located in `packages/shared/src/auth/approvals.ts`.

### Token Lifecycle

1. **Recording**: `recordApproval(toolCallId, toolName)` creates entry
   - Oracle INSERT into approved_tool_calls table (preferred)
   - Falls back to in-memory Map if DB unavailable
   - Single-use token (consumed on use)

2. **TTL**: 5 minutes
   - Oracle: `approved_at > SYSTIMESTAMP - INTERVAL '5' MINUTE`
   - In-memory: `Date.now() - entry.approvedAt > APPROVAL_TTL_MS`

3. **Consumption**: `consumeApproval(toolCallId, toolName)` atomically deletes entry
   - Oracle: Atomic DELETE statement (no TOCTOU race)
   - Returns true only if row deleted (matches both ID and tool name)
   - Falls back to in-memory if DB unavailable

### TOCTOU Safety

No race condition due to atomic SQL:

```sql
DELETE FROM approved_tool_calls
WHERE tool_call_id = :toolCallId
  AND tool_name = :toolName
  AND approved_at > SYSTIMESTAMP - INTERVAL '5' MINUTE
```

Single DELETE statement ensures check and consumption happen atomically.

### Anti-Replay

Approval consumed (deleted) immediately after use. Attempting to use same token twice fails.

## Audit Trail

Two complementary audit mechanisms: standard audit table and blockchain (immutable) table.

### Standard Audit Table

Logs all tool executions:

- **Columns**: user_id, org_id, tool_name, action (execute/approve/reject), result (success/failure), args_redacted, duration_ms, created_at, error_message
- **Retention**: Indefinite (standard table)
- **Query**: Org-scoped via org_id filter (IDOR prevention)
- **Redaction**: Sensitive args redacted before storage (e.g., API keys, passwords)

### Blockchain Audit Table (Immutable)

Tamper-proof INSERT-only ledger using Oracle 26AI blockchain tables:

```sql
CREATE BLOCKCHAIN TABLE audit_blockchain (
  action VARCHAR2(50),       -- 'tool_execution', 'approval', 'workflow_run', etc.
  tool_name VARCHAR2(255),   -- Tool or workflow name
  user_id VARCHAR2(255),
  org_id VARCHAR2(255),
  resource_type VARCHAR2(50), -- 'tool_execution', 'workflow_run', etc.
  resource_id VARCHAR2(255),
  detail JSON,               -- JSON payload (redacted sensitive fields)
  created_at TIMESTAMP DEFAULT SYSTIMESTAMP
)
NO DROP UNTIL 365 DAYS IDLE
NO DELETE UNTIL 365 DAYS AFTER INSERT
HASHING USING "SHA2_256"
```

**Properties**:

- **Immutable**: Cannot DROP or DELETE for 365 days minimum
- **Tamper-detection**: Hash chain ensures record integrity (SHA2_256)
- **Compliance**: Meets regulatory requirements for audit trails

## Webhook Security

Webhooks signed with HMAC-SHA256 and rate-limited with exponential backoff.

### Signing & Verification

**Sender** (portal):

1. Generate HMAC-SHA256 of JSON payload
2. Attach signature in `X-Webhook-Signature: sha256=<hex>` header

**Receiver** (customer):

1. Retrieve secret from webhook config
2. Generate HMAC-SHA256 of received payload
3. Compare to header signature using constant-time comparison
4. Process event only if signatures match

### Delivery Guarantees

- **Retry logic**: Up to 3 retries with exponential backoff (1s, 4s, 16s)
- **Timeout**: 10 seconds per delivery attempt
- **Circuit breaker**: Marks webhook as 'failed' after 5 consecutive failures
- **Fire-and-forget**: Dispatch is non-blocking; failures don't block request handler
- **Status codes**: Retries on 5xx, gives up on 4xx (except 429)

### SSRF Protection

- URL validated before registration (SSRF checks applied)
- URL re-validated before each delivery
- Prevents race condition where webhook URL changes between checks

## API Key Management

### Key Lifecycle

**Creation**:

- Generate random key: `crypto.randomBytes(32).toString('hex')` → `portal_<32-byte-hex>`
- Hash with SHA-256 for storage
- Extract key prefix (first 8 chars after `portal_`) for UI display
- Return plaintext key to admin (shown once)

**Validation**:

- Check prefix matches `portal_`
- Hash incoming key and query by hash
- Constant-time comparison to prevent timing oracle
- Check revocation status (REVOKED_AT)
- Check expiration (EXPIRES_AT)

**Revocation**:

- Soft-delete: Set REVOKED_AT and status = 'revoked'
- Hash is never deleted (prevents re-registration of compromised key)

**Listing**:

- Limited to 100 keys per org
- Never returns key_hash or plaintext key
- Returns key_prefix for identification

## Admin Console Security

### Setup Token Guard

All `/api/setup/*` endpoints require a valid setup token:

- **Initial**: Setup is public until portal configured
- **Bearer token**: `Authorization: Bearer <token>`
- **Validation**: `validateSetupToken()` checks token format and existence
- **One-time**: Token consumed on successful setup completion

### Secret Stripping

Admin console must never return secrets to client:

- **IDP secrets**: `stripIdpSecrets()` removes clientSecret, clientId, etc.
- **AI provider secrets**: `stripAiProviderSecrets()` removes API keys, credentials
- **Storage**: Secrets encrypted at rest with AES-256-GCM
- **Retrieval**: Admin cannot view plaintext; only test connectivity

### SSRF Prevention in Admin

IDP and AI provider test endpoints validate URLs:

```typescript
// In setup wizard tests
const { valid, error } = isValidExternalUrl(testUrl);
if (!valid) {
	return { error: 'Invalid URL' };
}
```

- Blocks private IPs
- Requires HTTPS
- Prevents SSRF via admin console

---

**Last Updated**: February 12, 2026
**Version**: 1.1
