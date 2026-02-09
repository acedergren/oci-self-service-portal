/**
 * POST /api/setup/idp
 *
 * Create the first IDP provider during setup.
 * Self-locking: returns 403 if setup is already complete.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	settingsRepository,
	idpRepository,
	CreateIdpInputSchema,
	validateSetupToken,
	stripIdpSecrets
} from '@portal/shared/server/admin';
import { createLogger } from '$lib/server/logger';
import { toPortalError } from '$lib/server/errors.js';

const log = createLogger('setup');

export const POST: RequestHandler = async ({ request }) => {
	const requestId = request.headers.get('X-Request-Id') ?? 'unknown';

	try {
		// Require setup token for bootstrap auth
		const denied = await validateSetupToken(request);
		if (denied) return denied;

		// Parse and validate input
		const body = await request.json();
		const input = CreateIdpInputSchema.parse(body);

		// Create IDP provider
		const idp = await idpRepository.create(input);

		log.info(
			{ requestId, providerId: idp.providerId, providerType: idp.providerType },
			'IDP provider created during setup'
		);

		return json(stripIdpSecrets(idp), { status: 201 });
	} catch (err) {
		log.error({ err, requestId }, 'failed to create IDP provider');

		const isValidationError = err instanceof Error && 'issues' in err;
		if (isValidationError) {
			return json({ error: 'Validation failed', details: (err as any).issues }, { status: 400 });
		}

		const portalError = toPortalError(err);
		return json(portalError.toResponseBody(), { status: portalError.statusCode });
	}
};
