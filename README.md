# OCI Self-Service Portal

Production-ready enterprise platform for OCI resource management with AI chat, workflow automation, and admin console.

## Features

- **AI Chat Assistant** - Streaming chat with OCI GenAI and 60+ tool integrations
- **Workflow Designer** - Visual Svelte Flow canvas for multi-step OCI operations
- **Admin Console** - Database-driven configuration (identity providers, AI models, settings)
- **API Key Management** - Programmatic access with org-scoped keys and permissions
- **Vector Search** - Semantic search over conversations with Oracle 26AI embeddings
- **Webhook System** - HMAC-signed outbound events with retry logic
- **Session Management** - Multi-device sessions with activity audit trail
- **Security Hardened** - RBAC, CSP nonce, rate limiting, SSRF prevention, AES-256-GCM encryption

## Prerequisites

- Node.js 22+
- pnpm 10+
- OCI CLI configured (`~/.oci/config`)

## Quick Start

```bash
cd oci-ai-chat
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your OCI settings

pnpm dev
```

Open http://localhost:5173

## Configuration

### Environment Variables

```bash
# Oracle Database
ORACLE_USER=ADMIN
ORACLE_PASSWORD=***
ORACLE_CONNECT_STRING=langflowdb_high
ORACLE_WALLET_LOCATION=/wallets

# Auth
BETTER_AUTH_SECRET=***
OIDC_CLIENT_ID=***
OIDC_CLIENT_SECRET=***

# OCI
OCI_REGION=eu-frankfurt-1
OCI_COMPARTMENT_ID=ocid1.compartment.oc1..xxxxx

# Optional: Observability
SENTRY_DSN=***
SENTRY_ENVIRONMENT=production
```

See `.env.example` for full configuration guide.

### OCI CLI Setup

```bash
# Configure OCI CLI credentials
mkdir -p ~/.oci
cp wallet/* /wallets/
export OCI_CONFIG_DIR=~/.oci
export OCI_PROFILE=DEFAULT
```

### MCP Servers (Optional)

Configure in `.mcp.json` to add external tool servers:

```json
{
	"mcpServers": {
		"filesystem": {
			"command": "npx",
			"args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
		}
	}
}
```

## Architecture

Monorepo with dedicated frontend (SvelteKit) and API (Fastify) services:

```
oci-self-service-portal/
├── apps/
│   ├── frontend/              # SvelteKit UI (SSR, streaming)
│   │   ├── src/routes/        # Pages + API routes
│   │   ├── src/lib/
│   │   │   ├── components/    # 50+ Svelte UI components
│   │   │   ├── tools/         # 60+ OCI CLI wrappers
│   │   │   └── server/        # Auth, DB, workflows
│   │   └── Dockerfile
│   │
│   └── api/                    # Fastify 5 backend (optional, feature-flagged)
│       ├── src/
│       │   ├── app.ts         # Plugin chain factory
│       │   ├── plugins/       # Middleware (Oracle, Auth, RBAC)
│       │   ├── routes/        # REST endpoints
│       │   ├── mastra/        # AI framework (agents, RAG, MCP)
│       │   └── services/      # Business logic
│       └── package.json
│
├── packages/
│   └── shared/                # Shared types & errors
│       ├── src/
│       │   ├── errors.ts      # PortalError hierarchy
│       │   ├── rbac.ts        # Roles & permissions
│       │   └── types/         # Zod schemas
│       └── package.json
│
├── docs/
│   ├── ARCHITECTURE.md        # System design
│   ├── SECURITY.md            # Auth, encryption, hardening
│   ├── ROADMAP.md             # Phase tracking
│   └── ...
│
└── package.json               # Workspace root
```

**Key separation**:

- `packages/shared`: Business logic (Oracle repos, RBAC, errors)
- `apps/frontend`: SvelteKit UI + feature-flagged Fastify proxy
- `apps/api`: Optional Fastify backend for independent scaling

## API Endpoints

### Internal (Session Auth)

| Endpoint                  | Method     | Description                            |
| ------------------------- | ---------- | -------------------------------------- |
| `/api/chat`               | POST       | Stream AI chat with tool execution     |
| `/api/sessions`           | GET/POST   | List/create sessions                   |
| `/api/sessions/[id]`      | GET/DELETE | Get/delete session                     |
| `/api/activity`           | GET        | Tool execution audit log               |
| `/api/workflows`          | GET/POST   | Workflow CRUD                          |
| `/api/workflows/[id]/run` | POST       | Execute workflow                       |
| `/api/health`             | GET        | Health check (admin-restricted detail) |
| `/api/healthz`            | GET        | Health check (public, minimal)         |
| `/api/metrics`            | GET        | Prometheus metrics (no auth)           |
| `/api/admin/*`            | GET/POST   | Admin: IDP, AI models, settings        |
| `/api/setup/*`            | GET/POST   | Initial setup wizard                   |

### External (API Key or Session Auth)

| Endpoint                       | Method   | Description                    |
| ------------------------------ | -------- | ------------------------------ |
| `/api/v1/tools`                | GET      | List available tools           |
| `/api/v1/tools/[name]`         | GET      | Get tool details               |
| `/api/v1/tools/[name]/execute` | POST     | Execute tool with confirmation |
| `/api/v1/workflows`            | GET      | List workflows                 |
| `/api/v1/workflows/[id]/run`   | POST     | Execute workflow               |
| `/api/v1/webhooks`             | GET/POST | Webhook management             |
| `/api/v1/search`               | POST     | Vector semantic search         |
| `/api/v1/openapi.json`         | GET      | OpenAPI specification          |

## Security Features

**Authentication & Authorization**:

- Session-based (Better Auth + OCI IAM OIDC)
- API key authentication (SHA-256 hashed, org-scoped)
- Role-based access control (3 roles, 13 permissions)
- Setup token guard for initial configuration

**Infrastructure Security**:

- Content Security Policy with per-request nonce
- SSRF prevention (URL validation, private IP blocklist)
- SQL injection prevention (bind parameters + column validation)
- Rate limiting (granular per-endpoint, DB-backed with fallback)

**Data Protection**:

- AES-256-GCM encryption for secrets at rest
- HMAC-SHA256 webhook signatures (constant-time comparison)
- Audit trail (standard + immutable blockchain table)
- Secure HTTP headers (HSTS, X-Frame-Options, Permissions-Policy)

**API Security**:

- Server-side approval tokens (single-use, 5-minute TTL)
- IDOR prevention (org-scoped queries)
- Dual auth pattern (session + API key)
- Response slimming (no internal error details to client)

See [docs/SECURITY.md](docs/SECURITY.md) for comprehensive security model.

## Development

```bash
# Type check
pnpm check

# Run tests
pnpm test

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## License

MIT
