// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Session, User } from '$lib/server/auth/config.js';
import type { Permission } from '$lib/server/auth/rbac.js';
import type { ApiKeyContext } from '$lib/server/api/types.js';

declare global {
	namespace App {
		interface Locals {
			dbAvailable: boolean;
			user?: User;
			session?: Session;
			permissions: Permission[];
			requestId: string;
			apiKeyContext?: ApiKeyContext;
		}
	}
}

export {};
