// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Session, User } from '@portal/shared/server/auth/config';
import type { Permission } from '@portal/shared/server/auth/rbac';
import type { ApiKeyContext } from '@portal/shared/server/api/types';

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
