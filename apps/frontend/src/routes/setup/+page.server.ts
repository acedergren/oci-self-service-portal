import { redirect, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { settingsRepository, idpRepository, aiProviderRepository } from '@portal/server/admin';

export const load: PageServerLoad = async ({ fetch }) => {
	// Check setup status directly via DB (avoids Vite proxy round-trip in SSR context)
	let isComplete = false;
	try {
		isComplete = await settingsRepository.isSetupComplete();
	} catch {
		// DB unavailable — allow setup to proceed in degraded mode
	}

	// Allow re-entry if providers are missing (admin may have deleted them)
	if (isComplete) {
		const [activeIdps, activeAiProviders] = await Promise.all([
			idpRepository.listActive(),
			aiProviderRepository.listActive()
		]);
		if (activeIdps.length > 0 && activeAiProviders.length > 0) {
			throw redirect(303, '/');
		}
	}

	// Try to detect environment variables for pre-filling the form
	let detectedEnv: Record<string, string> = {};
	try {
		const envResponse = await fetch('/api/setup/detect-env');
		if (envResponse.ok) {
			detectedEnv = await envResponse.json();
		}
	} catch (err) {
		if (isRedirect(err)) throw err;
		// Non-fatal — form still usable without pre-filled env values
	}

	return { detectedEnv };
};
