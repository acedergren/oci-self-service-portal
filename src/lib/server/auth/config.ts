/**
 * Better Auth server configuration.
 *
 * Sets up authentication with:
 * - OCI IAM Identity Domains via genericOAuth (OIDC + PKCE)
 * - Organization plugin for multi-tenancy
 * - Custom Oracle database adapter
 */
import { betterAuth } from 'better-auth';
import { genericOAuth, organization } from 'better-auth/plugins';
import { oracleAdapter } from './oracle-adapter.js';

export const auth = betterAuth({
	database: oracleAdapter(),
	baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5173',
	// Fallback needed for build (SvelteKit post-build runs in NODE_ENV=production).
	// Runtime validation in hooks.server.ts warns if secret is missing in production.
	secret: process.env.BETTER_AUTH_SECRET || 'dev-build-only-secret',
	plugins: [
		genericOAuth({
			config: [
				{
					providerId: 'oci-iam',
					clientId: process.env.OCI_IAM_CLIENT_ID!,
					clientSecret: process.env.OCI_IAM_CLIENT_SECRET!,
					discoveryUrl: process.env.OCI_IAM_DISCOVERY_URL,
					scopes: ['openid', 'email', 'profile'],
					pkce: true
				}
			]
		}),
		organization({
			allowUserToCreateOrganization: false
		})
	],
	session: {
		expiresIn: 60 * 60 * 24 * 30, // 30 days
		updateAge: 60 * 60 * 24 // refresh session token every 24h
	},
	user: {
		modelName: 'user',
		fields: {
			name: 'display_name'
		}
	}
});

export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;
