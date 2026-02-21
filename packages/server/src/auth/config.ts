/**
 * Better Auth server configuration.
 *
 * Sets up authentication with:
 * - OCI IDCS (Identity Cloud Service) via genericOAuth (OIDC + PKCE)
 * - Organization plugin for multi-tenancy
 * - Custom Oracle database adapter
 * - IDCS group-to-role mapping for automatic RBAC provisioning
 *
 * IDCS Configuration:
 *   OCI_IAM_DISCOVERY_URL should point to your IDCS domain:
 *   https://idcs-<GUID>.identity.oraclecloud.com/.well-known/openid-configuration
 *
 *   The IDCS application must be configured as a "Confidential Application" with:
 *   - Grant type: Authorization Code
 *   - Redirect URI: {BETTER_AUTH_URL}/api/auth/oauth2/callback/oci-iam
 *   - Allowed scopes: openid, email, profile, urn:opc:idm:__myscopes__
 */
import { betterAuth } from 'better-auth';
import { genericOAuth, organization } from 'better-auth/plugins';
import { oracleAdapter } from './oracle-adapter';
import { createLogger } from '../logger';
import { AUTH_COOKIE_ATTRIBUTES, AUTH_COOKIE_SAME_SITE, AUTH_USE_SECURE_COOKIES } from './cookies';
import {
	stashIdcsProfile,
	consumeIdcsProfile,
	resolveIdcsOrg,
	provisionFromIdcsGroups
} from './idcs-provisioning';
import type { IdpProvider } from '../admin/types.js';

const log = createLogger('auth-config');
const isProduction = process.env.NODE_ENV === 'production';
const OAUTH_STATE_COOKIE_ATTRIBUTES = {
	...AUTH_COOKIE_ATTRIBUTES,
	sameSite: 'lax' as const
};

/**
 * Extract IDCS-specific claims from the OIDC profile.
 *
 * OCI IDCS returns these non-standard claims:
 * - `user_displayname`: Full display name
 * - `user_tenantname`: IDCS tenant name
 * - `user_locale`: User's locale
 * - `groups`: Array of IDCS group names (requires urn:opc:idm:__myscopes__ scope)
 * - `app_roles`: Application-specific roles defined in IDCS
 */
interface IdcsProfile {
	sub: string;
	email?: string;
	name?: string;
	user_displayname?: string;
	user_tenantname?: string;
	groups?: string[];
	app_roles?: string[];
	[key: string]: unknown;
}

/**
 * Look up the OIDC subject (sub) for a user from the Better Auth account table.
 * Returns null if the user has no OIDC account (e.g., local user).
 */
async function findOidcSub(userId: string): Promise<string | null> {
	try {
		const { withConnection } = await import('../oracle/connection');
		return await withConnection(async (conn) => {
			const result = await conn.execute(
				`SELECT account_id FROM accounts
				 WHERE user_id = :userId AND provider_id = 'oci-iam'
				 FETCH FIRST 1 ROWS ONLY`,
				{ userId }
			);
			if (!result.rows?.length) return null;
			return (result.rows[0] as Record<string, unknown>).ACCOUNT_ID as string;
		});
	} catch (err) {
		log.error({ err, userId }, 'Failed to look up OIDC sub for user');
		return null;
	}
}

const oidcClientId = process.env.OCI_IAM_CLIENT_ID;
const oidcClientSecret = process.env.OCI_IAM_CLIENT_SECRET;
const hasOidcConfig = !!(oidcClientId && oidcClientSecret);

if (!hasOidcConfig) {
	if (isProduction) {
		throw new Error(
			'Missing required environment variable OCI_IAM_CLIENT_ID. ' +
				'Ensure OCI IAM OIDC is configured correctly. ' +
				'See docs/AUTH_PLUGIN_DESIGN.md for setup instructions.'
		);
	}
	log.warn('OCI_IAM_CLIENT_ID / OCI_IAM_CLIENT_SECRET not set — OIDC login disabled (dev mode)');
}

// ── Mutable OAuth config array ────────────────────────────────────────────
// genericOAuth closes over this array reference. Route handlers use
// config.find() on each request, so mutating contents via splice() is
// picked up without recreating the betterAuth() instance.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const oauthConfigs: any[] = [];

// Seed from env vars for initial startup (before DB is available)
if (hasOidcConfig) {
	oauthConfigs.push({
		providerId: 'oci-iam',
		clientId: oidcClientId!,
		clientSecret: oidcClientSecret!,
		discoveryUrl: process.env.OCI_IAM_DISCOVERY_URL,
		scopes: ['openid', 'email', 'profile', 'urn:opc:idm:__myscopes__'],
		pkce: true,
		...(process.env.OCI_IAM_IDP_NAME && {
			authorizationUrlParams: {
				idp: process.env.OCI_IAM_IDP_NAME
			}
		}),
		mapProfileToUser: buildIdcsProfileMapper()
	});
}

/**
 * Build the IDCS profile mapper for mapProfileToUser.
 * Captures IDCS-specific claims during OAuth callback for post-login provisioning.
 *
 * @param idp - Optional IDP record for per-provider configuration (future use)
 */
function buildIdcsProfileMapper(_idp?: IdpProvider) {
	return (profile: Record<string, unknown>) => {
		const p = profile as IdcsProfile;
		const displayName = p.user_displayname || p.name || p.email || p.sub;

		// Stash IDCS profile for post-login provisioning.
		// Always stash even without groups — provisioning assigns
		// viewer role as minimum so the user is at least in org_members.
		stashIdcsProfile(p.sub, p.groups ?? [], p.user_tenantname);
		log.info(
			{ sub: p.sub, groups: p.groups ?? [], tenant: p.user_tenantname },
			'IDCS user signed in'
		);

		return {
			name: displayName,
			email: p.email || `${p.sub}@idcs.local`,
			image: undefined
		};
	};
}

export const auth = betterAuth({
	database: oracleAdapter(),
	baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5173',
	// Fallback needed for build (SvelteKit post-build runs in NODE_ENV=production).
	// Runtime validation in hooks.server.ts warns if secret is missing in production.
	secret: process.env.BETTER_AUTH_SECRET || 'dev-build-only-secret',
	// Trusted origins: allow cross-origin auth requests from SvelteKit frontend.
	// Required for cookie-based authentication when frontend (port 5173) calls Fastify API (port 3000).
	// In production, this should be set via BETTER_AUTH_TRUSTED_ORIGINS env var.
	trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',') || [
		'http://localhost:5173', // SvelteKit dev server
		'http://localhost:3000' // Fastify API (for same-origin requests)
	],
	advanced: {
		useSecureCookies: AUTH_USE_SECURE_COOKIES,
		defaultCookieAttributes: AUTH_COOKIE_ATTRIBUTES,
		cookies: {
			session_token: {
				attributes: AUTH_COOKIE_ATTRIBUTES
			},
			session_data: {
				attributes: AUTH_COOKIE_ATTRIBUTES
			},
			dont_remember: {
				attributes: AUTH_COOKIE_ATTRIBUTES
			},
			oauth_state: {
				attributes: OAUTH_STATE_COOKIE_ATTRIBUTES
			}
		}
	},
	plugins: [
		// Always register genericOAuth — config array is mutated at runtime
		// by reloadAuthProviders() after DB becomes available.
		genericOAuth({ config: oauthConfigs }),
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
	},
	databaseHooks: {
		session: {
			create: {
				after: async (session) => {
					// After session creation (login), provision IDCS org membership.
					// The IDCS profile was stashed during mapProfileToUser (same request).
					const userId = (session as Record<string, unknown>).userId as string | undefined;
					if (!userId) return;

					// Look up the user's OIDC sub to consume the cached profile.
					// Better Auth stores the OIDC subject in the account table.
					// We use the userId to find the matching account.
					try {
						const accountSub = await findOidcSub(userId);
						if (!accountSub) return;

						const cached = consumeIdcsProfile(accountSub);
						if (!cached) return;
						// groups may be empty (no IDCS groups claim) — provisionFromIdcsGroups
						// will still assign at least viewer role via mapIdcsGroupsToRole([]).

						const orgId = await resolveIdcsOrg(userId, cached.tenantName);
						if (!orgId) {
							log.warn({ userId, tenantName: cached.tenantName }, 'no org resolved for IDCS user');
							return;
						}

						await provisionFromIdcsGroups(userId, orgId, cached.groups);
					} catch (err) {
						log.error({ err, userId }, 'IDCS post-login provisioning failed');
					}
				}
			}
		}
	}
});

if (!isProduction) {
	log.debug(
		{
			secureCookies: AUTH_USE_SECURE_COOKIES,
			sameSite: AUTH_COOKIE_SAME_SITE
		},
		'Better Auth cookie settings resolved'
	);
}

/**
 * Reload OAuth provider configs from the database.
 *
 * Called on app ready and after admin IDP mutations.
 * Atomically replaces array contents so Better Auth picks up changes on next request.
 * Skips providers without a decrypted client secret (can't authenticate without one).
 */
export async function reloadAuthProviders(): Promise<void> {
	const { idpRepository } = await import('../admin/idp-repository.js');
	const providers = await idpRepository.list();
	const active = providers.filter((p) => p.status === 'active' && p.clientSecret);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const newConfigs: any[] = active.map((idp) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const config: Record<string, any> = {
			providerId: idp.providerId,
			clientId: idp.clientId,
			clientSecret: idp.clientSecret,
			scopes: idp.scopes.split(',').map((s) => s.trim()),
			pkce: idp.pkceEnabled
		};

		// OIDC discovery endpoint (preferred) or explicit URLs
		if (idp.discoveryUrl) config.discoveryUrl = idp.discoveryUrl;
		if (idp.authorizationUrl) config.authorizationUrl = idp.authorizationUrl;
		if (idp.tokenUrl) config.tokenUrl = idp.tokenUrl;
		if (idp.userinfoUrl) config.userinfoUrl = idp.userinfoUrl;

		// IDP hint from extraConfig (for IDCS federated IdPs)
		const idpName = idp.extraConfig?.idpName as string | undefined;
		if (idpName) {
			config.authorizationUrlParams = { idp: idpName };
		}

		// Attach IDCS profile mapper for OCI IAM / IDCS providers
		if (idp.providerType === 'idcs' || idp.providerId === 'oci-iam') {
			config.mapProfileToUser = buildIdcsProfileMapper(idp);
		}

		return config;
	});

	// Atomic replacement: splice preserves the array reference that
	// genericOAuth's route handlers close over.
	oauthConfigs.splice(0, oauthConfigs.length, ...newConfigs);
	log.info(
		{ count: newConfigs.length, providerIds: newConfigs.map((c) => c.providerId) },
		'Reloaded auth providers from database'
	);
}

export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;
