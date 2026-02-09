import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../../app.js";
import type { FastifyInstance } from "fastify";
import {
  registerToolHandlers,
  _resetToolHandlers,
} from "../../services/tools.js";
import { recordApproval, _resetApprovals } from "../../services/approvals.js";

const TEST_USER = {
  userId: "user-123",
  orgId: "org-456",
  email: "test@example.com",
  displayName: "Test User",
  userStatus: "active" as const,
};

const MOCK_TOOLS = {
  "list-instances": {
    name: "list-instances",
    category: "compute",
    description: "List compute instances",
    approvalLevel: "none" as const,
  },
  "terminate-instance": {
    name: "terminate-instance",
    category: "compute",
    description: "Terminate a compute instance",
    approvalLevel: "confirm" as const,
  },
};

describe("Tool Execute Routes", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetToolHandlers();
    _resetApprovals();

    registerToolHandlers({
      execute: vi.fn(async (toolName) => ({
        result: `executed ${toolName}`,
      })),
      getDefinition: (name) =>
        MOCK_TOOLS[name as keyof typeof MOCK_TOOLS] ?? undefined,
      getWarning: (name) =>
        name === "terminate-instance"
          ? { warning: "This will terminate the instance", impact: "high" }
          : undefined,
    });
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    _resetToolHandlers();
    _resetApprovals();
  });

  describe("GET /api/tools/execute", () => {
    it("returns tool info for known tool", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/api/tools/execute?toolName=list-instances",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.toolName).toBe("list-instances");
      expect(body.category).toBe("compute");
      expect(body.approvalLevel).toBe("none");
      expect(body.requiresApproval).toBe(false);
      expect(body.description).toBe("List compute instances");
    });

    it("returns warning for dangerous tool", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/api/tools/execute?toolName=terminate-instance",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.requiresApproval).toBe(true);
      expect(body.warning).toBe("This will terminate the instance");
      expect(body.impact).toBe("high");
    });

    it("returns 404 for unknown tool", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/api/tools/execute?toolName=nonexistent",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
    });
  });

  describe("POST /api/tools/execute", () => {
    it("executes tool that does not require approval", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/execute",
        payload: {
          toolCallId: "call-1",
          toolName: "list-instances",
          args: { compartmentId: "ocid1.compartment.123" },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.toolCallId).toBe("call-1");
      expect(body.toolName).toBe("list-instances");
      expect(body.data).toEqual({ result: "executed list-instances" });
      expect(body.duration).toBeGreaterThanOrEqual(0);
      expect(body.approvalLevel).toBe("none");
    });

    it("rejects tool requiring approval without approval token", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/execute",
        payload: {
          toolCallId: "call-2",
          toolName: "terminate-instance",
          args: { instanceId: "ocid1.instance.123" },
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("APPROVAL_REQUIRED");
    });

    it("executes tool with valid approval token", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      // Record approval first
      await recordApproval("call-3", "terminate-instance");

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/execute",
        payload: {
          toolCallId: "call-3",
          toolName: "terminate-instance",
          args: { instanceId: "ocid1.instance.123" },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it("rejects reuse of consumed approval token (single-use)", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      await recordApproval("call-4", "terminate-instance");

      // First use: succeeds
      const res1 = await app.inject({
        method: "POST",
        url: "/api/tools/execute",
        payload: {
          toolCallId: "call-4",
          toolName: "terminate-instance",
          args: { instanceId: "ocid1.instance.123" },
        },
      });
      expect(res1.statusCode).toBe(200);

      // Second use: rejected (token consumed)
      const res2 = await app.inject({
        method: "POST",
        url: "/api/tools/execute",
        payload: {
          toolCallId: "call-4",
          toolName: "terminate-instance",
          args: { instanceId: "ocid1.instance.123" },
        },
      });
      expect(res2.statusCode).toBe(403);
    });

    it("returns 404 for unknown tool", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/execute",
        payload: {
          toolCallId: "call-5",
          toolName: "nonexistent",
          args: {},
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 500 when tool execution fails", async () => {
      _resetToolHandlers();
      registerToolHandlers({
        execute: vi.fn(async () => {
          throw new Error("OCI CLI command failed");
        }),
        getDefinition: (name) =>
          MOCK_TOOLS[name as keyof typeof MOCK_TOOLS] ?? undefined,
      });

      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/execute",
        payload: {
          toolCallId: "call-6",
          toolName: "list-instances",
          args: {},
        },
      });

      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe("Tool execution failed");
    });
  });
});
