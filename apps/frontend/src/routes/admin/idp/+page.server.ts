import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		// SSR prefetch IDPs for initialData pattern
		const response = await fetch('/api/admin/idp');

		if (response.ok) {
			const idps = await response.json();
			return {
				initialIdps: idps
			};
		}
	} catch (error) {
		console.error('Failed to prefetch IDPs:', error);
	}

	return {
		initialIdps: []
	};
};
