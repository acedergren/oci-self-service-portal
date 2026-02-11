import type { LayoutServerLoad } from './$types';
import { FASTIFY_URL } from '$lib/server/feature-flags.js';
import { createLogger } from '@portal/shared/server/logger';

/**
 * Root layout server load function.
 *
 * Fetches the user session from Fastify's auth endpoint during SSR.
 * Forwards the cookie header from the incoming request for session validation.
 *
 * After Phase C-1.01 (Better Auth in Fastify), all auth logic lives in the
 * Fastify backend. SvelteKit just forwards cookies and hydrates the session.
 */
export const load: LayoutServerLoad = async ({ request, locals, fetch }) => {
	let user = null;
	let session = null;

	try {
		// Fetch session from Fastify, forwarding cookies for auth validation
		const cookieHeader = request.headers.get('cookie');

		const sessionResponse = await fetch(`${FASTIFY_URL}/api/auth/session`, {
			headers: {
				...(cookieHeader ? { cookie: cookieHeader } : {})
			}
		});

		if (sessionResponse.ok) {
			const sessionData = await sessionResponse.json();
			user = sessionData.user ?? null;
			session = sessionData.session ?? null;
		}
	} catch (err) {
		// Log error but don't fail SSR - render page with null session
		createLogger('layout').error({ err }, 'Failed to fetch session from Fastify');
	}

	return {
		user,
		session,
		dbAvailable: locals.dbAvailable
	};
};
