# @portal/shared

Shared business logic package for OCI Self-Service Portal.

## Overview

This package contains all backend services, OCI CLI tool wrappers, and business logic that can be reused across frontend (SvelteKit) and backend (Fastify) applications.

## Installation

```bash
# In workspace root
pnpm install

# Or directly in a workspace package
pnpm add @portal/shared@workspace:*
```

## Package Structure

```
packages/shared/src/
├── server/              # Backend services
│   ├── auth/           # Authentication & authorization
│   ├── oracle/         # Oracle Database integration
│   ├── workflows/      # Workflow engine
│   ├── agent-state/    # Agent state management
│   ├── api/            # API utilities
│   └── mcp/            # MCP server integration
├── tools/              # OCI CLI tool wrappers
├── pricing/            # Cloud pricing comparison
├── terraform/          # Terraform HCL generator
├── workflows/          # Workflow types/definitions
└── query/              # OCI GenAI query utilities
```

## Exports

### Server Modules

```typescript
// Core services
import { createLogger } from '@portal/shared/server/logger';
import { httpRequestDuration } from '@portal/shared/server/metrics';
import { initSentry, captureError } from '@portal/shared/server/sentry';
import { PortalError, ValidationError, AuthError } from '@portal/shared/server/errors';
import { generateRequestId } from '@portal/shared/server/tracing';
import { runHealthChecks } from '@portal/shared/server/health';

// Authentication & Authorization
import { auth } from '@portal/shared/server/auth/config';
import { getPermissionsForRole, requirePermission } from '@portal/shared/server/auth/rbac';
import { getOrgRole } from '@portal/shared/server/auth/tenancy';
import { validateApiKey } from '@portal/shared/server/auth/api-keys';
import { provisionFromIdcsGroups } from '@portal/shared/server/auth/idcs-provisioning';

// Oracle Database
import { initPool, closePool, withConnection } from '@portal/shared/server/oracle/connection';
import { runMigrations } from '@portal/shared/server/oracle/migrations';
import {
	sessionRepository,
	orgRepository,
	auditRepository
} from '@portal/shared/server/oracle/repositories';

// Rate Limiting
import { checkRateLimit, RATE_LIMIT_CONFIG } from '@portal/shared/server/rate-limiter';

// Approvals
import { recordApproval, consumeApproval } from '@portal/shared/server/approvals';

// Workflows
import {
	workflowRepository,
	workflowRunRepository
} from '@portal/shared/server/workflows/repository';
import { WorkflowExecutor } from '@portal/shared/server/workflows/executor';

// Embeddings
import { generateEmbedding, generateEmbeddings } from '@portal/shared/server/embeddings';

// Webhooks
import { isValidWebhookUrl, signWebhookPayload } from '@portal/shared/server/webhooks';
```

### Tools

```typescript
// Tool registry and execution
import { tools, toolsByName, executeTool } from '@portal/shared/tools';
import type { ToolCategory, ToolDefinition, ToolEntry } from '@portal/shared/tools/types';

// Category-specific tools
import { computeTools } from '@portal/shared/tools/categories/compute';
import { networkingTools } from '@portal/shared/tools/categories/networking';
import { storageTools } from '@portal/shared/tools/categories/storage';
// ... 11 categories total
```

### Pricing

```typescript
import { compareCloudPricing, type PricingComparison } from '@portal/shared/pricing';
import { getPricing } from '@portal/shared/pricing/service';
```

### Terraform

```typescript
import { generateTerraformHCL, type TerraformConfig } from '@portal/shared/terraform';
```

### Workflows

```typescript
import type {
	WorkflowDefinition,
	WorkflowRun,
	WorkflowNode,
	ToolNode,
	ConditionNode,
	ApprovalNode
} from '@portal/shared/workflows';
```

### Query

```typescript
import { createQueryClient } from '@portal/shared/query';
```

## Usage Examples

### Creating a Logger

```typescript
import { createLogger } from '@portal/shared/server/logger';

const log = createLogger('my-module', { service: 'api' });
log.info('Starting service');
log.error({ err: error }, 'Request failed');
```

### Database Operations

```typescript
import { withConnection } from '@portal/shared/server/oracle/connection';
import { sessionRepository } from '@portal/shared/server/oracle/repositories';

// Using repository
const sessions = await sessionRepository.listByUser(userId);

// Custom query
const result = await withConnection(async (conn) => {
	return conn.execute('SELECT * FROM users WHERE id = :id', [userId]);
});
```

### Tool Execution

```typescript
import { executeTool } from '@portal/shared/tools';

const result = await executeTool({
	name: 'list_compute_instances',
	parameters: {
		compartmentId: 'ocid1.compartment...'
	},
	userId: 'user123',
	orgId: 'org456'
});
```

### Error Handling

```typescript
import {
	PortalError,
	ValidationError,
	AuthError,
	errorResponse
} from '@portal/shared/server/errors';

try {
	// ... operation
} catch (error) {
	if (error instanceof PortalError) {
		return errorResponse(error);
	}
	throw new ValidationError('Invalid input', { field: 'email' });
}
```

## Dependencies

### Runtime

- `@acedergren/oci-genai-provider` - OCI GenAI provider for AI SDK
- `ai` - AI SDK for LLM integrations
- `better-auth` - Authentication library
- `better-sqlite3` - SQLite for fallback storage
- `oracledb` - Oracle Database driver
- `pino` - Logging library
- `uuid` - UUID generation
- `zod` - Schema validation

### Dev Dependencies

- `typescript` - TypeScript compiler
- `@types/better-sqlite3` - Type definitions

## Configuration

The shared package expects certain environment variables to be set by the consuming application:

```bash
# Oracle Database
ORACLE_USER=ADMIN
ORACLE_PASSWORD=<password>
ORACLE_DSN=<dsn>
ORACLE_WALLET_LOCATION=/path/to/wallet

# OCI
OCI_REGION=eu-frankfurt-1
OCI_COMPARTMENT_OCID=<ocid>

# Auth
BETTER_AUTH_SECRET=<secret>
OIDC_CLIENT_ID=<client-id>
OIDC_CLIENT_SECRET=<client-secret>
OIDC_ISSUER=<issuer>

# Observability
SENTRY_DSN=<optional-dsn>
```

## Testing

```bash
# Run all tests in shared package
pnpm --filter @portal/shared test

# From workspace root
pnpm test
```

## Building

```bash
# Build shared package
pnpm --filter @portal/shared build

# From workspace root (builds shared first)
pnpm build
```

## Type Safety

All exports are fully typed with TypeScript. Import types alongside values:

```typescript
import { createLogger } from '@portal/shared/server/logger';
import type { Logger } from '@portal/shared/server/logger';

const log: Logger = createLogger('app');
```

## Architecture Notes

### Oracle Fallback Pattern

All services that interact with Oracle Database have fallback mechanisms:

- **Audit**: Falls back to JSONL file
- **Sessions**: Falls back to SQLite
- **Approvals**: Falls back to in-memory Map

This ensures the application remains functional even if Oracle is unavailable.

### RBAC Model

3 roles with granular permissions:

- **viewer**: Read-only access (4 permissions)
- **operator**: Execute operations (9 permissions)
- **admin**: Full control (13 permissions)

See `auth/rbac.ts` for complete permission matrix.

### Workflow Engine

Custom workflow executor with:

- Topological sort for dependency resolution
- Cycle detection
- Safe expression evaluation (no eval/Function)
- Support for 8 node types (tool, condition, loop, approval, ai-step, input, output, parallel)

### Security Features

- **Column validation**: Regex-based SQL injection prevention
- **CSP nonces**: Dynamic nonce generation per request
- **DB-backed approvals**: Single-use tokens with 5-min expiry
- **Rate limiting**: Atomic MERGE INTO for TOCTOU prevention
- **Webhook SSRF prevention**: Private IP blocking
- **HMAC-SHA256 signatures**: Timing-safe comparison

## Contributing

This package is part of the OCI Self-Service Portal monorepo. All shared business logic should be placed here to enable reuse across frontend and backend applications.

### Adding New Modules

1. Create module in appropriate directory (e.g., `src/server/my-module/`)
2. Export from `src/server/index.ts`
3. Add to `package.json` exports if needed
4. Update this README

### Versioning

Version is synchronized across all workspace packages. Bump version at workspace root.

## License

Private - Internal Use Only
