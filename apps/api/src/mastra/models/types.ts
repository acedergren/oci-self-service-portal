/**
 * AI Provider types for Mastra integration.
 * Extracted from apps/frontend admin types for use in Fastify API.
 */

export interface AiProvider {
	id: string;
	providerId: string;
	providerType: 'oci' | 'openai' | 'azure-openai' | 'anthropic' | 'google' | 'custom';
	displayName: string;
	region?: string;
	apiKey?: string;
	apiBaseUrl?: string;
	status: 'active' | 'inactive' | 'disabled';
	models?: string[];
	modelAllowlist?: string[];
	isDefault?: boolean;
	sortOrder?: number;
	defaultModel?: string;
	extraConfig?: Record<string, unknown>;
	createdAt?: Date;
	updatedAt?: Date;
}

/**
 * Repository interface for AI Provider operations.
 * Minimal interface needed by provider registry.
 */
export interface AiProviderRepository {
	/**
	 * List all active AI providers (status='active').
	 */
	listActive(): Promise<Omit<AiProvider, 'apiKey'>[]>;

	/**
	 * Get single AI provider by ID with decrypted API key.
	 */
	getById(id: string): Promise<AiProvider | undefined | null>;

	/**
	 * Get enabled models from all active providers.
	 * Returns a map of providerId → array of model IDs.
	 */
	getEnabledModels(): Promise<Record<string, string[]>>;
}
