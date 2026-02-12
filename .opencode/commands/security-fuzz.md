---
name: security-fuzz
description: Run CATS DAST fuzzer against a running Fastify API using exported OpenAPI.
---

# Security Fuzz (CATS)

Run a DAST fuzz pass against a running API using the OpenAPI spec.

Prereqs:

- API running (default `http://localhost:3001`)
- Java 11+
- CATS jar available (see `.claude/skills/security-fuzz/SKILL.md`)

Steps:

1. Export OpenAPI: `pnpm --filter @portal/api swagger:export -- /tmp/cats-openapi.json`
2. Verify server: `curl -sf http://localhost:3001/health`
3. Run CATS with a rate cap; write report to `/tmp/cats-report`
4. Print one-line summary + report path

Reference: `.claude/skills/security-fuzz/SKILL.md`
