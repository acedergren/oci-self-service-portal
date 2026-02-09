/**
 * Admin module barrel export.
 *
 * Central export point for all admin-related functionality:
 * - Type definitions and Zod schemas
 * - IDP provider repository (encrypted secrets)
 * - AI provider repository (encrypted API keys)
 * - Portal settings repository (key-value config)
 */

// Type exports
export * from './types.js';

// Repository exports
export { idpRepository } from './idp-repository.js';
export { aiProviderRepository } from './ai-provider-repository.js';
export { settingsRepository } from './settings-repository.js';

// Security utilities
export {
	validateSetupToken,
	initSetupToken,
	invalidateSetupToken,
	_getSetupToken,
	_resetSetupToken
} from './setup-token.js';
export {
	stripIdpSecrets,
	stripIdpSecretsArray,
	stripAiProviderSecrets,
	stripAiProviderSecretsArray
} from './strip-secrets.js';
