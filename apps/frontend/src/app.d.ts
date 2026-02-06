// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Session, User } from '@portal/shared/server/auth/config.js';
import type { Permission } from '@portal/shared/server/auth/rbac.js';
import type { ApiKeyContext } from '@portal/shared/server/api/types.js';

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
