import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user ?? null,
		session: locals.session ?? null,
		permissions: locals.permissions ?? [],
		dbAvailable: locals.dbAvailable
	};
};
