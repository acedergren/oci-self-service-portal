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

		// Note: Auth configuration reloads automatically via Fastify plugins on restart

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
