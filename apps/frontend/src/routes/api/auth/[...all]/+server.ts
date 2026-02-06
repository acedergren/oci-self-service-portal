import { auth } from '@portal/shared/server/auth/config';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	return svelteKitHandler({ event, resolve: () => new Response(), auth, building });
};

export const POST: RequestHandler = async (event) => {
	return svelteKitHandler({ event, resolve: () => new Response(), auth, building });
};
