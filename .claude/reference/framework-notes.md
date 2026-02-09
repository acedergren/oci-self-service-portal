# Framework Notes Reference

## Fastify 5 — Decorator Timing

- **Decorator types are locked at creation**: `fastify.decorate('foo', null)` permanently sets the type to `null`. Always pass the real value or a properly-typed stub. See `apps/api/src/app.ts:109-111`.
- **Module augmentation for TypeScript**: Fastify decorators need `declare module 'fastify'` blocks. Session plugin augments `FastifyRequest`, RBAC augments `FastifyInstance`.
- **Decorate before register in tests**: When testing a plugin that reads a decorator, decorate the mock _before_ calling `fastify.register(plugin)`.

## Fastify 5 — Auth Hook Ordering

- **Plugin registration order is load-bearing**: error-handler → request-logger → helmet → CORS → rate-limit → cookie → oracle → session → RBAC. See `apps/api/src/app.ts:68-129`.
- **`fp()` declares dependencies**: Plugins providing shared decorators must use `fastify-plugin` with `dependencies` array.
- **Deny-by-default auth gate**: `onRequest` hook rejects unauthenticated requests not in `PUBLIC_ROUTES`. Forgetting an endpoint = 401s.

## Fastify 5 — Response & Streaming

- **`reply.send(undefined)` → `FST_ERR_SEND_UNDEFINED`**: Always return an object or use `reply.code(204).send()`.
- **SSE streaming**: Use `reply.raw.writeHead()` + `reply.raw.write()`. Do NOT use `reply.send()` — it closes the response.
- **`app.inject()` in tests**: Use `JSON.parse(response.body)` for parsing. Always `await fastify.close()` in `afterEach`.

## Fastify 5 — Testing

- **`skipAuth` + `testUser`**: `buildApp({ skipAuth: true, testUser: {...} })` bypasses Oracle/session/RBAC in tests.
- **`PUBLIC_ROUTES` set**: All unauthenticated endpoints must be listed in the deny-by-default auth gate.
- **Type provider**: Route modules use `fastify.withTypeProvider<ZodTypeProvider>()` for Zod schema validation.
- **`withConnection()` decorator**: Check `fastify.hasDecorator("withConnection")` before using.

## Vitest 4

- **`projects` replaces `workspace`**: Root config uses `defineConfig({ test: { projects: [...] } })`. Old `vitest.workspace.ts` is gone.
- **`defineProject` not `defineConfig`**: Workspace member configs must use `defineProject` (avoids duplicate collection).
- **`$lib` alias**: Frontend vitest config needs `resolve.alias: { '$lib': resolve(__dirname, './src/lib') }`.
- **`import.meta.dirname`**: Use instead of `process.cwd()` for paths relative to the test file in a monorepo.
- **Mock hoisting order**: `vi.mock()` hoisted in declaration order. If mock A depends on mock B, declare B first.
- **`vi.hoisted()` for shared state**: `const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }))`.

## RAG Pipeline (OCI GenAI + Oracle 26AI)

The Mastra plugin (`apps/api/src/plugins/mastra.ts`) wires the RAG pipeline:

- **Embedding**: `createOCI().embeddingModel("cohere.embed-english-v3.0")` — 1024 dimensions, 96 texts/batch
- **Vector Storage**: `OracleVectorStore` implements `MastraVector` — `VECTOR(dim, FLOAT32)` + `VECTOR_DISTANCE(..., COSINE)`
- **Semantic Recall**: `semanticRecall: { topK: 3, messageRange: { before: 2, after: 1 }, scope: "resource" }`
- **Search Route**: `GET /api/v1/search` — uses `embed({ model: fastify.ociEmbedder, value: text })` from `ai` package
- **Key pattern**: Use `embed()` from `ai` package — NOT the old custom function signature
