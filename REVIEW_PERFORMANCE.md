# Performance & Infrastructure Review — CloudNow Portal

**Date**: 2026-02-19
**Reviewer**: Performance & Infrastructure Agent (Comprehensive)
**Scope**: Production readiness assessment — N+1 queries, unbounded SELECTs, memory/connection management, Docker/deployment, graceful shutdown, rate limiting, caching

## Executive Summary

The CloudNow portal has **solid infrastructure discipline** with proper connection pooling, two-layer rate limiting, graceful shutdown, and token-aware LLM constraints. However, a deep analysis of all repositories, plugins, and services reveals **34 findings** (5 Critical, 8 High, 12 Medium, 9 Low) that should be addressed before production deployment.

**Top 3 critical issues**:

1. N+1 query loops on the chat hot path (saveMessages, updateMessages, vector upsert)
2. Unbounded in-memory Map (`latestStatusByRun`) with no eviction — grows forever
3. Valkey cache infrastructure is fully built but **completely unused** in production routes

---

## Findings

### Category 1: N+1 Query Patterns

---

#### [CRITICAL] N+1 INSERT Loop in saveMessages

- **File**: `apps/api/src/mastra/storage/oracle-store.ts:709-735`
- **Impact**: Every chat message triggers individual INSERT statements in a `for` loop. A conversation with 50 messages = 50 database round-trips per save. This is on the **chat hot path**.
- **Effort**: M (batch INSERT with multi-row VALUES or PL/SQL FORALL)
- **Fix**:
  ```typescript
  // Current: for (const msg of args.messages) { await conn.execute(INSERT ...) }
  // Fix: Build multi-row INSERT ALL ... SELECT FROM DUAL
  // Or use PL/SQL anonymous block with FORALL for bulk insert
  // Estimated improvement: 95% reduction in round-trips
  ```

---

#### [CRITICAL] N+1 SELECT+UPDATE Loop in updateMessages

- **File**: `apps/api/src/mastra/storage/oracle-store.ts:737-803`
- **Impact**: Each message update issues a SELECT (to load current state) then an UPDATE — **2 round-trips per message**. Updating 100 messages = 200 queries. Hot path for conversation persistence.
- **Effort**: L (requires batch SELECT with IN clause + batch MERGE)
- **Fix**:
  ```typescript
  // Current: for (const update of args.messages) {
  //   SELECT ... WHERE id = :id  (load current)
  //   UPDATE ... WHERE id = :id  (apply changes)
  // }
  // Fix: 1. Batch SELECT all by IDs in one query
  //       2. Use MERGE INTO with multi-row source for atomic batch update
  // Estimated improvement: 95% reduction in round-trips
  ```

---

#### [CRITICAL] N+1 MERGE Loop in Vector Upsert

- **File**: `apps/api/src/mastra/rag/oracle-vector-store.ts:175-194`
- **Impact**: Each vector embedding is upserted individually via MERGE. Ingesting 1000 document chunks = 1000 MERGE statements. Blocks RAG indexing performance.
- **Effort**: L (Oracle multi-row MERGE with collection types)
- **Fix**:
  ```typescript
  // Current: for (let i = 0; i < vectors.length; i++) {
  //   await conn.execute(MERGE INTO ... USING (SELECT :id FROM DUAL) ...)
  // }
  // Fix: Use INSERT ALL ... INTO ... SELECT FROM DUAL for new rows
  //       or PL/SQL bulk bind with FORALL for upserts
  // Estimated improvement: 95%+ reduction for bulk vector ingestion
  ```

---

#### [HIGH] N+1 UPDATE Loop in Webhook Secret Migration

- **File**: `packages/server/src/oracle/repositories/webhook-repository.ts:303-322`
- **Impact**: `migratePlaintextSecrets()` loops over legacy rows (batch of 200) issuing individual UPDATE statements. Not on hot path but blocks migration completion.
- **Effort**: S (batch UPDATE with MERGE or CASE expression)
- **Fix**:
  ```typescript
  // Current: for (const row of legacyRows.rows) {
  //   const encrypted = encryptWebhookSecret(row.SECRET);
  //   await conn.execute(UPDATE ... WHERE id = :id);
  // }
  // Fix: Encrypt all secrets in JS, then batch via MERGE INTO ... USING (
  //   SELECT :id1 AS id, :sec1 AS secret, :iv1 AS iv FROM DUAL UNION ALL ...
  // ) ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET ...
  ```

---

#### [HIGH] N+1 MERGE Loop in Findings Upsert

- **File**: `apps/api/src/services/findings-repository.ts:156-160`
- **Impact**: `upsertFindings()` calls `upsertFinding()` in a loop. CloudAdvisor may generate 100+ findings per scan — each becomes a separate MERGE query.
- **Effort**: M (batch MERGE)
- **Fix**:
  ```typescript
  // Current: for (const finding of findings) { await upsertFinding(finding); }
  // Fix: Batch into single MERGE with multi-row source subquery
  // Estimated improvement: 90% reduction for bulk findings import
  ```

---

#### [MEDIUM] N+1 INSERT Loop in MCP Tool Cache

- **File**: `packages/server/src/admin/mcp-repository.ts:610`
- **Impact**: `cacheTools()` inserts each tool individually within a transaction. A server exposing 200 tools = 200 INSERTs. Runs during MCP server connection, not on chat hot path.
- **Effort**: S (INSERT ALL syntax)
- **Fix**: Use Oracle's `INSERT ALL INTO ... SELECT FROM DUAL` for batch tool cache population.

---

#### [MEDIUM] Sequential Queries in Audit getSummary

- **File**: `packages/server/src/oracle/repositories/audit-repository.ts:133-173`
- **Impact**: Three separate SELECT queries (COUNT, GROUP BY action, GROUP BY tool_name) scan the same table with the same WHERE clause. 3x table scan overhead.
- **Effort**: S (combine into single query)
- **Fix**:
  ```sql
  -- Combine with GROUP BY ROLLUP or window functions:
  SELECT action, tool_name, COUNT(*) AS cnt,
         COUNT(*) OVER() AS total
  FROM tool_executions WHERE ...
  GROUP BY action, tool_name
  ```

---

#### [MEDIUM] COUNT + Data Query Separate in listByOrg

- **File**: `apps/api/src/services/workflow-repository.ts:675-703`
- **Impact**: Pagination queries issue a separate COUNT(\*) query before the paginated SELECT — two scans of the same table.
- **Effort**: S (window function)
- **Fix**: Use `SELECT *, COUNT(*) OVER() AS total FROM workflow_runs WHERE ... OFFSET :offset ROWS FETCH FIRST :limit ROWS ONLY`

---

### Category 2: Unbounded Queries (Missing LIMIT)

---

#### [HIGH] Unbounded SELECT in Auth Oracle Adapter (Hot Path)

- **File**: `packages/server/src/auth/oracle-adapter.ts:357`, `:419`
- **Impact**: `SELECT * FROM ${table}${whereSql}` without LIMIT in session/user lookups. If WHERE clause is empty or misconfigured, returns full table. **On auth hot path** — every authenticated request.
- **Effort**: S
- **Fix**:
  ```typescript
  // Line 357 (findOne): Add FETCH FIRST 1 ROW ONLY
  // Line 419 (find/list): Add FETCH FIRST 500 ROWS ONLY
  ```

---

#### [MEDIUM] Unbounded SELECT in Audit getBySession

- **File**: `packages/server/src/oracle/repositories/audit-repository.ts:89-100`
- **Impact**: `SELECT * FROM tool_executions WHERE session_id = :sessionId` — a long-running session with 100k+ tool executions loads ALL into memory.
- **Effort**: S
- **Fix**: Add `FETCH FIRST 1000 ROWS ONLY` or implement pagination parameter.

---

#### [MEDIUM] Unbounded SELECT in Audit getByDateRange

- **File**: `packages/server/src/oracle/repositories/audit-repository.ts:103`
- **Impact**: Date range queries without LIMIT. Wide date ranges scan entire audit table.
- **Effort**: S
- **Fix**: Add `FETCH FIRST 1000 ROWS ONLY`.

---

#### [MEDIUM] Unbounded SELECT in Approval getPending

- **File**: `packages/server/src/oracle/repositories/approval-repository.ts:105-125`
- **Impact**: Returns all pending approvals with no LIMIT. Unlikely to be large in practice, but no safety net.
- **Effort**: S
- **Fix**: Add `FETCH FIRST 1000 ROWS ONLY`.

---

#### [MEDIUM] Unbounded SELECT in Org listMembers / listByStatus

- **File**: `packages/server/src/oracle/repositories/org-repository.ts:100`, `:140`
- **Impact**: `listByStatus('active')` across a multi-tenant platform could return thousands. `listMembers()` has no LIMIT for large organizations.
- **Effort**: S
- **Fix**: Add `FETCH FIRST 500 ROWS ONLY` to both queries.

---

#### [MEDIUM] Unbounded SELECT in IDP listByOrg / listByStatus

- **File**: `packages/server/src/admin/idp-repository.ts:153`, `:228`
- **Impact**: Admin IDP queries without LIMIT. Low risk (admin UI) but should have safety cap.
- **Effort**: S
- **Fix**: Add `FETCH FIRST 500 ROWS ONLY` to both.

---

#### [LOW] Unbounded SELECT in MCP Tool/Resource Cache

- **File**: `packages/server/src/admin/mcp-repository.ts:638`, `:695`
- **Impact**: A buggy MCP server exposing 10k+ tools would spike memory on cache read. Low probability.
- **Effort**: S
- **Fix**: Add `FETCH FIRST 1000 ROWS ONLY` for tools, `FETCH FIRST 5000 ROWS ONLY` for resources.

---

#### [LOW] Unbounded SELECT in Webhook list

- **File**: `packages/server/src/oracle/repositories/webhook-repository.ts:120`
- **Impact**: Webhook list for org without LIMIT. Orgs unlikely to have thousands, but no cap.
- **Effort**: S
- **Fix**: Add `FETCH FIRST 500 ROWS ONLY`.

---

### Category 3: Memory Leaks & Connection Management

---

#### [CRITICAL] Unbounded latestStatusByRun Map — No Eviction

- **File**: `apps/api/src/services/workflow-stream-bus.ts:25,29`
- **Impact**: Every workflow run adds an entry to `latestStatusByRun`. **No eviction policy exists.** `clearWorkflowStreamState()` exists but is only called in tests. Over days/weeks of operation, this Map grows without bound, consuming heap memory proportional to total workflow runs ever executed.
- **Effort**: S (add TTL eviction)
- **Fix**:

  ```typescript
  // Option A: TTL-based eviction — store timestamp with each entry
  const latestStatusByRun = new Map<string, { status: WorkflowStreamEvent; ts: number }>();
  setInterval(() => {
  	const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h
  	for (const [key, val] of latestStatusByRun) {
  		if (val.ts < cutoff) latestStatusByRun.delete(key);
  	}
  }, 60_000).unref();

  // Option B: LRU cache with max 10,000 entries
  ```

---

#### [CRITICAL] EventEmitter setMaxListeners(0) — Unbounded Listeners

- **File**: `apps/api/src/services/workflow-stream-bus.ts:22-23`
- **Impact**: `setMaxListeners(0)` disables the Node.js memory leak warning. If clients subscribe to workflow streams and connections die without cleanup (e.g., network timeout without close event), listeners accumulate permanently. Under sustained load with client disconnects, this is a classic memory leak vector.
- **Effort**: S (set reasonable cap)
- **Fix**:
  ```typescript
  emitter.setMaxListeners(1000); // Cap at reasonable max, log warning if approached
  ```

---

#### [HIGH] Chat Stream Write Errors Not Handled

- **File**: `apps/api/src/routes/chat.ts:294-303`
- **Impact**: The stream reader loop calls `reply.raw.write()` without error handling. If the client disconnects mid-stream, write throws and the error propagates through the finally block. The `reader.releaseLock()` fires but the underlying AI stream may continue generating tokens (wasting LLM spend).
- **Effort**: S
- **Fix**:
  ```typescript
  const reader = result.textStream.getReader();
  try {
  	while (true) {
  		const { done, value } = await reader.read();
  		if (done) break;
  		try {
  			reply.raw.write(`data: ${JSON.stringify({ text: value })}\n\n`);
  		} catch {
  			controller.abort(); // Stop the AI stream
  			break;
  		}
  	}
  } finally {
  	reader.releaseLock();
  }
  ```

---

#### [HIGH] Unbounded clients Map in MCPConnectionManager

- **File**: `apps/api/src/services/mcp-connection-manager.ts:65`
- **Impact**: `clients` Map grows with every MCP server connection. While `disconnectServer()` removes entries, failed connections mid-flight may leave partial entries. No upper bound check exists — a misconfigured org connecting 10,000 servers would exhaust memory.
- **Effort**: S (add size cap + cleanup)
- **Fix**:
  ```typescript
  if (this.clients.size >= 500) {
  	throw new Error('MCP connection limit exceeded');
  }
  ```

---

#### [MEDIUM] Workflow SSE Write Errors Unhandled

- **File**: `apps/api/src/routes/workflows.ts:496-509`
- **Impact**: `reply.raw.write()` in SSE stream event handlers has no try/catch. If write fails after client disconnect, error propagates uncaught. The `cleanup()` guard checks `if (closed) return` but a write error can fire before cleanup is called.
- **Effort**: S
- **Fix**: Wrap `reply.raw.write()` calls in try/catch, call `cleanup()` on write failure.

---

#### [MEDIUM] Cache Client Event Handlers Not Cleaned Up

- **File**: `apps/api/src/services/cache.ts:33-50`
- **Impact**: Redis client `ready` and `error` event handlers are registered on `connect()` but never removed on `disconnect()`. If cache reconnects, duplicate handlers accumulate.
- **Effort**: S
- **Fix**: Call `this.client.removeAllListeners()` before `this.client.quit()` in `disconnect()`.

---

#### [MEDIUM] Approval Timer Not Stopped on Shutdown

- **File**: `apps/api/src/services/approvals.ts:86-98`
- **Impact**: `startCleanupTimer()` runs on module import with no exported stop function. Timer is `unref()`'d (prevents blocking exit) but the callback can still execute during shutdown, potentially accessing torn-down state.
- **Effort**: S
- **Fix**: Export `stopCleanupTimer()`, call from `app.ts` onClose hook.

---

#### [LOW] Oracle Pool Never Retries After Init Failure

- **File**: `apps/api/src/plugins/oracle.ts:69`
- **Impact**: If the pool fails to initialize (e.g., transient network error), `isAvailable()` returns false permanently. No retry mechanism exists — requires app restart.
- **Effort**: M (add lazy retry with backoff)
- **Fix**: Consider periodic pool retry on `isAvailable()` check (optional for v1).

---

### Category 4: Rate Limiting Coverage

---

#### [HIGH] Setup Endpoints Unprotected — No Auth, No Rate Limit

- **File**: `apps/api/src/routes/setup.ts:129` (detect-env), `:305` (ai-provider/test)
- **Impact**: `GET /api/setup/detect-env` exposes environment variables (tenant URLs, client IDs, regions) to unauthenticated users with unlimited requests — enables reconnaissance. `POST /api/setup/ai-provider/test` validates credentials without auth or rate limit — enables credential enumeration.
- **Effort**: S
- **Fix**:
  ```typescript
  // detect-env: Add rate limit 10 req/min per IP
  // ai-provider/test: Add rate limit 5 req/min per IP + require setup token
  ```

---

#### [LOW] Auth Endpoints Use Generic Rate Limit

- **File**: `apps/api/src/routes/auth.ts:67-134`
- **Impact**: Better Auth sign-in endpoints use the generic 60 req/min `@fastify/rate-limit` but may bypass the Oracle rate limiter for unauthenticated users (since `request.user` isn't set on failed attempts). Sign-in should have tighter limits (5 failed attempts per 15 min).
- **Effort**: M
- **Fix**: Add per-IP rate limiting with lower threshold before Oracle plugin: 5 failed attempts per 15 minutes for `/api/auth/sign-in/*`.

---

#### [LOW] Public /api/models Without Rate Limit

- **File**: `apps/api/src/routes/models.ts:30-67`
- **Impact**: Unauthenticated endpoint returning available AI models. No rate limit. Could be used for DoS or inventory enumeration. Non-sensitive data but should have a cap.
- **Effort**: S
- **Fix**: Add rate limit 30 req/min per IP.

---

#### [LOW] Streaming Endpoints Default to API Rate Limit

- **File**: `apps/api/src/plugins/rate-limiter-oracle.ts:28-31`
- **Impact**: Workflow streaming endpoints (`/api/v1/workflows/.../stream`) default to 60 req/min (same as list routes). Streaming connections consume more resources per request than reads — should have a lower limit.
- **Effort**: S
- **Fix**: Map workflow streaming endpoints to 'chat' category (20 req/min) in `endpointCategories`.

---

### Category 5: Caching Opportunities

---

#### [CRITICAL] Valkey Cache Built But Completely Unused

- **File**: `apps/api/src/plugins/cache.ts`, `apps/api/src/services/cache.ts`
- **Impact**: The entire Valkey cache infrastructure (`CacheService` with namespace TTLs, `getOrFetch()` cache-aside pattern, graceful degradation) is fully built and registered as a Fastify decorator — but **no production route or repository calls it**. Every request hits Oracle directly for data that is cacheable.
- **Effort**: M (integrate existing cache into hot paths)
- **Fix**: Wire up `fastify.cache.getOrFetch()` for:
  - `getEnabledModelIds()` — 5 min TTL (called every chat request)
  - `settingsRepository.getPublic()` — 30 min TTL
  - `mcpServerRepository.getCatalog()` — 30 min TTL
  - `idpRepository.listActive()` / `aiProviderRepository.listActive()` — 2 min TTL

---

#### [HIGH] getEnabledModelIds() Hits Oracle on Every Chat Request

- **File**: `apps/api/src/routes/chat.ts:63`, `apps/api/src/mastra/models/provider-registry.ts:326-344`
- **Impact**: Every `POST /api/chat` calls `getEnabledModelIds()` which calls `repo.getEnabledModels()` → Oracle SELECT. Model configuration changes rarely (admin action). This is the single highest-impact caching miss in the application.
- **Effort**: S (use existing cache infrastructure)
- **Fix**:
  ```typescript
  export async function getEnabledModelIds(): Promise<string[]> {
  	return fastify.cache.getOrFetch(
  		'tool',
  		'enabled-model-ids',
  		async () => {
  			const allowlist = await repo.getEnabledModels();
  			return allowlist.flatMap((p) => p.models);
  		},
  		300
  	); // 5 min TTL
  }
  ```

---

#### [HIGH] Missing Cache Invalidation for Admin CRUD

- **File**: `apps/api/src/routes/admin/ai-providers.ts:79-114`, `admin/idp.ts`, `admin/settings.ts`
- **Impact**: `reloadProviderRegistry()` exists but is **never called** from admin CRUD handlers. When an admin adds/updates AI providers, changes don't take effect until app restart. Same pattern affects IDP and settings caches (when caching is wired up).
- **Effort**: S (add invalidation calls to existing handlers)
- **Fix**: Call `reloadProviderRegistry()` in AI provider create/update/delete handlers. Add `fastify.cache.del()` calls for cached namespaces in corresponding admin routes.

---

### Category 6: Docker & Deployment

---

#### [LOW] Docker Compose Deprecated and Non-Functional

- **File**: `docker-compose.yml:1-4`, `Dockerfile`
- **Impact**: docker-compose.yml references non-existent `cloudnow/Dockerfile` and only builds frontend — API not included. Resource limits (2GB memory, 1 CPU) are defined but the file doesn't work.
- **Effort**: M (update docker-compose or remove it)
- **Fix**: Either update to correct paths and add API service, or remove and document Kubernetes-only deployment.

---

#### [LOW] Health Check Has No Timeout Enforcement

- **File**: `Dockerfile:116`
- **Impact**: HEALTHCHECK exists but has no `--timeout` flag. A hung database connection during health check blocks orchestration indefinitely.
- **Effort**: S
- **Fix**:
  ```dockerfile
  HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
      CMD curl --max-time 4 -f http://localhost:3000/api/health || exit 1
  ```

---

### Category 7: Graceful Shutdown

---

#### [LOW] Two-Phase Shutdown May Race

- **File**: `apps/api/src/app.ts:356-364`
- **Impact**: `fastify-graceful-shutdown` (30s timeout) and Oracle `onClose` hook fire in reverse plugin order. If in-flight queries haven't completed when Oracle pool drains (10s window), they hang. Low probability in practice but untested under load.
- **Effort**: M (verify ordering, add drain-time enforcement)
- **Fix**: Test graceful shutdown with 100+ concurrent requests. Verify Oracle pool drain completes within the graceful shutdown window. Consider increasing `pool.close()` drain time from 10s to 20s.

---

### Category 8: Missing Indexes & Query Optimization

---

#### [LOW] JSON_VALUE Filter Without Functional Index

- **File**: `apps/api/src/mastra/storage/oracle-store.ts:471-536`
- **Impact**: `listThreads()` filters by `JSON_VALUE(metadata, '$.key')` without a corresponding functional index. For large thread collections with metadata filters, this triggers full table scans.
- **Effort**: M (create functional indexes for common metadata paths)
- **Fix**:
  ```sql
  CREATE INDEX idx_threads_metadata_orgId
  ON mastra_threads (JSON_VALUE(metadata, '$.orgId'));
  ```

---

## Summary Table

| #   | Severity | Category   | Issue                                  | File                         | Effort |
| --- | -------- | ---------- | -------------------------------------- | ---------------------------- | ------ |
| 1   | CRITICAL | N+1        | saveMessages INSERT loop               | oracle-store.ts:709          | M      |
| 2   | CRITICAL | N+1        | updateMessages SELECT+UPDATE loop      | oracle-store.ts:737          | L      |
| 3   | CRITICAL | N+1        | Vector upsert MERGE loop               | oracle-vector-store.ts:175   | L      |
| 4   | CRITICAL | Memory     | Unbounded latestStatusByRun Map        | workflow-stream-bus.ts:25    | S      |
| 5   | CRITICAL | Cache      | Valkey cache built but unused          | cache.ts + services/cache.ts | M      |
| 6   | HIGH     | N+1        | Webhook secret migration loop          | webhook-repository.ts:303    | S      |
| 7   | HIGH     | N+1        | Findings upsert loop                   | findings-repository.ts:156   | M      |
| 8   | HIGH     | Memory     | Chat stream write errors unhandled     | chat.ts:294                  | S      |
| 9   | HIGH     | Memory     | Unbounded clients Map (MCP)            | mcp-connection-manager.ts:65 | S      |
| 10  | HIGH     | Memory     | EventEmitter setMaxListeners(0)        | workflow-stream-bus.ts:22    | S      |
| 11  | HIGH     | Rate Limit | Setup endpoints unprotected            | setup.ts:129,:305            | S      |
| 12  | HIGH     | Cache      | getEnabledModelIds() no cache          | chat.ts:63                   | S      |
| 13  | HIGH     | Cache      | Admin CRUD missing invalidation        | admin/ai-providers.ts        | S      |
| 14  | MEDIUM   | Unbounded  | Auth adapter SELECT \* no LIMIT        | oracle-adapter.ts:357,:419   | S      |
| 15  | MEDIUM   | Unbounded  | Audit getBySession no LIMIT            | audit-repository.ts:89       | S      |
| 16  | MEDIUM   | Unbounded  | Audit getByDateRange no LIMIT          | audit-repository.ts:103      | S      |
| 17  | MEDIUM   | Unbounded  | Approval getPending no LIMIT           | approval-repository.ts:105   | S      |
| 18  | MEDIUM   | Unbounded  | Org listMembers/listByStatus no LIMIT  | org-repository.ts:100,:140   | S      |
| 19  | MEDIUM   | Unbounded  | IDP listByOrg/listByStatus no LIMIT    | idp-repository.ts:153,:228   | S      |
| 20  | MEDIUM   | N+1        | MCP tool cache INSERT loop             | mcp-repository.ts:610        | S      |
| 21  | MEDIUM   | N+1        | Audit getSummary 3 sequential queries  | audit-repository.ts:133      | S      |
| 22  | MEDIUM   | N+1        | Workflow listByOrg COUNT+SELECT        | workflow-repository.ts:675   | S      |
| 23  | MEDIUM   | Memory     | Workflow SSE write errors unhandled    | workflows.ts:496             | S      |
| 24  | MEDIUM   | Memory     | Cache client handlers not cleaned      | cache.ts:33                  | S      |
| 25  | MEDIUM   | Memory     | Approval timer not stopped on shutdown | approvals.ts:86              | S      |
| 26  | LOW      | Unbounded  | MCP tool/resource cache no LIMIT       | mcp-repository.ts:638,:695   | S      |
| 27  | LOW      | Unbounded  | Webhook list no LIMIT                  | webhook-repository.ts:120    | S      |
| 28  | LOW      | Rate Limit | Auth endpoints generic rate limit      | auth.ts:67                   | M      |
| 29  | LOW      | Rate Limit | Public /api/models no rate limit       | models.ts:30                 | S      |
| 30  | LOW      | Rate Limit | Streaming endpoints wrong category     | rate-limiter-oracle.ts:28    | S      |
| 31  | LOW      | Docker     | docker-compose deprecated              | docker-compose.yml           | M      |
| 32  | LOW      | Docker     | Health check no timeout                | Dockerfile:116               | S      |
| 33  | LOW      | Shutdown   | Two-phase shutdown race potential      | app.ts:356                   | M      |
| 34  | LOW      | Index      | JSON_VALUE without functional index    | oracle-store.ts:471          | M      |

---

## Passing Areas

### [PASS] Connection Pool Configuration

- **File**: `packages/server/src/oracle/connection.ts:83-86`
- `poolMin: 2, poolMax: 10, poolIncrement: 2, poolTimeout: 60` — reasonable for small-to-medium deployments
- `withConnection()` uses try/finally for guaranteed release
- Pool properly initialized with fail-fast validation

### [PASS] Graceful Shutdown Orchestration

- **File**: `apps/api/src/app.ts:353-364`
- `fastify-graceful-shutdown` with 30s timeout
- Oracle pool drain via `onClose` hook (10s drain window)
- Valkey cache disconnects with 5s timeout
- SIGTERM → graceful drain → process exit

### [PASS] Two-Layer Rate Limiting

- **File**: `apps/api/src/plugins/rate-limiter-oracle.ts`, `apps/api/src/app.ts:310-323`
- Layer 1: In-memory `@fastify/rate-limit` (60 req/min, fails open)
- Layer 2: Oracle-backed per-user/per-endpoint (user ID > API key > IP)
- Chat endpoints: 20 req/min; general API: 60 req/min
- Proper `Retry-After` headers and 429 responses

### [PASS] Valkey Cache Architecture (Implementation)

- **File**: `apps/api/src/plugins/cache.ts:33-63`
- Fail-open behavior, graceful degradation
- `getOrFetch()` cache-aside pattern prevents thundering herd
- Namespace-scoped TTLs (session: 600s, tool: 300s, mcp: 1800s)
- _Note: Architecture is excellent; issue is that it's not wired to any routes_

### [PASS] SSE Stream Cleanup

- **File**: `apps/api/src/routes/workflows.ts:550-589`
- Dual cleanup on `request.close` AND `reply.close`
- `closed` flag prevents double-cleanup
- Timeout fires at 300s to prevent resource leak
- Unsubscribe callback clears event listeners

### [PASS] LLM Token Guardrails

- **File**: `apps/api/src/mastra/agents/guardrails.ts`, `charlie.ts:24-26`
- Input: 50k chars (~12.5k tokens), Output: 4000 tokens
- Prompt injection detector blocks common jailbreak patterns
- PII detector redacts SSN, credit cards, AWS keys, OCI keys, bearer tokens, private keys

### [PASS] Oracle Query Patterns — No N+1 in Read Paths

- Repository read paths use `LEFT JOIN` for enrichment (e.g., `session-repository.ts:243-249`)
- No loops containing `withConnection()` calls on read paths
- Pagination with OFFSET/FETCH NEXT consistently applied in list endpoints
- Aggregate queries (COUNT, SUM) avoid client-side counting

### [PASS] Under-Pressure Plugin

- **File**: `apps/api/src/plugins/under-pressure.ts`
- Thresholds: maxEventLoopDelay=1000ms, maxHeapUsedBytes=700MB, maxRssBytes=1200MB
- Custom health check integrates with Oracle pool availability
- Proper 503 responses when thresholds exceeded

### [PASS] Oracle VPD Tenant Isolation

- **File**: `apps/api/src/plugins/vpd.ts`
- `withVPD()` sets `portal_ctx_pkg.set_org_id(:orgId)` before queries
- Always clears org context in `finally` block
- Prevents cross-tenant data leakage at database level

---

## Production Readiness Verdict

**Ready with reservations.** The application has strong fundamentals (connection pooling, rate limiting, graceful shutdown, LLM guardrails, VPD isolation). The critical issues are well-defined and fixable:

### Pre-Deployment Checklist

1. **Fix N+1 loops** on chat hot path (saveMessages, updateMessages, vector upsert) — biggest performance risk
2. **Add TTL eviction** to `latestStatusByRun` Map — prevents memory leak under sustained load
3. **Wire up Valkey cache** for `getEnabledModelIds()` — eliminates unnecessary Oracle query per chat request
4. **Add LIMIT clauses** to all unbounded SELECT queries (14 queries identified)
5. **Add error handling** to SSE stream write operations in chat and workflow routes
6. **Set EventEmitter max listeners** to reasonable cap (1000)
7. **Add rate limiting** to setup endpoints (detect-env, ai-provider/test)
8. **Wire cache invalidation** in admin CRUD handlers (call `reloadProviderRegistry()`)

### Monitoring Recommendations

- Emit metrics for: `latestStatusByRun.size`, `clients.size`, `pendingApprovals.size`
- Monitor Oracle pool usage (>80% = alert) via existing `getPoolStats()`
- Track Valkey cache hit/miss ratio once wired up
- Alert on rate limit rejection rate (429 responses > 5% of requests)
- Monitor SSE stream duration and abort frequency

---

**Report generated**: 2026-02-19 | Agent: performance-infra-reviewer (comprehensive)
