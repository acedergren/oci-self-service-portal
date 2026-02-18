# Migrate All SvelteKit API Routes to Fastify Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all 6 remaining SvelteKit-only API route groups to Fastify 5, completing the backend consolidation.

**Architecture:** Each SvelteKit route becomes a Fastify route plugin registered in `app.ts`. Auth uses `better-auth/node`'s `toNodeHandler()`. Setup routes use a shared `validateSetupToken` preHandler. All other routes reuse `requireAuth()` from `plugins/rbac.ts`. Proxy cutover happens incrementally via `FASTIFY_PROXY_ROUTES`.

**Tech Stack:** Fastify 5, Zod, better-auth 1.4.18 (`better-auth/node`), Vitest, fastify-type-provider-zod

---

## Agent Team Structure

### Team: `fastify-route-migration`

| Agent Name   | Model  | subagent_type   | Role                | Tasks              | Skills                                                         |
| ------------ | ------ | --------------- | ------------------- | ------------------ | -------------------------------------------------------------- |
| `wave1-impl` | Sonnet | general-purpose | Backend implementer | 1, 2, 3            | `/fastify`, `/tdd`, `/quality-commit`                          |
| `wave2-impl` | Sonnet | general-purpose | Backend implementer | 4, 5               | `/fastify`, `/tdd`, `/quality-commit`                          |
| `auth-impl`  | Opus   | general-purpose | Auth specialist     | 6                  | `/fastify`, `/auth-implementation-patterns`, `/quality-commit` |
| `proxy-impl` | Haiku  | general-purpose | Config updater      | 7                  | `/quality-commit`                                              |
| `reviewer`   | Opus   | general-purpose | Code reviewer       | Review all commits | `/coderabbit:review`, `/security-review`                       |

### Execution Waves

**Wave 1 (parallel):** Tasks 1-3 (`wave1-impl`) — models, audit, graph routes
**Wave 2 (parallel):** Tasks 4-5 (`wave2-impl`) — webhooks, setup routes
**Wave 3 (sequential):** Task 6 (`auth-impl`) — auth handler (depends on Wave 1-2 for `app.ts` wiring pattern)
**Wave 4:** Task 7 (`proxy-impl`) — proxy config (depends on all routes being registered)

### Quality Gates (per commit)

Each agent MUST after every task step:

1. **TDD**: Write test first → run → fail → implement → run → pass
2. **Commit**: Use `/quality-commit` skill after each passing task
3. **Review**: Team lead triggers `/coderabbit:review` on each commit
4. **Type check**: `cd apps/api && npx tsc --noEmit`
5. **Lint**: `cd apps/api && npx eslint <changed-files>`
6. **Test suite**: `cd apps/api && npx vitest run` (full suite, not just new tests)

### Conflict Avoidance: `app.ts` Wiring

Multiple agents need to add imports + registrations to `apps/api/src/app.ts`. To avoid merge conflicts:

- **Wave 1 (`wave1-impl`)** adds: `modelRoutes`, `auditRoutes`, `graphRoutes` — commits `app.ts` with all 3
- **Wave 2 (`wave2-impl`)** waits for Wave 1's `app.ts` commit, then adds: `webhookRoutes`, `setupRoutes`
- **Wave 3 (`auth-impl`)** waits for Wave 2, then adds: `authRoutes`
- **Wave 4 (`proxy-impl`)** modifies `feature-flags.ts` only (no `app.ts` change)

Team lead coordinates: assigns wave2-impl tasks only after wave1-impl's `app.ts` commit is on disk.

### Agent Instructions Template

Each agent receives:

- This plan document (link to `docs/plans/2026-02-09-migrate-sveltekit-routes-to-fastify.md`)
- Their assigned task numbers
- Instructions:
  - "Follow TDD per task step. Write failing test → implement → pass → commit."
  - "Use `/quality-commit` skill after each passing test."
  - "Stage only your files. Do NOT modify files outside your assigned tasks."
  - "After each commit, notify team lead. Team lead will trigger `/coderabbit:review` on your commit."
  - "If pre-commit hooks fail on files you didn't touch, report to team lead — do not use `--no-verify`."

---

## Reference Files

| Purpose                     | Path                                                                            |
| --------------------------- | ------------------------------------------------------------------------------- |
| App entry (register routes) | `apps/api/src/app.ts`                                                           |
| Route pattern reference     | `apps/api/src/routes/sessions.ts`                                               |
| RBAC + resolveOrgId         | `apps/api/src/plugins/rbac.ts`                                                  |
| Auth plugin (toWebRequest)  | `apps/api/src/plugins/auth.ts`                                                  |
| Test helpers                | `apps/api/src/tests/routes/test-helpers.ts`                                     |
| Test pattern reference      | `apps/api/src/tests/routes/sessions.test.ts`                                    |
| Proxy config                | `apps/frontend/src/lib/server/feature-flags.ts`                                 |
| Better Auth config          | `packages/shared/src/server/auth/config.ts`                                     |
| Setup token                 | `packages/shared/src/server/admin/setup-token.ts`                               |
| Webhook repo                | `packages/shared/src/server/oracle/repositories/webhook-repository.ts`          |
| Graph analytics             | `packages/shared/src/server/oracle/graph-analytics.ts`                          |
| Blockchain audit repo       | `packages/shared/src/server/oracle/repositories/blockchain-audit-repository.ts` |
| Provider registry           | `apps/api/src/mastra/models/provider-registry.ts`                               |
| AI provider repo            | `packages/shared/src/server/admin/ai-provider-repository.ts`                    |
| Fallback models             | `apps/api/src/mastra/agents/cloud-advisor.ts` (FALLBACK_MODEL_ALLOWLIST)        |

---

## Task 1: Dynamic Models Route

**Recommended model: Sonnet**

**Context:** The old SvelteKit `/api/models` returned a hardcoded model list. Since the portal supports dynamic AI providers (OCI, OpenAI, Anthropic, Google, Azure) configured via the admin console, the Fastify version should return models dynamically from DB configuration.

**Existing infrastructure to reuse:**

- `getEnabledModelIds()` from `apps/api/src/mastra/models/provider-registry.ts` — returns `["providerId:modelId", ...]`
- `aiProviderRepository.listActive()` — returns active providers with `modelAllowlist`, `providerType`, `displayName`
- `aiProviderRepository.getEnabledModels()` — returns `{ providerId: ["model1", "model2"] }`
- `FALLBACK_MODEL_ALLOWLIST` from `apps/api/src/mastra/agents/cloud-advisor.ts` — used when no providers configured
- `DEFAULT_MODEL` (`google.gemini-2.5-flash`) — default model ID

**Files:**

- Create: `apps/api/src/routes/models.ts`
- Create: `apps/api/src/tests/routes/models.test.ts`
- Modify: `apps/api/src/app.ts` (add import + register)

**Step 1: Write the test file**

```typescript
// apps/api/src/tests/routes/models.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp } from './test-helpers.js';
import { modelRoutes } from '../../routes/models.js';

// Mock the provider registry
const mockGetEnabledModelIds = vi.fn();
vi.mock('../../mastra/models/index.js', () => ({
	get getEnabledModelIds() {
		return mockGetEnabledModelIds;
	}
}));

// Mock the AI provider repository
const mockListActive = vi.fn();
vi.mock('@portal/shared/server/admin', () => ({
	aiProviderRepository: {
		get listActive() {
			return mockListActive;
		}
	}
}));

vi.mock('@portal/shared/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

describe('GET /api/models', () => {
	beforeEach(() => {
		mockGetEnabledModelIds.mockReset();
		mockListActive.mockReset();
	});

	it('returns dynamic models from configured providers', async () => {
		mockGetEnabledModelIds.mockResolvedValue([
			'my-openai:gpt-4o',
			'my-openai:gpt-4o-mini',
			'my-anthropic:claude-sonnet-4-5-20250929'
		]);
		mockListActive.mockResolvedValue([
			{
				providerId: 'my-openai',
				providerType: 'openai',
				displayName: 'OpenAI',
				modelAllowlist: ['gpt-4o', 'gpt-4o-mini']
			},
			{
				providerId: 'my-anthropic',
				providerType: 'anthropic',
				displayName: 'Anthropic',
				modelAllowlist: ['claude-sonnet-4-5-20250929']
			}
		]);

		const app = await buildTestApp({ withRbac: false });
		await app.register(modelRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/models' });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.models).toHaveLength(3);
		expect(body.models[0]).toHaveProperty('id');
		expect(body.models[0]).toHaveProperty('provider');
		expect(body.dynamic).toBe(true);
	});

	it('returns fallback models when no providers configured', async () => {
		mockGetEnabledModelIds.mockResolvedValue([]);
		mockListActive.mockResolvedValue([]);

		const app = await buildTestApp({ withRbac: false });
		await app.register(modelRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/models' });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.models.length).toBeGreaterThan(0);
		expect(body.dynamic).toBe(false);
	});

	it('returns region from environment', async () => {
		mockGetEnabledModelIds.mockResolvedValue([]);
		mockListActive.mockResolvedValue([]);

		const app = await buildTestApp({ withRbac: false });
		await app.register(modelRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/models' });
		const body = res.json();
		expect(body.region).toBeDefined();
	});
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/tests/routes/models.test.ts`
Expected: FAIL — module `../../routes/models.js` not found

**Step 3: Write the route**

```typescript
// apps/api/src/routes/models.ts
import type { FastifyInstance } from 'fastify';
import { getEnabledModelIds } from '../mastra/models/index.js';
import { aiProviderRepository } from '@portal/shared/server/admin';
import { FALLBACK_MODEL_ALLOWLIST, DEFAULT_MODEL } from '../mastra/agents/cloud-advisor.js';
import { createLogger } from '@portal/shared/server/logger';

const log = createLogger('api:models');

interface ModelEntry {
	id: string;
	provider: string;
	providerType: string;
}

/**
 * GET /api/models — List available AI models.
 *
 * Dynamic: queries the provider registry for configured model allowlists.
 * Falls back to FALLBACK_MODEL_ALLOWLIST when no providers are configured.
 * Public endpoint — no auth required.
 */
export async function modelRoutes(app: FastifyInstance): Promise<void> {
	app.get('/api/models', async (_request, reply) => {
		const region = process.env.OCI_REGION || 'eu-frankfurt-1';

		try {
			// Try dynamic model list from configured providers
			const enabledModelIds = await getEnabledModelIds();

			if (enabledModelIds.length > 0) {
				// Build enriched model list with provider metadata
				const activeProviders = await aiProviderRepository.listActive();
				const providerMap = new Map(activeProviders.map((p) => [p.providerId, p]));

				const models: ModelEntry[] = enabledModelIds.map((fullId) => {
					const [providerId, ...rest] = fullId.split(':');
					const modelId = rest.join(':'); // Handle model IDs with colons
					const provider = providerMap.get(providerId);
					return {
						id: fullId,
						provider: provider?.displayName ?? providerId,
						providerType: provider?.providerType ?? 'unknown'
					};
				});

				return reply.send({
					models,
					defaultModel: DEFAULT_MODEL,
					region,
					dynamic: true
				});
			}
		} catch (err) {
			log.warn({ err }, 'Failed to load dynamic models, falling back to static list');
		}

		// Fallback: static model list (no providers configured or error)
		const models: ModelEntry[] = FALLBACK_MODEL_ALLOWLIST.map((id) => ({
			id,
			provider: id.split('.')[0], // "google.gemini..." → "google"
			providerType: 'oci'
		}));

		return reply.send({
			models,
			defaultModel: DEFAULT_MODEL,
			region,
			dynamic: false
		});
	});
}
```

**Step 4: Wire into app.ts**

Add to imports section of `apps/api/src/app.ts`:

```typescript
import { modelRoutes } from './routes/models.js';
```

Add after `await app.register(openApiRoute);`:

```typescript
await app.register(modelRoutes);
```

**Step 5: Run test**

Run: `cd apps/api && npx vitest run src/tests/routes/models.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/api/src/routes/models.ts apps/api/src/tests/routes/models.test.ts apps/api/src/app.ts
git commit -m "feat(api): add dynamic /api/models Fastify route

Queries provider registry for configured model allowlists.
Falls back to FALLBACK_MODEL_ALLOWLIST when no providers configured.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Audit Verify Route (Trivial)

**Recommended model: Sonnet**

**Files:**

- Create: `apps/api/src/routes/audit.ts`
- Create: `apps/api/src/tests/routes/audit.test.ts`
- Modify: `apps/api/src/app.ts` (add import + register)

**Step 1: Write the test file**

```typescript
// apps/api/src/tests/routes/audit.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, simulateSession } from './test-helpers.js';
import { auditRoutes } from '../../routes/audit.js';

// Mock the blockchain audit repository
const mockVerify = vi.fn();
vi.mock('@portal/shared/server/oracle/repositories/blockchain-audit-repository', () => ({
	blockchainAuditRepository: {
		get verify() {
			return mockVerify;
		}
	}
}));

vi.mock('@portal/shared/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

describe('GET /api/v1/audit/verify', () => {
	beforeEach(() => {
		mockVerify.mockReset();
	});

	it('returns 401 without auth', async () => {
		const app = await buildTestApp();
		await app.register(auditRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/audit/verify'
		});
		expect(res.statusCode).toBe(401);
	});

	it('returns 403 without admin:audit permission', async () => {
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		await app.register(auditRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/audit/verify'
		});
		expect(res.statusCode).toBe(403);
	});

	it('returns verification result on success', async () => {
		mockVerify.mockResolvedValue({
			valid: true,
			rowCount: 42,
			lastVerified: new Date('2026-01-01')
		});
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:audit']);
		await app.register(auditRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/audit/verify'
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.valid).toBe(true);
		expect(body.rowCount).toBe(42);
		expect(body.verifiedAt).toBeDefined();
	});

	it('returns 503 on verification failure', async () => {
		mockVerify.mockRejectedValue(new Error('ORA-05715'));
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['admin:audit']);
		await app.register(auditRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'GET',
			url: '/api/v1/audit/verify'
		});
		expect(res.statusCode).toBe(503);
	});
});
```

**Step 2: Run test — expect FAIL (module not found)**

**Step 3: Write the route**

```typescript
// apps/api/src/routes/audit.ts
import type { FastifyInstance } from 'fastify';
import { blockchainAuditRepository } from '@portal/shared/server/oracle/repositories/blockchain-audit-repository';
import { createLogger } from '@portal/shared/server/logger';
import { requireAuth } from '../plugins/rbac.js';

const log = createLogger('api:audit');

/**
 * GET /api/v1/audit/verify — Validate blockchain audit chain integrity.
 */
export async function auditRoutes(app: FastifyInstance): Promise<void> {
	app.get(
		'/api/v1/audit/verify',
		{
			preHandler: requireAuth('admin:audit')
		},
		async (request, reply) => {
			try {
				const result = await blockchainAuditRepository.verify();
				return reply.send({
					valid: result.valid,
					rowCount: result.rowCount,
					lastVerified: result.lastVerified?.toISOString() ?? null,
					verifiedAt: new Date().toISOString()
				});
			} catch (err) {
				log.error(
					{ err, requestId: request.headers['x-request-id'] },
					'Blockchain verification failed'
				);
				return reply.status(503).send({ error: 'Verification failed', valid: false });
			}
		}
	);
}
```

**Step 4: Wire into app.ts** — same pattern as Task 1
**Step 5: Run test — expect PASS**
**Step 6: Commit**

```bash
git add apps/api/src/routes/audit.ts apps/api/src/tests/routes/audit.test.ts apps/api/src/app.ts
git commit -m "feat(api): add /api/v1/audit/verify Fastify route

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Graph Analytics Route (Easy)

**Recommended model: Sonnet**

**Files:**

- Create: `apps/api/src/routes/graph.ts`
- Create: `apps/api/src/tests/routes/graph.test.ts`
- Modify: `apps/api/src/app.ts`

**Step 1: Write test file**

Tests should cover:

- 401 without auth
- 403 without `admin:audit`
- 400 for missing `type` param
- 400 for `user-activity` without `userId`
- 400 for `org-impact` without `toolName`
- 200 for each of the 3 query types
- 503 on analytics failure

Mock `getUserActivity`, `getToolAffinity`, `getOrgImpact` from `@portal/shared/server/oracle/graph-analytics`. Use forwarding pattern (see MEMORY.md re: `mockReset: true`).

**Step 2: Write the route**

```typescript
// apps/api/src/routes/graph.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	getUserActivity,
	getToolAffinity,
	getOrgImpact
} from '@portal/shared/server/oracle/graph-analytics';
import { createLogger } from '@portal/shared/server/logger';
import { requireAuth } from '../plugins/rbac.js';

const log = createLogger('api:graph');

const GraphQuerySchema = z.object({
	type: z.enum(['user-activity', 'tool-affinity', 'org-impact']),
	userId: z.string().optional(),
	toolName: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50)
});

export async function graphRoutes(app: FastifyInstance): Promise<void> {
	app.get(
		'/api/v1/graph',
		{
			preHandler: requireAuth('admin:audit'),
			schema: { querystring: GraphQuerySchema }
		},
		async (request, reply) => {
			const { type, userId, toolName, limit } = request.query as z.infer<typeof GraphQuerySchema>;

			try {
				switch (type) {
					case 'user-activity': {
						if (!userId) return reply.status(400).send({ error: 'userId parameter required' });
						const result = await getUserActivity(userId, limit);
						return reply.send({ type, ...result });
					}
					case 'tool-affinity': {
						const result = await getToolAffinity(limit);
						return reply.send({ type, ...result });
					}
					case 'org-impact': {
						if (!toolName) return reply.status(400).send({ error: 'toolName parameter required' });
						const result = await getOrgImpact(toolName, limit);
						return reply.send({ type, ...result });
					}
				}
			} catch (err) {
				log.error({ err, type, requestId: request.headers['x-request-id'] }, 'Graph query failed');
				return reply.status(503).send({ error: 'Graph query failed' });
			}
		}
	);
}
```

**Note:** The Zod schema validates `type` as an enum, so the 400 "invalid type" case is handled by Fastify's validation layer automatically (returns 400 with Zod error details).

**Step 3: Wire, test, commit** — same pattern

---

## Task 4: Webhook Routes (Medium)

**Recommended model: Sonnet**

**Files:**

- Create: `apps/api/src/routes/webhooks.ts`
- Create: `apps/api/src/tests/routes/webhooks.test.ts`
- Modify: `apps/api/src/app.ts`

**Step 1: Write test file**

Cover:

- Collection: GET list (auth, org scope, empty list), POST create (validation, SSRF, encryption check, success 201)
- Resource: GET by id (auth, 404, success), PUT update (validation, status enum, SSRF, success), DELETE (auth, success)
- IDOR: operations scoped to orgId (mock repo verifies orgId passed)

Mock `webhookRepository`, `isValidWebhookUrl`, `isWebhookEncryptionEnabled`. Use `simulateSession` + set session with `activeOrganizationId` for org context.

**Step 2: Write the route**

Combine collection + resource into one plugin file. Key patterns:

- `resolveOrgId(request)` from `plugins/rbac.ts` (already exists for Fastify)
- `requireAuth('tools:read')` for reads, `requireAuth('tools:execute')` for writes
- SSRF: `isValidWebhookUrl()` before create/update
- Encryption guard: `isWebhookEncryptionEnabled()` before create
- Secret: `whsec_${crypto.randomUUID().replace(/-/g, '')}` — shown once on create

Route paths:

- `GET /api/v1/webhooks` — list
- `POST /api/v1/webhooks` — create
- `GET /api/v1/webhooks/:id` — get by id
- `PUT /api/v1/webhooks/:id` — update
- `DELETE /api/v1/webhooks/:id` — delete

**Zod schemas needed:**

```typescript
const CreateWebhookBody = z.object({
	url: z.string().url(),
	events: z.array(z.string()).min(1)
});

const UpdateWebhookBody = z
	.object({
		url: z.string().url().optional(),
		events: z.array(z.string()).min(1).optional(),
		status: z.enum(['active', 'paused']).optional()
	})
	.refine((d) => Object.keys(d).length > 0, {
		message: 'No valid fields to update'
	});

const WebhookIdParam = z.object({ id: z.string() });
```

Import `CreateWebhookInputSchema` and `WebhookEventTypeSchema` from `@portal/shared/server/api/types` for validation consistency.

**Step 3: Wire, test, commit**

---

## Task 5: Setup Routes (Medium-Complex)

**Recommended model: Sonnet**

**Files:**

- Create: `apps/api/src/routes/setup.ts`
- Create: `apps/api/src/tests/routes/setup.test.ts`
- Modify: `apps/api/src/app.ts`

**Key design: Setup token preHandler**

Setup routes use `validateSetupToken()` instead of session auth. This function takes a `Request` object (Web API) and returns `Response | null`. In Fastify, convert via `toWebRequest()` pattern from `plugins/auth.ts`.

```typescript
import { validateSetupToken } from '@portal/shared/server/admin';

async function requireSetupToken(request: FastifyRequest, reply: FastifyReply) {
	// Build a minimal Web API Request for validateSetupToken
	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers)) {
		if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
	}
	const webRequest = new Request(`${request.protocol}://${request.hostname}${request.url}`, {
		method: request.method,
		headers
	});

	const denied = await validateSetupToken(webRequest);
	if (denied) {
		const body = await denied.json();
		return reply.status(denied.status).send(body);
	}
}
```

**7 endpoints to port:**

| SvelteKit path                | Fastify path                  | Method | Auth                           |
| ----------------------------- | ----------------------------- | ------ | ------------------------------ |
| `/api/setup/status`           | `/api/setup/status`           | GET    | setup token                    |
| `/api/setup/idp`              | `/api/setup/idp`              | POST   | setup token                    |
| `/api/setup/idp/test`         | `/api/setup/idp/test`         | POST   | setup token                    |
| `/api/setup/ai-provider`      | `/api/setup/ai-provider`      | POST   | setup token                    |
| `/api/setup/ai-provider/test` | `/api/setup/ai-provider/test` | POST   | `isSetupComplete()` check only |
| `/api/setup/settings`         | `/api/setup/settings`         | POST   | setup token                    |
| `/api/setup/complete`         | `/api/setup/complete`         | POST   | setup token                    |

**IDP test endpoint:** Replace `event.fetch()` (SvelteKit) with plain `fetch()`. The call is to external OIDC discovery URLs only, pre-validated by `isValidExternalUrl()`. No session context needed.

**Tests should cover:**

- Token validation (401 without token, 403 after setup complete)
- Each endpoint's happy path
- IDP test with mocked `fetch` (mock `globalThis.fetch`)
- AI provider test (OCI shortcut, key length validation)
- Complete endpoint (rejects when no IDP/AI configured)

**Startup initialization:** `apps/api/src/app.ts` (or server entry) must call `initSetupToken()` at startup if not already. Check if this is already called somewhere in the Fastify startup chain.

---

## Task 6: Auth Routes (Complex — Better Auth Node Handler)

**Recommended model: Opus**

**Files:**

- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/tests/routes/auth.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/plugins/auth.ts` (add `/api/auth` to excludePaths)
- Modify: `apps/frontend/src/lib/server/feature-flags.ts` (remove auth route exclusion)

**Key design:**

`better-auth/node` exports `toNodeHandler(auth)` which returns `(req: IncomingMessage, res: ServerResponse) => Promise<void>`. Fastify provides raw Node objects via `request.raw` and `reply.raw`.

```typescript
// apps/api/src/routes/auth.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '@portal/shared/server/auth/config';

const nodeHandler = toNodeHandler(auth);

export async function authRoutes(app: FastifyInstance): Promise<void> {
	// Catch-all for /api/auth/* — delegates to Better Auth's Node handler
	app.route({
		method: ['GET', 'POST'],
		url: '/api/auth/*',
		handler: async (request: FastifyRequest, reply: FastifyReply) => {
			await nodeHandler(request.raw, reply.raw);
			// Better Auth writes directly to the raw response
			reply.hijack();
		}
	});
}
```

**Critical considerations:**

1. `reply.hijack()` tells Fastify not to send its own response — Better Auth handles it
2. The auth plugin's `excludePaths` must include `/api/auth` to prevent session resolution on auth endpoints (recursive loop)
3. Cookie handling: Better Auth sets cookies directly on `res` (ServerResponse) — Fastify's cookie plugin won't interfere because we hijack
4. OIDC callback flow: The redirect URLs must match the Fastify server's origin

**Auth plugin change** (`apps/api/src/plugins/auth.ts`):
Add `'/api/auth'` to the default `excludePaths` array.

**Feature flags change** (`apps/frontend/src/lib/server/feature-flags.ts`):
Remove the line `if (pathname.startsWith('/api/auth/')) return false;` — auth routes should now proxy to Fastify too.

**Tests:**

- Basic: GET `/api/auth/get-session` returns 200 (or 401) — tests that the handler doesn't crash
- Integration: Harder to test OIDC flow in unit tests. Verify route registration and that `reply.hijack()` is called.
- The real validation is the manual E2E test (see verification section)

---

## Task 7: Proxy Configuration Update

**Recommended model: Haiku**

**Files:**

- Modify: `apps/frontend/src/lib/server/feature-flags.ts`

After all routes are in Fastify, update the proxy to forward these new routes. Two options:

**Option A (incremental):** Add each route prefix to `FASTIFY_PROXY_ROUTES`:

```
FASTIFY_PROXY_ROUTES=/api/health,/api/sessions,...,/api/models,/api/v1/audit,/api/v1/graph,/api/v1/webhooks,/api/setup,/api/auth
```

**Option B (blanket):** Leave `FASTIFY_PROXY_ROUTES` empty (proxies all `/api/*` when `FASTIFY_ENABLED=true`). Now that `/api/auth` is handled by Fastify too, remove the auth exclusion from `shouldProxyToFastify()`.

Option B is cleaner since ALL routes are now in Fastify. The only change is removing line 47-49 of `feature-flags.ts`:

```typescript
// Remove this block:
if (pathname.startsWith('/api/auth/')) {
	return false;
}
```

**No test needed** — existing proxy tests cover the function behavior.

**Commit:**

```bash
git add apps/frontend/src/lib/server/feature-flags.ts
git commit -m "feat(proxy): remove auth route exclusion — all routes now in Fastify

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Verification

### Automated

```bash
# Run all API tests
cd apps/api && npx vitest run

# Type check
cd apps/api && npx tsc --noEmit

# Lint
cd apps/api && npx eslint src/routes/models.ts src/routes/audit.ts src/routes/graph.ts src/routes/webhooks.ts src/routes/setup.ts src/routes/auth.ts
```

### Manual E2E

1. Start both servers: `FASTIFY_ENABLED=true pnpm dev`
2. Test models: `curl http://localhost:5173/api/models` — should return model list
3. Test auth: Open browser, navigate to login — OIDC flow should complete through Fastify
4. Test setup: With a fresh DB, use setup token to configure IDP
5. Test webhooks: Create webhook via API key, verify SSRF rejection for private IPs
6. Test audit: `curl -H "Cookie: ..." http://localhost:5173/api/v1/audit/verify`
7. Test graph: `curl -H "Cookie: ..." "http://localhost:5173/api/v1/graph?type=tool-affinity"`

---

Plan saved. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session / opencode headless** — Hand off to opencode headless agents, one per task (or grouped by wave)
