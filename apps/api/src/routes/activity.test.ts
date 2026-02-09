import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";

const TEST_USER = {
  userId: "user-123",
  orgId: "org-456",
  email: "test@example.com",
  displayName: "Test User",
  userStatus: "active",
};

/** Sample Oracle rows for tool_executions. */
function makeSampleRows() {
  return [
    {
      ID: "exec-1",
      TOOL_CATEGORY: "compute",
      TOOL_NAME: "list-instances",
      ACTION: "executed",
      SUCCESS: 1,
      CREATED_AT: new Date("2026-01-15T10:00:00Z"),
    },
    {
      ID: "exec-2",
      TOOL_CATEGORY: "networking",
      TOOL_NAME: "list-vcns",
      ACTION: "requested",
      SUCCESS: null,
      CREATED_AT: new Date("2026-01-15T09:00:00Z"),
    },
    {
      ID: "exec-3",
      TOOL_CATEGORY: "storage",
      TOOL_NAME: "list-buckets",
      ACTION: "completed",
      SUCCESS: 0,
      CREATED_AT: new Date("2026-01-15T08:00:00Z"),
    },
  ];
}

/** Decorate app with a mock withConnection that returns activity rows. */
function mockOracleForActivity(
  app: FastifyInstance,
  rows: ReturnType<typeof makeSampleRows> = [],
) {
  const mockWithConnection = vi.fn(async (fn) => {
    const mockConn = {
      execute: vi.fn(async (sql: string) => {
        if (sql.includes("COUNT(*)")) {
          return { rows: [{ CNT: rows.length }] };
        }
        return { rows };
      }),
      close: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
    };
    return fn(mockConn);
  });

  if (!app.hasDecorator("withConnection")) {
    app.decorate("withConnection", mockWithConnection);
  }
}

describe("Activity Routes", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("returns empty list when no activity exists", async () => {
    app = buildApp({ skipAuth: true, testUser: TEST_USER });
    mockOracleForActivity(app, []);
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/activity",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("returns activity items with correct status mapping", async () => {
    app = buildApp({ skipAuth: true, testUser: TEST_USER });
    const rows = makeSampleRows();
    mockOracleForActivity(app, rows);
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/activity",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(3);

    // exec-1: executed + success=1 → completed
    expect(body.items[0]).toEqual({
      id: "exec-1",
      type: "compute",
      action: "list-instances (executed)",
      time: "2026-01-15T10:00:00.000Z",
      status: "completed",
    });

    // exec-2: requested → pending
    expect(body.items[1]).toEqual({
      id: "exec-2",
      type: "networking",
      action: "list-vcns (requested)",
      time: "2026-01-15T09:00:00.000Z",
      status: "pending",
    });

    // exec-3: completed + success=0 → failed
    expect(body.items[2]).toEqual({
      id: "exec-3",
      type: "storage",
      action: "list-buckets (completed)",
      time: "2026-01-15T08:00:00.000Z",
      status: "failed",
    });
  });

  it("respects limit and offset query params", async () => {
    app = buildApp({ skipAuth: true, testUser: TEST_USER });
    mockOracleForActivity(app, makeSampleRows());
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/activity?limit=2&offset=1",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(3);
  });

  it("returns empty when database is not available", async () => {
    app = buildApp({ skipAuth: true, testUser: TEST_USER });
    // Don't register withConnection — simulates DB unavailable
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/activity",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.message).toBe("Database not available");
  });

  it("returns 500 when database query fails", async () => {
    app = buildApp({ skipAuth: true, testUser: TEST_USER });
    const failingWithConnection = vi.fn(async () => {
      throw new Error("Connection pool exhausted");
    });
    if (!app.hasDecorator("withConnection")) {
      app.decorate("withConnection", failingWithConnection);
    }
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/activity",
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error).toBe("Failed to retrieve activity");
  });

  it("handles null SUCCESS as success (default true)", async () => {
    app = buildApp({ skipAuth: true, testUser: TEST_USER });
    mockOracleForActivity(app, [
      {
        ID: "exec-4",
        TOOL_CATEGORY: "iam",
        TOOL_NAME: "list-policies",
        ACTION: "completed",
        SUCCESS: null,
        CREATED_AT: new Date("2026-01-15T07:00:00Z"),
      },
    ]);
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/activity",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items[0].status).toBe("completed");
  });
});
