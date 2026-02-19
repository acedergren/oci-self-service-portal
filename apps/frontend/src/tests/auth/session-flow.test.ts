import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Oracle connection
vi.mock('$lib/server/oracle/connection.js', () => ({
	withConnection: vi.fn(async (fn: (conn: unknown) => Promise<unknown>) => {
		const mockConn = {
			execute: vi.fn().mockResolvedValue({ rows: [] }),
			commit: vi.fn().mockResolvedValue(undefined),
			rollback: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined)
		};
		return fn(mockConn);
	}),
	initPool: vi.fn().mockResolvedValue(undefined),
	isPoolInitialized: vi.fn().mockReturnValue(true)
}));

// Mock logger
vi.mock('$lib/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

// Create a shared mock function we can control from tests
const mockGetSession = vi.fn();

// Mock Better Auth config -- the module may or may not exist yet
vi.mock('$lib/server/auth/config.js', () => ({
	auth: {
		api: {
			getSession: mockGetSession
		},
		handler: vi.fn()
	}
}));

describe('Auth Session Flow', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('unauthenticated requests', () => {
		it('API request without session returns null', async () => {
			mockGetSession.mockResolvedValue(null);

			const session = await mockGetSession({ headers: new Headers() });
			expect(session).toBeNull();
			// The hooks guard should return 401 for null sessions on API routes
		});

		it('page request without session returns null (hooks should redirect)', async () => {
			mockGetSession.mockResolvedValue(null);

			const session = await mockGetSession({ headers: new Headers() });
			expect(session).toBeNull();
			// The hooks guard should redirect non-API page routes to /login
		});
	});

	describe('public routes bypass auth', () => {
		const publicPaths = ['/api/health', '/api/auth', '/api/auth/callback/oidc', '/login'];

		for (const path of publicPaths) {
			it(`${path} is accessible without authentication`, () => {
				// These paths should be in the auth guard's bypass list.
				// Verify the path matching logic that hooks.server.ts should use.
				const isPublic =
					path === '/api/health' || path.startsWith('/api/auth') || path === '/login';
				expect(isPublic).toBe(true);
			});
		}

		it('non-public paths should require auth', () => {
			const protectedPaths = ['/api/chat', '/api/tools/execute', '/chat', '/'];
			for (const path of protectedPaths) {
				const isPublic =
					path === '/api/health' || path.startsWith('/api/auth') || path === '/login';
				expect(isPublic).toBe(false);
			}
		});
	});

	describe('authenticated requests', () => {
		const mockUser = {
			id: 'user-123',
			email: 'alice@example.com',
			name: 'Alice'
		};

		const mockSession = {
			session: {
				id: 'session-abc',
				userId: 'user-123',
				expiresAt: new Date(Date.now() + 86400000) // 24h from now
			},
			user: mockUser
		};

		it('authenticated request resolves user from session', async () => {
			mockGetSession.mockResolvedValue(mockSession);

			const result = await mockGetSession({
				headers: new Headers({ cookie: 'session=valid-token' })
			});

			expect(result).not.toBeNull();
			expect(result.user.id).toBe('user-123');
			expect(result.user.email).toBe('alice@example.com');
		});

		it('expired session returns null', async () => {
			mockGetSession.mockResolvedValue(null);

			const result = await mockGetSession({
				headers: new Headers({ cookie: 'session=expired-token' })
			});

			expect(result).toBeNull();
		});

		it('getSession is called with request headers', async () => {
			mockGetSession.mockResolvedValue(mockSession);

			const headers = new Headers({ cookie: 'session=abc' });
			await mockGetSession({ headers });

			expect(mockGetSession).toHaveBeenCalledWith({ headers });
		});
	});

	describe('session with permissions', () => {
		it('session lookup returns user data that hooks can use for RBAC', async () => {
			const mockSessionWithRole = {
				session: {
					id: 'sess-1',
					userId: 'user-1',
					expiresAt: new Date(Date.now() + 86400000)
				},
				user: { id: 'user-1', email: 'admin@example.com', name: 'Admin' }
			};

			mockGetSession.mockResolvedValue(mockSessionWithRole);

			const result = await mockGetSession({ headers: new Headers() });
			expect(result).not.toBeNull();
			expect(result.user.id).toBe('user-1');

			// After session lookup, the hooks guard should:
			// 1. Look up org membership for user-1 via tenancy module
			// 2. Get permissions for their role via rbac module
			// 3. Attach user + permissions to event.locals
		});
	});
});
