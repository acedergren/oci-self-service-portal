import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

// ── Mock the MCP server (vi.hoisted to survive vi.mock hoisting) ────────

const { mockListTools, mockExecuteTool, mockListResources, mockGetResource } =
  vi.hoisted(() => ({
    mockListTools: vi.fn().mockReturnValue([
      {
        name: "listInstances",
        description: "List compute instances",
        inputSchema: { type: "object" },
      },
      {
        name: "listBuckets",
        description: "List storage buckets",
        inputSchema: { type: "object" },
      },
    ]),
    mockExecuteTool: vi.fn().mockResolvedValue({ instances: [{ id: "i-1" }] }),
    mockListResources: vi.fn().mockReturnValue([
      {
        uri: "portal://sessions",
        name: "Chat Sessions",
        description: "desc",
        mimeType: "application/json",
      },
    ]),
    mockGetResource: vi.fn().mockResolvedValue({
      contents: [
        {
          uri: "portal://sessions",
          mimeType: "application/json",
          text: "{}",
        },
      ],
    }),
  }));

vi.mock("../mastra/mcp/portal-mcp-server.js", () => ({
  PortalMCPServer: class MockPortalMCPServer {
    listTools = mockListTools;
    executeTool = mockExecuteTool;
    listResources = mockListResources;
    getResource = mockGetResource;
  },
}));

import mcpRoutes from "./mcp.js";

// ── Helpers ─────────────────────────────────────────────────────────────

function buildTestApp(opts?: { permissions?: string[] }) {
  const app = Fastify({ logger: false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Stub auth decorators
  app.decorateRequest("user", null);

  const permissions = opts?.permissions ?? ["tools:read", "tools:execute"];

  app.decorate(
    "requirePermission",
    (perm: string) =>
      async (
        request: unknown,
        reply: { code: (n: number) => { send: (b: unknown) => void } },
      ) => {
        if (!permissions.includes(perm)) {
          return reply.code(403).send({ error: "Forbidden" });
        }
      },
  );

  // Inject test user
  app.addHook("onRequest", async (request) => {
    request.user = {
      userId: "user-1",
      orgId: "org-1",
      permissions,
    } as unknown as typeof request.user;
  });

  app.register(mcpRoutes);
  return app;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("MCP Routes", () => {
  let app: ReturnType<typeof buildTestApp>;

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── GET /api/mcp/tools ─────────────────────────────────────────

  describe("GET /api/mcp/tools", () => {
    it("returns the list of MCP tools", async () => {
      app = buildTestApp();
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/api/mcp/tools",
      });

      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body.tools).toHaveLength(2);
      expect(body.tools[0].name).toBe("listInstances");
    });
  });

  // ── POST /api/mcp/tools/:name/execute ──────────────────────────

  describe("POST /api/mcp/tools/:name/execute", () => {
    it("executes a tool and returns the result", async () => {
      app = buildTestApp();
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/tools/listInstances/execute",
        payload: { compartmentId: "ocid1.compartment.test" },
      });

      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body.result).toEqual({ instances: [{ id: "i-1" }] });
      expect(mockExecuteTool).toHaveBeenCalledWith(
        "listInstances",
        { compartmentId: "ocid1.compartment.test" },
        expect.objectContaining({ userId: "user-1", orgId: "org-1" }),
      );
    });

    it("rejects without tools:execute permission", async () => {
      app = buildTestApp({ permissions: ["tools:read"] });
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/tools/listInstances/execute",
        payload: {},
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ── GET /api/mcp/resources ─────────────────────────────────────

  describe("GET /api/mcp/resources", () => {
    it("returns the list of MCP resources", async () => {
      app = buildTestApp();
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/api/mcp/resources",
      });

      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body.resources).toHaveLength(1);
      expect(body.resources[0].uri).toBe("portal://sessions");
    });
  });

  // ── GET /api/mcp/resources/:uri ────────────────────────────────

  describe("GET /api/mcp/resources/:uri", () => {
    it("returns a specific resource by URI", async () => {
      app = buildTestApp();
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: `/api/mcp/resources/${encodeURIComponent("portal://sessions")}`,
      });

      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body.contents).toBeDefined();
      expect(mockGetResource).toHaveBeenCalledWith(
        "portal://sessions",
        expect.objectContaining({ userId: "user-1" }),
      );
    });

    it("returns 404 for unknown resource", async () => {
      const { NotFoundError } = await import("@portal/shared");
      mockGetResource.mockRejectedValueOnce(
        new NotFoundError("Unknown MCP resource", { uri: "portal://nope" }),
      );

      app = buildTestApp();
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: `/api/mcp/resources/${encodeURIComponent("portal://nope")}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
