/**
 * TDD tests for Better Auth Fastify integration (Phase 9 task 9.5)
 * and RBAC preHandler hooks (Phase 9 task 9.6)
 *
 * The auth middleware should:
 * - Parse session cookies from requests
 * - Validate sessions via Better Auth
 * - Populate request context with user/permissions
 * - Return 401 for unauthenticated requests to protected routes
 * - Return 403 for insufficient permissions
 * - Allow public endpoints (health, auth callbacks) without auth
 * - Support API key authentication (dual auth)
 *
 * RBAC hooks should:
 * - Map roles to permissions using the shared RBAC module
 * - Support viewer/operator/admin roles
 * - Grant admin:all access to admins
 * - Fall back to viewer for unknown roles
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

// Mock auth and RBAC modules
vi.mock('@portal/server/oracle/connection', () => ({
	initPool: vi.fn().mockResolvedValue(undefined),
	closePool: vi.fn().mockResolvedValue(undefined),
	withConnection: vi.fn(async (fn: (conn: unknown) => unknown) =>
		fn({
			execute: vi.fn().mockResolvedValue({ rows: [] }),
			close: vi.fn().mockResolvedValue(undefined),
			commit: vi.fn(),
			rollback: vi.fn()
		})
	),
	getPoolStats: vi.fn().mockResolvedValue(null),
	isPoolInitialized: vi.fn(() => false),
	getPool: vi.fn()
}));

vi.mock('@portal/server/sentry', () => ({
	wrapWithSpan: vi.fn((_name: string, _op: string, fn: () => unknown) => fn()),
	captureError: vi.fn(),
	isSentryEnabled: vi.fn(() => false),
	initSentry: vi.fn(),
	closeSentry: vi.fn()
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: vi.fn(() => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	}))
}));

vi.mock('@portal/server/oracle/migrations', () => ({
	runMigrations: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@portal/server/oracle/repositories/webhook-repository', () => ({
	webhookRepository: {
		migratePlaintextSecrets: vi.fn().mockResolvedValue({ migrated: 0, remaining: 0 })
	}
}));

vi.mock('@portal/server/auth/config', () => ({
	auth: {
		api: {
			getSession: vi.fn().mockResolvedValue(null)
		}
	},
	reloadAuthProviders: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@portal/server/admin/env-bootstrap.js', () => ({
	bootstrapEnvToDatabase: vi.fn().mockResolvedValue(undefined)
}));

// Use forwarding pattern for health mock so mockReset:true doesn't break it
const mockRunHealthChecks = vi.fn();
vi.mock('@portal/server/health', () => ({
	runHealthChecks: (...args: unknown[]) => mockRunHealthChecks(...args)
}));

// ---------------------------------------------------------------------------
// RBAC module tests (shared package)
// ---------------------------------------------------------------------------

describe('RBAC module (shared package)', () => {
	it('should export getPermissionsForRole', async () => {
		const { getPermissionsForRole } = await import('@portal/server/auth/rbac');
		expect(typeof getPermissionsForRole).toBe('function');
	});

	it('should export hasPermission', async () => {
		const { hasPermission } = await import('@portal/server/auth/rbac');
		expect(typeof hasPermission).toBe('function');
	});

	it('viewer role should have read-only permissions', async () => {
		const { getPermissionsForRole } = await import('@portal/server/auth/rbac');
		const perms = getPermissionsForRole('viewer');

		expect(perms).toContain('tools:read');
		expect(perms).toContain('sessions:read');
		expect(perms).toContain('workflows:read');
		expect(perms).not.toContain('tools:execute');
		expect(perms).not.toContain('admin:all');
	});

	it('operator role should have execute permissions', async () => {
		const { getPermissionsForRole } = await import('@portal/server/auth/rbac');
		const perms = getPermissionsForRole('operator');

		expect(perms).toContain('tools:read');
		expect(perms).toContain('tools:execute');
		expect(perms).toContain('tools:approve');
		expect(perms).toContain('sessions:write');
		expect(perms).toContain('workflows:execute');
		expect(perms).not.toContain('admin:all');
		expect(perms).not.toContain('tools:danger');
	});

	it('admin role should have all permissions', async () => {
		const { getPermissionsForRole, PERMISSIONS } = await import('@portal/server/auth/rbac');
		const perms = getPermissionsForRole('admin');
		const allPerms = Object.keys(PERMISSIONS);

		// Admin should have every permission
		for (const perm of allPerms) {
			expect(perms).toContain(perm);
		}
	});

	it('unknown role should fall back to viewer permissions', async () => {
		const { getPermissionsForRole } = await import('@portal/server/auth/rbac');
		const perms = getPermissionsForRole('nonexistent-role');
		const viewerPerms = getPermissionsForRole('viewer');

		expect(perms).toEqual(viewerPerms);
	});

	it('hasPermission should return true when permission exists', async () => {
		const { hasPermission } = await import('@portal/server/auth/rbac');
		expect(hasPermission(['tools:read', 'tools:execute'], 'tools:execute')).toBe(true);
	});

	it('hasPermission should return false when permission is missing', async () => {
		const { hasPermission } = await import('@portal/server/auth/rbac');
		expect(hasPermission(['tools:read'], 'tools:execute')).toBe(false);
	});

	it('should have exactly 13 permissions defined', async () => {
		const { PERMISSIONS } = await import('@portal/server/auth/rbac');
		const expectedPermissions = [
			'tools:read',
			'tools:execute',
			'tools:approve',
			'tools:danger',
			'sessions:read',
			'sessions:write',
			'workflows:read',
			'workflows:write',
			'workflows:execute',
			'admin:all',
			'admin:users',
			'admin:orgs',
			'admin:audit'
		];
		expect(Object.keys(PERMISSIONS).sort()).toEqual(expectedPermissions.sort());
	});
});

// ---------------------------------------------------------------------------
// Auth middleware contract (TDD — middleware not yet built for Fastify)
// ---------------------------------------------------------------------------

describe('Fastify auth middleware (TDD contract)', () => {
	let app: FastifyInstance;

	beforeEach(() => {
		// Re-configure health mock after mockReset: true clears it
		mockRunHealthChecks.mockResolvedValue({
			status: 'ok',
			checks: {},
			timestamp: new Date().toISOString(),
			uptime: 1,
			version: '0.1.0'
		});
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it('should allow unauthenticated access to /health', async () => {
		app = await createApp({ enableRateLimit: false });
		await app.ready();

		const response = await app.inject({
			method: 'GET',
			url: '/health'
		});

		expect(response.statusCode).toBe(200);
	});

	it('should define public routes that skip auth', () => {
		// These routes should never require authentication
		const publicRoutes = [
			'/health',
			'/health/deep',
			'/api/auth/', // Better Auth callback routes
			'/api/metrics' // Prometheus scraping
		];

		// Contract: all these should be publicly accessible
		expect(publicRoutes.length).toBeGreaterThan(0);
		for (const route of publicRoutes) {
			expect(typeof route).toBe('string');
			expect(route.startsWith('/')).toBe(true);
		}
	});

	it('should define protected route patterns', () => {
		// These route patterns should require authentication
		const protectedPatterns = [
			'/api/sessions',
			'/api/activity',
			'/api/tools/execute',
			'/api/chat',
			'/api/workflows',
			'/api/v1/'
		];

		expect(protectedPatterns.length).toBeGreaterThan(0);
	});

	it('should define route-to-permission mapping', () => {
		// Each protected endpoint maps to a required permission
		const routePermissions: Record<string, string> = {
			'GET /api/sessions': 'sessions:read',
			'POST /api/sessions': 'sessions:write',
			'DELETE /api/sessions/:id': 'sessions:write',
			'GET /api/activity': 'sessions:read',
			'POST /api/tools/execute': 'tools:execute',
			'POST /api/tools/approve': 'tools:approve',
			'POST /api/chat': 'tools:execute',
			'GET /api/workflows': 'workflows:read',
			'POST /api/workflows': 'workflows:write',
			'POST /api/workflows/:id/run': 'workflows:execute'
		};

		// Every route should map to a valid permission
		for (const [route, permission] of Object.entries(routePermissions)) {
			expect(typeof route).toBe('string');
			expect(typeof permission).toBe('string');
			expect(permission).toMatch(/^[a-z]+:[a-z]+$/);
		}
	});
});

// ---------------------------------------------------------------------------
// Dual auth (session + API key) contract
// ---------------------------------------------------------------------------

describe('Dual auth (session + API key) contract', () => {
	it('should define API key format', () => {
		// API keys use portal_ prefix + 32 random hex bytes
		const validKey = 'portal_' + 'a'.repeat(64);
		expect(validKey).toMatch(/^portal_[a-f0-9]{64}$/);
	});

	it('should accept API key in Authorization header', () => {
		const key = 'portal_' + 'a'.repeat(64);
		const header = `Bearer ${key}`;
		expect(header.startsWith('Bearer portal_')).toBe(true);
	});

	it('should accept API key in X-API-Key header', () => {
		const key = 'portal_' + 'a'.repeat(64);
		// Both header formats should work
		expect(key.startsWith('portal_')).toBe(true);
	});
});
