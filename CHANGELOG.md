# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `@portal/ui` package scaffolded with shared Svelte components, design primitives, stores, and utilities
- Oracle migration 017: VPD (Virtual Private Database) tenant isolation policies on all org-scoped tables
- Workflow streaming module with SSE integration (15 integration tests)
- POST `/api/setup/features` endpoint for feature flag initialization
- IDP and AI provider management route modules in admin console
- `/api/health` and `/api/healthz` aliases for Nginx reverse proxy compatibility
- Syncpack configuration for aligned workspace dependency versions

### Fixed

- Frontend test timeout and mock contamination in review-fixes suite
- Pre-commit hook failures in `@portal/shared` package due to pre-existing lint errors
- Frontend URL alignment with Fastify backend route conventions

### Changed

- Svelte and `@sentry/sveltekit` updated to latest versions

### Security

- VPD row-level isolation ensures cross-tenant data leakage is impossible at the database layer
- Semgrep false positives documented and suppressed with `nosemgrep` annotations (verified clean)

---

## [0.1.0] - 2026-02-17

Initial release of CloudNow — a multi-tenant OCI self-service portal powered by Charlie, an AI cloud advisor built on Mastra and Oracle 26AI.

### Added

**Core Platform**

- SvelteKit frontend (`apps/frontend`) with adapter-node for production deployment
- Fastify 5 backend (`apps/api`) with plugin-based architecture
- Monorepo with pnpm workspaces: `@portal/types`, `@portal/server`, `@portal/shared`, `@portal/ui`
- Oracle Autonomous Database 26AI integration with vector search, embeddings, and blockchain audit
- Better Auth integration with session management, RBAC, and optional IDP (SAML/OIDC)

**AI & Agent Layer (Mastra)**

- Charlie AI agent with OCI tool calling (compute, networking, identity, database, billing, storage)
- `OracleVectorStore` — Mastra-compatible vector store backed by Oracle 23ai vector search
- OCI GenAI SDK embeddings pipeline (migrated from CLI subprocess calls)
- `OracleStore` — Mastra memory/thread storage on Oracle ADB
- AI agent guardrails for scope enforcement and policy validation
- Provider registry supporting OCI GenAI, OpenAI, AWS Bedrock, and Azure OpenAI
- 60+ OCI tool wrappers across 8 categories

**MCP (Model Context Protocol)**

- Portal MCP server exposing tool discovery and execution as MCP resources
- MCP connection manager with org-scoped server enumeration
- SSE and stdio transport support
- MCP admin CRUD routes (`/api/admin/mcp`)
- GitHub, Jira, Slack, PagerDuty MCP configuration templates

**Workflows**

- Workflow executor with sequential, parallel branch, compensation/saga, and loop node types
- Retry policies with exponential backoff, SSE streaming progress, and crash recovery
- Suspend/resume mechanism with typed schema
- Stale session cleanup via schedule plugin
- Cancel, resume, and detail endpoints

**Admin Console**

- Tool playground with agent selection, parameter tuning, and tool-call result cards
- Workflow monitor with step timeline, run controls, and SSE progress feed
- Agent observability with error summary, cost placeholder, and activity timeline
- Settings management (GET/PATCH `/api/admin/settings`)
- AI model provider management (OCI GenAI, OpenAI, Bedrock, Azure)
- IDP configuration management
- Developer tools: SQL explorer, API tester, log viewer, performance dashboard

**Security**

- Helmet.js plugin with strict CSP (nonce-based in production)
- CORS plugin with origin allowlist
- Rate limiting per IP and per org (Oracle-backed for distributed environments)
- SSRF prevention (`isValidWebhookUrl()`) with async DNS validation and private-IP blocking
- HMAC-SHA256 webhook signatures (`X-Webhook-Signature: sha256=<hex>`)
- AES-256-GCM encryption for webhook secrets at rest (migration 009)
- VPD tenant isolation policies enforced at the Oracle database layer
- IDOR prevention: all routes verify org ownership via `resolveOrgId()`
- CodeQL and Semgrep pre-push security scans

**RAG Pipeline**

- `OracleVectorStore` with cosine/dot-product similarity, metadata filtering, and threshold queries
- OCI GenAI embeddings integration (Cohere embed-multilingual-v3.0)
- Vector search across tool documentation, audit logs, and workflow history

**Testing Infrastructure**

- 1775+ tests (888 API, 887 frontend) using Vitest 4
- `mockReset: true` test isolation with documented forwarding, object-bag, and counter patterns
- `buildTestApp()` centralized test helper with simulateSession and RBAC injection
- Vitest `vi.hoisted()` + globalThis registry patterns for TDZ-safe mock factories
- Test coverage: repositories, routes, plugins, workflows, agents, RAG, embeddings

### Changed

- **CloudNow rebrand**: renamed from OCI Self-Service Portal, introduced Charlie as AI persona
- **Package split (Phase 10)**: `@portal/shared` split into `@portal/types` (error hierarchy, Zod schemas) and `@portal/server` (Oracle repositories, auth, workflows)
- **Auth migration**: admin RBAC moved from SvelteKit layout guards to Fastify RBAC plugin
- **SvelteKit route removal**: all 15 SvelteKit API stubs deleted; Fastify is the sole backend
- **Superforms**: admin forms migrated to `sveltekit-superforms` with Zod 4 adapters (`zod4Client`)
- **OCI SDK migration**: compute, networking, identity, billing, search tools migrated from CLI subprocess to OCI TypeScript SDK

### Security

- Fixed critical DNS rebinding vulnerability in webhook URL validation (`security(ssrf)`)
- Fixed SQL interpolation risk in search queries (bind parameters enforced)
- Fixed cross-org IDOR in workflow endpoints (missing `resolveOrgId()` check)
- Fixed missing `await` on async SSRF validation calls (would bypass protection)
- Fixed case-insensitive IDCS group matching (group names were compared case-sensitively)
- Fixed 4 critical findings from CodeRabbit security review

[Unreleased]: https://github.com/acedergr/oci-self-service-portal/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/acedergr/oci-self-service-portal/releases/tag/v0.1.0
