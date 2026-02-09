// Stub for SvelteKit App.Locals type used by shared server modules.
// The actual type is defined in apps/frontend/src/app.d.ts.
// This stub allows tsc to compile the shared package standalone.

declare global {
	namespace App {
		interface Locals {
			dbAvailable: boolean;
			user?: import('./server/auth/config').User;
			session?: import('./server/auth/config').Session;
			permissions: import('./server/auth/rbac').Permission[];
			requestId: string;
			apiKeyContext?: import('./server/api/types').ApiKeyContext;
		}
	}
}

export {};
