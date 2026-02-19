import { redirect, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		// Check if setup is already complete.
		// Note: this endpoint requires a setup token; when setup is done the token
		// is invalidated and the API returns 403 {"error":"Setup is already complete"}.
		// Both 403 and a successful response with setupComplete=true should redirect.
		const response = await fetch('/api/setup/status');

		if (response.status === 403) {
			// 403 means setup is complete and the setup token is gone — redirect to home
			throw redirect(303, '/');
		}

		if (response.ok) {
			const data = await response.json();

			// Handle both response shapes: {setupComplete} and {isSetupComplete}
			if (data.setupComplete || data.isSetupComplete) {
				throw redirect(303, '/');
			}
		}

		// Try to detect environment variables for pre-filling
		const envResponse = await fetch('/api/setup/detect-env');
		const detectedEnv = envResponse.ok ? await envResponse.json() : {};

		return {
			detectedEnv
		};
	} catch (error) {
		// If it's a redirect, re-throw it
		if (isRedirect(error)) {
			throw error;
		}

		// Otherwise, allow setup to proceed (setup status check failed)
		return {
			detectedEnv: {}
		};
	}
};
