/**
 * Dynamic AI provider registry — builds provider instances from database configuration.
 *
 * Uses AI SDK v6's createProviderRegistry to manage multiple AI providers:
 * - OCI GenAI (instance principal or resource principal auth)
 * - OpenAI (API key auth)
 * - Anthropic (API key auth)
 * - Google Generative AI (API key auth)
 *
 * Registry is lazy-loaded on first use and cached for performance.
 * Call reloadProviderRegistry() after admin updates provider config.
 *
 * Factory pattern:
 * - Call initProviderRegistry(repo) at app startup to inject repository
 * - Call getProviderRegistry() to get cached registry instance
 */

import { createOCI } from '@acedergren/oci-genai-provider';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createProviderRegistry } from 'ai';
import type { AiProvider, AiProviderRepository } from './types.js';

// Structured logger for module-level logging (outside Fastify request lifecycle)
const log = {
	info(obj: Record<string, unknown>, msg: string) {
		process.stdout.write(
			JSON.stringify({
				level: 'info',
				module: 'provider-registry',
				msg,
				...obj
			}) + '\n'
		);
	},
	warn(obj: Record<string, unknown>, msg: string) {
		process.stdout.write(
			JSON.stringify({
				level: 'warn',
				module: 'provider-registry',
				msg,
				...obj
			}) + '\n'
		);
	},
	error(obj: Record<string, unknown>, msg: string) {
		process.stderr.write(
			JSON.stringify({
				level: 'error',
				module: 'provider-registry',
				msg,
				...obj
			}) + '\n'
		);
	}
};

// Type alias for AI SDK provider instances (v6.x uses ProviderV3 internally)
type ProviderInstance =
	| ReturnType<typeof createOpenAI>
	| ReturnType<typeof createOCI>
	| ReturnType<typeof createAnthropic>
	| ReturnType<typeof createGoogleGenerativeAI>;

// ============================================================================
// Repository Injection
// ============================================================================

let repo: AiProviderRepository | null = null;

/**
 * Initialize provider registry with repository.
 * Must be called at app startup before getProviderRegistry().
 */
export function initProviderRegistry(repository: AiProviderRepository): void {
	repo = repository;
	_clearRegistryCache();
}

// ============================================================================
// Cached Registry
// ============================================================================

let cachedRegistry: ReturnType<typeof createProviderRegistry> | null = null;
let buildPromise: Promise<ReturnType<typeof createProviderRegistry>> | null = null;

// ============================================================================
// Provider Factory Functions
// ============================================================================

/**
 * Creates an OCI GenAI provider instance.
 * Uses instance principal auth (no API key needed).
 */
function createOCIProvider(provider: AiProvider): ProviderInstance {
	return createOCI({
		region: provider.region ?? 'us-ashburn-1'
		// OCI providers don't need API keys — use instance principal or resource principal
		// compartmentId can be set via OCI_COMPARTMENT_ID env var or passed via extraConfig
	});
}

/**
 * Creates an OpenAI provider instance with API key.
 */
function createOpenAIProvider(provider: AiProvider): ProviderInstance {
	if (!provider.apiKey) {
		throw new Error(`OpenAI provider ${provider.providerId} missing API key`);
	}

	return createOpenAI({
		apiKey: provider.apiKey,
		baseURL: provider.apiBaseUrl
	});
}

/**
 * Creates an Azure OpenAI provider instance with API key.
 * Azure requires specific endpoint structure, API versioning, and deployment names.
 * Uses dynamic import since @ai-sdk/azure is an optional dependency.
 */
async function createAzureProvider(provider: AiProvider): Promise<ProviderInstance> {
	if (!provider.apiKey) {
		throw new Error(`Azure OpenAI provider ${provider.providerId} missing API key`);
	}

	if (!provider.apiBaseUrl) {
		throw new Error(
			`Azure OpenAI provider ${provider.providerId} missing baseURL (e.g., https://<resource-name>.openai.azure.com)`
		);
	}

	// @ts-expect-error - @ai-sdk/azure is an optional dependency
	const { createAzure } = await import('@ai-sdk/azure');
	return createAzure({
		apiKey: provider.apiKey,
		resourceName: extractAzureResourceName(provider.apiBaseUrl)
	}) as ProviderInstance;
}

/**
 * Extracts Azure resource name from base URL.
 * Example: https://my-resource.openai.azure.com → my-resource
 */
function extractAzureResourceName(baseUrl: string): string {
	const match = baseUrl.match(/https:\/\/([^.]+)\.openai\.azure\.com/);
	if (!match) {
		throw new Error(`Invalid Azure OpenAI base URL: ${baseUrl}`);
	}
	return match[1];
}

/**
 * Creates an Anthropic provider instance with API key.
 */
function createAnthropicProvider(provider: AiProvider): ProviderInstance {
	if (!provider.apiKey) {
		throw new Error(`Anthropic provider ${provider.providerId} missing API key`);
	}

	return createAnthropic({
		apiKey: provider.apiKey,
		baseURL: provider.apiBaseUrl
	});
}

/**
 * Creates a Google Generative AI provider instance with API key.
 */
function createGoogleProvider(provider: AiProvider): ProviderInstance {
	if (!provider.apiKey) {
		throw new Error(`Google provider ${provider.providerId} missing API key`);
	}

	return createGoogleGenerativeAI({
		apiKey: provider.apiKey,
		baseURL: provider.apiBaseUrl
	});
}

/**
 * Factory function to create provider instances based on type.
 */
async function createProviderInstance(provider: AiProvider): Promise<ProviderInstance | null> {
	try {
		switch (provider.providerType) {
			case 'oci':
				return createOCIProvider(provider);
			case 'openai':
				return createOpenAIProvider(provider);
			case 'azure-openai':
				return await createAzureProvider(provider);
			case 'anthropic':
				return createAnthropicProvider(provider);
			case 'google':
				return createGoogleProvider(provider);
			default:
				log.warn(
					{
						providerType: provider.providerType,
						providerId: provider.providerId
					},
					'Unsupported provider type'
				);
				return null;
		}
	} catch (err) {
		log.error(
			{
				providerId: provider.providerId,
				providerType: provider.providerType,
				err: err instanceof Error ? err.message : String(err)
			},
			'Failed to create provider instance'
		);
		return null;
	}
}

// ============================================================================
// Registry Builder
// ============================================================================

/**
 * Builds provider registry from database configuration.
 * Internal — use getProviderRegistry() to get cached instance.
 */
async function buildRegistry(): Promise<ReturnType<typeof createProviderRegistry>> {
	if (!repo) {
		log.warn({}, 'Provider registry not initialized — call initProviderRegistry(repo) first');
		return createProviderRegistry({});
	}

	// Load active providers from database
	const providers = await repo.listActive();

	if (providers.length === 0) {
		log.warn({}, 'No active AI providers in database — registry will be empty');
		return createProviderRegistry({});
	}

	// Create provider instances
	const providerMap: Record<string, ProviderInstance> = {};

	for (const provider of providers) {
		// Fetch full provider with decrypted API key
		const fullProvider = await repo.getById(provider.id);
		if (!fullProvider) {
			log.warn({ providerId: provider.id }, 'Provider not found when fetching full config');
			continue;
		}

		const instance = await createProviderInstance(fullProvider);
		if (instance) {
			providerMap[provider.providerId] = instance;
			log.info(
				{
					providerId: provider.providerId,
					providerType: provider.providerType
				},
				'Registered AI provider'
			);
		}
	}

	if (Object.keys(providerMap).length === 0) {
		log.warn({}, 'No valid AI providers could be created — registry will be empty');
	}

	return createProviderRegistry(providerMap);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the AI provider registry.
 * Builds lazily on first call, then caches.
 * Thread-safe: multiple concurrent calls resolve to same instance.
 */
export async function getProviderRegistry(): Promise<ReturnType<typeof createProviderRegistry>> {
	if (cachedRegistry) return cachedRegistry;

	// If build already in progress, wait for it
	if (buildPromise) return buildPromise;

	// Start build and cache promise
	buildPromise = buildRegistry();

	try {
		cachedRegistry = await buildPromise;
		return cachedRegistry;
	} finally {
		buildPromise = null;
	}
}

/**
 * Reload provider registry from database.
 * Call after admin updates AI provider configuration.
 *
 * NOTE: Existing streaming requests continue with old registry.
 * Only new requests will use the updated registry.
 */
export async function reloadProviderRegistry(): Promise<void> {
	log.info({}, 'Reloading AI provider registry from database');

	// Wait for any in-flight build to complete before clearing
	if (buildPromise) {
		await buildPromise.catch(() => {
			// Ignore errors from previous build
		});
	}

	cachedRegistry = null;
	buildPromise = null;
	await getProviderRegistry(); // Force rebuild
}

/**
 * Get flat list of enabled model IDs for validation.
 * Returns all model IDs from all active providers' model allowlists.
 */
export async function getEnabledModelIds(): Promise<string[]> {
	if (!repo) {
		log.warn({}, 'Provider registry not initialized — returning empty model list');
		return [];
	}

	const allowlist = await repo.getEnabledModels();
	const modelIds = new Set<string>();

	for (const [providerId, models] of Object.entries(allowlist)) {
		models.forEach((model) => {
			// Prefix model with provider if not already prefixed
			const fullModelId = model.includes(':') ? model : `${providerId}:${model}`;
			modelIds.add(fullModelId);
		});
	}

	return Array.from(modelIds);
}

/**
 * Clear cached registry.
 * FOR TESTING ONLY — allows tests to rebuild registry with different DB state.
 *
 * @internal
 */
export function _clearRegistryCache(): void {
	cachedRegistry = null;
	buildPromise = null;
}
