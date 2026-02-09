import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../../app.js";
import type { FastifyInstance } from "fastify";
import {
  registerToolHandlers,
  _resetToolHandlers,
} from "../../services/tools.js";
import {
  addPendingApproval,
  pendingApprovals,
  _resetApprovals,
} from "../../services/approvals.js";

const TEST_USER = {
  userId: "user-123",
  orgId: "org-456",
  email: "test@example.com",
  displayName: "Test User",
  userStatus: "active" as const,
};

describe("Tool Approve Routes", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetToolHandlers();
    _resetApprovals();

    registerToolHandlers({
      execute: vi.fn(),
      getDefinition: (name) =>
        name === "terminate-instance"
          ? {
              name: "terminate-instance",
              category: "compute",
              description: "Terminate a compute instance",
              approvalLevel: "confirm" as const,
            }
          : undefined,
    });
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    _resetToolHandlers();
    _resetApprovals();
  });

  describe("GET /api/tools/approve", () => {
    it("returns empty list when no approvals pending", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/api/tools/approve",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pending).toEqual([]);
      expect(body.count).toBe(0);
    });

    it("returns pending approvals with metadata", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      addPendingApproval(
        "call-10",
        "terminate-instance",
        { instanceId: "ocid1.instance.123" },
        "session-1",
        vi.fn(),
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/tools/approve",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(1);
      expect(body.pending[0].toolCallId).toBe("call-10");
      expect(body.pending[0].toolName).toBe("terminate-instance");
      expect(body.pending[0].sessionId).toBe("session-1");
      expect(body.pending[0].createdAt).toBeDefined();
      expect(body.pending[0].age).toBeGreaterThanOrEqual(0);
    });
  });

  describe("POST /api/tools/approve", () => {
    it("approves a pending tool call", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      const resolveFn = vi.fn();
      addPendingApproval(
        "call-20",
        "terminate-instance",
        { instanceId: "ocid1.instance.123" },
        undefined,
        resolveFn,
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/approve",
        payload: {
          toolCallId: "call-20",
          approved: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.approved).toBe(true);
      expect(body.toolCallId).toBe("call-20");
      expect(body.message).toBe("Tool execution approved");
      expect(resolveFn).toHaveBeenCalledWith(true);
      expect(pendingApprovals.has("call-20")).toBe(false);
    });

    it("rejects a pending tool call", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      const resolveFn = vi.fn();
      addPendingApproval(
        "call-21",
        "terminate-instance",
        { instanceId: "ocid1.instance.123" },
        undefined,
        resolveFn,
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/approve",
        payload: {
          toolCallId: "call-21",
          approved: false,
          reason: "Too risky",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.approved).toBe(false);
      expect(body.message).toBe("Tool execution rejected");
      expect(resolveFn).toHaveBeenCalledWith(false);
    });

    it("returns 404 for unknown tool call", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/approve",
        payload: {
          toolCallId: "nonexistent",
          approved: true,
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
    });

    it("removes pending approval after processing", async () => {
      app = buildApp({ skipAuth: true, testUser: TEST_USER });
      await app.ready();

      addPendingApproval(
        "call-22",
        "terminate-instance",
        {},
        undefined,
        vi.fn(),
      );

      expect(pendingApprovals.size).toBe(1);

      await app.inject({
        method: "POST",
        url: "/api/tools/approve",
        payload: {
          toolCallId: "call-22",
          approved: true,
        },
      });

      expect(pendingApprovals.size).toBe(0);
    });
  });
});
