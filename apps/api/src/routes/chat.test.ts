import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

// ── Mock modules ────────────────────────────────────────────────────────

vi.mock("../mastra/agents/cloud-advisor.js", () => ({
  FALLBACK_MODEL_ALLOWLIST: [
    "google.gemini-2.5-flash",
    "cohere.command-r-plus",
    "meta.llama-3.3-70b",
  ],
  DEFAULT_MODEL: "google.gemini-2.5-flash",
}));

vi.mock("../mastra/models/index.js", () => ({
  getProviderRegistry: vi.fn().mockResolvedValue({}),
  getEnabledModelIds: vi.fn().mockResolvedValue([]),
}));

// ── Import after mocks ─────────────────────────────────────────────────

import chatRoutes from "./chat.js";
import { getEnabledModelIds } from "../mastra/models/index.js";

const mockedGetEnabledModelIds = vi.mocked(getEnabledModelIds);

// ── Helpers ─────────────────────────────────────────────────────────────

function buildTestApp() {
  const app = Fastify({ logger: false });

  // Zod type provider (required for schema validation)
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Stub auth decorators
  app.decorateRequest("user", null);
  app.decorate("requirePermission", () => async () => {});

  // Stub mastra
  const mockStream = {
    textStream: {
      getReader: () => ({
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: "Hello" })
          .mockResolvedValueOnce({ done: false, value: " world" })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: vi.fn(),
      }),
    },
  };

  const mockAgent = {
    stream: vi.fn().mockResolvedValue(mockStream),
  };

  app.decorate("mastra", {
    getAgent: vi.fn().mockReturnValue(mockAgent),
  });

  // Inject test user
  app.addHook("onRequest", async (request) => {
    request.user = {
      userId: "test-user",
      orgId: "test-org",
      email: "test@example.com",
      role: "admin",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  });

  app.register(chatRoutes);
  return { app, mockAgent };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no DB models → use fallback
    mockedGetEnabledModelIds.mockResolvedValue([]);
  });

  it("returns 400 for empty messages array", async () => {
    const { app } = buildTestApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { messages: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing messages", async () => {
    const { app } = buildTestApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("streams SSE response with text chunks", async () => {
    const { app } = buildTestApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {
        messages: [{ role: "user", content: "Hello" }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.body).toContain('data: {"text":"Hello"}');
    expect(res.body).toContain('data: {"text":" world"}');
    expect(res.body).toContain("data: [DONE]");
  });

  it("uses fallback model when no DB providers", async () => {
    const { app, mockAgent } = buildTestApp();
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {
        messages: [{ role: "user", content: "Test" }],
      },
    });

    // Agent.stream should be called (model validated)
    expect(mockAgent.stream).toHaveBeenCalledOnce();
  });

  it("passes threadId to agent memory options", async () => {
    const { app, mockAgent } = buildTestApp();
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {
        messages: [{ role: "user", content: "Test" }],
        threadId: "550e8400-e29b-41d4-a716-446655440000",
      },
    });

    const streamCall = mockAgent.stream.mock.calls[0];
    const options = streamCall[1];
    expect(options.memory.thread).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("generates threadId when not provided", async () => {
    const { app, mockAgent } = buildTestApp();
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {
        messages: [{ role: "user", content: "Test" }],
      },
    });

    const options = mockAgent.stream.mock.calls[0][1];
    expect(options.memory.thread).toBeDefined();
    // Should be a valid UUID format
    expect(options.memory.thread).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("uses userId from request context", async () => {
    const { app, mockAgent } = buildTestApp();
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {
        messages: [{ role: "user", content: "Test" }],
      },
    });

    const options = mockAgent.stream.mock.calls[0][1];
    expect(options.memory.resource).toBe("test-user");
  });

  it("rejects invalid threadId format", async () => {
    const { app } = buildTestApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {
        messages: [{ role: "user", content: "Test" }],
        threadId: "not-a-uuid",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("limits messages to 100", async () => {
    const { app } = buildTestApp();
    await app.ready();

    const messages = Array.from({ length: 101 }, (_, i) => ({
      role: "user",
      content: `Message ${i}`,
    }));

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { messages },
    });

    expect(res.statusCode).toBe(400);
  });

  it("sets maxSteps to 5", async () => {
    const { app, mockAgent } = buildTestApp();
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {
        messages: [{ role: "user", content: "Test" }],
      },
    });

    const options = mockAgent.stream.mock.calls[0][1];
    expect(options.maxSteps).toBe(5);
  });
});
