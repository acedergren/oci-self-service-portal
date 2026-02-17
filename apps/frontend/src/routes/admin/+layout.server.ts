import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const session = await locals.auth();

	if (!session || !locals.user) {
		throw redirect(303, '/login');
	}

	return {
		user: locals.user
	};
};
