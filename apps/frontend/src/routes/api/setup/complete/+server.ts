/**
 * POST /api/setup/complete
 *
 * Mark setup wizard as complete and reload auth configuration.
 * This locks all other setup endpoints from further modifications.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	settingsRepository,
	idpRepository,
	aiProviderRepository,
	validateSetupToken,
	invalidateSetupToken
} from '@portal/shared/server/admin';
import { reloadAuth } from '$lib/server/auth/config.js';
import { createLogger } from '$lib/server/logger';
import { toPortalError } from '$lib/server/errors.js';

const log = createLogger('setup');

export const POST: RequestHandler = async ({ request }) => {
	const requestId = request.headers.get('X-Request-Id') ?? 'unknown';

	try {
		// Require setup token for bootstrap auth
		const denied = await validateSetupToken(request);
		if (denied) return denied;

		// Validate prerequisites before marking complete
		const [idps, aiProviders] = await Promise.all([
			idpRepository.listActive(),
			aiProviderRepository.listActive()
		]);

		if (idps.length === 0) {
			return json({ error: 'Cannot complete setup: no IDP providers configured' }, { status: 400 });
		}

		if (aiProviders.length === 0) {
			return json({ error: 'Cannot complete setup: no AI providers configured' }, { status: 400 });
		}

		// Mark setup as complete
		await settingsRepository.markSetupComplete();

		// Invalidate setup token — no more setup endpoint access
		invalidateSetupToken();

		// Reload auth configuration to pick up new IDP providers
		try {
			await reloadAuth();
			log.info({ requestId }, 'auth configuration reloaded after setup completion');
		} catch (authErr) {
			log.error({ err: authErr, requestId }, 'failed to reload auth after setup completion');
			// Continue anyway — setup is marked complete, auth will reload on next request
		}

		log.info(
			{
				requestId,
				idpCount: idps.length,
				aiProviderCount: aiProviders.length
			},
			'setup wizard completed successfully'
		);

		return json({
			success: true,
			message: 'Setup completed successfully',
			idpCount: idps.length,
			aiProviderCount: aiProviders.length
		});
	} catch (err) {
		log.error({ err, requestId }, 'failed to complete setup');
		const portalError = toPortalError(err);
		return json(portalError.toResponseBody(), { status: portalError.statusCode });
	}
};
