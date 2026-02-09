// Stub for SvelteKit App.Locals type referenced by @portal/shared modules.
// The Fastify API doesn't use SvelteKit, but shared auth modules reference
// App.Locals for backward compatibility with the SvelteKit frontend.

declare global {
	namespace App {
		interface Locals {
			dbAvailable: boolean;
			user?: unknown;
			session?: unknown;
			permissions: string[];
			requestId: string;
			apiKeyContext?: unknown;
		}
	}
}

export {};
