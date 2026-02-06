/**
 * Phase 5 TDD: Activity API Endpoint (GET /api/activity)
 *
 * Returns recent user activity (tool executions, chat messages) from the
 * tool_executions table, filtered by userId.
 *
 * Uses the ActivityItem type from the architect's types.ts:
 *   { id: string; type: string; action: string; time: string;
 *     status: 'completed' | 'pending' | 'failed' }
 *
 * Backend implementation notes (Task #5):
 *   - Response uses `items` (not `activities`)
 *   - No 401 for unauthenticated — returns { items: [], total: 0 }
 *   - COUNT query first, then data query
 *   - No offset/limit echoed in response
 *
 * Expected route: GET /api/activity
 * Expected query params:
 *   - offset (number, default 0)
 *   - limit  (number, default 20, max 100)
 *
 * Expected response shape:
 *   { items: ActivityItem[], total: number }
 *
 * Expected module: src/routes/api/activity/+server.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
const mockConn = {
	execute: mockExecute,
	commit: vi.fn().mockResolvedValue(undefined),
	rollback: vi.fn().mockResolvedValue(undefined),
	close: vi.fn().mockResolvedValue(undefined)
};

vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) => fn(mockConn))
}));

vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

vi.mock('$lib/server/auth/rbac.js', () => ({
	requirePermission: vi.fn()
}));

// ── Helpers ────────────────────────────────────────────────────────────────

type Locals = {
	user: { id: string };
	permissions: string[];
	dbAvailable: boolean;
};

function makeRequestEvent(options: {
	searchParams?: Record<string, string>;
	locals?: Partial<Locals>;
}) {
	const url = new URL('http://localhost/api/activity');
	if (options.searchParams) {
		for (const [key, value] of Object.entries(options.searchParams)) {
			url.searchParams.set(key, value);
		}
	}

	const locals: Locals = {
		user: { id: 'test-user-123' },
		permissions: ['activity:read'],
		dbAvailable: true,
		...options.locals
	};

	return { url, locals };
}

// ── Module import ──────────────────────────────────────────────────────────

type ActivityHandler = {
	GET: (event: ReturnType<typeof makeRequestEvent>) => Promise<Response>;
};

let serverModule: ActivityHandler | null = null;
let moduleError: string | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		serverModule =
			(await import('../../routes/api/activity/+server.js')) as unknown as ActivityHandler;
	} catch (err) {
		moduleError = (err as Error).message;
	}
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Activity API (Phase 5.3)', () => {
	describe('module availability', () => {
		it('activity endpoint module should be importable', () => {
			if (moduleError) {
				expect.fail(
					`Activity endpoint not yet available: ${moduleError}. ` +
						'Implement src/routes/api/activity/+server.ts per Phase 5.3.'
				);
			}
			expect(serverModule).not.toBeNull();
		});
	});

	describe('GET /api/activity', () => {
		it('returns empty items for unauthenticated user (graceful degradation)', async () => {
			if (!serverModule) return;
			const event = makeRequestEvent({
				locals: { user: undefined as unknown as Locals['user'] }
			});

			const response = await serverModule.GET(event);
			// Backend returns { items: [], total: 0 } instead of 401
			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.items).toEqual([]);
			expect(data.total).toBe(0);
		});

		it('returns items filtered by userId', async () => {
			if (!serverModule) return;

			// Backend runs COUNT first, then data query
			mockExecute.mockResolvedValueOnce({ rows: [{ CNT: 1 }] });
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'exec-1',
						TOOL_CATEGORY: 'compute',
						TOOL_NAME: 'listInstances',
						ACTION: 'executed',
						SUCCESS: 1,
						CREATED_AT: new Date('2026-02-06T10:00:00Z')
					}
				]
			});

			const event = makeRequestEvent({});
			const response = await serverModule.GET(event);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.items).toBeDefined();
			expect(Array.isArray(data.items)).toBe(true);
			expect(data.items.length).toBeGreaterThan(0);
		});

		it('supports pagination with offset and limit query params', async () => {
			if (!serverModule) return;

			// COUNT then empty data
			mockExecute.mockResolvedValueOnce({ rows: [{ CNT: 50 }] });
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const event = makeRequestEvent({
				searchParams: { offset: '20', limit: '10' }
			});
			const response = await serverModule.GET(event);
			expect(response.status).toBe(200);

			// Verify the data query received the offset and limit binds
			const dataCall = mockExecute.mock.calls[1];
			const binds = dataCall?.[1] as Record<string, unknown> | undefined;
			expect(binds?.offset).toBe(20);
			expect(binds?.maxRows).toBe(10);
		});

		it('clamps limit to max 100', async () => {
			if (!serverModule) return;

			// COUNT then empty data
			mockExecute.mockResolvedValueOnce({ rows: [{ CNT: 0 }] });
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const event = makeRequestEvent({
				searchParams: { limit: '500' }
			});
			const response = await serverModule.GET(event);
			expect(response.status).toBe(200);

			// Verify the data query clamped maxRows to 100
			const dataCall = mockExecute.mock.calls[1];
			const binds = dataCall?.[1] as Record<string, unknown> | undefined;
			expect(binds?.maxRows).toBeLessThanOrEqual(100);
		});

		it('returns empty items when Oracle is unavailable (fallback)', async () => {
			if (!serverModule) return;

			const event = makeRequestEvent({
				locals: { dbAvailable: false }
			});
			const response = await serverModule.GET(event);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.items).toEqual([]);
		});

		it('returns proper response shape with total count', async () => {
			if (!serverModule) return;

			mockExecute.mockResolvedValueOnce({ rows: [{ CNT: 42 }] });
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'exec-1',
						TOOL_CATEGORY: 'compute',
						TOOL_NAME: 'listInstances',
						ACTION: 'executed',
						SUCCESS: 1,
						CREATED_AT: new Date('2026-02-06T10:00:00Z')
					}
				]
			});

			const event = makeRequestEvent({});
			const response = await serverModule.GET(event);
			const data = await response.json();

			expect(data).toHaveProperty('items');
			expect(data).toHaveProperty('total');
			expect(typeof data.total).toBe('number');
		});

		it('activity items conform to ActivityItem type shape', async () => {
			if (!serverModule) return;

			mockExecute.mockResolvedValueOnce({ rows: [{ CNT: 1 }] });
			mockExecute.mockResolvedValueOnce({
				rows: [
					{
						ID: 'exec-1',
						TOOL_CATEGORY: 'compute',
						TOOL_NAME: 'listInstances',
						ACTION: 'executed',
						SUCCESS: 1,
						CREATED_AT: new Date('2026-02-06T10:00:00Z')
					}
				]
			});

			const event = makeRequestEvent({});
			const response = await serverModule.GET(event);
			const data = await response.json();

			// Each item should match the ActivityItem type from types.ts:
			// { id: string; type: string; action: string; time: string; status: 'completed' | 'pending' | 'failed' }
			for (const item of data.items) {
				expect(typeof item.id).toBe('string');
				expect(typeof item.type).toBe('string');
				expect(typeof item.action).toBe('string');
				expect(typeof item.time).toBe('string');
				expect(['completed', 'pending', 'failed']).toContain(item.status);
			}
		});
	});
});
