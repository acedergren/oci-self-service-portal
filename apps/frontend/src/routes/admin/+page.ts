import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	// Redirect to IDP management as the default admin page
	throw redirect(303, '/admin/idp');
};
