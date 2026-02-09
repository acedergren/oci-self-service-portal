import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";

// ── Mock repositories ─────────────────────────────────────────────────

const mockWorkflowRepo = {
  list: vi.fn(),
  count: vi.fn().mockResolvedValue(0),
  create: vi.fn(),
  getByIdForUser: vi.fn(),
  getByIdForOrg: vi.fn(),
  updateForUser: vi.fn(),
  delete: vi.fn(),
};

const mockRunRepo = {
  create: vi.fn(),
  getByIdForUser: vi.fn(),
  getByIdForOrg: vi.fn(),
  updateStatus: vi.fn(),
};

const mockStepRepo = {
  listByRun: vi.fn(),
};

vi.mock("../services/workflow-repository.js", () => ({
  createWorkflowRepository: vi.fn(() => mockWorkflowRepo),
  createWorkflowRunRepository: vi.fn(() => mockRunRepo),
  createWorkflowRunStepRepository: vi.fn(() => mockStepRepo),
}));

// ── Mock executor ─────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockResume = vi.fn();

vi.mock("../mastra/workflows/executor.js", () => ({
  WorkflowExecutor: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
  ) {
    this.execute = mockExecute;
    this.resume = mockResume;
  }),
}));

// ── Constants ─────────────────────────────────────────────────────────

const TEST_USER = {
  userId: "user-123",
  orgId: "org-456",
  email: "test@example.com",
  displayName: "Test User",
  userStatus: "active" as const,
};

const WORKFLOW_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const RUN_ID = "f1e2d3c4-b5a6-7890-dcba-fe0987654321";

const MOCK_DEFINITION = {
  id: WORKFLOW_ID,
  name: "Test Workflow",
  description: "A test workflow",
  status: "published",
  version: 1,
  tags: ["test"],
  nodes: [
    { id: "n1", type: "input", position: { x: 0, y: 0 }, data: {} },
    { id: "n2", type: "output", position: { x: 200, y: 0 }, data: {} },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const MOCK_RUN = {
  id: RUN_ID,
  definitionId: WORKFLOW_ID,
  workflowVersion: 1,
  status: "completed",
  input: { key: "value" },
  output: { result: "ok" },
  error: null,
  startedAt: new Date("2026-01-01T10:00:00Z"),
  completedAt: new Date("2026-01-01T10:00:05Z"),
  engineState: null,
};

// ── Test suite ────────────────────────────────────────────────────────

describe("Workflow Routes", () => {
  let app: FastifyInstance;

  function createApp() {
    app = buildApp({ skipAuth: true, testUser: TEST_USER, logger: false });
    // Stub withConnection so getRepos() doesn't throw
    if (!app.hasDecorator("withConnection")) {
      app.decorate("withConnection", vi.fn());
    }
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── GET /api/v1/workflows ─────────────────────────────────────────

  describe("GET /api/v1/workflows", () => {
    it("lists workflows for the org", async () => {
      mockWorkflowRepo.list.mockResolvedValue([MOCK_DEFINITION]);
      mockWorkflowRepo.count.mockResolvedValue(1);
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/workflows",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.workflows).toHaveLength(1);
      expect(body.workflows[0].id).toBe(WORKFLOW_ID);
      expect(body.workflows[0].name).toBe("Test Workflow");
      expect(body.workflows[0].nodeCount).toBe(2);
      expect(body.workflows[0].edgeCount).toBe(1);
      expect(body.total).toBe(1);
    });

    it("passes query params to repository", async () => {
      mockWorkflowRepo.list.mockResolvedValue([]);
      mockWorkflowRepo.count.mockResolvedValue(0);
      createApp();
      await app.ready();

      await app.inject({
        method: "GET",
        url: "/api/v1/workflows?limit=10&offset=5&status=published&search=test",
      });

      expect(mockWorkflowRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: "org-456",
          userId: "user-123",
          limit: 10,
          offset: 5,
          status: "published",
          search: "test",
        }),
      );
    });
  });

  // ── POST /api/v1/workflows ────────────────────────────────────────

  describe("POST /api/v1/workflows", () => {
    it("creates a workflow and returns 201", async () => {
      mockWorkflowRepo.create.mockResolvedValue(MOCK_DEFINITION);
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/workflows",
        payload: {
          name: "New Workflow",
          nodes: [{ id: "n1", type: "input" }],
          edges: [],
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().workflow).toBeDefined();
      expect(mockWorkflowRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "New Workflow",
          orgId: "org-456",
          userId: "user-123",
        }),
      );
    });

    it("rejects invalid body (missing name)", async () => {
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/workflows",
        payload: { nodes: [], edges: [] },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  // ── GET /api/v1/workflows/:id ─────────────────────────────────────

  describe("GET /api/v1/workflows/:id", () => {
    it("returns workflow detail", async () => {
      mockWorkflowRepo.getByIdForUser.mockResolvedValue(MOCK_DEFINITION);
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/workflows/${WORKFLOW_ID}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().workflow.id).toBe(WORKFLOW_ID);
    });

    it("returns 404 for missing workflow", async () => {
      mockWorkflowRepo.getByIdForUser.mockResolvedValue(null);
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/workflows/${WORKFLOW_ID}`,
      });

      expect(res.statusCode).toBe(404);
    });

    it("rejects non-UUID param", async () => {
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/workflows/not-a-uuid",
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  // ── PUT /api/v1/workflows/:id ─────────────────────────────────────

  describe("PUT /api/v1/workflows/:id", () => {
    it("updates workflow and returns result", async () => {
      const updated = { ...MOCK_DEFINITION, name: "Updated" };
      mockWorkflowRepo.updateForUser.mockResolvedValue(updated);
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/workflows/${WORKFLOW_ID}`,
        payload: { name: "Updated" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().workflow.name).toBe("Updated");
    });

    it("returns 404 when workflow not found", async () => {
      mockWorkflowRepo.updateForUser.mockResolvedValue(null);
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/workflows/${WORKFLOW_ID}`,
        payload: { name: "Updated" },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /api/v1/workflows/:id ──────────────────────────────────

  describe("DELETE /api/v1/workflows/:id", () => {
    it("deletes workflow and returns 204", async () => {
      mockWorkflowRepo.delete.mockResolvedValue(true);
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/workflows/${WORKFLOW_ID}`,
      });

      expect(res.statusCode).toBe(204);
    });

    it("returns 404 for missing workflow", async () => {
      mockWorkflowRepo.delete.mockResolvedValue(false);
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/workflows/${WORKFLOW_ID}`,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /api/v1/workflows/:id/run ────────────────────────────────

  describe("POST /api/v1/workflows/:id/run", () => {
    it("executes workflow and returns 201 with result", async () => {
      mockWorkflowRepo.getByIdForUser.mockResolvedValue(MOCK_DEFINITION);
      mockRunRepo.create.mockResolvedValue({ id: RUN_ID });
      mockRunRepo.updateStatus.mockResolvedValue(undefined);
      mockExecute.mockResolvedValue({
        status: "completed",
        output: { result: "done" },
        stepResults: {},
      });
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${WORKFLOW_ID}/run`,
        payload: { input: { key: "value" } },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.status).toBe("completed");
      expect(body.workflowId).toBe(WORKFLOW_ID);
      expect(body.output).toEqual({ result: "done" });
    });

    it("returns 404 when workflow not found", async () => {
      mockWorkflowRepo.getByIdForUser.mockResolvedValue(null);
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${WORKFLOW_ID}/run`,
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });

    it("rejects archived workflow execution", async () => {
      mockWorkflowRepo.getByIdForUser.mockResolvedValue({
        ...MOCK_DEFINITION,
        status: "archived",
      });
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${WORKFLOW_ID}/run`,
        payload: {},
      });

      // ValidationError → 400 via error handler
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("handles suspended workflow", async () => {
      mockWorkflowRepo.getByIdForUser.mockResolvedValue(MOCK_DEFINITION);
      mockRunRepo.create.mockResolvedValue({ id: RUN_ID });
      mockRunRepo.updateStatus.mockResolvedValue(undefined);
      mockExecute.mockResolvedValue({
        status: "suspended",
        stepResults: { n1: {} },
        engineState: {
          suspendedAtNodeId: "n2",
          completedNodeIds: ["n1"],
          stepResults: { n1: {} },
        },
      });
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${WORKFLOW_ID}/run`,
        payload: {},
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().status).toBe("suspended");
    });
  });

  // ── GET /api/v1/workflows/:id/runs/:runId ─────────────────────────

  describe("GET /api/v1/workflows/:id/runs/:runId", () => {
    it("returns run detail with steps", async () => {
      mockRunRepo.getByIdForUser.mockResolvedValue(MOCK_RUN);
      mockStepRepo.listByRun.mockResolvedValue([
        {
          nodeId: "n1",
          nodeType: "input",
          status: "completed",
          output: {},
          error: null,
          startedAt: new Date("2026-01-01T10:00:00Z"),
          completedAt: new Date("2026-01-01T10:00:01Z"),
          durationMs: 1000,
        },
      ]);
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/workflows/${WORKFLOW_ID}/runs/${RUN_ID}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(RUN_ID);
      expect(body.workflowId).toBe(WORKFLOW_ID);
      expect(body.steps).toHaveLength(1);
      expect(body.steps[0].nodeId).toBe("n1");
    });

    it("returns 404 when run not found", async () => {
      mockRunRepo.getByIdForUser.mockResolvedValue(null);
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/workflows/${WORKFLOW_ID}/runs/${RUN_ID}`,
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 404 when run belongs to different workflow (IDOR)", async () => {
      const wrongWorkflowRun = {
        ...MOCK_RUN,
        definitionId: "00000000-0000-0000-0000-000000000000",
      };
      mockRunRepo.getByIdForUser.mockResolvedValue(wrongWorkflowRun);
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/workflows/${WORKFLOW_ID}/runs/${RUN_ID}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("not found for this workflow");
    });
  });

  // ── POST /api/v1/workflows/:id/runs/:runId/approve ────────────────

  describe("POST /api/v1/workflows/:id/runs/:runId/approve", () => {
    const SUSPENDED_RUN = {
      ...MOCK_RUN,
      status: "suspended",
      engineState: {
        suspendedAtNodeId: "n2",
        completedNodeIds: ["n1"],
        stepResults: { n1: {} },
      },
    };

    it("resumes suspended workflow", async () => {
      mockRunRepo.getByIdForUser.mockResolvedValue(SUSPENDED_RUN);
      mockWorkflowRepo.getByIdForUser.mockResolvedValue(MOCK_DEFINITION);
      mockRunRepo.updateStatus.mockResolvedValue(undefined);
      mockResume.mockResolvedValue({
        status: "completed",
        output: { result: "approved" },
      });
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${WORKFLOW_ID}/runs/${RUN_ID}/approve`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().run.status).toBe("completed");
    });

    it("rejects non-suspended run", async () => {
      mockRunRepo.getByIdForUser.mockResolvedValue({
        ...MOCK_RUN,
        status: "completed",
      });
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${WORKFLOW_ID}/runs/${RUN_ID}/approve`,
      });

      // ValidationError → 400
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("rejects run with no engine state", async () => {
      mockRunRepo.getByIdForUser.mockResolvedValue({
        ...MOCK_RUN,
        status: "suspended",
        engineState: null,
      });
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${WORKFLOW_ID}/runs/${RUN_ID}/approve`,
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("returns 404 when run belongs to different workflow (IDOR)", async () => {
      const wrongRun = {
        ...SUSPENDED_RUN,
        definitionId: "00000000-0000-0000-0000-000000000000",
      };
      mockRunRepo.getByIdForUser.mockResolvedValue(wrongRun);
      createApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${WORKFLOW_ID}/runs/${RUN_ID}/approve`,
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  // ── Auth: unauthenticated requests ────────────────────────────────

  describe("authentication", () => {
    it("returns 401 for unauthenticated request", async () => {
      app = buildApp({ skipAuth: true, logger: false }); // no testUser
      if (!app.hasDecorator("withConnection")) {
        app.decorate("withConnection", vi.fn());
      }
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/workflows",
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
