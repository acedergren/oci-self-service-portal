import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";

/** Default test user injected via buildApp({ testUser }). */
const TEST_USER = {
  userId: "user-123",
  orgId: "org-456",
  email: "test@example.com",
  displayName: "Test User",
  userStatus: "active",
};

/** Mock Oracle decorators for testing sessions routes. */
function mockOracleForSessions(app: FastifyInstance) {
  let mockSessions: Array<{
    ID: string;
    USER_ID: string;
    ORG_ID: string | null;
    TITLE: string | null;
    MODEL: string;
    REGION: string;
    STATUS: string;
    CREATED_AT: Date;
    UPDATED_AT: Date;
    MESSAGE_COUNT: number;
    LAST_MESSAGE: string | null;
  }> = [];

  const mockWithConnection = vi.fn(async (fn) => {
    const mockConn = {
      execute: vi.fn(async (sql: string, binds: Record<string, unknown>) => {
        // Handle SELECT with enrichment (list sessions) — check BEFORE COUNT
        // because enriched SQL also contains COUNT(*) in its subquery.
        if (sql.includes("LEFT JOIN") && sql.includes("chat_turns")) {
          const userId = binds.userId as string;
          const offset = (binds.offset as number) ?? 0;
          const maxRows = (binds.maxRows as number) ?? 50;

          let filtered = mockSessions.filter((s) => s.USER_ID === userId);

          // Handle search filter
          if (binds.search) {
            const searchTerm = (binds.search as string)
              .replace(/%/g, "")
              .toLowerCase();
            filtered = filtered.filter((s) =>
              s.TITLE?.toLowerCase().includes(searchTerm),
            );
          }

          const paginated = filtered.slice(offset, offset + maxRows);
          return { rows: paginated };
        }

        // Handle COUNT query (must be AFTER enriched query check above)
        if (sql.includes("COUNT(*)")) {
          const userId = binds.userId as string;
          const filtered = mockSessions.filter((s) => s.USER_ID === userId);
          return { rows: [{ CNT: filtered.length }] };
        }

        // Handle INSERT
        if (sql.includes("INSERT INTO chat_sessions")) {
          const newSession = {
            ID: binds.id as string,
            USER_ID: binds.userId as string,
            ORG_ID: (binds.orgId as string | null) ?? null,
            TITLE: (binds.title as string | null) ?? null,
            MODEL: binds.model as string,
            REGION: binds.region as string,
            STATUS: "active",
            CREATED_AT: new Date(),
            UPDATED_AT: new Date(),
            MESSAGE_COUNT: 0,
            LAST_MESSAGE: null,
          };
          mockSessions.push(newSession);
          return { rowsAffected: 1 };
        }

        // Handle SELECT single session (after create)
        if (sql.includes("WHERE s.id = :id")) {
          const session = mockSessions.find((s) => s.ID === binds.id);
          return { rows: session ? [session] : [] };
        }

        // Handle DELETE
        if (sql.includes("DELETE FROM chat_sessions")) {
          const index = mockSessions.findIndex(
            (s) => s.ID === binds.id && s.USER_ID === binds.userId,
          );
          if (index !== -1) {
            mockSessions.splice(index, 1);
            return { rowsAffected: 1 };
          }
          return { rowsAffected: 0 };
        }

        return { rows: [] };
      }),
      close: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
    };
    return await fn(mockConn);
  });

  app.decorate("withConnection", mockWithConnection);

  // Reset helper for tests
  return {
    reset: () => {
      mockSessions = [];
    },
    addSession: (session: (typeof mockSessions)[0]) => {
      mockSessions.push(session);
    },
  };
}

describe("Sessions Routes", () => {
  let app: FastifyInstance;
  let sessionHelpers: ReturnType<typeof mockOracleForSessions>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp({ skipAuth: true, testUser: TEST_USER });

    // Mock Oracle decorators (RBAC decorators already stubbed by skipAuth)
    sessionHelpers = mockOracleForSessions(app);

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe("GET /api/sessions", () => {
    it("returns empty list when user has no sessions", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/sessions",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.sessions).toEqual([]);
      expect(body.total).toBe(0);
    });

    it("returns user's sessions with pagination", async () => {
      // Add test sessions
      sessionHelpers.addSession({
        ID: "session-1",
        USER_ID: "user-123",
        ORG_ID: "org-456",
        TITLE: "First Session",
        MODEL: "llama3",
        REGION: "eu-frankfurt-1",
        STATUS: "active",
        CREATED_AT: new Date("2024-01-01"),
        UPDATED_AT: new Date("2024-01-02"),
        MESSAGE_COUNT: 5,
        LAST_MESSAGE: "Hello world",
      });

      sessionHelpers.addSession({
        ID: "session-2",
        USER_ID: "user-123",
        ORG_ID: "org-456",
        TITLE: "Second Session",
        MODEL: "llama3",
        REGION: "us-ashburn-1",
        STATUS: "active",
        CREATED_AT: new Date("2024-01-03"),
        UPDATED_AT: new Date("2024-01-04"),
        MESSAGE_COUNT: 10,
        LAST_MESSAGE: "Goodbye",
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/sessions?limit=10&offset=0",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.sessions).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.sessions[0].id).toBe("session-1");
      expect(body.sessions[0].messageCount).toBe(5);
      expect(body.sessions[1].id).toBe("session-2");
    });

    it("filters sessions by search term", async () => {
      sessionHelpers.addSession({
        ID: "session-1",
        USER_ID: "user-123",
        ORG_ID: null,
        TITLE: "Budget Planning",
        MODEL: "llama3",
        REGION: "eu-frankfurt-1",
        STATUS: "active",
        CREATED_AT: new Date(),
        UPDATED_AT: new Date(),
        MESSAGE_COUNT: 0,
        LAST_MESSAGE: null,
      });

      sessionHelpers.addSession({
        ID: "session-2",
        USER_ID: "user-123",
        ORG_ID: null,
        TITLE: "Code Review",
        MODEL: "llama3",
        REGION: "eu-frankfurt-1",
        STATUS: "active",
        CREATED_AT: new Date(),
        UPDATED_AT: new Date(),
        MESSAGE_COUNT: 0,
        LAST_MESSAGE: null,
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/sessions?search=budget",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].title).toBe("Budget Planning");
    });

    it("applies pagination correctly", async () => {
      // Add 3 sessions
      for (let i = 1; i <= 3; i++) {
        sessionHelpers.addSession({
          ID: `session-${i}`,
          USER_ID: "user-123",
          ORG_ID: null,
          TITLE: `Session ${i}`,
          MODEL: "llama3",
          REGION: "eu-frankfurt-1",
          STATUS: "active",
          CREATED_AT: new Date(),
          UPDATED_AT: new Date(),
          MESSAGE_COUNT: 0,
          LAST_MESSAGE: null,
        });
      }

      // Get first page (limit 2)
      const page1 = await app.inject({
        method: "GET",
        url: "/api/sessions?limit=2&offset=0",
      });

      expect(page1.statusCode).toBe(200);
      const body1 = page1.json();
      expect(body1.sessions).toHaveLength(2);
      expect(body1.total).toBe(3);

      // Get second page
      const page2 = await app.inject({
        method: "GET",
        url: "/api/sessions?limit=2&offset=2",
      });

      expect(page2.statusCode).toBe(200);
      const body2 = page2.json();
      expect(body2.sessions).toHaveLength(1);
      expect(body2.total).toBe(3);
    });
  });

  describe("POST /api/sessions", () => {
    it("creates a new session", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: {
          title: "New Session",
          model: "llama3",
          region: "us-ashburn-1",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeDefined();
      expect(body.title).toBe("New Session");
      expect(body.model).toBe("llama3");
      expect(body.region).toBe("us-ashburn-1");
      expect(body.status).toBe("active");
      expect(body.messageCount).toBe(0);
    });

    it("creates session with defaults when optional fields omitted", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.model).toBe("default");
      expect(body.region).toBe("eu-frankfurt-1");
      expect(body.title).toBeNull();
    });
  });

  describe("DELETE /api/sessions/:id", () => {
    it("deletes a session owned by the user", async () => {
      const deleteId = "a0000000-0000-4000-8000-000000000001";
      sessionHelpers.addSession({
        ID: deleteId,
        USER_ID: "user-123",
        ORG_ID: null,
        TITLE: "Delete Me",
        MODEL: "llama3",
        REGION: "eu-frankfurt-1",
        STATUS: "active",
        CREATED_AT: new Date(),
        UPDATED_AT: new Date(),
        MESSAGE_COUNT: 0,
        LAST_MESSAGE: null,
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/api/sessions/${deleteId}`,
      });

      expect(response.statusCode).toBe(204);
    });

    it("returns 404 when session does not exist", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/sessions/b0000000-0000-4000-8000-000000000002",
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 404 when trying to delete another user's session (IDOR protection)", async () => {
      const otherSessionId = "c0000000-0000-4000-8000-000000000003";
      sessionHelpers.addSession({
        ID: otherSessionId,
        USER_ID: "other-user-999",
        ORG_ID: null,
        TITLE: "Not Yours",
        MODEL: "llama3",
        REGION: "eu-frankfurt-1",
        STATUS: "active",
        CREATED_AT: new Date(),
        UPDATED_AT: new Date(),
        MESSAGE_COUNT: 0,
        LAST_MESSAGE: null,
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/api/sessions/${otherSessionId}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
