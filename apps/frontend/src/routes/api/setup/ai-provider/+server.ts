/**
 * POST /api/setup/ai-provider
 *
 * Create or update AI provider configuration during setup.
 * Self-locking: returns 403 if setup is already complete.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	settingsRepository,
	aiProviderRepository,
	CreateAiProviderInputSchema,
	validateSetupToken,
	stripAiProviderSecrets
} from '@portal/server/admin';
import { createLogger } from '@portal/server/logger';
import { toPortalError } from '@portal/server/errors';

const log = createLogger('setup');

export const POST: RequestHandler = async ({ request }) => {
	const requestId = request.headers.get('X-Request-Id') ?? 'unknown';

	try {
		// Require setup token for bootstrap auth
		const denied = await validateSetupToken(request);
		if (denied) return denied;

		// Parse and validate input
		const body = await request.json();
		const input = CreateAiProviderInputSchema.parse(body);

		// Create AI provider
		const provider = await aiProviderRepository.create(input);

		log.info(
			{ requestId, providerId: provider.providerId, providerType: provider.providerType },
			'AI provider created during setup'
		);

		return json(stripAiProviderSecrets(provider), { status: 201 });
	} catch (err) {
		log.error({ err, requestId }, 'failed to create AI provider');

		const isValidationError = err instanceof Error && 'issues' in err;
		if (isValidationError) {
			return json({ error: 'Validation failed', details: (err as any).issues }, { status: 400 });
		}

		const portalError = toPortalError(err);
		return json(portalError.toResponseBody(), { status: portalError.statusCode });
	}
};
