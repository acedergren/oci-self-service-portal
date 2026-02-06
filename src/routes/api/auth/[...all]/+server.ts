import { auth } from '$lib/server/auth/config.js';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	return svelteKitHandler({ event, resolve: () => new Response(), auth, building });
};

export const POST: RequestHandler = async (event) => {
	return svelteKitHandler({ event, resolve: () => new Response(), auth, building });
};
