# @portal/shared - Architecture Guide

## Package Purpose

This package contains all business logic shared between frontend (SvelteKit) and backend (Fastify) applications. It's designed to be framework-agnostic where possible.

## Key Principles

### 1. Zero Circular Dependencies

All modules must follow a strict dependency hierarchy:

```
tools → (no shared deps)
pricing → (no shared deps)
terraform → (no shared deps)
query → (no shared deps)
workflows → (types only, no server deps)

server/errors → (foundation)
server/logger → errors
server/tracing → (standalone)
server/metrics → (standalone)
server/oracle → errors, logger
server/auth → errors, logger, oracle
server/workflows → errors, logger, oracle, auth
server/api → errors, logger, auth, workflows
```

### 2. Framework-Agnostic Design

Most modules should work with any Node.js framework. Framework-specific code goes in apps/.

**Good** (framework-agnostic):

```typescript
// packages/shared/src/server/auth/rbac.ts
export function requirePermission(userId: string, permission: Permission): void {
	if (!hasPermission(userId, permission)) {
		throw new AuthError('Insufficient permissions');
	}
}
```

**Bad** (SvelteKit-specific):

```typescript
// Don't do this in shared package
import { error } from '@sveltejs/kit';
export function requirePermission(userId: string, permission: Permission) {
	if (!hasPermission(userId, permission)) {
		throw error(403, 'Insufficient permissions');
	}
}
```

### 3. Error Handling

Use `PortalError` hierarchy for all errors:

```typescript
import { ValidationError, AuthError, DatabaseError } from '@portal/shared/server/errors';

// Throw typed errors
throw new ValidationError('Invalid email format', { field: 'email' });
throw new AuthError('Token expired', 401);
throw new DatabaseError('Connection failed');

// Wrap unknown errors
try {
	await somethingRisky();
} catch (error) {
	throw toPortalError(error); // Wraps as INTERNAL_ERROR
}
```

### 4. Logging

Use `createLogger` with module context:

```typescript
import { createLogger } from '@portal/shared/server/logger';

const log = createLogger('my-module', { service: 'api' });

log.info('Operation started');
log.error({ err: error }, 'Operation failed');
log.debug({ userId, orgId }, 'Processing request');
```

**Never use `console.log`** - it bypasses structured logging and won't appear in production logs.

### 5. Oracle Fallback Pattern

All Oracle-dependent services must have fallbacks:

```typescript
import { withConnection } from '@portal/shared/server/oracle/connection';

async function getData(id: string) {
	try {
		return await withConnection(async (conn) => {
			const result = await conn.execute('SELECT * FROM data WHERE id = :id', [id]);
			return result.rows[0];
		});
	} catch (error) {
		log.warn({ error }, 'Oracle unavailable, using fallback');
		return fallbackStorage.get(id); // SQLite, JSONL, in-memory, etc.
	}
}
```

### 6. Export Patterns

#### Module Exports

Each module should have an `index.ts` barrel:

```typescript
// server/workflows/index.ts
export * from './repository.js';
export * from './executor.js';
export * from './types.js';
```

#### Package Exports

`package.json` defines public API:

```json
{
	"exports": {
		"./server/*": "./src/server/*.js",
		"./tools": "./src/tools/index.js"
	}
}
```

Consumers import via package name:

```typescript
import { workflowRepository } from '@portal/shared/server/workflows';
import { executeTool } from '@portal/shared/tools';
```

## Module Guide

### server/auth/

Authentication and authorization services.

**Key Files:**

- `config.ts` - Better Auth configuration
- `rbac.ts` - Role-based access control (3 roles, 13 permissions)
- `tenancy.ts` - Multi-tenancy (org membership)
- `api-keys.ts` - API key validation
- `idcs-provisioning.ts` - OIDC → org provisioning

**Critical Patterns:**

- Always check BOTH role AND org membership
- API keys use SHA-256 hashing (never store plaintext)
- IDCS groups → roles via `provisionFromIdcsGroups()`

### server/oracle/

Oracle Database integration.

**Key Files:**

- `connection.ts` - Connection pool management
- `migrations.ts` - Schema migrations (008_property_graph.sql)
- `repositories/` - Data access layer

**Critical Patterns:**

- Always use `withConnection()` for queries
- Migrations are idempotent (IF NOT EXISTS checks)
- All tables have `created_at`/`updated_at` timestamps
- Blockchain tables have 365-day retention

### server/workflows/

Workflow engine with topological execution.

**Key Files:**

- `executor.ts` - WorkflowExecutor (Kahn's algorithm)
- `repository.ts` - CRUD for definitions and runs
- `types.ts` - 8 node types + validation schemas

**Critical Patterns:**

- Cycle detection before execution
- Safe expression evaluation (no eval)
- Approval nodes require server-side token validation
- Each run step is recorded for audit trail

### tools/

OCI CLI tool wrappers for AI SDK.

**Structure:**

- `registry.ts` - Tool registry with 60+ tools
- `categories/` - 11 categories (compute, networking, storage, etc.)
- `types.ts` - ToolDefinition, ToolEntry, ApprovalLevel

**Critical Patterns:**

- All tools return `slimOCIResponse()` (filtered OCI output)
- Never combine `--all` and `--limit` flags
- Namespace is auto-fetched for bucket operations
- Tools tagged with approval levels (auto/operator/admin)

### pricing/

Cloud pricing comparison (OCI vs Azure).

**Files:**

- `service.ts` - Main pricing logic
- `data/` - Pricing JSON files
- `types.ts` - PricingComparison interface

**Usage:**

```typescript
import { compareCloudPricing } from '@portal/shared/pricing';

const comparison = compareCloudPricing({
	instanceType: 'VM.Standard.E4.Flex',
	ocpus: 4,
	memoryGB: 64,
	region: 'eu-frankfurt-1'
});
```

### terraform/

Terraform HCL code generator.

**Files:**

- `generator.ts` - AST → HCL conversion
- `types.ts` - TerraformConfig interface

**Usage:**

```typescript
import { generateTerraformHCL } from '@portal/shared/terraform';

const hcl = generateTerraformHCL({
  resources: [{
    type: 'oci_core_instance',
    name: 'web_server',
    attributes: { ... }
  }]
});
```

## Testing Patterns

### Unit Tests

Test business logic in isolation:

```typescript
import { describe, it, expect } from 'vitest';
import { requirePermission } from '@portal/shared/server/auth/rbac';

describe('requirePermission', () => {
	it('throws AuthError for insufficient permissions', () => {
		expect(() => {
			requirePermission('viewer', 'workflows:execute');
		}).toThrow(AuthError);
	});
});
```

### Integration Tests

Test with real Oracle connection:

```typescript
import { withConnection } from '@portal/shared/server/oracle/connection';
import { workflowRepository } from '@portal/shared/server/workflows/repository';

describe('workflowRepository', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  it('creates and retrieves workflow', async () => {
    const workflow = await workflowRepository.create({ ... });
    const retrieved = await workflowRepository.getById(workflow.id);
    expect(retrieved).toEqual(workflow);
  });
});
```

## Security Review Checklist

When adding new modules, verify:

- [ ] **Input validation**: All user input validated with Zod schemas
- [ ] **SQL injection**: Use parameterized queries, never string concatenation
- [ ] **IDOR prevention**: Always filter by `userId` or `orgId`
- [ ] **Error leakage**: Never expose internal details in error messages
- [ ] **Rate limiting**: Add to `RATE_LIMIT_CONFIG` if public-facing
- [ ] **Approval flow**: Sensitive operations require `recordApproval()`
- [ ] **Logging**: Redact sensitive data (passwords, tokens, PII)

## Common Pitfalls

### 1. Importing from apps/

**Never import from `apps/frontend` or `apps/api`** - this creates circular dependencies.

```typescript
// ❌ BAD
import { something } from '../../apps/frontend/src/lib/utils';

// ✅ GOOD
// Move shared utilities to packages/shared/src/utils/
import { something } from '@portal/shared/utils';
```

### 2. Framework-Specific APIs

**Don't use framework-specific APIs** in shared package.

```typescript
// ❌ BAD (SvelteKit-specific)
import { error, redirect } from '@sveltejs/kit';

// ✅ GOOD (throw errors, let framework handle)
throw new AuthError('Unauthorized', 401);
```

### 3. Global State

**Avoid global mutable state** - use dependency injection.

```typescript
// ❌ BAD
let currentUser: User | null = null;
export function setCurrentUser(user: User) { currentUser = user; }

// ✅ GOOD
export function getUserPermissions(userId: string) { ... }
```

### 4. Environment Variables

**Don't read env vars directly** - pass them as parameters.

```typescript
// ❌ BAD
export function getDatabaseUrl() {
  return process.env.DATABASE_URL;
}

// ✅ GOOD
export function createConnection(databaseUrl: string) { ... }
```

Let consuming applications handle env var resolution.

## Migration from $lib/server

All imports changed:

```typescript
// Before (SvelteKit $lib alias)
import { createLogger } from '$lib/server/logger';
import { workflowRepository } from '$lib/server/workflows/repository';
import { executeTool } from '$lib/tools';

// After (@portal/shared package)
import { createLogger } from '@portal/shared/server/logger';
import { workflowRepository } from '@portal/shared/server/workflows/repository';
import { executeTool } from '@portal/shared/tools';
```

## Roadmap

### Phase 9 (Current)

- ✅ Monorepo restructure
- ✅ Extract shared package
- 🚧 Fastify backend migration
- 🚧 REST API v1 endpoints

### Future Enhancements

- [ ] Shared package versioning (semantic)
- [ ] Published to private npm registry
- [ ] Separate OCI tools into standalone package
- [ ] Extract pricing to standalone package
- [ ] GraphQL schema generation

## Support

For questions about this package:

- Check README.md for API documentation
- Review test files for usage examples
- See `docs/ARCHITECTURE.md` at workspace root for system overview
