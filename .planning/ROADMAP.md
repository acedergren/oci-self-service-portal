# OCI Self-Service Portal Roadmap

## Phase 10 — Foundation Rewrite & Workflow Completion (In Planning)

- **Goal:** Deliver the Phase 10 outcomes from `.claude/reference/PRD.md`, including Fastify-first API boundary, package split, OCI SDK migration, workflow designer completion, Oracle 26AI upgrades, and upgraded admin experience.
- **Status:** Planning
- **Plans:** 18 plans

Plans:

- [ ] 10-01-PLAN.md — Consolidate Better Auth inside Fastify `/api/auth/*`
- [ ] 10-02-PLAN.md — Route /api/\* to Fastify and hydrate sessions via backend
- [ ] 10-03-PLAN.md — Move chat messaging/approvals fully to Fastify
- [ ] 10-04-PLAN.md — Run tools listing/execution through Fastify
- [ ] 10-05-PLAN.md — Shift workflows CRUD/run endpoints to Fastify
- [ ] 10-06-PLAN.md — Migrate sessions/setup/admin/webhooks APIs
- [ ] 10-07-PLAN.md — Extract `@portal/types` package
- [ ] 10-08-PLAN.md — Extract `@portal/server` package
- [ ] 10-09-PLAN.md — Extract `@portal/ui` package
- [ ] 10-10-PLAN.md — Implement OCI SDK executor
- [ ] 10-11-PLAN.md — Wire SDK executor through tool categories
- [ ] 10-12-PLAN.md — Enhance workflow executor (AI, loop, parallel, retries)
- [ ] 10-13-PLAN.md — Finish workflow designer UI for remaining node types
- [ ] 10-14-PLAN.md — Apply Oracle 26AI schema upgrades (HNSW, VPD)
- [ ] 10-15-PLAN.md — Update vector store to typed bindings + tests
- [ ] 10-16-PLAN.md — Add admin SSE routes and Mastra Studio gating
- [ ] 10-17-PLAN.md — Build admin agents/workflows/tools console pages
- [ ] 10-18-PLAN.md — Ship observability dashboard with design iteration checkpoint
