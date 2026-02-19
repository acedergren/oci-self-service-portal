import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildTestApp as _buildTestApp, simulateSession } from './test-helpers.js';
import type { FastifyInstance } from 'fastify';

// Track all created apps for cleanup after each test
const _appsToClose: FastifyInstance[] = [];
afterEach(async () => {
	await Promise.all(_appsToClose.splice(0).map((a) => a.close()));
});
function buildTestApp(opts?: Parameters<typeof _buildTestApp>[0]): Promise<FastifyInstance> {
	return _buildTestApp(opts).then((app) => {
		_appsToClose.push(app);
		return app;
	});
}
import { webhookRoutes } from '../../routes/webhooks.js';

/** simulateSession + set session.activeOrganizationId for resolveOrgId */
function simulateOrgSession(
	app: FastifyInstance,
	user: Record<string, unknown>,
	permissions: string[],
	orgId: string
): void {
	simulateSession(app, user, permissions);
	app.addHook('onRequest', async (request) => {
		(request as FastifyRequest).session = {
			activeOrganizationId: orgId
		} as FastifyRequest['session'];
	});
}

// Mock webhook repository
const mockList = vi.fn();
const mockGetById = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('@portal/server/oracle/repositories/webhook-repository', () => ({
	webhookRepository: {
		get list() {
			return mockList;
		},
		get getById() {
			return mockGetById;
		},
		get create() {
			return mockCreate;
		},
		get update() {
			return mockUpdate;
		},
		get delete() {
			return mockDelete;
		}
	}
}));

// Mock SSRF validation
const mockIsValidWebhookUrl = vi.fn();
vi.mock('@portal/server/webhooks', () => ({
	get isValidWebhookUrl() {
		return mockIsValidWebhookUrl;
	}
}));

const mockIsWebhookEncryptionEnabled = vi.fn();
vi.mock('@portal/server/crypto', () => ({
	get isWebhookEncryptionEnabled() {
		return mockIsWebhookEncryptionEnabled;
	}
}));

vi.mock('@portal/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

describe('Webhook CRUD Routes', () => {
	beforeEach(() => {
		mockList.mockReset();
		mockGetById.mockReset();
		mockCreate.mockReset();
		mockUpdate.mockReset();
		mockDelete.mockReset();
		mockIsValidWebhookUrl.mockReset();
		mockIsWebhookEncryptionEnabled.mockReset();
		mockIsWebhookEncryptionEnabled.mockReturnValue(true);
	});

	// ── Auth ──────────────────────────────────────────────────────

	it('GET /api/v1/webhooks returns 401 without auth', async () => {
		const app = await buildTestApp();
		await app.register(webhookRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/v1/webhooks' });
		expect(res.statusCode).toBe(401);
	});

	it('POST /api/v1/webhooks returns 401 without auth', async () => {
		const app = await buildTestApp();
		await app.register(webhookRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/webhooks',
			payload: { url: 'https://example.com/hook', events: ['tool.executed'] }
		});
		expect(res.statusCode).toBe(401);
	});

	it('GET /api/v1/webhooks returns 403 without tools:read', async () => {
		const app = await buildTestApp();
		simulateSession(app, { id: 'user-1' }, ['sessions:read']);
		await app.register(webhookRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/v1/webhooks' });
		expect(res.statusCode).toBe(403);
	});

	// ── List ──────────────────────────────────────────────────────

	it('GET /api/v1/webhooks lists webhooks for org', async () => {
		mockList.mockResolvedValue([
			{
				id: 'wh-1',
				url: 'https://example.com/hook',
				events: ['tool.executed'],
				status: 'active',
				failureCount: 0,
				createdAt: new Date()
			}
		]);

		const app = await buildTestApp();
		simulateOrgSession(app, { id: 'user-1' }, ['tools:read'], 'org-1');
		await app.register(webhookRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/v1/webhooks' });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.webhooks).toHaveLength(1);
		expect(body.webhooks[0].id).toBe('wh-1');
	});

	// ── Create ───────────────────────────────────────────────────

	it('POST /api/v1/webhooks creates webhook', async () => {
		mockIsValidWebhookUrl.mockReturnValue(true);
		mockCreate.mockResolvedValue({ id: 'wh-new' });

		const app = await buildTestApp();
		simulateOrgSession(app, { id: 'user-1' }, ['tools:execute'], 'org-1');
		await app.register(webhookRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/webhooks',
			payload: { url: 'https://example.com/hook', events: ['tool.executed'] }
		});
		expect(res.statusCode).toBe(201);
		const body = res.json();
		expect(body.id).toBe('wh-new');
		expect(body.secret).toMatch(/^whsec_/);
	});

	it('POST /api/v1/webhooks rejects private IP (SSRF)', async () => {
		mockIsValidWebhookUrl.mockReturnValue(false);

		const app = await buildTestApp();
		simulateOrgSession(app, { id: 'user-1' }, ['tools:execute'], 'org-1');
		await app.register(webhookRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/webhooks',
			payload: { url: 'http://192.168.1.1/hook', events: ['tool.executed'] }
		});
		expect(res.statusCode).toBe(400);
	});

	it('POST /api/v1/webhooks returns 503 when encryption is disabled', async () => {
		mockIsWebhookEncryptionEnabled.mockReturnValue(false);
		mockIsValidWebhookUrl.mockReturnValue(true);

		const app = await buildTestApp();
		simulateOrgSession(app, { id: 'user-1' }, ['tools:execute'], 'org-1');
		await app.register(webhookRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/webhooks',
			payload: { url: 'https://example.com/hook', events: ['tool.executed'] }
		});
		expect(res.statusCode).toBe(503);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	// ── Get by ID ────────────────────────────────────────────────

	it('GET /api/v1/webhooks/:id returns webhook', async () => {
		mockGetById.mockResolvedValue({
			id: 'wh-1',
			url: 'https://example.com/hook',
			events: ['tool.executed'],
			status: 'active',
			failureCount: 0,
			createdAt: new Date(),
			updatedAt: new Date()
		});

		const app = await buildTestApp();
		simulateOrgSession(app, { id: 'user-1' }, ['tools:read'], 'org-1');
		await app.register(webhookRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/v1/webhooks/wh-1' });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.id).toBe('wh-1');
	});

	it('GET /api/v1/webhooks/:id returns 404 when not found', async () => {
		mockGetById.mockResolvedValue(null);

		const app = await buildTestApp();
		simulateOrgSession(app, { id: 'user-1' }, ['tools:read'], 'org-1');
		await app.register(webhookRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/v1/webhooks/nonexistent' });
		expect(res.statusCode).toBe(404);
	});

	// ── Update ───────────────────────────────────────────────────

	it('PUT /api/v1/webhooks/:id updates webhook', async () => {
		mockGetById.mockResolvedValue({ id: 'wh-1', status: 'active' });
		mockUpdate.mockResolvedValue(undefined);

		const app = await buildTestApp();
		simulateOrgSession(app, { id: 'user-1' }, ['tools:execute'], 'org-1');
		await app.register(webhookRoutes);
		await app.ready();

		const res = await app.inject({
			method: 'PUT',
			url: '/api/v1/webhooks/wh-1',
			payload: { status: 'paused' }
		});
		expect(res.statusCode).toBe(200);
		expect(mockUpdate).toHaveBeenCalledWith('wh-1', 'org-1', { status: 'paused' });
	});

	// ── Delete ───────────────────────────────────────────────────

	it('DELETE /api/v1/webhooks/:id deletes webhook', async () => {
		mockDelete.mockResolvedValue(undefined);

		const app = await buildTestApp();
		simulateOrgSession(app, { id: 'user-1' }, ['tools:execute'], 'org-1');
		await app.register(webhookRoutes);
		await app.ready();

		const res = await app.inject({ method: 'DELETE', url: '/api/v1/webhooks/wh-1' });
		expect(res.statusCode).toBe(204);
		expect(mockDelete).toHaveBeenCalledWith('wh-1', 'org-1');
	});
});
