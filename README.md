# OCI Self-Service Portal

AI-powered cloud operations portal built with SvelteKit, Oracle ADB 26AI, and 60+ OCI tools.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **This is not an official Oracle product.** This project is independent, community-driven, and has no affiliation with Oracle Corporation. It is provided as-is with absolutely no warranty. Oracle, OCI, and related trademarks are the property of Oracle Corporation. Use at your own risk.

## Features

### Core
- **Streaming Chat** — Real-time AI responses with Vercel AI SDK
- **15+ Chat Models** — Meta Llama 4, Cohere Command A, Google Gemini 2.5, xAI Grok 4
- **60+ OCI Tools** — Compute, networking, database, storage, security, observability
- **Tool Calling** — AI executes OCI CLI commands with 3-tier approval workflow
- **Session Persistence** — Oracle ADB 26AI with SQLite fallback

### Security
- **Better Auth + OIDC** — OCI IAM Identity Domains integration
- **RBAC** — 3 roles (viewer/operator/admin), 10 permissions
- **Multi-tenancy** — Organization-to-compartment isolation
- **Rate Limiting** — DB-backed with atomic MERGE INTO
- **Request Tracing** — `req-{uuid}` propagated via `X-Request-Id` headers
- **Approval Tokens** — Server-side, single-use, 5-min expiry
- **CSP & Security Headers** — HSTS, X-Frame-Options, X-Content-Type-Options

### UI
- **17 Portal Components** — Decomposed from 2042-line monolith
- **shadcn-svelte** — bits-ui headless primitives + Svelte 5 runes
- **Activity Feed** — Real-time tool execution history
- **Mobile Responsive** — Works on all device sizes

### Observability
- **Structured Logging** — Pino with module-scoped child loggers and custom serializers
- **Error Tracking** — Sentry integration with graceful degradation (no-op when DSN missing)
- **Prometheus Metrics** — 9 predefined `portal_*` metrics at `/api/metrics`
- **Deep Health Checks** — Database, connection pool, OCI CLI, Sentry, metrics subsystems
- **PortalError Hierarchy** — 6 typed error classes with HTTP status codes, JSON serialization, Sentry extras
- **Grafana Dashboard** — 15+ panels for request rate, latency, tool execution, pool utilization

## Quick Start

### Prerequisites

- Node.js 18+ (22 recommended)
- pnpm 8+
- OCI CLI configured (`~/.oci/config`)
- Optional: Oracle Autonomous Database 26AI (falls back to SQLite)

### Install

```bash
git clone https://github.com/acedergren/oci-self-service-portal.git
cd oci-self-service-portal
pnpm install

cp .env.example .env
# Edit .env with your OCI settings

pnpm dev
```

Open http://localhost:5173

### Development

```bash
pnpm check       # Type check
pnpm test         # Run tests (366 passing)
pnpm lint         # ESLint + Prettier
pnpm build        # Production build
```

## Roadmap

- ✅ **Phase 1:** Foundation — adapter-node, Docker, ESLint/Prettier, CI
- ✅ **Phase 2:** Oracle ADB 26AI — connection pool, migrations, repositories, fallback patterns
- ✅ **Phase 3:** Authentication — Better Auth, OIDC, RBAC, multi-tenancy
- ✅ **Phase 4:** Security — rate limiting, request tracing, approval tokens, 4 critical/high fixes
- ✅ **Phase 5:** Frontend — 17 portal components, shadcn-svelte, activity/session APIs
- ✅ **Phase 6:** Observability — Pino logging, Sentry, Prometheus metrics, deep health checks
- 📋 **Phase 7:** Visual Workflow Designer — Svelte Flow canvas, Mastra engine
- 📋 **Phase 8:** API Integration Layer — REST API, MCP server, webhooks, OpenAPI
- 📋 **Phase 9:** Fastify Backend Migration — monorepo split, OpenAPI docs

See [docs/ROADMAP.md](docs/ROADMAP.md) for detailed task breakdown.

## Documentation

- [ROADMAP.md](docs/ROADMAP.md) — Development progress and task tracking
- [SELF_SERVICE_PORTAL_IMPROVEMENT_PLAN.md](docs/SELF_SERVICE_PORTAL_IMPROVEMENT_PLAN.md) — Architecture and design decisions

## Related Projects

- [oci-genai-provider](https://github.com/acedergren/oci-genai-provider) — AI SDK provider for OCI GenAI
- [oci-genai-examples](https://github.com/acedergren/oci-genai-examples) — Examples monorepo (original home)

## Author

Alex Cedergren — [alex@solutionsedge.io](mailto:alex@solutionsedge.io)

## License

[MIT](./LICENSE)
