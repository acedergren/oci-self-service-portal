import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		// SSR prefetch AI providers for initialData pattern
		const response = await fetch('/api/admin/ai-providers');

		if (response.ok) {
			const providers = await response.json();
			return {
				initialProviders: providers
			};
		}
	} catch (error) {
		console.error('Failed to prefetch AI providers:', error);
	}

	return {
		initialProviders: []
	};
};
