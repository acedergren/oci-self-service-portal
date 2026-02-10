// Stub for SvelteKit App.Locals type used by server modules.
// The actual type is defined in apps/frontend/src/app.d.ts.
// This stub allows tsc to compile the server package standalone.

declare global {
	namespace App {
		interface Locals {
			dbAvailable: boolean;
			user?: import('./auth/config').User;
			session?: import('./auth/config').Session;
			permissions: import('./auth/rbac').Permission[];
			requestId: string;
			apiKeyContext?: import('@portal/types/server/api/types').ApiKeyContext;
		}
	}
}

export {};
