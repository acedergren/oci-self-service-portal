/**
 * GET /api/setup/status
 *
 * Returns setup wizard completion status.
 * This endpoint is always accessible, even after setup is complete.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	settingsRepository,
	idpRepository,
	aiProviderRepository,
	validateSetupToken
} from '@portal/server/admin';
import { createLogger } from '@portal/server/logger';
import { toPortalError } from '@portal/server/errors';

const log = createLogger('setup');

export const GET: RequestHandler = async ({ request }) => {
	const requestId = request.headers.get('X-Request-Id') ?? 'unknown';

	try {
		// Require setup token for bootstrap auth
		const denied = await validateSetupToken(request);
		if (denied) return denied;

		// Check if setup is complete
		const isSetupComplete = await settingsRepository.isSetupComplete();

		// Count active providers
		const [idps, aiProviders] = await Promise.all([
			idpRepository.listActive(),
			aiProviderRepository.listActive()
		]);

		const defaultIdp = idps.find((idp) => idp.isDefault);
		const defaultAiProvider = aiProviders.find((p) => p.isDefault);

		const status = {
			isSetupComplete,
			steps: {
				idp: idps.length > 0,
				aiProvider: aiProviders.length > 0,
				settings: isSetupComplete
			},
			activeIdpCount: idps.length,
			activeAiProviderCount: aiProviders.length,
			defaultIdpId: defaultIdp?.id ?? null,
			defaultAiProviderId: defaultAiProvider?.id ?? null
		};

		log.info({ requestId, status }, 'setup status checked');

		return json(status);
	} catch (err) {
		log.error({ err, requestId }, 'failed to get setup status');
		const portalError = toPortalError(err);
		return json(portalError.toResponseBody(), { status: portalError.statusCode });
	}
};
