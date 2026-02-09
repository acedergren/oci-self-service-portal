import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { hasPermission } from '@portal/shared/server/auth/rbac.js';
import type { Permission } from '@portal/shared/server/auth/rbac.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	const session = await locals.auth();

	if (!session?.user) {
		throw redirect(303, '/login');
	}

	// Enforce admin:all permission — non-admin users must not access admin pages
	const userPerms = (locals.permissions ?? []) as Permission[];
	if (!hasPermission(userPerms, 'admin:all')) {
		throw redirect(303, '/');
	}

	return {
		user: session.user
	};
};
