import { createAuthClient } from 'better-auth/svelte';
import { genericOAuthClient, organizationClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	plugins: [genericOAuthClient(), organizationClient()],
});
