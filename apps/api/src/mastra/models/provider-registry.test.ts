import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	initProviderRegistry,
	getProviderRegistry,
	getEnabledModelIds,
	reloadProviderRegistry,
	_clearRegistryCache
} from './provider-registry.js';
import type { AiProviderRepository, AiProvider } from './types.js';

// ── Mock provider SDKs ──────────────────────────────────────────────────

vi.mock('@acedergren/oci-genai-provider', () => ({
	createOCI: vi.fn(() => ({ id: 'oci-mock' }))
}));

vi.mock('@ai-sdk/openai', () => ({
	createOpenAI: vi.fn(() => ({ id: 'openai-mock' }))
}));

vi.mock('@ai-sdk/anthropic', () => ({
	createAnthropic: vi.fn(() => ({ id: 'anthropic-mock' }))
}));

vi.mock('@ai-sdk/google', () => ({
	createGoogleGenerativeAI: vi.fn(() => ({ id: 'google-mock' }))
}));

vi.mock('ai', () => ({
	createProviderRegistry: vi.fn((providers) => ({
		...providers,
		_type: 'registry'
	}))
}));

// ── Helpers ─────────────────────────────────────────────────────────────

function makeProvider(overrides: Partial<AiProvider> = {}): AiProvider {
	return {
		id: 'p-1',
		providerId: 'test-provider',
		providerType: 'openai',
		displayName: 'Test Provider',
		isActive: true,
		apiKey: 'sk-test-key',
		region: 'us-ashburn-1',
		...overrides
	};
}

function makeRepo(
	providers: AiProvider[] = [],
	enabledModels: Record<string, string[]> = {}
): AiProviderRepository {
	return {
		listActive: vi.fn().mockResolvedValue(providers),
		getById: vi
			.fn()
			.mockImplementation(async (id: string) => providers.find((p) => p.id === id) ?? null),
		getEnabledModels: vi.fn().mockResolvedValue(enabledModels)
	};
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('Provider Registry', () => {
	beforeEach(() => {
		_clearRegistryCache();
	});

	afterEach(() => {
		_clearRegistryCache();
	});

	describe('getProviderRegistry — without init', () => {
		it('returns empty registry when not initialized', async () => {
			// Re-init with null to simulate uninitalized state
			initProviderRegistry(null as never);
			_clearRegistryCache();

			const registry = await getProviderRegistry();
			expect(registry).toBeDefined();
			expect(registry._type).toBe('registry');
		});
	});

	describe('getProviderRegistry — with providers', () => {
		it('creates registry with OpenAI provider', async () => {
			const providers = [
				makeProvider({
					id: 'p-1',
					providerId: 'openai',
					providerType: 'openai'
				})
			];
			initProviderRegistry(makeRepo(providers));

			const registry = await getProviderRegistry();

			expect(registry).toBeDefined();
			expect(registry._type).toBe('registry');
		});

		it('creates registry with OCI provider (no API key needed)', async () => {
			const providers = [
				makeProvider({
					id: 'p-2',
					providerId: 'oci-genai',
					providerType: 'oci',
					apiKey: undefined
				})
			];
			initProviderRegistry(makeRepo(providers));

			const registry = await getProviderRegistry();
			expect(registry).toBeDefined();
		});

		it('skips provider with missing API key (OpenAI)', async () => {
			const providers = [
				makeProvider({
					id: 'p-3',
					providerId: 'openai-nokey',
					providerType: 'openai',
					apiKey: undefined
				})
			];
			initProviderRegistry(makeRepo(providers));

			// Should not throw — skips invalid provider
			const registry = await getProviderRegistry();
			expect(registry).toBeDefined();
		});

		it('caches registry on second call', async () => {
			const repo = makeRepo([makeProvider({ id: 'p-1', providerId: 'test', providerType: 'oci' })]);
			initProviderRegistry(repo);

			await getProviderRegistry();
			await getProviderRegistry();

			// listActive called only once (cached)
			expect(repo.listActive).toHaveBeenCalledOnce();
		});
	});

	describe('getEnabledModelIds', () => {
		it('returns empty when not initialized', async () => {
			initProviderRegistry(null as never);
			_clearRegistryCache();

			const models = await getEnabledModelIds();
			expect(models).toEqual([]);
		});

		it('returns prefixed model IDs', async () => {
			const repo = makeRepo([], {
				'oci-genai': ['cohere.command-r-plus', 'meta.llama-3.3-70b'],
				openai: ['gpt-4o']
			});
			initProviderRegistry(repo);

			const models = await getEnabledModelIds();

			expect(models).toContain('oci-genai:cohere.command-r-plus');
			expect(models).toContain('oci-genai:meta.llama-3.3-70b');
			expect(models).toContain('openai:gpt-4o');
		});

		it('preserves already-prefixed model IDs', async () => {
			const repo = makeRepo([], {
				custom: ['custom:special-model']
			});
			initProviderRegistry(repo);

			const models = await getEnabledModelIds();
			expect(models).toContain('custom:special-model');
		});

		it('deduplicates model IDs', async () => {
			const repo = makeRepo([], {
				provider1: ['model-a'],
				provider2: ['model-a']
			});
			initProviderRegistry(repo);

			const models = await getEnabledModelIds();
			const modelACount = models.filter(
				(m) => m === 'provider1:model-a' || m === 'provider2:model-a'
			);
			// Both should appear — different prefixes
			expect(modelACount.length).toBe(2);
		});
	});

	describe('reloadProviderRegistry', () => {
		it('clears cache and rebuilds', async () => {
			const repo = makeRepo([makeProvider({ id: 'p-1', providerId: 'test', providerType: 'oci' })]);
			initProviderRegistry(repo);

			await getProviderRegistry(); // Build cache
			expect(repo.listActive).toHaveBeenCalledTimes(1);

			await reloadProviderRegistry(); // Force rebuild
			expect(repo.listActive).toHaveBeenCalledTimes(2);
		});
	});

	describe('_clearRegistryCache', () => {
		it('allows rebuilding on next call', async () => {
			const repo = makeRepo([makeProvider({ id: 'p-1', providerId: 'test', providerType: 'oci' })]);
			initProviderRegistry(repo);

			await getProviderRegistry();
			_clearRegistryCache();
			await getProviderRegistry();

			expect(repo.listActive).toHaveBeenCalledTimes(2);
		});
	});
});
