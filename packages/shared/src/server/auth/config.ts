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
 *   - Redirect URI: {BETTER_AUTH_URL}/api/auth/callback/oci-iam
 *   - Allowed scopes: openid, email, profile, urn:opc:idm:__myscopes__
 */
import { betterAuth } from 'better-auth';
import { genericOAuth, organization } from 'better-auth/plugins';
import { oracleAdapter } from './oracle-adapter';
import { createLogger } from '../logger';
import {
	stashIdcsProfile,
	consumeIdcsProfile,
	resolveIdcsOrg,
	provisionFromIdcsGroups
} from './idcs-provisioning';

const log = createLogger('auth-config');

/**
 * Maps IDCS group names to portal roles.
 *
 * IDCS groups come from the `groups` claim in the userinfo response.
 * The first match wins (ordered highest to lowest privilege).
 *
 * Configurable via OCI_IAM_ADMIN_GROUPS, OCI_IAM_OPERATOR_GROUPS env vars
 * (comma-separated group names). Defaults to common IDCS group patterns.
 */
const IDCS_ADMIN_GROUPS = (
	process.env.OCI_IAM_ADMIN_GROUPS || 'PortalAdmins,OCI_Administrators,Administrators'
)
	.split(',')
	.map((s) => s.trim());
const IDCS_OPERATOR_GROUPS = (
	process.env.OCI_IAM_OPERATOR_GROUPS || 'PortalOperators,OCI_Operators,CloudOperators'
)
	.split(',')
	.map((s) => s.trim());

export function mapIdcsGroupsToRole(groups: string[]): 'admin' | 'operator' | 'viewer' {
	const groupSet = new Set(groups);
	if (IDCS_ADMIN_GROUPS.some((g) => groupSet.has(g))) return 'admin';
	if (IDCS_OPERATOR_GROUPS.some((g) => groupSet.has(g))) return 'operator';
	return 'viewer';
}

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
				`SELECT account_id FROM account
				 WHERE user_id = :userId AND provider_id = 'oci-iam'
				 FETCH FIRST 1 ROWS ONLY`,
				{ userId }
			);
			if (!result.rows?.length) return null;
			return (result.rows[0] as Record<string, unknown>).ACCOUNT_ID as string;
		});
	} catch {
		return null;
	}
}

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
					// urn:opc:idm:__myscopes__ requests all IDCS app scopes,
					// which includes group and app role claims in the token
					scopes: ['openid', 'email', 'profile', 'urn:opc:idm:__myscopes__'],
					pkce: true,
					mapProfileToUser: (profile: Record<string, unknown>) => {
						const p = profile as IdcsProfile;
						const displayName = p.user_displayname || p.name || p.email || p.sub;

						// Stash IDCS groups for post-login provisioning
						if (p.groups?.length) {
							stashIdcsProfile(p.sub, p.groups, p.user_tenantname);
							log.info(
								{ sub: p.sub, groups: p.groups, tenant: p.user_tenantname },
								'IDCS user signed in with groups'
							);
						}

						return {
							name: displayName,
							email: p.email || `${p.sub}@idcs.local`,
							image: undefined
						};
					}
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
						if (!cached || !cached.groups.length) return;

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

export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;
