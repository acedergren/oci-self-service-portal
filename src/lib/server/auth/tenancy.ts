import { withConnection } from '$lib/server/oracle/connection.js';
import { createLogger } from '$lib/server/logger.js';

const log = createLogger('tenancy');

// ============================================================================
// Types
// ============================================================================

export interface TenantContext {
	orgId: string;
	compartmentId: string;
	orgName: string;
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Resolve the OCI compartment for a user's organization.
 *
 * If `orgId` is provided the lookup is scoped to that org.
 * Otherwise we pick the first org the user belongs to (oldest membership).
 *
 * Falls back to `OCI_COMPARTMENT_ID` env var when the org has no
 * explicit compartment mapping.
 */
export async function resolveCompartment(
	userId: string,
	orgId?: string
): Promise<TenantContext | null> {
	try {
		return await withConnection(async (conn) => {
			const query = orgId
				? `SELECT o.id, o.name, o.oci_compartment_id
				   FROM organizations o
				   JOIN org_members m ON m.org_id = o.id
				   WHERE m.user_id = :userId AND o.id = :orgId`
				: `SELECT o.id, o.name, o.oci_compartment_id
				   FROM organizations o
				   JOIN org_members m ON m.org_id = o.id
				   WHERE m.user_id = :userId
				   ORDER BY m.created_at ASC
				   FETCH FIRST 1 ROWS ONLY`;

			const binds = orgId ? { userId, orgId } : { userId };
			const result = await conn.execute(query, binds);

			if (!result.rows?.length) return null;

			const row = result.rows[0] as Record<string, unknown>;
			return {
				orgId: row.ID as string,
				orgName: row.NAME as string,
				compartmentId:
					(row.OCI_COMPARTMENT_ID as string) || process.env.OCI_COMPARTMENT_ID || ''
			};
		});
	} catch (err) {
		log.error({ err, userId, orgId }, 'failed to resolve compartment');
		return null;
	}
}

/**
 * Look up a user's role within an organization.
 * Returns null when the user is not a member of the org.
 */
export async function getOrgRole(userId: string, orgId?: string): Promise<string | null> {
	if (!orgId) return null;

	try {
		return await withConnection(async (conn) => {
			const result = await conn.execute(
				'SELECT role FROM org_members WHERE user_id = :userId AND org_id = :orgId',
				{ userId, orgId }
			);

			if (!result.rows?.length) return null;
			return (result.rows[0] as Record<string, unknown>).ROLE as string;
		});
	} catch (err) {
		log.error({ err, userId, orgId }, 'failed to get org role');
		return null;
	}
}
