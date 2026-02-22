import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ parent }) => {
	const { user, session } = await parent();

	if (!user) {
		throw redirect(303, '/login');
	}

	// Enforce admin role — non-admin users cannot access admin pages
	if (session?.role !== 'admin') {
		throw redirect(303, '/');
	}

	return { user };
};
