/**
 * Route tests for admin IDP (Identity Provider) endpoints.
 *
 * Tests:
 * - GET    /api/admin/idp            — list providers (secrets stripped)
 * - POST   /api/admin/idp            — create provider
 * - PUT    /api/admin/idp/:id        — update provider
 * - DELETE /api/admin/idp/:id        — delete provider
 * - POST   /api/admin/idp/:id/toggle — toggle enabled/disabled
 *
 * All endpoints require admin:all permission.
 * Client secrets are never returned — response includes hasClientSecret boolean instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, simulateSession } from './test-helpers.js';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockGetById = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('@portal/server/admin/idp-repository', () => ({
	idpRepository: {
		list: (...args: unknown[]) => mockList(...args),
		create: (...args: unknown[]) => mockCreate(...args),
		getById: (...args: unknown[]) => mockGetById(...args),
		update: (...args: unknown[]) => mockUpdate(...args),
		delete: (...args: unknown[]) => mockDelete(...args)
	}
}));

vi.mock('@portal/server/admin/strip-secrets', () => ({
	stripIdpSecrets: (p: Record<string, unknown>) => {
		const { clientSecret, ...rest } = p;
		return { ...rest, hasClientSecret: !!clientSecret };
	},
	stripIdpSecretsArray: (providers: Record<string, unknown>[]) =>
		providers.map((p) => {
			const { clientSecret, ...rest } = p;
			return { ...rest, hasClientSecret: !!clientSecret };
		})
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

// ── Test data ─────────────────────────────────────────────────────────────

const VALID_UUID = '12345678-1234-4123-8123-123456789012';

const IDP_WITH_SECRET = {
	id: VALID_UUID,
	providerId: 'idcs-main',
	displayName: 'IDCS Production',
	providerType: 'idcs',
	discoveryUrl: 'https://idcs.example.com/.well-known/openid-configuration',
	authorizationUrl: null,
	tokenUrl: null,
	userInfoUrl: null,
	jwksUrl: null,
	clientId: 'client-id-12345',
	clientSecret: 'super-secret-value',
	scopes: 'openid,email,profile',
	pkceEnabled: true,
	status: 'active',
	isDefault: false,
	sortOrder: 0,
	iconUrl: null,
	buttonLabel: null,
	adminGroups: null,
	userGroups: null,
	defaultOrgId: null,
	extraConfig: null,
	createdAt: new Date(),
	updatedAt: new Date()
};

const IDP_WITHOUT_SECRET = {
	id: '22345678-1234-4123-8123-123456789012',
	providerId: 'oidc-backup',
	displayName: 'OIDC Backup',
	providerType: 'oidc',
	discoveryUrl: null,
	authorizationUrl: 'https://auth.example.com/authorize',
	tokenUrl: 'https://auth.example.com/token',
	userInfoUrl: null,
	jwksUrl: null,
	clientId: 'backup-client-id',
	clientSecret: null,
	scopes: 'openid,email',
	pkceEnabled: false,
	status: 'disabled',
	isDefault: false,
	sortOrder: 1,
	iconUrl: null,
	buttonLabel: null,
	adminGroups: null,
	userGroups: null,
	defaultOrgId: null,
	extraConfig: null,
	createdAt: new Date(),
	updatedAt: new Date()
};

// ── Helpers ───────────────────────────────────────────────────────────────

let app: FastifyInstance;

async function buildIdpApp(): Promise<FastifyInstance> {
	const a = await buildTestApp({ withRbac: true });
	simulateSession(a, { id: 'admin-1' }, ['admin:all']);
	const { idpAdminRoutes } = await import('../../routes/admin/idp.js');
	await a.register(idpAdminRoutes);
	await a.ready();
	return a;
}

beforeEach(() => {
	mockList.mockResolvedValue([]);
	mockCreate.mockResolvedValue(IDP_WITH_SECRET);
	mockGetById.mockResolvedValue(null);
	mockUpdate.mockResolvedValue(IDP_WITH_SECRET);
	mockDelete.mockResolvedValue(true);
});

afterEach(async () => {
	if (app) await app.close();
});

// ── GET /api/admin/idp ──────────────────────────────────────────────────

describe('GET /api/admin/idp', () => {
	it('returns 200 with providers list (client secrets stripped)', async () => {
		mockList.mockResolvedValue([IDP_WITH_SECRET, IDP_WITHOUT_SECRET]);
		app = await buildIdpApp();

		const res = await app.inject({ method: 'GET', url: '/api/admin/idp' });

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body).toHaveLength(2);
		// Client secret must be stripped, replaced with boolean flag
		expect(body[0]).not.toHaveProperty('clientSecret');
		expect(body[0].hasClientSecret).toBe(true);
		expect(body[1].hasClientSecret).toBe(false);
	});

	it('returns 200 with empty array when no providers exist', async () => {
		mockList.mockResolvedValue([]);
		app = await buildIdpApp();

		const res = await app.inject({ method: 'GET', url: '/api/admin/idp' });

		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual([]);
	});

	it('returns 401 for unauthenticated request', async () => {
		app = await buildTestApp({ withRbac: true });
		const { idpAdminRoutes } = await import('../../routes/admin/idp.js');
		await app.register(idpAdminRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/idp' });
		expect(res.statusCode).toBe(401);
	});

	it('returns 403 for user without admin:all permission', async () => {
		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		const { idpAdminRoutes } = await import('../../routes/admin/idp.js');
		await app.register(idpAdminRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/idp' });
		expect(res.statusCode).toBe(403);
	});
});

// ── POST /api/admin/idp ─────────────────────────────────────────────────

describe('POST /api/admin/idp', () => {
	it('returns 201 with created provider (client secret stripped)', async () => {
		app = await buildIdpApp();

		const res = await app.inject({
			method: 'POST',
			url: '/api/admin/idp',
			payload: {
				providerId: 'idcs-main',
				displayName: 'IDCS Production',
				providerType: 'idcs',
				discoveryUrl: 'https://idcs.example.com/.well-known/openid-configuration',
				clientId: 'client-id-12345',
				clientSecret: 'super-secret-value'
			}
		});

		expect(res.statusCode).toBe(201);
		const body = res.json();
		expect(body.displayName).toBe('IDCS Production');
		expect(body).not.toHaveProperty('clientSecret');
		expect(body.hasClientSecret).toBe(true);
		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({ providerId: 'idcs-main', providerType: 'idcs' })
		);
	});
});

// ── PUT /api/admin/idp/:id ──────────────────────────────────────────────

describe('PUT /api/admin/idp/:id', () => {
	it('returns 200 with updated provider', async () => {
		mockGetById.mockResolvedValue(IDP_WITH_SECRET);
		const updated = { ...IDP_WITH_SECRET, displayName: 'IDCS Updated' };
		mockUpdate.mockResolvedValue(updated);
		app = await buildIdpApp();

		const res = await app.inject({
			method: 'PUT',
			url: `/api/admin/idp/${VALID_UUID}`,
			payload: {
				displayName: 'IDCS Updated',
				discoveryUrl: 'https://idcs.example.com/.well-known/openid-configuration'
			}
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().displayName).toBe('IDCS Updated');
		expect(mockUpdate).toHaveBeenCalledWith(
			VALID_UUID,
			expect.objectContaining({ displayName: 'IDCS Updated' })
		);
	});

	it('returns 404 when provider does not exist', async () => {
		mockGetById.mockResolvedValue(null);
		app = await buildIdpApp();

		const res = await app.inject({
			method: 'PUT',
			url: `/api/admin/idp/${VALID_UUID}`,
			payload: {
				displayName: 'Nonexistent',
				discoveryUrl: 'https://example.com/.well-known/openid-configuration'
			}
		});

		expect(res.statusCode).toBe(404);
	});

	it('returns 400 for invalid UUID param', async () => {
		app = await buildIdpApp();

		const res = await app.inject({
			method: 'PUT',
			url: '/api/admin/idp/not-a-uuid',
			payload: {
				displayName: 'Test',
				discoveryUrl: 'https://example.com/.well-known/openid-configuration'
			}
		});

		expect(res.statusCode).toBe(400);
	});
});

// ── DELETE /api/admin/idp/:id ───────────────────────────────────────────

describe('DELETE /api/admin/idp/:id', () => {
	it('returns 204 when provider is deleted successfully', async () => {
		mockDelete.mockResolvedValue(true);
		app = await buildIdpApp();

		const res = await app.inject({
			method: 'DELETE',
			url: `/api/admin/idp/${VALID_UUID}`
		});

		expect(res.statusCode).toBe(204);
		expect(mockDelete).toHaveBeenCalledWith(VALID_UUID);
	});

	it('returns 404 when provider does not exist', async () => {
		mockDelete.mockResolvedValue(false);
		app = await buildIdpApp();

		const res = await app.inject({
			method: 'DELETE',
			url: `/api/admin/idp/${VALID_UUID}`
		});

		expect(res.statusCode).toBe(404);
	});
});

// ── POST /api/admin/idp/:id/toggle ──────────────────────────────────────

describe('POST /api/admin/idp/:id/toggle', () => {
	it('returns 200 with updated provider when toggling to enabled', async () => {
		mockGetById.mockResolvedValue({ ...IDP_WITH_SECRET, status: 'disabled' });
		const toggled = { ...IDP_WITH_SECRET, status: 'active' };
		mockUpdate.mockResolvedValue(toggled);
		app = await buildIdpApp();

		const res = await app.inject({
			method: 'POST',
			url: `/api/admin/idp/${VALID_UUID}/toggle`,
			payload: { enabled: true }
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().status).toBe('active');
		expect(mockUpdate).toHaveBeenCalledWith(VALID_UUID, { status: 'active' });
	});

	it('returns 200 with updated provider when toggling to disabled', async () => {
		mockGetById.mockResolvedValue(IDP_WITH_SECRET);
		const toggled = { ...IDP_WITH_SECRET, status: 'disabled' };
		mockUpdate.mockResolvedValue(toggled);
		app = await buildIdpApp();

		const res = await app.inject({
			method: 'POST',
			url: `/api/admin/idp/${VALID_UUID}/toggle`,
			payload: { enabled: false }
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().status).toBe('disabled');
		expect(mockUpdate).toHaveBeenCalledWith(VALID_UUID, { status: 'disabled' });
	});

	it('returns 404 when provider does not exist', async () => {
		mockGetById.mockResolvedValue(null);
		app = await buildIdpApp();

		const res = await app.inject({
			method: 'POST',
			url: `/api/admin/idp/${VALID_UUID}/toggle`,
			payload: { enabled: true }
		});

		expect(res.statusCode).toBe(404);
	});
});
