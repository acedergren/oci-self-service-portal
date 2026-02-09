/**
 * Secret stripping utilities for admin API responses.
 *
 * These functions remove or mask decrypted secrets (clientSecret, apiKey)
 * from provider objects before returning them in HTTP responses.
 * Admins can see that a secret *exists* (via hasSecret: true) but never
 * the actual value.
 */
import type { IdpProvider, AiProvider } from './types.js';

/**
 * Strip clientSecret from an IDP provider for API response.
 * Replaces the decrypted secret with a boolean indicator.
 */
export function stripIdpSecrets<T extends Partial<IdpProvider>>(
	provider: T
): Omit<T, 'clientSecret'> & { hasClientSecret: boolean } {
	const { clientSecret, ...rest } = provider;
	return {
		...rest,
		hasClientSecret: !!clientSecret
	} as Omit<T, 'clientSecret'> & { hasClientSecret: boolean };
}

/**
 * Strip clientSecret from an array of IDP providers.
 */
export function stripIdpSecretsArray<T extends Partial<IdpProvider>>(
	providers: T[]
): Array<Omit<T, 'clientSecret'> & { hasClientSecret: boolean }> {
	return providers.map(stripIdpSecrets);
}

/**
 * Strip apiKey from an AI provider for API response.
 * Replaces the decrypted key with a boolean indicator.
 */
export function stripAiProviderSecrets<T extends Partial<AiProvider>>(
	provider: T
): Omit<T, 'apiKey'> & { hasApiKey: boolean } {
	const { apiKey, ...rest } = provider;
	return {
		...rest,
		hasApiKey: !!apiKey
	} as Omit<T, 'apiKey'> & { hasApiKey: boolean };
}

/**
 * Strip apiKey from an array of AI providers.
 */
export function stripAiProviderSecretsArray<T extends Partial<AiProvider>>(
	providers: T[]
): Array<Omit<T, 'apiKey'> & { hasApiKey: boolean }> {
	return providers.map(stripAiProviderSecrets);
}
