import { withConnection } from '../oracle/connection.js';
import {
	PortalSettingSchema,
	type PortalSetting,
	type SetSettingInput,
	type SettingType
} from './types.js';

// ============================================================================
// Oracle row shapes (OUT_FORMAT_OBJECT, uppercase keys)
// ============================================================================

interface PortalSettingRow {
	ID: string;
	KEY: string;
	VALUE: string;
	VALUE_TYPE: string;
	DESCRIPTION: string | null;
	CATEGORY: string | null;
	IS_PUBLIC: number; // Oracle boolean (0/1)
	SORT_ORDER: number;
	CREATED_AT: Date;
	UPDATED_AT: Date;
}

// ============================================================================
// Row mappers
// ============================================================================

function rowToSetting(row: PortalSettingRow): PortalSetting {
	return PortalSettingSchema.parse({
		id: row.ID,
		key: row.KEY,
		value: row.VALUE,
		valueType: row.VALUE_TYPE,
		description: row.DESCRIPTION ?? undefined,
		category: row.CATEGORY ?? undefined,
		isPublic: row.IS_PUBLIC === 1,
		sortOrder: row.SORT_ORDER,
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT
	});
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Auto-detect setting type from value
 */
function detectSettingType(value: unknown): SettingType {
	if (typeof value === 'boolean') return 'boolean';
	if (typeof value === 'number') return 'number';
	if (typeof value === 'object' && value !== null) return 'json';
	return 'string';
}

/**
 * Serialize value to string for storage
 */
function serializeValue(value: unknown, type: SettingType): string {
	if (type === 'json') {
		return JSON.stringify(value);
	}
	return String(value);
}

/**
 * Deserialize value from string based on type
 */
function deserializeValue(
	value: string,
	type: SettingType
): string | number | boolean | Record<string, unknown> {
	switch (type) {
		case 'json':
			return JSON.parse(value) as Record<string, unknown>;
		case 'boolean':
			return value === 'true';
		case 'number':
			return Number(value);
		default:
			return value;
	}
}

// ============================================================================
// Repository
// ============================================================================

export const settingsRepository = {
	/**
	 * Get a single setting by key.
	 * Returns null if not found.
	 */
	async get(key: string): Promise<PortalSetting | null> {
		return withConnection(async (conn) => {
			const result = await conn.execute<PortalSettingRow>(
				'SELECT * FROM portal_settings WHERE "KEY" = :key',
				{ key }
			);

			if (!result.rows?.length) return null;
			return rowToSetting(result.rows[0]);
		});
	},

	/**
	 * Get the parsed value of a setting (auto-deserialized based on type).
	 * Returns null if not found.
	 */
	async getValue(key: string): Promise<string | number | boolean | Record<string, unknown> | null> {
		const setting = await this.get(key);
		if (!setting) return null;
		return deserializeValue(setting.value, setting.valueType);
	},

	/**
	 * Get all settings in a category.
	 */
	async getByCategory(category: string): Promise<PortalSetting[]> {
		return withConnection(async (conn) => {
			const result = await conn.execute<PortalSettingRow>(
				'SELECT * FROM portal_settings WHERE category = :category ORDER BY sort_order, "KEY"',
				{ category }
			);

			if (!result.rows) return [];
			return result.rows.map(rowToSetting);
		});
	},

	/**
	 * Get all public settings (safe for client exposure).
	 */
	async getPublic(): Promise<PortalSetting[]> {
		return withConnection(async (conn) => {
			const result = await conn.execute<PortalSettingRow>(
				'SELECT * FROM portal_settings WHERE is_public = 1 ORDER BY category, sort_order, "KEY"',
				{}
			);

			if (!result.rows) return [];
			return result.rows.map(rowToSetting);
		});
	},

	/**
	 * Set a single setting (upsert via MERGE INTO).
	 * Auto-detects type if not provided.
	 */
	async set(input: SetSettingInput): Promise<PortalSetting> {
		const id = crypto.randomUUID();
		const valueType = input.valueType ?? detectSettingType(input.value);
		const serializedValue = serializeValue(input.value, valueType);

		await withConnection(async (conn) => {
			await conn.execute(
				`MERGE INTO portal_settings ps
				 USING (
					SELECT
						:id AS id,
						:key AS "KEY",
						:value AS value,
						:valueType AS value_type,
						:description AS description,
						:category AS category,
						:isPublic AS is_public,
						:sortOrder AS sort_order,
						SYSTIMESTAMP AS created_at,
						SYSTIMESTAMP AS updated_at
					FROM DUAL
				 ) src
				 ON (ps."KEY" = src."KEY")
				 WHEN MATCHED THEN
					UPDATE SET
						ps.value = src.value,
						ps.value_type = src.value_type,
						ps.description = src.description,
						ps.category = src.category,
						ps.is_public = src.is_public,
						ps.sort_order = src.sort_order,
						ps.updated_at = src.updated_at
				 WHEN NOT MATCHED THEN
					INSERT (id, "KEY", value, value_type, description, category, is_public, sort_order, created_at, updated_at)
					VALUES (src.id, src."KEY", src.value, src.value_type, src.description, src.category, src.is_public, src.sort_order, src.created_at, src.updated_at)`,
				{
					id,
					key: input.key,
					value: serializedValue,
					valueType,
					description: input.description ?? null,
					category: input.category ?? null,
					isPublic: input.isPublic ? 1 : 0,
					sortOrder: input.sortOrder
				}
			);
		});

		return (await this.get(input.key))!;
	},

	/**
	 * Bulk set multiple settings (batch upsert).
	 * More efficient than calling set() in a loop.
	 */
	async bulkSet(settings: SetSettingInput[]): Promise<void> {
		await withConnection(async (conn) => {
			for (const input of settings) {
				const id = crypto.randomUUID();
				const valueType = input.valueType ?? detectSettingType(input.value);
				const serializedValue = serializeValue(input.value, valueType);

				await conn.execute(
					`MERGE INTO portal_settings ps
					 USING (
						SELECT
							:id AS id,
							:key AS "KEY",
							:value AS value,
							:valueType AS value_type,
							:description AS description,
							:category AS category,
							:isPublic AS is_public,
							:sortOrder AS sort_order,
							SYSTIMESTAMP AS created_at,
							SYSTIMESTAMP AS updated_at
						FROM DUAL
					 ) src
					 ON (ps."KEY" = src."KEY")
					 WHEN MATCHED THEN
						UPDATE SET
							ps.value = src.value,
							ps.value_type = src.value_type,
							ps.description = src.description,
							ps.category = src.category,
							ps.is_public = src.is_public,
							ps.sort_order = src.sort_order,
							ps.updated_at = src.updated_at
					 WHEN NOT MATCHED THEN
						INSERT (id, "KEY", value, value_type, description, category, is_public, sort_order, created_at, updated_at)
						VALUES (src.id, src."KEY", src.value, src.value_type, src.description, src.category, src.is_public, src.sort_order, src.created_at, src.updated_at)`,
					{
						id,
						key: input.key,
						value: serializedValue,
						valueType,
						description: input.description ?? null,
						category: input.category ?? null,
						isPublic: input.isPublic ? 1 : 0,
						sortOrder: input.sortOrder
					}
				);
			}
		});
	},

	/**
	 * List all settings ordered by category and sort_order.
	 * Admin-only — returns all settings including private ones.
	 */
	async listAll(): Promise<PortalSetting[]> {
		return withConnection(async (conn) => {
			const result = await conn.execute<PortalSettingRow>(
				'SELECT * FROM portal_settings ORDER BY category, sort_order, "KEY"',
				{}
			);

			if (!result.rows) return [];
			return result.rows.map(rowToSetting);
		});
	},

	/**
	 * Delete a setting by key.
	 */
	async delete(key: string): Promise<void> {
		await withConnection(async (conn) => {
			await conn.execute('DELETE FROM portal_settings WHERE "KEY" = :key', { key });
		});
	},

	/**
	 * Check if portal setup is complete.
	 * Checks the 'portal.setup_complete' setting equals 'true'.
	 */
	async isSetupComplete(): Promise<boolean> {
		const value = await this.getValue('portal.setup_complete');
		return value === true;
	},

	/**
	 * Mark portal setup as complete.
	 */
	async markSetupComplete(): Promise<void> {
		await this.set({
			key: 'portal.setup_complete',
			value: true,
			valueType: 'boolean',
			description: 'Portal setup wizard completed',
			category: 'system',
			isPublic: false,
			sortOrder: 0
		});
	}
};
