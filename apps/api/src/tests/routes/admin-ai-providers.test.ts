/**
 * Route tests for admin AI provider endpoints.
 *
 * Tests:
 * - GET    /api/admin/ai-providers       — list providers (secrets stripped)
 * - POST   /api/admin/ai-providers       — create provider
 * - PATCH  /api/admin/ai-providers/:id   — update provider
 * - DELETE /api/admin/ai-providers/:id   — delete provider
 *
 * All endpoints require admin:all permission.
 * API keys are never returned — response includes hasApiKey boolean instead.
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

vi.mock('@portal/server/admin/ai-provider-repository', () => ({
	aiProviderRepository: {
		list: (...args: unknown[]) => mockList(...args),
		create: (...args: unknown[]) => mockCreate(...args),
		getById: (...args: unknown[]) => mockGetById(...args),
		update: (...args: unknown[]) => mockUpdate(...args),
		delete: (...args: unknown[]) => mockDelete(...args)
	}
}));

vi.mock('@portal/server/admin/strip-secrets', () => ({
	stripAiProviderSecrets: (p: Record<string, unknown>) => {
		const { apiKey, ...rest } = p;
		return { ...rest, hasApiKey: !!apiKey };
	},
	stripAiProviderSecretsArray: (providers: Record<string, unknown>[]) =>
		providers.map((p) => {
			const { apiKey, ...rest } = p;
			return { ...rest, hasApiKey: !!apiKey };
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

const PROVIDER_WITH_KEY = {
	id: VALID_UUID,
	providerId: 'openai-main',
	displayName: 'OpenAI',
	providerType: 'openai',
	apiBaseUrl: 'https://api.openai.com/v1',
	apiKey: 'sk-secret-key-12345',
	status: 'active',
	isDefault: false,
	sortOrder: 0,
	createdAt: new Date(),
	updatedAt: new Date()
};

const PROVIDER_WITHOUT_KEY = {
	id: '22345678-1234-4123-8123-123456789012',
	providerId: 'anthropic-backup',
	displayName: 'Anthropic Backup',
	providerType: 'anthropic',
	apiBaseUrl: 'https://api.anthropic.com',
	apiKey: null,
	status: 'active',
	isDefault: false,
	sortOrder: 1,
	createdAt: new Date(),
	updatedAt: new Date()
};

// ── Helpers ───────────────────────────────────────────────────────────────

let app: FastifyInstance;

async function buildAiProvidersApp(): Promise<FastifyInstance> {
	const a = await buildTestApp({ withRbac: true });
	simulateSession(a, { id: 'admin-1' }, ['admin:all']);
	const { aiProviderAdminRoutes } = await import('../../routes/admin/ai-providers.js');
	await a.register(aiProviderAdminRoutes);
	await a.ready();
	return a;
}

beforeEach(() => {
	mockList.mockResolvedValue([]);
	mockCreate.mockResolvedValue(PROVIDER_WITH_KEY);
	mockGetById.mockResolvedValue(null);
	mockUpdate.mockResolvedValue(PROVIDER_WITH_KEY);
	mockDelete.mockResolvedValue(true);
});

afterEach(async () => {
	if (app) await app.close();
});

// ── GET /api/admin/ai-providers ──────────────────────────────────────────

describe('GET /api/admin/ai-providers', () => {
	it('returns 200 with providers list (API keys stripped)', async () => {
		mockList.mockResolvedValue([PROVIDER_WITH_KEY, PROVIDER_WITHOUT_KEY]);
		app = await buildAiProvidersApp();

		const res = await app.inject({ method: 'GET', url: '/api/admin/ai-providers' });

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body).toHaveLength(2);
		// API key must be stripped, replaced with boolean flag
		expect(body[0]).not.toHaveProperty('apiKey');
		expect(body[0].hasApiKey).toBe(true);
		expect(body[1].hasApiKey).toBe(false);
	});

	it('returns 200 with empty array when no providers exist', async () => {
		mockList.mockResolvedValue([]);
		app = await buildAiProvidersApp();

		const res = await app.inject({ method: 'GET', url: '/api/admin/ai-providers' });

		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual([]);
	});

	it('returns 401 for unauthenticated request', async () => {
		app = await buildTestApp({ withRbac: true });
		const { aiProviderAdminRoutes } = await import('../../routes/admin/ai-providers.js');
		await app.register(aiProviderAdminRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/ai-providers' });
		expect(res.statusCode).toBe(401);
	});

	it('returns 403 for user without admin:all permission', async () => {
		app = await buildTestApp({ withRbac: true });
		simulateSession(app, { id: 'user-1' }, ['tools:read']);
		const { aiProviderAdminRoutes } = await import('../../routes/admin/ai-providers.js');
		await app.register(aiProviderAdminRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/admin/ai-providers' });
		expect(res.statusCode).toBe(403);
	});
});

// ── POST /api/admin/ai-providers ─────────────────────────────────────────

describe('POST /api/admin/ai-providers', () => {
	it('returns 201 with created provider (API key stripped)', async () => {
		app = await buildAiProvidersApp();

		const res = await app.inject({
			method: 'POST',
			url: '/api/admin/ai-providers',
			payload: {
				providerId: 'openai-main',
				displayName: 'OpenAI',
				providerType: 'openai',
				apiBaseUrl: 'https://api.openai.com/v1',
				apiKey: 'sk-secret-key-12345'
			}
		});

		expect(res.statusCode).toBe(201);
		const body = res.json();
		expect(body.displayName).toBe('OpenAI');
		expect(body).not.toHaveProperty('apiKey');
		expect(body.hasApiKey).toBe(true);
		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({ providerId: 'openai-main', providerType: 'openai' })
		);
	});
});

// ── PATCH /api/admin/ai-providers/:id ────────────────────────────────────

describe('PATCH /api/admin/ai-providers/:id', () => {
	it('returns 200 with updated provider', async () => {
		mockGetById.mockResolvedValue(PROVIDER_WITH_KEY);
		const updated = { ...PROVIDER_WITH_KEY, displayName: 'OpenAI Updated' };
		mockUpdate.mockResolvedValue(updated);
		app = await buildAiProvidersApp();

		const res = await app.inject({
			method: 'PATCH',
			url: `/api/admin/ai-providers/${VALID_UUID}`,
			payload: { displayName: 'OpenAI Updated' }
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().displayName).toBe('OpenAI Updated');
		expect(mockUpdate).toHaveBeenCalledWith(
			VALID_UUID,
			expect.objectContaining({ displayName: 'OpenAI Updated' })
		);
	});

	it('returns 404 when provider does not exist', async () => {
		mockGetById.mockResolvedValue(null);
		app = await buildAiProvidersApp();

		const res = await app.inject({
			method: 'PATCH',
			url: `/api/admin/ai-providers/${VALID_UUID}`,
			payload: { displayName: 'Nonexistent' }
		});

		expect(res.statusCode).toBe(404);
	});

	it('returns 400 for invalid UUID param', async () => {
		app = await buildAiProvidersApp();

		const res = await app.inject({
			method: 'PATCH',
			url: '/api/admin/ai-providers/not-a-uuid',
			payload: { displayName: 'Test' }
		});

		expect(res.statusCode).toBe(400);
	});
});

// ── DELETE /api/admin/ai-providers/:id ───────────────────────────────────

describe('DELETE /api/admin/ai-providers/:id', () => {
	it('returns 204 when provider is deleted successfully', async () => {
		mockDelete.mockResolvedValue(true);
		app = await buildAiProvidersApp();

		const res = await app.inject({
			method: 'DELETE',
			url: `/api/admin/ai-providers/${VALID_UUID}`
		});

		expect(res.statusCode).toBe(204);
		expect(mockDelete).toHaveBeenCalledWith(VALID_UUID);
	});

	it('returns 404 when provider does not exist', async () => {
		mockDelete.mockResolvedValue(false);
		app = await buildAiProvidersApp();

		const res = await app.inject({
			method: 'DELETE',
			url: `/api/admin/ai-providers/${VALID_UUID}`
		});

		expect(res.statusCode).toBe(404);
	});
});
