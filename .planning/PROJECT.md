# OCI Self-Service Portal — Planning Overview

## Mission

Modernize the Oracle Cloud Infrastructure (OCI) self-service portal so platform administrators, operations engineers, and workflow designers can manage AI-driven automation from a single, reliable experience.

## Current Focus

Phase 10 prioritizes foundation rewrites and workflow designer completion as outlined in `.claude/reference/PRD.md`.

Key pillars:

1. **Single API boundary** — Fastify 5 owns all API surface area and Better Auth lives entirely on the backend.
2. **Package separation** — Split `@portal/shared` into `@portal/types`, `@portal/server`, and `@portal/ui` to reduce coupling.
3. **OCI SDK adoption** — Replace CLI-driven tool execution with the official OCI TypeScript SDK for lower latency and typed responses.
4. **Workflow completion** — Deliver the remaining node types, retries, compensation, and streaming execution for the visual designer.
5. **Oracle 26AI upgrades** — HNSW DML indexes, native Float32Array bindings, and VPD-based tenant isolation.
6. **Admin experience** — First-party admin console and Mastra Studio integration for observability, tooling, and agent QA.

## References

- Product requirements: `@.claude/reference/PRD.md`
- Code conventions: `@.claude/reference/naming-conventions.md`
- Framework notes: `@.claude/reference/framework-notes.md`
