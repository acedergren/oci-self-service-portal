/**
 * IDCS auto-provisioning: maps IDCS group claims to portal org roles.
 *
 * When a user logs in via OCI IDCS, their group memberships determine:
 * 1. Which organization they belong to (based on IDCS tenant → org mapping)
 * 2. What role they get (admin/operator/viewer based on group membership)
 *
 * This runs post-login and updates the org_members table if needed.
 */
import { withConnection } from '../oracle/connection';
import { createLogger } from '../logger';

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
	.map((s) => s.trim().toLowerCase())
	.filter(Boolean);
const IDCS_OPERATOR_GROUPS = (
	process.env.OCI_IAM_OPERATOR_GROUPS || 'PortalOperators,OCI_Operators,CloudOperators'
)
	.split(',')
	.map((s) => s.trim().toLowerCase())
	.filter(Boolean);

/**
 * Options for overriding default group-to-role mapping.
 * When provided, these take precedence over env-var defaults.
 */
export interface GroupMappingOptions {
	adminGroups?: string[];
	operatorGroups?: string[];
}

export function mapIdcsGroupsToRole(
	groups: string[],
	options?: GroupMappingOptions
): 'admin' | 'operator' | 'viewer' {
	const adminGroups = options?.adminGroups?.map((g) => g.toLowerCase()) ?? IDCS_ADMIN_GROUPS;
	const operatorGroups =
		options?.operatorGroups?.map((g) => g.toLowerCase()) ?? IDCS_OPERATOR_GROUPS;
	const groupSet = new Set(groups.map((g) => g.toLowerCase()));
	if (adminGroups.some((g) => groupSet.has(g))) return 'admin';
	if (operatorGroups.some((g) => groupSet.has(g))) return 'operator';
	return 'viewer';
}

const log = createLogger('idcs-provisioning');

// ── IDCS Profile Cache ─────────────────────────────────────────────────────
// Short-lived in-memory cache for IDCS claims captured during mapProfileToUser.
// Consumed once during the hooks.after callback (same request cycle).
// TTL: 60s to handle any delay between profile mapping and session creation.

interface CachedIdcsProfile {
	groups: string[];
	tenantName?: string;
	cachedAt: number;
}

const CACHE_TTL_MS = 60_000;
const profileCache = new Map<string, CachedIdcsProfile>();

/**
 * Stash IDCS groups + tenant from the OAuth profile for later provisioning.
 * Called from mapProfileToUser in auth config.
 */
export function stashIdcsProfile(sub: string, groups: string[], tenantName?: string): void {
	profileCache.set(sub, { groups, tenantName, cachedAt: Date.now() });

	// Evict stale entries (>60s old) to prevent unbounded growth
	for (const [key, entry] of profileCache) {
		if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
			profileCache.delete(key);
		}
	}
}

/**
 * Consume the cached IDCS profile for a given sub claim.
 * Returns null if not found or expired. Single-use: entry is deleted after consumption.
 */
export function consumeIdcsProfile(sub: string): { groups: string[]; tenantName?: string } | null {
	const entry = profileCache.get(sub);
	if (!entry) return null;

	profileCache.delete(sub);

	if (Date.now() - entry.cachedAt > CACHE_TTL_MS) return null;

	return { groups: entry.groups, tenantName: entry.tenantName };
}

/**
 * Provision or update a user's org membership based on their IDCS groups.
 *
 * Called after successful OIDC login when IDCS groups are available.
 * Uses MERGE INTO for atomic upsert (insert or update role).
 *
 * @param userId - The portal user ID (from Better Auth)
 * @param orgId - The organization ID to provision into
 * @param groups - IDCS group names from the OIDC token
 * @returns The resolved role
 */
export async function provisionFromIdcsGroups(
	userId: string,
	orgId: string,
	groups: string[]
): Promise<string> {
	// Fetch IDP record for DB-configured group overrides (Admin UI)
	let groupOptions: GroupMappingOptions | undefined;
	try {
		const { idpRepository } = await import('../admin/idp-repository.js');
		const idp = await idpRepository.getByProviderId('oci-iam');
		if (idp?.adminGroups || idp?.operatorGroups) {
			groupOptions = {};
			if (idp.adminGroups) {
				groupOptions.adminGroups = idp.adminGroups
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
			}
			if (idp.operatorGroups) {
				groupOptions.operatorGroups = idp.operatorGroups
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
			}
		}
	} catch {
		// Non-fatal — fall back to env var defaults
	}

	// Bootstrap: if no admins exist yet in this org, promote first provisioned user to admin.
	// This breaks the chicken-and-egg cycle on fresh installs where IDCS groups aren't
	// configured yet (admin groups must be set, but you need admin access to set them).
	let role = mapIdcsGroupsToRole(groups, groupOptions);
	if (role !== 'admin') {
		try {
			const hasAdmin = await withConnection(async (conn) => {
				const result = await conn.execute(
					`SELECT COUNT(*) AS cnt FROM org_members WHERE org_id = :orgId AND role = 'admin'`,
					{ orgId }
				);
				const cnt = ((result.rows?.[0] as Record<string, unknown>)?.CNT as number) ?? 0;
				return cnt > 0;
			});
			if (!hasAdmin) {
				log.info({ userId, orgId }, 'No admins in org — promoting first user to admin (bootstrap)');
				role = 'admin';
			}
		} catch {
			// Non-fatal — proceed with IDCS-mapped role
		}
	}

	try {
		await withConnection(async (conn) => {
			// Atomic upsert: insert membership if new, update role if changed
			// SECURITY: autoCommit required to persist changes (otherwise silently rolled back on connection release)
			await conn.execute(
				`MERGE INTO org_members m
				 USING (SELECT :userId AS user_id, :orgId AS org_id FROM DUAL) src
				 ON (m.user_id = src.user_id AND m.org_id = src.org_id)
				 WHEN MATCHED THEN UPDATE SET role = :role
				 WHEN NOT MATCHED THEN INSERT (user_id, org_id, role) VALUES (:userId, :orgId, :role)`,
				{ userId, orgId, role },
				{ autoCommit: true }
			);
		});

		log.info({ userId, orgId, role, groupCount: groups.length }, 'IDCS org membership provisioned');
		return role;
	} catch (err) {
		log.error({ err, userId, orgId, role }, 'failed to provision IDCS org membership');
		// Return the computed role even if DB write failed — permissions will be resolved from it
		return role;
	}
}

/**
 * Resolve the default organization for an IDCS user.
 *
 * Lookup priority:
 * 1. Existing org membership (user already provisioned)
 * 2. Org mapped from IDCS tenant name (OCI_IAM_TENANT_ORG_MAP env var)
 * 3. Default organization (OCI_IAM_DEFAULT_ORG_ID env var)
 *
 * Returns null if no org can be determined.
 */
export async function resolveIdcsOrg(userId: string, tenantName?: string): Promise<string | null> {
	// 1. Check existing membership
	try {
		const existing = await withConnection(async (conn) => {
			const result = await conn.execute(
				`SELECT org_id FROM org_members WHERE user_id = :userId
				 ORDER BY created_at ASC FETCH FIRST 1 ROWS ONLY`,
				{ userId }
			);
			if (!result.rows?.length) return null;
			return (result.rows[0] as Record<string, unknown>).ORG_ID as string;
		});
		if (existing) return existing;
	} catch {
		// Continue to fallbacks
	}

	// 2. Tenant name → org mapping from env
	if (tenantName) {
		const mapping = process.env.OCI_IAM_TENANT_ORG_MAP;
		if (mapping) {
			// Format: "tenantA:org-id-1,tenantB:org-id-2"
			for (const pair of mapping.split(',')) {
				const [tenant, orgId] = pair.split(':').map((s) => s.trim());
				if (tenant === tenantName && orgId) return orgId;
			}
		}
	}

	// 3. IDP record default org (set via admin UI → OCI IAM provider settings)
	try {
		const { idpRepository } = await import('../admin/idp-repository.js');
		const idp = await idpRepository.getByProviderId('oci-iam');
		if (idp?.defaultOrgId) return idp.defaultOrgId;
	} catch {
		// Continue to env var fallback
	}

	// 4. Default org from environment variable
	if (process.env.OCI_IAM_DEFAULT_ORG_ID) return process.env.OCI_IAM_DEFAULT_ORG_ID;

	// 5. Last resort: use first/only org in the database (handles single-org deployments
	//    where admin hasn't explicitly configured a default org yet).
	try {
		const firstOrg = await withConnection(async (conn) => {
			const result = await conn.execute(
				`SELECT id FROM organizations ORDER BY created_at ASC FETCH FIRST 1 ROWS ONLY`,
				{}
			);
			if (!result.rows?.length) return null;
			return (result.rows[0] as Record<string, unknown>).ID as string;
		});
		if (firstOrg) return firstOrg;
	} catch {
		// No org in database
	}

	return null;
}
