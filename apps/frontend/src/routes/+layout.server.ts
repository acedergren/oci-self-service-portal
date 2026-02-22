import { redirect, isRedirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { createLogger } from '@portal/server/logger';
import { settingsRepository, idpRepository, aiProviderRepository } from '@portal/server/admin';

// Fastify backend URL for session fetch during SSR
const FASTIFY_URL = process.env.FASTIFY_URL || 'http://localhost:3001';

const log = createLogger('layout');

/**
 * Root layout server load function.
 *
 * Performs three checks in order:
 * 1. Database availability (from hooks.server.ts)
 * 2. Setup completeness (IDP + AI provider configured)
 * 3. Session fetch from Fastify backend
 *
 * Returns a `systemStatus` field that the layout component uses to decide
 * whether to render the normal app or a branded error/status page.
 */
export const load: LayoutServerLoad = async ({ request, locals, fetch, url }) => {
	// 1. Database health gate — if Oracle is unreachable, show status page
	if (!locals.dbAvailable) {
		return {
			user: null,
			session: null,
			dbAvailable: false,
			systemStatus: 'database_unavailable' as const
		};
	}

	// 2. Setup completeness check (skip if already on /setup to avoid redirect loop)
	if (!url.pathname.startsWith('/setup')) {
		try {
			const [isComplete, activeIdps, activeAiProviders] = await Promise.all([
				settingsRepository.isSetupComplete(),
				idpRepository.listActive(),
				aiProviderRepository.listActive()
			]);

			if (!isComplete || activeIdps.length === 0 || activeAiProviders.length === 0) {
				throw redirect(303, '/setup');
			}
		} catch (err) {
			// SvelteKit redirects are thrown as special objects — must re-throw
			if (isRedirect(err)) throw err;
			// DB query failed mid-request — treat as degraded
			log.error({ err }, 'Setup completeness check failed');
			return {
				user: null,
				session: null,
				dbAvailable: false,
				systemStatus: 'database_unavailable' as const
			};
		}
	}

	// 3. Session fetch from Fastify (existing logic)
	let user = null;
	let session = null;

	try {
		const cookieHeader = request.headers.get('cookie');

		const sessionResponse = await fetch(`${FASTIFY_URL}/api/auth/get-session`, {
			headers: cookieHeader ? { cookie: cookieHeader } : {}
		});

		if (sessionResponse.ok) {
			const sessionData = await sessionResponse.json();
			user = sessionData?.user ?? null;
			session = sessionData?.session ?? null;
		}
	} catch (err) {
		// Fastify API is unreachable — show status page
		log.error({ err }, 'Failed to fetch session from Fastify');
		return {
			user: null,
			session: null,
			dbAvailable: true,
			systemStatus: 'api_unreachable' as const
		};
	}

	// Auth guard — runs after infrastructure checks so DB/API errors get their own error pages
	const publicPaths = ['/login', '/setup'];
	const isPublicPath = publicPaths.some(
		(p) => url.pathname === p || url.pathname.startsWith(p + '/')
	);

	// Unauthenticated user on a protected route → redirect to login with redirectTo
	if (!user && !isPublicPath) {
		const redirectTo = url.pathname + url.search;
		throw redirect(302, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
	}

	// Authenticated user visiting /login → bounce home
	if (user && url.pathname === '/login') {
		throw redirect(302, '/');
	}

	return {
		user,
		session,
		dbAvailable: true,
		systemStatus: 'ready' as const
	};
};
