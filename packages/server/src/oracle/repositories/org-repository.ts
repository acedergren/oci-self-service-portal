import { withConnection } from '../connection';
import { OrganizationSchema, OrgMemberSchema, type Organization, type OrgMember } from '../types';

// ============================================================================
// Oracle row shapes (OUT_FORMAT_OBJECT, uppercase keys)
// ============================================================================

interface OrganizationRow {
	ID: string;
	NAME: string;
	OCI_COMPARTMENT_ID: string | null;
	SETTINGS: string | null;
	STATUS: string;
	CREATED_AT: Date;
	UPDATED_AT: Date;
}

interface OrgMemberRow {
	USER_ID: string;
	ORG_ID: string;
	ROLE: string;
	CREATED_AT: Date;
}

// ============================================================================
// Row mappers
// ============================================================================

function rowToOrg(row: OrganizationRow): Organization {
	let settings: Record<string, unknown> | undefined;
	if (row.SETTINGS) {
		try {
			settings = JSON.parse(row.SETTINGS);
		} catch {
			// Corrupt JSON in CLOB — fallback to empty object
			settings = {};
		}
	}

	return OrganizationSchema.parse({
		id: row.ID,
		name: row.NAME,
		ociCompartmentId: row.OCI_COMPARTMENT_ID ?? undefined,
		settings,
		status: row.STATUS,
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT
	});
}

function rowToMember(row: OrgMemberRow): OrgMember {
	return OrgMemberSchema.parse({
		userId: row.USER_ID,
		orgId: row.ORG_ID,
		role: row.ROLE,
		createdAt: row.CREATED_AT
	});
}

// ============================================================================
// Repository
// ============================================================================

export const orgRepository = {
	async create(input: { name: string; ociCompartmentId?: string }): Promise<Organization> {
		const id = crypto.randomUUID();

		await withConnection(async (conn) => {
			await conn.execute(
				`INSERT INTO organizations (id, name, oci_compartment_id, status)
				 VALUES (:id, :name, :ociCompartmentId, 'active')`,
				{
					id,
					name: input.name,
					ociCompartmentId: input.ociCompartmentId ?? null
				}
			);
		});

		const created = await this.getById(id);
		if (!created) {
			throw new Error(`Failed to retrieve organization after creation: ${id}`);
		}
		return created;
	},

	async getById(id: string): Promise<Organization | null> {
		return withConnection(async (conn) => {
			const result = await conn.execute<OrganizationRow>(
				'SELECT * FROM organizations WHERE id = :id',
				{ id }
			);

			if (!result.rows?.length) return null;
			return rowToOrg(result.rows[0]);
		});
	},

	async list(): Promise<Organization[]> {
		return withConnection(async (conn) => {
			const result = await conn.execute<OrganizationRow>(
				'SELECT * FROM organizations WHERE status = :status ORDER BY name',
				{ status: 'active' }
			);

			if (!result.rows) return [];
			return result.rows.map(rowToOrg);
		});
	},

	async addMember(orgId: string, userId: string, role: string): Promise<void> {
		await withConnection(async (conn) => {
			await conn.execute(
				`INSERT INTO org_members (user_id, org_id, role)
				 VALUES (:userId, :orgId, :role)`,
				{ userId, orgId, role }
			);
		});
	},

	async removeMember(orgId: string, userId: string): Promise<void> {
		await withConnection(async (conn) => {
			await conn.execute('DELETE FROM org_members WHERE user_id = :userId AND org_id = :orgId', {
				userId,
				orgId
			});
		});
	},

	async updateMemberRole(orgId: string, userId: string, role: string): Promise<void> {
		await withConnection(async (conn) => {
			await conn.execute(
				'UPDATE org_members SET role = :role WHERE user_id = :userId AND org_id = :orgId',
				{ role, userId, orgId }
			);
		});
	},

	async getMembers(orgId: string): Promise<OrgMember[]> {
		return withConnection(async (conn) => {
			const result = await conn.execute<OrgMemberRow>(
				'SELECT * FROM org_members WHERE org_id = :orgId ORDER BY created_at',
				{ orgId }
			);

			if (!result.rows) return [];
			return result.rows.map(rowToMember);
		});
	}
};
