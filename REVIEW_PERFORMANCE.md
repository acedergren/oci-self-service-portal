# Performance & Infrastructure Review — CloudNow Portal
**Date**: 2026-02-19
**Reviewer**: Performance & Infrastructure Agent
**Scope**: Production readiness assessment of query performance, resource limits, graceful shutdown, rate limiting, and LLM safety guardrails

## Executive Summary

The CloudNow portal demonstrates **solid infrastructure discipline** with proper connection pooling, rate limiting at two layers (in-memory + Oracle), graceful shutdown, and token-aware LLM constraints. However, there are **3 findings** requiring attention before production deployment:

1. **MEDIUM**: Unbounded queries in IDP/auth adapters risk full table scans
2. **MEDIUM**: Docker Compose is deprecated and non-functional; production uses no resource limits
3. **LOW**: Two-phase shutdown (graceful-shutdown plugin + manual drains) could introduce race conditions

---

## Findings

### [MEDIUM] Unbounded SELECT Queries in IDP Admin Repository

- **File**: `packages/server/src/admin/idp-repository.ts:153`, `:173`, `:228`
- **Impact**: SELECT * queries without LIMIT may trigger full table scans on large IDP provider lists, causing memory exhaustion or connection stalls during pagination errors
- **Effort**: S (add LIMIT 500 to three queries)
- **Fix**:
  ```typescript
  // Line 153 (listByOrg)
  `SELECT * FROM idp_providers WHERE org_id = :orgId
   ORDER BY display_name
   FETCH FIRST 500 ROWS ONLY`  // Add limit

  // Line 173 (getByIdForOrg)
  // Keep as-is (single record by PK — safe)

  // Line 228 (listByStatus)
  `SELECT * FROM idp_providers WHERE status = :status
   ORDER BY display_name
   FETCH FIRST 500 ROWS ONLY`  // Add limit
  ```
  These queries are called from admin UIs; add pagination or hard cap to prevent runaway result sets.

---

### [MEDIUM] Unbounded SELECT in Better Auth Oracle Adapter

- **File**: `packages/server/src/auth/oracle-adapter.ts:357`, `:419`
- **Impact**: `SELECT * FROM ${table}${whereSql}` without LIMIT in session/user lookups could return full tables if WHERE clause fails or is bypassed. Affects auth hot path.
- **Effort**: M (refactor to parameterize LIMIT, add index hints)
- **Fix**:
  ```typescript
  // Line 357 (findOne/getUser)
  let sql = `SELECT * FROM ${table}${whereSql} FETCH FIRST 1 ROW ONLY`;

  // Line 419 (find/listUsers)
  const selectSql = `SELECT * FROM ${table}${whereSql} FETCH FIRST 500 ROWS ONLY`;
  // Add index hints for common lookups (email, user_id) to prevent full scans
  ```
  Consider adding `/*+ INDEX(${table} idx_${column}) */` hints for email/id lookups.

---

### [MEDIUM] Docker Compose Marked Deprecated, No Production Resource Limits

- **File**: `docker-compose.yml:1-4`, `Dockerfile` (no HEALTHCHECK resources)
- **Impact**:
  - docker-compose.yml references non-existent `cloudnow/Dockerfile` and only builds frontend — API not included
  - Dockerfile uses multi-stage build correctly but runs as non-root user (good) without explicit cgroup limits
  - No memory/CPU limits in runtime environment (Kubernetes values, systemd service limits, or cgroup2 settings not visible)
  - Health check endpoints (`/api/health` on line 116) have no timeout enforcement — hung probes block orchestration
- **Effort**: M (update docker-compose, add resource limits to production deployment docs)
- **Fix**:
  ```yaml
  # Recommended for docker-compose or container orchestration:
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 2G
      reservations:
        cpus: '1'
        memory: 1G

  # Add to Dockerfile HEALTHCHECK (line 115):
  HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
      CMD curl --max-time 4 -f http://localhost:3000/api/health || exit 1
  ```
  Document memory overcommit safeguards and CPU throttling policies for Kubernetes deployments.

---

### [MEDIUM] Oracle Connection Pool Drains During Graceful Shutdown; Risk of Connection Leak

- **File**: `apps/api/src/app.ts:356-364`
- **Impact**: Two shutdown handlers (fastify-graceful-shutdown plugin + oracle plugin's onClose hook) may fire in unexpected order. If oracle pool drains before all in-flight queries complete, requests may hang waiting for a connection.
- **Effort**: M (verify plugin execution order, add drain-time enforcement)
- **Fix**:
  ```typescript
  // app.ts line 357 — increase timeout or add explicit oracle drain before plugin register
  await app.register(gracefulShutdown, {
    timeout: 30000  // 30s is good, but verify oracle pool drains within this window
  });

  // In oracle plugin (plugins/oracle.ts), ensure onClose drains with explicit timeout:
  fastify.addHook('onClose', async () => {
    await closePool(); // Calls pool.close(10) internally — 10s drain window
    log.info('Oracle pool drained');
  });
  ```
  Test graceful shutdown scenario: start 100 concurrent requests, trigger SIGTERM, verify all drain and complete within 30s.

---

### [LOW] Rate Limiting Configuration Missing Chat-Specific Endpoint Variants

- **File**: `apps/api/src/plugins/rate-limiter-oracle.ts:28-31`
- **Impact**: New workflow streaming endpoints (`/api/v1/workflows/...stream`) not in category mapping default to 60 req/min (same as list routes). Streaming connections may consume more server resources per request than reads.
- **Effort**: S (add workflow endpoints to category map)
- **Fix**:
  ```typescript
  const endpointCategories = {
    '/api/chat': 'chat',
    '/api/tools': 'chat',
    '/api/v1/workflows': 'workflows',  // 40 req/min (moderate)
    '/api/v1/workflows/:id/runs/:runId/stream': 'chat'  // 20 req/min (streaming)
  } as const;

  // Add to RATE_LIMIT_CONFIG in packages/server/src/rate-limiter.ts:
  maxRequests: {
    api: 60,
    chat: 20,
    workflows: 40
  }
  ```

---

### [LOW] SSE Stream Timeout at 5 Minutes; Long-Running Workflows May Disconnect Prematurely

- **File**: `apps/api/src/routes/workflows.ts:580-584`
- **Impact**: SSE stream closes with 'timeout' event after 300s (5 min). Long-running workflows (>5 min) require client re-subscribe, potentially missing steps.
- **Effort**: S (make timeout configurable, document client retry strategy)
- **Fix**:
  ```typescript
  // Line 580 — make timeout configurable:
  const SSE_TIMEOUT_MS = process.env.SSE_TIMEOUT_MS ?
    parseInt(process.env.SSE_TIMEOUT_MS, 10) : 300_000;

  timeoutId = setTimeout(() => {
    if (closed) return;
    writeEvent('timeout', {
      message: 'Connection timeout. Please reconnect to continue monitoring.'
    });
    cleanup();
  }, SSE_TIMEOUT_MS);

  // Document in API responses that clients should implement exponential backoff on timeout
  ```
  Recommend increasing to 10-15 minutes for long-running workflows, or implement client-side auto-reconnect with heartbeats.

---

### [LOW] Unbounded MCP Tool/Resource Cache Queries

- **File**: `packages/server/src/admin/mcp-repository.ts:638`, `:695`
- **Impact**: `SELECT * FROM mcp_tool_cache WHERE server_id = :serverId` and resource cache queries have no LIMIT. If a buggy MCP server exposes 10k+ tools, memory spikes.
- **Effort**: S (add LIMIT, verify cache growth)
- **Fix**:
  ```typescript
  // Line 638 (getCachedTools)
  `SELECT * FROM mcp_tool_cache
   WHERE server_id = :serverId
   ORDER BY tool_name
   FETCH FIRST 1000 ROWS ONLY`  // Add limit

  // Line 695 (getCachedResources)
  `SELECT * FROM mcp_resource_cache
   WHERE server_id = :serverId
   ORDER BY resource_name
   FETCH FIRST 5000 ROWS ONLY`  // Higher for resources
  ```
  Monitor mcp_tool_cache growth via admin metrics endpoint.

---

### [✓ PASS] Connection Pool Configuration

- **File**: `packages/server/src/oracle/connection.ts:83-86`
- **Status**: Well-configured
- **Details**:
  - `poolMin: 2, poolMax: 10, poolIncrement: 2, poolTimeout: 60`
  - Reasonable for small-to-medium deployments
  - Pool is properly initialized with fail-fast validation
  - `withConnection()` pattern ensures release on all code paths (try/finally)

---

### [✓ PASS] Graceful Shutdown Orchestration

- **File**: `apps/api/src/app.ts:353-364`
- **Status**: Well-implemented
- **Details**:
  - fastify-graceful-shutdown plugin registered with 30s timeout
  - Oracle pool drain honored via plugin lifecycle (onClose hook fires in reverse order)
  - Valkey cache disconnects with 5s timeout (line 53-62 in cache.ts)
  - SIGTERM → graceful drain → process exit (no hard kills observed)

---

### [✓ PASS] Rate Limiting — Two-Layer Defense

- **File**: `apps/api/src/plugins/rate-limiter-oracle.ts`, `apps/api/src/app.ts:310-323`
- **Status**: Excellent
- **Details**:
  - Layer 1: In-memory `@fastify/rate-limit` (fails open on error)
  - Layer 2: Oracle-backed per-user/per-endpoint limits (user ID > API key > IP)
  - Chat endpoints capped at 20 req/min; general API at 60 req/min
  - Proper retry-after headers and 429 response codes

---

### [✓ PASS] Valkey Cache with Fail-Open Behavior

- **File**: `apps/api/src/plugins/cache.ts:33-63`
- **Status**: Excellent
- **Details**:
  - Cache disconnects gracefully on boot failure (no exception thrown)
  - Decorates fastify instance with `cache.get/set/del/getOrFetch`
  - 5s disconnect timeout prevents hanging on shutdown
  - `getOrFetch()` pattern avoids thundering herd on cache miss

---

### [✓ PASS] SSE Stream Cleanup on Client Disconnect

- **File**: `apps/api/src/routes/workflows.ts:550-589`
- **Status**: Excellent
- **Details**:
  - Dual cleanup on request.close AND reply.close (line 586-587)
  - `closed` flag prevents double-cleanup
  - Timeout fires 300s if stream still open (prevents resource leak)
  - Unsubscribe callback clears event listeners

---

### [✓ PASS] LLM Token Guardrails in Charlie Agent

- **File**: `apps/api/src/mastra/agents/guardrails.ts`, `charlie.ts:24-26`
- **Status**: Excellent
- **Details**:
  - Input limit: 50k chars (~12.5k tokens)
  - Output limit: 4000 tokens (~16k chars)
  - Prompt injection detector blocks common jailbreak patterns
  - PII detector redacts SSN, credit cards, AWS keys, OCI keys, bearer tokens, private keys
  - Graceful truncation logs warnings but doesn't crash

---

### [✓ PASS] Oracle Query Patterns — No N+1 Observed

- **File**: Repository files (audit, approval, session, etc.)
- **Status**: Excellent
- **Details**:
  - Repositories use `LEFT JOIN` for enrichment (e.g., session-repository.ts:243-249)
  - No loops containing `withConnection()` calls
  - Pagination implemented with OFFSET/FETCH NEXT
  - Aggregate queries (COUNT, SUM) avoid client-side counting

---

## Infrastructure & Deployment Checklist

| Item | Status | Notes |
|------|--------|-------|
| Connection pool bounded | ✓ | Min=2, Max=10, reasonable for small deployments; scale to Max=50+ for multi-tenant |
| Graceful shutdown | ✓ | 30s timeout, oracle + valkey drains, SIGTERM handling present |
| Rate limiting (L1 + L2) | ✓ | In-memory + Oracle, 20 req/min (chat), 60 req/min (api) |
| Cache fail-open | ✓ | Valkey disconnects gracefully, app continues without cache |
| SSE cleanup | ✓ | Proper cleanup on client disconnect, 5min timeout |
| LLM token limits | ✓ | Input 50k char, output 4000 token, guardrails in place |
| Unbounded queries | ✗ | IDP, auth adapter, MCP cache have SELECT * without LIMIT |
| Docker/K8s resource limits | ✗ | No explicit cgroup limits in Dockerfile or docker-compose |
| Health check timeout | ⚠ | No timeout enforcement; could block orchestration on hung db |

---

## Production Readiness Summary

**Ready with reservations**: Deploy to production with fixes for the three MEDIUM findings. Recommended pre-deployment checklist:

1. ✅ Add LIMIT clauses to IDP, auth adapter, and MCP cache queries
2. ✅ Document and enforce resource limits (CPU, memory, disk) in Kubernetes/systemd configs
3. ✅ Test graceful shutdown under load (100+ concurrent requests)
4. ✅ Configure SSE timeout based on expected workflow duration (increase to 10-15 min if needed)
5. ✅ Monitor pool exhaustion and rate limit rejection rates (emit metrics)
6. ✅ Set up alerting on oracle pool usage >80% and cache disconnections

---

## Appendix: Load Testing Recommendations

### Scenario 1: Connection Pool Saturation
```bash
# Simulate 50+ concurrent requests to oracle-backed endpoints
wrk -t 4 -c 50 -d 30s http://localhost:3000/api/workflows
# Monitor: connectionsOpen, connectionsInUse from getPoolStats()
```

### Scenario 2: Rate Limit Bypass
```bash
# Attempt to exceed chat rate limit (20 req/min per user)
for i in {1..50}; do
  curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/chat &
done
# Verify 429 responses after 20 requests
```

### Scenario 3: Graceful Shutdown
```bash
# Start 100 long-running requests, trigger SIGTERM, measure drain time
curl http://localhost:3000/api/v1/workflows/$ID/runs/$RUN_ID/stream &
# ... repeat 100 times
kill -SIGTERM $API_PID
# Measure time until all connections close (should be <30s)
```

---

**Report generated**: 2026-02-19 | Agent: performance-infra-reviewer
