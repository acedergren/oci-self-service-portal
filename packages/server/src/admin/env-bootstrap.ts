/**
 * Environment variable → database bootstrap.
 *
 * On every startup, syncs environment-configured IDP and AI provider
 * settings into the Oracle admin tables. This ensures:
 *
 * 1. The admin panel shows providers that are already working via env vars
 * 2. Admin panel edits can override env-var defaults without redeployment
 * 3. The setup wizard is auto-completed when both providers are configured
 *
 * All operations are idempotent: existing DB records are never overwritten.
 * Errors are caught and logged — bootstrap failure must not prevent app startup.
 */

import { createLogger } from '../logger.js';

const log = createLogger('env-bootstrap');

/**
 * Bootstrap environment variables into Oracle admin tables.
 *
 * Call after the Oracle plugin has initialized the connection pool and
 * run migrations, but before auth plugin registration.
 */
export async function bootstrapEnvToDatabase(): Promise<void> {
	try {
		const idpCreated = await bootstrapIdp();
		const aiCreated = await bootstrapAiProvider();

		// Auto-complete setup if both providers exist
		if (idpCreated !== null && aiCreated !== null) {
			await autoCompleteSetup();
		}
	} catch (err) {
		log.warn({ err }, 'Env bootstrap failed — app will continue with env-var config');
	}
}

// ── IDP Bootstrap ─────────────────────────────────────────────────────────

/**
 * Sync OCI_IAM_* env vars to the idp_providers table.
 * Returns true if a record was created, false if skipped, null if no env vars.
 */
async function bootstrapIdp(): Promise<boolean | null> {
	const clientId = process.env.OCI_IAM_CLIENT_ID;
	const clientSecret = process.env.OCI_IAM_CLIENT_SECRET;

	if (!clientId || !clientSecret) {
		log.debug('No OCI_IAM_CLIENT_ID/SECRET — skipping IDP bootstrap');
		return null;
	}

	const { idpRepository } = await import('./idp-repository.js');

	// Idempotent: skip if oci-iam already exists in DB
	const existing = await idpRepository.getByProviderId('oci-iam');
	if (existing) {
		log.debug('IDP oci-iam already exists in database — skipping bootstrap');
		return false;
	}

	const scopes = process.env.OCI_IAM_SCOPES || 'openid,email,profile,urn:opc:idm:__myscopes__';

	const extraConfig: Record<string, unknown> = { source: 'env' };
	if (process.env.OCI_IAM_IDP_NAME) {
		extraConfig.idpName = process.env.OCI_IAM_IDP_NAME;
	}

	await idpRepository.create({
		providerId: 'oci-iam',
		displayName: 'OCI Identity',
		providerType: 'idcs',
		discoveryUrl: process.env.OCI_IAM_DISCOVERY_URL ?? undefined,
		clientId,
		clientSecret,
		scopes,
		pkceEnabled: true,
		status: 'active',
		isDefault: true,
		sortOrder: 0,
		adminGroups: process.env.OCI_IAM_ADMIN_GROUPS ?? undefined,
		operatorGroups: process.env.OCI_IAM_OPERATOR_GROUPS ?? undefined,
		defaultOrgId: process.env.OCI_IAM_DEFAULT_ORG_ID ?? undefined,
		extraConfig
	});

	log.info('Bootstrapped IDP oci-iam from environment variables');
	return true;
}

// ── AI Provider Bootstrap ─────────────────────────────────────────────────

/**
 * Sync OCI GenAI env vars to the ai_providers table.
 * Returns true if a record was created, false if skipped, null if no env vars.
 */
async function bootstrapAiProvider(): Promise<boolean | null> {
	const region = process.env.OCI_REGION;

	if (!region) {
		log.debug('No OCI_REGION — skipping AI provider bootstrap');
		return null;
	}

	const { aiProviderRepository } = await import('./ai-provider-repository.js');

	// Idempotent: skip if oci-genai already exists in DB
	const existing = await aiProviderRepository.getByProviderId('oci-genai');
	if (existing) {
		log.debug('AI provider oci-genai already exists in database — skipping bootstrap');
		return false;
	}

	const modelId = process.env.OCI_GENAI_MODEL_ID;

	await aiProviderRepository.create({
		providerId: 'oci-genai',
		displayName: 'OCI Generative AI',
		providerType: 'oci',
		region,
		// OCI GenAI uses instance principal auth — no API key needed
		status: 'active',
		isDefault: true,
		sortOrder: 0,
		modelAllowlist: modelId ? [modelId] : undefined,
		defaultModel: modelId ?? undefined,
		extraConfig: { source: 'env' }
	});

	log.info({ region, modelId }, 'Bootstrapped AI provider oci-genai from environment variables');
	return true;
}

// ── Auto-complete Setup ───────────────────────────────────────────────────

/**
 * If both IDP and AI provider exist in DB and setup isn't complete,
 * mark setup as complete automatically.
 */
async function autoCompleteSetup(): Promise<void> {
	try {
		const { settingsRepository } = await import('./settings-repository.js');
		const { idpRepository } = await import('./idp-repository.js');
		const { aiProviderRepository } = await import('./ai-provider-repository.js');

		const isComplete = await settingsRepository.isSetupComplete();
		if (isComplete) return;

		// Verify both providers actually exist
		const idpCount = await idpRepository.countActive();
		const aiCount = await aiProviderRepository.countActive();

		if (idpCount > 0 && aiCount > 0) {
			await settingsRepository.markSetupComplete();
			log.info('Auto-completed setup — IDP and AI provider both configured');
		}
	} catch (err) {
		log.warn({ err }, 'Failed to auto-complete setup — wizard will remain available');
	}
}
