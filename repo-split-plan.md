# OCI AI Chat - Standalone Repository Split Plan

**Version:** 1.0
**Date:** February 6, 2026
**Purpose:** Split oci-ai-chat from oci-genai-examples monorepo into standalone repository

---

## Executive Summary

This plan details the extraction of the `oci-ai-chat` SvelteKit application from the `oci-genai-examples` monorepo into its own standalone repository. The `oci-genai-provider` package is published on npm as `@acedergren/oci-genai-provider`, so we'll install it as a regular dependency instead of using pnpm workspaces.

**Key Changes:**

- Convert from pnpm workspace dependency to npm registry dependency for oci-genai-provider
- Inline workspace packages into src/lib/ structure (agent-state, mcp-client, oci-genai-query)
- Migrate imports from `@acedergren/*` to SvelteKit `$lib/*` aliases
- Create standalone repository structure with proper documentation
- Set up independent CI/CD pipeline
- Configure Serena for the new repository

---

## 1. New Repository Structure

```
oci-ai-chat/                          # Root of standalone repo
├── .github/                          # GitHub configuration
│   └── workflows/                    # CI/CD workflows
│       ├── ci.yml                    # Main CI pipeline (lint, test, build)
│       ├── docker.yml                # Docker image build & publish
│       └── deploy.yml                # Optional: deployment workflow
│
├── .serena/                          # Serena configuration
│   ├── project.yml                   # Project settings
│   └── cache/                        # Serena cache (gitignored)
│
├── docs/                             # Documentation
│   ├── ROADMAP.md                    # Current: Phases 1-5 progress tracker
│   ├── ARCHITECTURE.md               # System architecture overview
│   ├── DEPLOYMENT.md                 # Deployment guide
│   └── DEVELOPMENT.md                # Development setup guide
│
├── src/                              # SvelteKit application source
│   ├── app.d.ts                      # TypeScript app declarations
│   ├── app.html                      # HTML template
│   ├── hooks.server.ts               # Server hooks (auth, security)
│   ├── lib/                          # Shared library code
│   │   ├── auth-client.ts            # Better Auth client
│   │   ├── components/               # Svelte components
│   │   │   ├── mobile/               # Mobile-specific components
│   │   │   ├── panels/               # Panel components
│   │   │   ├── portal/               # Portal components (17 from Phase 5)
│   │   │   ├── ui/                   # shadcn-svelte UI components
│   │   │   └── UserMenu.svelte       # User menu component
│   │   ├── pricing/                  # Cloud pricing comparison
│   │   │   └── data/                 # Pricing data files
│   │   ├── query/                    # Query utilities (inlined from @acedergren/oci-genai-query)
│   │   ├── server/                   # Server-side code
│   │   │   ├── agent-state/          # Agent state management (inlined from @acedergren/agent-state)
│   │   │   ├── auth/                 # Better Auth + OIDC configuration
│   │   │   ├── mcp-client/           # MCP client (inlined from @acedergren/mcp-client)
│   │   │   ├── oracle/               # Oracle ADB 26AI integration
│   │   │   ├── approvals.ts          # Approval tokens (Phase 4)
│   │   │   ├── audit.ts              # Audit logging
│   │   │   ├── db.ts                 # Database connection pool
│   │   │   ├── rate-limiter.ts       # DB-backed rate limiting (Phase 4)
│   │   │   ├── session.ts            # Session management
│   │   │   └── tracing.ts            # Request tracing (Phase 4)
│   │   ├── stores/                   # Svelte stores
│   │   ├── stubs/                    # Test stubs
│   │   ├── terraform/                # Terraform HCL generator
│   │   ├── tools/                    # OCI CLI tool wrappers (60+ tools)
│   │   │   ├── categories/           # Tool category modules
│   │   │   ├── index.ts              # Tool exports
│   │   │   └── registry.ts           # Tool registry orchestrator
│   │   ├── utils/                    # Utility functions
│   │   └── workflows/                # Multi-step workflow templates
│   ├── routes/                       # SvelteKit routes
│   │   ├── +layout.svelte            # Root layout
│   │   ├── +layout.server.ts         # Root layout server
│   │   ├── +page.svelte              # Main chat UI
│   │   ├── api/                      # API routes
│   │   │   ├── activity/             # Activity/tool execution logs (Phase 5)
│   │   │   ├── auth/                 # Better Auth endpoints
│   │   │   ├── chat/                 # Streaming chat endpoint
│   │   │   ├── health/               # Health check endpoint
│   │   │   ├── healthz/              # Kubernetes health endpoint
│   │   │   ├── mcp/                  # MCP server status
│   │   │   ├── models/               # Available models
│   │   │   ├── sessions/             # Session management
│   │   │   └── tools/                # Tool approval & execution
│   │   ├── login/                    # Login page
│   │   └── self-service/             # Self-service portal
│   └── tests/                        # Test files
│       ├── auth/                     # Auth tests (Phase 3)
│       ├── phase4/                   # Security & infrastructure tests
│       ├── phase5/                   # Portal component tests
│       ├── phase6/                   # Future: Observability tests
│       ├── phase7/                   # Future: Performance tests
│       └── phase8/                   # Future: Integration tests
│
├── static/                           # Static assets
│   ├── favicon.png                   # Favicon
│   └── robots.txt                    # Robots.txt (if present)
│
├── .dockerignore                     # Docker ignore patterns
├── .env.example                      # Environment variable template
├── .eslintrc.js → eslint.config.js   # ESLint configuration (flat config)
├── .gitignore                        # Git ignore patterns
├── .prettierignore                   # Prettier ignore patterns
├── .prettierrc                       # Prettier configuration
├── CLAUDE.md                         # Claude Code project context
├── components.json                   # shadcn-svelte configuration
├── docker-compose.yml                # Local Docker Compose setup
├── Dockerfile                        # Production Docker image
├── LICENSE                           # MIT License
├── package.json                      # NPM package configuration
├── postcss.config.js                 # PostCSS configuration (if present)
├── README.md                         # Project README
├── svelte.config.js                  # SvelteKit configuration
├── tailwind.config.ts                # Tailwind CSS configuration
├── tsconfig.json                     # TypeScript configuration
├── vite.config.ts                    # Vite configuration
└── vitest.config.ts                  # Vitest configuration
```

---

## 2. File Manifest

### 2.1 Files to Copy (Source → Destination)

All paths relative to `/Users/acedergr/Projects/oci-genai-examples/`

#### Root Configuration Files

```
oci-ai-chat/.dockerignore          → .dockerignore
oci-ai-chat/.env.example           → .env.example
oci-ai-chat/components.json        → components.json
oci-ai-chat/docker-compose.yml     → docker-compose.yml
oci-ai-chat/Dockerfile             → Dockerfile
oci-ai-chat/eslint.config.js       → eslint.config.js
oci-ai-chat/package.json           → package.json (MODIFY - see section 3)
oci-ai-chat/svelte.config.js       → svelte.config.js
oci-ai-chat/tsconfig.json          → tsconfig.json
oci-ai-chat/vite.config.ts         → vite.config.ts
oci-ai-chat/vitest.config.ts       → vitest.config.ts
oci-ai-chat/.prettierrc            → .prettierrc
oci-ai-chat/.prettierignore        → .prettierignore
```

#### Source Code (entire directories)

```
oci-ai-chat/src/                   → src/
oci-ai-chat/static/                → static/ (if exists)
oci-ai-chat/docs/                  → docs/ (if exists)
```

#### Serena Configuration

```
oci-ai-chat/.serena/project.yml    → .serena/project.yml (MODIFY - see section 7)
```

#### Documentation (to be created/adapted)

```
oci-ai-chat/README.md              → README.md (REWRITE - see section 4)
(new file)                         → CLAUDE.md (CREATE - see section 5)
(new file)                         → LICENSE (CREATE - see section 8)
(new file)                         → .github/workflows/ci.yml (CREATE - see section 9)
(new file)                         → docs/ARCHITECTURE.md (CREATE - optional)
(new file)                         → docs/DEPLOYMENT.md (CREATE - optional)
(new file)                         → docs/DEVELOPMENT.md (CREATE - optional)
```

#### Copy docs/ if it exists

```
oci-ai-chat/docs/ROADMAP.md        → docs/ROADMAP.md (if exists)
oci-ai-chat/docs/*.md              → docs/*.md (copy all)
```

### 2.2 Files to Exclude

**Do NOT copy the following:**

```
# Build artifacts
oci-ai-chat/.svelte-kit/
oci-ai-chat/build/
oci-ai-chat/dist/
oci-ai-chat/node_modules/

# Environment files
oci-ai-chat/.env
oci-ai-chat/.env.local
oci-ai-chat/.env.*.local

# Git history
oci-ai-chat/.git/

# IDE/Editor files
oci-ai-chat/.vercel/
oci-ai-chat/.wrangler/
oci-ai-chat/.opencode/

# Local data
oci-ai-chat/data/

# Serena cache
oci-ai-chat/.serena/cache/

# Test artifacts
oci-ai-chat/demo/
oci-ai-chat/tests/
oci-ai-chat/test-*.py
oci-ai-chat/test-*.mjs
oci-ai-chat/test-*.sh

# Other monorepo artifacts
../pnpm-lock.yaml (create new lockfile)
../.github/ (create new workflows)
../CLAUDE.md (create new context file)
```

### 2.3 New `.gitignore` for Standalone Repo

Create at root with comprehensive patterns:

```gitignore
# Dependencies
node_modules/
.pnp
.pnp.js

# Build outputs
build/
dist/
.svelte-kit/
.output/
.vercel/
.netlify/
.wrangler/

# Environment variables
.env
.env.local
.env.*.local

# Testing
coverage/
.nyc_output/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~
.DS_Store

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Database
data/*.db
data/*.db-journal
data/*.db-shm
data/*.db-wal

# Oracle Wallet
wallets/

# Serena
.serena/cache/

# Misc
.opencode/
*.tgz
```

---

## 3. package.json Modifications

### 3.1 Current Dependencies (workspace references)

```json
{
	"dependencies": {
		"@acedergren/agent-state": "workspace:*",
		"@acedergren/mcp-client": "workspace:*",
		"@acedergren/oci-genai-provider": "workspace:*",
		"@acedergren/oci-genai-query": "workspace:*"
		// ... other dependencies
	}
}
```

### 3.2 Updated Dependencies (npm registry)

**Analysis:**

- `@acedergren/oci-genai-provider` is published on npm (confirmed from package.json)
- Other workspace packages (`agent-state`, `mcp-client`, `oci-genai-query`) are NOT mentioned in current memory or documentation
- Need to check if these are actually used in the codebase

**Action Required:**

1. Grep codebase for imports of workspace packages
2. If unused, remove from dependencies
3. If used, either:
   - Inline the code into oci-ai-chat
   - Publish as separate npm packages
   - Bundle with oci-ai-chat as internal modules

**Updated package.json (with inlined packages):**

```json
{
	"name": "oci-ai-chat",
	"version": "0.1.0",
	"description": "Production-ready SvelteKit chat application with OCI Generative AI, RBAC, and Oracle Database integration",
	"type": "module",
	"private": true,
	"author": "Alexander Cedergren <alexander.cedergren@oracle.com>",
	"license": "MIT",
	"repository": {
		"type": "git",
		"url": "https://github.com/acedergren/oci-ai-chat.git"
	},
	"keywords": [
		"oci",
		"oracle-cloud",
		"generative-ai",
		"chat",
		"sveltekit",
		"ai-sdk",
		"better-auth",
		"oracle-database",
		"rbac"
	],
	"scripts": {
		"dev": "vite dev",
		"build": "vite build",
		"preview": "vite preview",
		"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
		"test": "vitest run",
		"test:watch": "vitest",
		"test:ui": "vitest --ui",
		"lint": "eslint .",
		"lint:fix": "eslint . --fix",
		"format": "prettier --write .",
		"format:check": "prettier --check .",
		"docker:build": "docker build -t oci-ai-chat .",
		"docker:run": "docker-compose up"
	},
	"dependencies": {
		"@acedergren/oci-genai-provider": "^0.1.0",
		"@ai-sdk/svelte": "^4.0.69",
		"@tanstack/svelte-query": "^6.0.18",
		"ai": "^6.0.69",
		"better-auth": "^1.4.18",
		"clsx": "^2.1.1",
		"dompurify": "^3.3.1",
		"marked": "^17.0.1",
		"oracledb": "^6.10.0",
		"pino": "^10.3.0",
		"svelte-sonner": "^1.0.7",
		"tailwind-merge": "^3.4.0",
		"uuid": "^13.0.0",
		"zod": "^4.3.6"
	},
	"devDependencies": {
		"@eslint/js": "^9.39.2",
		"@sveltejs/adapter-node": "^5.5.2",
		"@sveltejs/kit": "^2.50.2",
		"@sveltejs/vite-plugin-svelte": "^5.1.1",
		"@tailwindcss/typography": "^0.5.19",
		"@tailwindcss/vite": "^4.1.18",
		"@tanstack/query-core": "^5.90.20",
		"@types/dompurify": "^3.2.0",
		"@types/node": "^20.14.0",
		"@types/uuid": "^10.0.0",
		"bits-ui": "^2.15.5",
		"eslint": "^9.39.2",
		"eslint-plugin-svelte": "^3.14.0",
		"globals": "^17.3.0",
		"postcss": "^8.5.6",
		"prettier": "^3.8.1",
		"prettier-plugin-svelte": "^3.4.1",
		"svelte": "^5.49.1",
		"svelte-check": "^4.3.6",
		"tailwind-variants": "^3.2.2",
		"tailwindcss": "^4.1.18",
		"typescript": "^5.9.3",
		"typescript-eslint": "^8.54.0",
		"vite": "^6.4.1",
		"vitest": "^4.0.18"
	},
	"engines": {
		"node": ">=18.0.0",
		"pnpm": ">=8.0.0"
	}
}
```

**Note:** Workspace packages (`@acedergren/agent-state`, `@acedergren/mcp-client`, `@acedergren/oci-genai-query`) have been removed. Their code will be inlined into `src/lib/` (see section 10).

---

## 4. README.md Structure

Rewrite the README to focus on standalone repository usage.

### 4.1 New README Outline

````markdown
# OCI AI Chat

Production-ready SvelteKit chat application with OCI Generative AI, tool calling, RBAC, and Oracle Database integration.

## Features

### Core

- **Streaming Chat** - Real-time AI responses with Vercel AI SDK
- **30+ Models** - Meta Llama, Cohere Command, Google Gemini, xAI Grok
- **60+ OCI Tools** - Compute, networking, database, storage, security, observability
- **Tool Calling** - AI can execute OCI CLI commands with approval workflow
- **Session Persistence** - Oracle ADB 26AI or SQLite fallback

### Security (Phase 3-4)

- **Better Auth + OIDC** - OCI IAM Identity Domains integration
- **RBAC** - 3 roles (viewer/operator/admin), 10 permissions
- **Multi-tenancy** - Compartment isolation
- **Rate Limiting** - DB-backed, atomic MERGE INTO pattern
- **Request Tracing** - `req-{uuid}` propagated via headers
- **Approval Tokens** - Server-side, single-use, 5-min expiry
- **CSP & Security Headers** - HSTS, X-Frame-Options, etc.

### UI (Phase 5)

- **17 Portal Components** - Decomposed from 2042-line monolith
- **shadcn-svelte** - Modern UI primitives with bits-ui + Svelte 5
- **Activity Feed** - Real-time tool execution logs
- **Mobile Responsive** - Works on all device sizes

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm 8+
- OCI CLI configured (`~/.oci/config`)
- Optional: Oracle Autonomous Database 26AI (falls back to SQLite)

### Installation

```bash
git clone https://github.com/acedergren/oci-ai-chat.git
cd oci-ai-chat
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your OCI settings

pnpm dev
```
````

Open http://localhost:5173

## Configuration

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed setup.

### Required Environment Variables

```bash
# OCI Configuration
OCI_COMPARTMENT_ID=ocid1.compartment.oc1..xxxxx
OCI_REGION=us-chicago-1

# Better Auth (Phase 3)
BETTER_AUTH_SECRET=<generate-with-openssl-rand-base64-32>
OCI_IAM_CLIENT_ID=<oidc-client-id>
OCI_IAM_CLIENT_SECRET=<oidc-client-secret>

# Optional: Oracle Database (Phase 2)
ORACLE_USER=ADMIN
ORACLE_PASSWORD=<from-oci-vault>
ORACLE_CONNECT_STRING=adb_high
ORACLE_WALLET_LOCATION=/path/to/wallet
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture.

```
┌─────────────────────────────────────────────────────────┐
│  SvelteKit Frontend (Svelte 5 + AI SDK)                │
│  - 17 Portal Components (Phase 5)                      │
│  - shadcn-svelte UI primitives                         │
│  - TanStack Query for server state                     │
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│  API Routes (+server.ts)                               │
│  - /api/chat - Streaming chat with tools               │
│  - /api/sessions - Session CRUD                        │
│  - /api/activity - Tool execution logs (Phase 5)       │
│  - /api/tools - Approval & execution                   │
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│  Server Layer (hooks.server.ts)                        │
│  - Better Auth middleware (Phase 3)                    │
│  - RBAC permission checks                              │
│  - Rate limiting (Phase 4)                             │
│  - Request tracing (Phase 4)                           │
│  - CSP & security headers                              │
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│  Services (src/lib/server/)                            │
│  - Tool Registry (60+ OCI tools)                       │
│  - Oracle ADB 26AI repositories (Phase 2)              │
│  - Approval tokens (Phase 4)                           │
│  - Audit logging                                       │
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│  Data Layer                                            │
│  - Oracle ADB 26AI (primary) - Phase 2                 │
│  - SQLite fallback (development)                       │
│  - JSONL/in-memory fallback (no DB)                    │
└─────────────────────────────────────────────────────────┘
```

## Development

### Scripts

```bash
pnpm dev              # Start dev server (port 5173)
pnpm build            # Build for production
pnpm preview          # Preview production build
pnpm check            # TypeScript + Svelte type check
pnpm test             # Run tests (289 tests as of Phase 5)
pnpm test:watch       # Watch mode
pnpm lint             # ESLint check
pnpm lint:fix         # ESLint fix
pnpm format           # Prettier format
pnpm format:check     # Prettier check
```

### Testing

- **289 total tests** (as of Phase 5)
  - Phase 3: 52 auth/RBAC tests
  - Phase 4: 26 security/infrastructure tests
  - Phase 5: 78 portal component tests
- **Test runner:** Vitest
- **Coverage:** `pnpm test -- --coverage`

### Docker

```bash
# Build image
docker build -t oci-ai-chat .

# Run with Docker Compose
docker-compose up

# Or run standalone
docker run -p 3000:3000 \
  -v ~/.oci:/root/.oci:ro \
  -e OCI_COMPARTMENT_ID=ocid1... \
  oci-ai-chat
```

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production deployment guide.

**Deployment targets:**

- OCI Compute + Docker
- OCI Container Instances
- Kubernetes (Helm chart TODO)

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for detailed progress.

- ✅ **Phase 1:** Foundation (adapter-node, Docker, CI)
- ✅ **Phase 2:** Oracle ADB 26AI integration
- ✅ **Phase 3:** Better Auth + OIDC + RBAC
- ✅ **Phase 4:** Security hardening (rate limiting, tracing, approval tokens)
- ✅ **Phase 5:** Portal decomposition (17 components, shadcn-svelte)
- 🚧 **Phase 6:** Observability (OpenTelemetry, metrics, logs)
- 📋 **Phase 7:** Performance (caching, query optimization)
- 📋 **Phase 8:** Advanced features (file uploads, embeddings, RAG)

## Contributing

Contributions are welcome! Please open an issue or PR.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

Alexander Cedergren <alexander.cedergren@oracle.com>

## Related Projects

- [oci-genai-provider](https://github.com/acedergren/oci-genai-provider) - OCI GenAI provider for Vercel AI SDK
- [oci-genai-examples](https://github.com/acedergren/oci-genai-examples) - OCI GenAI examples monorepo (original home)

````

---

## 5. CLAUDE.md Structure

Create a comprehensive project context file for Claude Code.

### 5.1 CLAUDE.md Template

```markdown
# OCI AI Chat - Claude Code Context

Last Updated: February 6, 2026

## Project Overview

Production-ready SvelteKit chat application with OCI Generative AI, tool calling, RBAC, and Oracle Database integration.

**Repository:** https://github.com/acedergren/oci-ai-chat
**License:** MIT
**Node:** 18+
**Package Manager:** pnpm 8+

## Technology Stack

### Frontend
- **SvelteKit** 2.50+ (Svelte 5 runes mode)
- **Vercel AI SDK** 6.0+ (`ai`, `@ai-sdk/svelte`)
- **shadcn-svelte** (bits-ui@next for Svelte 5)
- **TailwindCSS** 4.1+ (with @tailwindcss/vite plugin)
- **TanStack Query** (svelte-query)
- **svelte-sonner** (toast notifications)

### Backend
- **SvelteKit API Routes** (+server.ts)
- **@sveltejs/adapter-node** (Docker/OCI deployment)
- **Better Auth** 1.4+ (OIDC with OCI IAM)
- **Oracle Database 26AI** (via oracledb node package)
- **pino** (structured logging)

### Tools & CLI
- **OCI CLI** (60+ wrapped tools)
- **@acedergren/oci-genai-provider** (npm package, v0.1.0)
- **Zod** (schema validation)

### Testing & Quality
- **Vitest** (unit + integration tests)
- **ESLint** 9+ (flat config)
- **Prettier** (code formatting)
- **svelte-check** (TypeScript + Svelte validation)

## Architecture

### Directory Structure

````

src/
├── hooks.server.ts # Auth, rate limiting, tracing, CSP
├── lib/
│ ├── components/
│ │ ├── portal/ # 17 decomposed components (Phase 5)
│ │ ├── ui/ # shadcn-svelte primitives
│ │ └── UserMenu.svelte
│ ├── query/ # Query utilities (inlined from @acedergren/oci-genai-query)
│ ├── server/
│ │ ├── agent-state/ # Agent state management (inlined from @acedergren/agent-state)
│ │ ├── auth/ # Better Auth + RBAC (Phase 3)
│ │ ├── mcp-client/ # MCP client (inlined from @acedergren/mcp-client)
│ │ ├── oracle/ # ADB 26AI repositories (Phase 2)
│ │ ├── rate-limiter.ts # DB-backed, atomic (Phase 4)
│ │ ├── tracing.ts # Request IDs (Phase 4)
│ │ ├── approvals.ts # Single-use tokens (Phase 4)
│ │ ├── audit.ts # Audit logging
│ │ ├── session.ts # Session CRUD
│ │ └── db.ts # Oracle connection pool
│ ├── tools/
│ │ ├── registry.ts # Slim orchestrator (Phase 4)
│ │ └── categories/ # 11 tool category modules
│ ├── pricing/ # Cloud pricing comparison
│ ├── terraform/ # HCL code generator
│ ├── workflows/ # Multi-step templates
│ └── utils/
└── routes/
├── +page.svelte # Main chat UI (212 lines, Phase 5)
├── +layout.svelte # Root layout
├── +layout.server.ts # Auth session loading
├── api/
│ ├── chat/+server.ts # Streaming chat with tools
│ ├── sessions/+server.ts # Session CRUD
│ ├── activity/+server.ts # Tool execution logs (Phase 5)
│ ├── tools/
│ │ ├── approve/+server.ts # Approval token recording
│ │ └── execute/+server.ts # Tool execution
│ ├── auth/[...all]/+server.ts # Better Auth handler
│ └── health/+server.ts # Health check
├── login/+page.svelte # Login page
└── self-service/+page.svelte # Self-service portal

````

### Key Patterns (from Memory)

#### Response Slimming
```typescript
// OCI CLI output is verbose; slim it before returning to AI
slimOCIResponse(data, pickFields)
````

#### OCI CLI Flags

- **Never combine `--all` and `--limit`** (Zod defaults always send both)
- Use pagination for large result sets

#### Namespace Auto-Fetch

- Bucket tools auto-fetch namespace via `oci os ns get`

#### Oracle Fallback Chain

All services support graceful degradation:

1. Oracle ADB 26AI (primary)
2. SQLite (development)
3. JSONL/in-memory (no DB)

#### Better Auth Build

- Requires `BETTER_AUTH_SECRET` env var
- Fallback string for builds (logs warning in production)

#### Oracle UPPERCASE Keys

- `OUT_FORMAT_OBJECT` returns UPPERCASE
- Use `fromOracleRow()` helper for camelCase conversion

#### Export for Testability

- Export helpers (`toSnakeCase`, `toCamelCase`, etc.)
- QA tests import directly

#### DB Rate Limiting (Phase 4)

- `MERGE INTO` for atomic upsert
- Fail-open on DB errors
- Per-user + per-IP tracking

#### Request Tracing (Phase 4)

- Generate `req-{uuid}` in hooks
- Propagate via `X-Request-Id` header
- Log with trace ID

#### Approval Tokens (Phase 4)

- Server-side `recordApproval()` / `consumeApproval()`
- Single-use, 5-min expiry
- Prevents client bypass

#### Tool Execution (Phase 4)

- Centralized `executeTool()` in registry
- Removed 11 duplicate executors from execute/+server.ts

#### Portal Decomposition (Phase 5)

- Bottom-up extraction (leaves first, then containers)
- State ownership: AI SDK state in +page.svelte, components are pure
- 17 components, 212-line orchestrator

#### shadcn-svelte (Phase 5)

- bits-ui@next for Svelte 5 compatibility
- `cn()` helper in `src/lib/utils/cn.ts`
- svelte-sonner for toasts

#### Notification Helpers (Phase 5)

- Domain-specific: `notifyToolSuccess()`, `notifyToolError()`, `notifyRateLimit()`
- Not generic notification API

## Security Posture

### Fixed Issues (Phase 4 + 5)

- **C1:** Auth secret fallback + runtime warning
- **H1:** Auth errors → 503/redirect, no default permissions
- **H2:** Sessions filtered by `userId` (IDOR fix)
- **H3:** Server-side approval tokens (client bypass fix)
- **H4/H5:** Rate limiter TOCTOU fixed (atomic MERGE INTO)
- **M6:** `switchToSession()` requires `userId`, verifies ownership
- **M7:** Session POST passes `userId` to `create()`
- **M3-M5 partial:** LIKE escaping in session search

### Known Issues (Deferred)

- **M1:** Column injection in oracle-adapter (future: parameterized queries)
- **M2:** CSP `unsafe-inline` (future: nonce-based CSP)
- **Navigation:** "AI Chat" link goes to "/" instead of opening dialog

## Development Workflow

### Prerequisites

- OCI CLI configured (`~/.oci/config`)
- Oracle Database 26AI (optional, falls back to SQLite)
- Node 18+, pnpm 8+

### Quick Start

```bash
pnpm install
cp .env.example .env
# Edit .env (see Configuration section)
pnpm dev  # Port 5173 (or 5175 if occupied)
```

### Configuration

Required env vars:

```bash
OCI_COMPARTMENT_ID=ocid1.compartment.oc1..xxxxx
OCI_REGION=us-chicago-1
BETTER_AUTH_SECRET=<openssl rand -base64 32>
OCI_IAM_CLIENT_ID=<oidc-client-id>
OCI_IAM_CLIENT_SECRET=<oidc-client-secret>
```

Optional (Oracle DB):

```bash
ORACLE_USER=ADMIN
ORACLE_PASSWORD=<from-vault>
ORACLE_CONNECT_STRING=adb_high
ORACLE_WALLET_LOCATION=/path/to/wallet
ORACLE_WALLET_PASSWORD=<from-vault>
```

### Testing

```bash
pnpm test           # Run all tests (289 total)
pnpm test:watch     # Watch mode
pnpm check          # svelte-check
pnpm lint           # ESLint
pnpm format         # Prettier
```

### Phase Validation

After changes, validate:

```bash
pnpm lint && pnpm check && pnpm build && pnpm test
```

### Lint Baseline

- 20 pre-existing ESLint errors (self-service/\_page.svelte, demo-runner.ts)
- ~39 warnings (unused vars in tests, event_directive_deprecated)
- svelte-check errors from TDD imports of future-phase modules (expected)

## Upgrade Plan Progress

See `docs/ROADMAP.md` for full status.

- ✅ **Phase 1:** Foundation (adapter-node, Docker, ESLint/Prettier, CI, health endpoint)
- ✅ **Phase 2:** Oracle ADB 26AI (connection pool, migrations, repositories, fallbacks)
- ✅ **Phase 3:** Better Auth + OIDC + RBAC (3 roles, 10 permissions, 52 tests)
- ✅ **Phase 4:** Security hardening (rate limiting, tracing, approval tokens, 4 fixes, 26 tests)
- ✅ **Phase 5:** Portal decomposition (17 components, shadcn-svelte, 78 tests, 289 total)
- 🚧 **Phase 6:** Observability (OpenTelemetry, metrics, logs, traces)
- 📋 **Phase 7:** Performance (caching, query optimization, CDN)
- 📋 **Phase 8:** Advanced features (file uploads, embeddings, RAG, vector search)

## Agent Team Patterns (Historical)

This project was built using agent teams (4-6 agents):

- **Architect:** Delivers interfaces/types first
- **Backend:** Implements server logic
- **Frontend:** Builds UI components
- **QA:** Writes TDD tests (current + future phases)
- **Security:** Reviews previous phases before new work
- **EM (optional):** Coordinates across phases

**Pattern:** Architect → Backend/Frontend (parallel) → QA integration tests → Security review → Next phase

## External Dependencies

### npm Packages

- `@acedergren/oci-genai-provider@^0.1.0` - OCI GenAI provider for AI SDK

### Inlined Packages (formerly workspace dependencies)

- `src/lib/server/agent-state/` - Agent state management (from @acedergren/agent-state)
- `src/lib/server/mcp-client/` - MCP protocol client (from @acedergren/mcp-client)
- `src/lib/query/` - Query utilities for OCI GenAI (from @acedergren/oci-genai-query)

**Note:** These packages were copied from the monorepo and imports updated from `@acedergren/*` to `$lib/*` SvelteKit aliases.

### OCI Services

- **Generative AI** (inference.generativeai.\*.oci.oraclecloud.com)
- **Oracle Autonomous Database 26AI** (optional)
- **OCI Vault** (secret storage for prod deployments)
- **OCI IAM Identity Domains** (OIDC auth provider)

## Common Tasks

### Adding a New Tool

1. Create tool definition in `src/lib/tools/categories/<category>.ts`
2. Export from category index
3. Add to registry orchestrator in `src/lib/tools/registry.ts`
4. Write tests in `src/tests/tools/<tool-name>.test.ts`

### Adding a New Component

1. Create in `src/lib/components/portal/<ComponentName>.svelte`
2. Follow Svelte 5 runes pattern (`$state`, `$derived`, `$props`)
3. Use shadcn-svelte UI primitives from `src/lib/components/ui/`
4. Write tests in `src/tests/phase5/<component-name>.test.ts`

### Updating Database Schema

1. Create migration in `src/lib/server/oracle/migrations/`
2. Update repository in `src/lib/server/oracle/repositories/`
3. Test both Oracle and SQLite fallback
4. Update tests

### Adding a New Permission

1. Add to `src/lib/server/auth/rbac.ts` permissions enum
2. Update role mappings
3. Add guards to relevant API routes
4. Write tests for permission checks

## Troubleshooting

### Dev Server Port Conflicts

Default port 5173; falls back to 5175 if occupied.

### Oracle Connection Issues

Check:

1. Wallet location (`ORACLE_WALLET_LOCATION`)
2. Wallet password (`ORACLE_WALLET_PASSWORD`)
3. Connect string (`ORACLE_CONNECT_STRING`)
4. Network access to database

Falls back to SQLite if unavailable.

### Build Failures

Most common:

1. Missing `BETTER_AUTH_SECRET` - set to any string for builds
2. Type errors - run `pnpm check` for details
3. Import errors - check for workspace package references

### Test Failures

Phase-specific tests may fail if:

1. Importing future-phase modules (TDD pattern, expected)
2. Missing env vars (tests use fallbacks)
3. Oracle DB not available (tests skip DB-dependent tests)

## Additional Resources

- [Vercel AI SDK Docs](https://sdk.vercel.ai/docs)
- [SvelteKit Docs](https://kit.svelte.dev/docs)
- [Better Auth Docs](https://www.better-auth.com/docs)
- [OCI GenAI Docs](https://docs.oracle.com/en-us/iaas/Content/generative-ai/home.htm)
- [Oracle Database 26AI Docs](https://docs.oracle.com/en/database/oracle/oracle-database/26/)
- [shadcn-svelte](https://www.shadcn-svelte.com/)

---

**Note to Claude:** This project follows a multi-phase upgrade plan. Always check `docs/ROADMAP.md` for current status and phase-specific patterns in the memory section above.

````

---

## 6. `.env.example` Updates

Update the existing `.env.example` to be standalone-friendly.

### 6.1 Updated `.env.example`

```bash
# =============================================================================
# OCI AI Chat - Environment Configuration
# =============================================================================
# Copy this file to .env and fill in the values:
#
#   cp .env.example .env
#
# Then edit .env with your actual values.
# =============================================================================

# -----------------------------------------------------------------------------
# Application
# -----------------------------------------------------------------------------
NODE_ENV=development
PORT=5173
HOST=0.0.0.0
LOG_LEVEL=info                       # Options: debug, info, warn, error

# -----------------------------------------------------------------------------
# OCI Configuration
# -----------------------------------------------------------------------------
OCI_COMPARTMENT_ID=ocid1.compartment.oc1..aaaaaaaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OCI_REGION=us-chicago-1              # Or: eu-frankfurt-1, ap-mumbai-1, etc.
OCI_AUTH_METHOD=config_file          # Options: config_file, instance_principal, resource_principal
OCI_CONFIG_PROFILE=DEFAULT

# -----------------------------------------------------------------------------
# OCI GenAI Model Configuration
# -----------------------------------------------------------------------------
OCI_GENAI_MODEL_ID=cohere.command-r-plus
# OCI_GENAI_ENDPOINT=https://inference.generativeai.us-chicago-1.oci.oraclecloud.com

# -----------------------------------------------------------------------------
# Phase 2: Oracle Autonomous Database (Optional - falls back to SQLite)
# -----------------------------------------------------------------------------
# Retrieve passwords from OCI Vault in production:
#   oci secrets secret-bundle get --secret-id <ocid> \
#     --query 'data."secret-bundle-content".content' --raw-output | base64 -d
#
ORACLE_USER=ADMIN
ORACLE_PASSWORD=
ORACLE_CONNECT_STRING=adb_high
ORACLE_WALLET_LOCATION=/path/to/wallet
ORACLE_WALLET_PASSWORD=

# -----------------------------------------------------------------------------
# Phase 3: Better Auth (OIDC with OCI IAM Identity Domains)
# -----------------------------------------------------------------------------
# Generate a random secret: openssl rand -base64 32
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:5173
OCI_IAM_CLIENT_ID=
OCI_IAM_CLIENT_SECRET=
OCI_IAM_DISCOVERY_URL=https://identity.oraclecloud.com/.well-known/openid-configuration

# -----------------------------------------------------------------------------
# Optional: MCP Server Configuration
# -----------------------------------------------------------------------------
# MCP servers are configured in ~/.oci-genai/mcp.json
# No environment variables needed unless using custom MCP server locations
````

---

## 7. Serena Configuration

### 7.1 Updated `.serena/project.yml`

```yaml
# Serena Project Configuration
project_name: 'oci-ai-chat'

# Language servers
languages:
  - typescript

# Encoding
encoding: 'utf-8'

# Use .gitignore for file exclusions
ignore_all_files_in_gitignore: true

# Additional paths to ignore
ignored_paths:
  - 'node_modules/**'
  - '.svelte-kit/**'
  - 'build/**'
  - 'dist/**'
  - 'data/*.db'
  - 'wallets/**'

# Not read-only
read_only: false

# No excluded tools
excluded_tools: []

# No optional tools
included_optional_tools: []

# No fixed tools
fixed_tools: []

# Base modes (use global defaults)
base_modes:

# Default modes (use global defaults)
default_modes:

# Initial prompt
initial_prompt: |
  You are working on OCI AI Chat, a production-ready SvelteKit application with OCI Generative AI integration.

  Key architecture:
  - SvelteKit 2.50+ with Svelte 5 runes
  - Vercel AI SDK for streaming chat
  - Better Auth + OIDC with OCI IAM
  - Oracle Database 26AI (fallback to SQLite)
  - 60+ OCI CLI tool wrappers
  - RBAC with 3 roles, 10 permissions

  Important patterns:
  - Phase 4: DB-backed rate limiting (atomic MERGE INTO), request tracing, approval tokens
  - Phase 5: 17 portal components, shadcn-svelte, activity API
  - All services support Oracle → SQLite → in-memory fallback chain
  - Export helpers for testability (QA imports directly)

  See CLAUDE.md for full context and memory for phase-specific patterns.
```

### 7.2 New Repository Serena Setup

After creating the new repo:

```bash
# In the new oci-ai-chat repo
cd /path/to/new/oci-ai-chat

# Initialize Serena (if needed)
# This will create .serena/ directory with project.yml
# Follow Serena documentation for your specific setup
```

---

## 8. LICENSE File

Create a standard MIT license.

### 8.1 LICENSE Content

```
MIT License

Copyright (c) 2026 Alexander Cedergren

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 9. GitHub Actions CI/CD

Create comprehensive CI workflows.

### 9.1 `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run ESLint
        run: pnpm lint

      - name: Run Prettier
        run: pnpm format:check

  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run svelte-check
        run: pnpm check

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        run: pnpm test -- --coverage
        env:
          BETTER_AUTH_SECRET: test-secret-for-ci
          OCI_COMPARTMENT_ID: ocid1.compartment.oc1..test
          OCI_REGION: us-chicago-1

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        if: always()
        with:
          file: ./coverage/coverage-final.json

  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build application
        run: pnpm build
        env:
          BETTER_AUTH_SECRET: build-secret
          OCI_COMPARTMENT_ID: ocid1.compartment.oc1..build

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build
          path: build/
```

### 9.2 `.github/workflows/docker.yml`

```yaml
name: Docker Build

on:
  push:
    branches: [main]
    tags:
      - 'v*'
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    name: Build and Push Docker Image
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

---

## 10. Workspace Package Inlining Strategy

**Decision:** Inline all workspace packages into the new repository.

### 10.1 Package Destinations

Copy workspace package code into `src/lib/` structure:

| Package                          | Source                | Destination                   | Rationale                    |
| -------------------------------- | --------------------- | ----------------------------- | ---------------------------- |
| `@acedergren/oci-genai-provider` | N/A                   | npm package `^0.1.0`          | Published on npm             |
| `@acedergren/agent-state`        | `../agent-state/`     | `src/lib/server/agent-state/` | Server-side state management |
| `@acedergren/mcp-client`         | `../mcp-client/`      | `src/lib/server/mcp-client/`  | Server-side MCP client       |
| `@acedergren/oci-genai-query`    | `../oci-genai-query/` | `src/lib/query/`              | Already fits location        |

### 10.2 Import Path Migration

Update all imports in `src/` to use SvelteKit path aliases:

**Before (workspace):**

```typescript
import { createAgent } from '@acedergren/agent-state';
import { MCPClient } from '@acedergren/mcp-client';
import { createQuery } from '@acedergren/oci-genai-query';
```

**After (inlined):**

```typescript
import { createAgent } from '$lib/server/agent-state';
import { MCPClient } from '$lib/server/mcp-client';
import { createQuery } from '$lib/query';
```

### 10.3 Migration Steps

1. **Copy package source code:**

   ```bash
   # From oci-genai-examples root
   cp -r agent-state/src/* new-repo/src/lib/server/agent-state/
   cp -r mcp-client/src/* new-repo/src/lib/server/mcp-client/
   cp -r oci-genai-query/src/* new-repo/src/lib/query/
   ```

2. **Find and replace imports:**

   ```bash
   # In new repo
   find src -type f -name "*.ts" -o -name "*.svelte" | xargs sed -i '' \
     -e "s|from '@acedergren/agent-state'|from '\$lib/server/agent-state'|g" \
     -e "s|from '@acedergren/mcp-client'|from '\$lib/server/mcp-client'|g" \
     -e "s|from '@acedergren/oci-genai-query'|from '\$lib/query'|g"
   ```

3. **Remove from package.json:**

   ```diff
   {
     "dependencies": {
   -   "@acedergren/agent-state": "workspace:*",
   -   "@acedergren/mcp-client": "workspace:*",
       "@acedergren/oci-genai-provider": "^0.1.0",
   -   "@acedergren/oci-genai-query": "workspace:*",
       // ... other dependencies
     }
   }
   ```

4. **Update internal imports within inlined packages:**
   - If packages import each other, update to relative paths
   - Example: `agent-state` importing `oci-genai-query`

     ```typescript
     // Before
     import { createQuery } from '@acedergren/oci-genai-query';

     // After
     import { createQuery } from '../../query';
     ```

### 10.4 Verification Checklist

After inlining:

- [ ] No `@acedergren/` imports remain (except `oci-genai-provider`)
- [ ] All imports resolve correctly
- [ ] TypeScript compilation succeeds (`pnpm check`)
- [ ] ESLint passes (`pnpm lint`)
- [ ] All tests pass (`pnpm test`)
- [ ] Build succeeds (`pnpm build`)
- [ ] No duplicate code between packages

### 10.5 Documentation Updates

Update the following files to reflect inlining:

**CLAUDE.md:**

```markdown
### Inlined Packages (formerly workspace dependencies)

- `src/lib/server/agent-state/` - Agent state management
- `src/lib/server/mcp-client/` - MCP protocol client
- `src/lib/query/` - Query utilities for OCI GenAI
```

**README.md:**

```markdown
## Architecture

The application includes inlined versions of:

- Agent state management (`src/lib/server/agent-state/`)
- MCP client (`src/lib/server/mcp-client/`)
- Query utilities (`src/lib/query/`)
```

### 10.6 Benefits of Inlining

- **Simplified dependency management** - No workspace protocol
- **Easier onboarding** - Single repo, no monorepo setup
- **Faster CI/CD** - No cross-package dependencies
- **Direct modification** - Can edit inlined code without publishing
- **Version control** - All code in one git history
- **No external package risk** - Not dependent on unpublished packages

---

## 11. Migration Checklist

### 11.1 Pre-Migration

- [ ] Analyze workspace package usage (section 10)
- [ ] Verify oci-genai-provider npm package availability
- [ ] Review git history for important context (if needed)
- [ ] Backup existing oci-genai-examples repo

### 11.2 Create New Repository

- [ ] Create GitHub repo: `acedergren/oci-ai-chat`
- [ ] Initialize with README (or push initial commit)
- [ ] Set up branch protection rules
- [ ] Configure GitHub Actions secrets (if needed)

### 11.3 Copy Files

- [ ] Copy source code (`src/`)
- [ ] Copy configuration files (see section 2.1)
- [ ] Copy static assets (`static/`)
- [ ] Copy documentation (`docs/`)
- [ ] **Inline workspace packages** (section 10):
  - [ ] Copy `agent-state/src/` → `src/lib/server/agent-state/`
  - [ ] Copy `mcp-client/src/` → `src/lib/server/mcp-client/`
  - [ ] Copy `oci-genai-query/src/` → `src/lib/query/`
  - [ ] Update imports: `@acedergren/*` → `$lib/*` (use find-replace)
  - [ ] Fix internal cross-package imports (if any)
- [ ] Create new `.gitignore` (section 2.3)
- [ ] Create `LICENSE` (section 8)
- [ ] Create `CLAUDE.md` (section 5)
- [ ] Update `README.md` (section 4)
- [ ] Update `.env.example` (section 6)
- [ ] Update `package.json` (section 3 - remove workspace deps)
- [ ] Update `.serena/project.yml` (section 7)

### 11.4 Create CI/CD

- [ ] Create `.github/workflows/ci.yml` (section 9.1)
- [ ] Create `.github/workflows/docker.yml` (section 9.2)
- [ ] Test CI pipeline with first commit

### 11.5 Verification

- [ ] Clone new repo to clean directory
- [ ] Run `pnpm install` (should create new lockfile)
- [ ] Run `pnpm check` (TypeScript validation)
- [ ] Run `pnpm lint` (ESLint validation)
- [ ] Run `pnpm test` (289 tests should pass)
- [ ] Run `pnpm build` (production build)
- [ ] Run `pnpm preview` (test production build)
- [ ] Test Docker build: `docker build -t oci-ai-chat .`
- [ ] Verify GitHub Actions pass on first push

### 11.6 Update Original Repo

- [ ] Update `oci-genai-examples/CLAUDE.md` to reference new repo
- [ ] Add migration notice to `oci-genai-examples/oci-ai-chat/README.md`
- [ ] Optional: Archive or remove `oci-ai-chat/` directory from monorepo

### 11.7 Configure Serena

- [ ] Set up Serena for new `oci-ai-chat` repo
- [ ] Update Serena configuration in original `oci-genai-examples` repo
- [ ] Test Serena tools work in both repos

---

## 12. Post-Migration Tasks

### 12.1 Documentation

- [ ] Write `docs/ARCHITECTURE.md` (detailed system design)
- [ ] Write `docs/DEPLOYMENT.md` (production deployment guide)
- [ ] Write `docs/DEVELOPMENT.md` (development setup guide)
- [ ] Update `docs/ROADMAP.md` with repo split milestone

### 12.2 Repository Settings

- [ ] Add repository description
- [ ] Add repository topics: `oci`, `oracle-cloud`, `generative-ai`, `sveltekit`, `ai-sdk`, `better-auth`
- [ ] Set up GitHub Pages (optional, for docs)
- [ ] Configure Dependabot for security updates
- [ ] Add CODEOWNERS file (optional)

### 12.3 Community

- [ ] Add CONTRIBUTING.md (optional)
- [ ] Add CODE_OF_CONDUCT.md (optional)
- [ ] Create GitHub issue templates (optional)
- [ ] Create GitHub PR template (optional)

### 12.4 NPM Package Updates

- [ ] Verify `@acedergren/oci-genai-provider` is on latest version
- [ ] Set up Renovate or Dependabot for automated updates
- [ ] Pin critical dependencies

---

## 13. Risk Mitigation

### 13.1 Known Risks

| Risk                         | Impact             | Mitigation                                  |
| ---------------------------- | ------------------ | ------------------------------------------- |
| Missing workspace packages   | Build failure      | Grep analysis (section 10) before migration |
| npm package version mismatch | Runtime errors     | Test thoroughly after dependency update     |
| Lost git history             | Context loss       | Keep original repo, reference in docs       |
| CI/CD configuration errors   | Deployment failure | Test locally before pushing                 |
| Oracle DB connection issues  | Runtime errors     | Test with SQLite fallback                   |

### 13.2 Rollback Plan

If migration fails:

1. Keep original `oci-genai-examples/oci-ai-chat/` intact
2. Delete new repo or reset to initial commit
3. Address issues identified
4. Re-attempt migration

---

## 14. Success Criteria

Migration is successful when:

- [ ] New repo clones and installs without errors
- [ ] All 289 tests pass
- [ ] Lint and type checking pass
- [ ] Production build succeeds
- [ ] Docker image builds successfully
- [ ] CI/CD pipeline completes on first push
- [ ] Dev server runs on clean clone
- [ ] Documentation is comprehensive
- [ ] Serena configuration works in both repos

---

## 15. Timeline Estimate

| Phase                  | Duration     | Dependencies           |
| ---------------------- | ------------ | ---------------------- |
| Pre-migration analysis | 1 hour       | None                   |
| Create new repo        | 15 min       | GitHub access          |
| Copy files             | 30 min       | Pre-migration complete |
| Update configurations  | 1 hour       | Files copied           |
| Create CI/CD           | 30 min       | Repo initialized       |
| Verification           | 1 hour       | CI/CD created          |
| Update original repo   | 30 min       | Verification complete  |
| Configure Serena       | 30 min       | Verification complete  |
| **Total**              | **~5 hours** | Sequential             |

---

## 16. Next Steps

1. **Review this plan** with team lead
2. **Run workspace package analysis** (section 10)
3. **Finalize package.json** based on analysis
4. **Create GitHub repo** and begin file migration
5. **Test thoroughly** before declaring success
6. **Update both repos** after successful migration

---

## Appendix A: Reference Files

### Current package.json workspace dependencies

```json
{
	"@acedergren/agent-state": "workspace:*",
	"@acedergren/mcp-client": "workspace:*",
	"@acedergren/oci-genai-provider": "workspace:*",
	"@acedergren/oci-genai-query": "workspace:*"
}
```

### Published npm package

```json
{
	"name": "@acedergren/oci-genai-provider",
	"version": "0.1.0"
}
```

### Recommended npm dependency

```json
{
	"@acedergren/oci-genai-provider": "^0.1.0"
}
```

---

**End of Repo Split Plan**
