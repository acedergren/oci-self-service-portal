import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp } from './test-helpers.js';
import { modelRoutes } from '../../routes/models.js';

const mockGetEnabledModelIds = vi.fn();
vi.mock('../../mastra/models/index.js', () => ({
	get getEnabledModelIds() {
		return mockGetEnabledModelIds;
	}
}));

const mockListActive = vi.fn();
vi.mock('@portal/server/admin', () => ({
	aiProviderRepository: {
		get listActive() {
			return mockListActive;
		}
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

describe('GET /api/models', () => {
	beforeEach(() => {
		mockGetEnabledModelIds.mockReset();
		mockListActive.mockReset();
	});

	it('returns dynamic models from configured providers', async () => {
		mockGetEnabledModelIds.mockResolvedValue([
			'my-openai:gpt-4o',
			'my-openai:gpt-4o-mini',
			'my-anthropic:claude-sonnet-4-5-20250929'
		]);
		mockListActive.mockResolvedValue([
			{
				providerId: 'my-openai',
				providerType: 'openai',
				displayName: 'OpenAI',
				modelAllowlist: ['gpt-4o', 'gpt-4o-mini']
			},
			{
				providerId: 'my-anthropic',
				providerType: 'anthropic',
				displayName: 'Anthropic',
				modelAllowlist: ['claude-sonnet-4-5-20250929']
			}
		]);

		const app = await buildTestApp({ withRbac: false });
		await app.register(modelRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/models' });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.models).toHaveLength(3);
		expect(body.models[0]).toHaveProperty('id');
		expect(body.models[0]).toHaveProperty('provider');
		expect(body.dynamic).toBe(true);
	});

	it('returns fallback models when no providers configured', async () => {
		mockGetEnabledModelIds.mockResolvedValue([]);
		mockListActive.mockResolvedValue([]);

		const app = await buildTestApp({ withRbac: false });
		await app.register(modelRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/models' });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.models.length).toBeGreaterThan(0);
		expect(body.dynamic).toBe(false);
	});

	it('returns region from environment', async () => {
		mockGetEnabledModelIds.mockResolvedValue([]);
		mockListActive.mockResolvedValue([]);

		const app = await buildTestApp({ withRbac: false });
		await app.register(modelRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/models' });
		const body = res.json();
		expect(body.region).toBeDefined();
	});
});
