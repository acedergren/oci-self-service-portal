import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		// SSR prefetch portal settings for initialData pattern
		const response = await fetch('/api/admin/settings');

		if (response.ok) {
			const settings = await response.json();
			return {
				initialSettings: settings
			};
		}
	} catch (error) {
		console.error('Failed to prefetch portal settings:', error);
	}

	return {
		initialSettings: null
	};
};
