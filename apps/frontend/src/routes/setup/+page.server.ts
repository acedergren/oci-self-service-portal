import { redirect, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		// Check if setup is already complete
		const response = await fetch('/api/setup/status');

		if (response.ok) {
			const { setupComplete } = await response.json();

			// If setup is already complete, redirect to home
			if (setupComplete) {
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
