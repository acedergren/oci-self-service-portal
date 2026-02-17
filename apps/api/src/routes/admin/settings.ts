import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../plugins/rbac.js';
import { settingsRepository } from '@portal/server/admin/settings-repository.js';
import { toPortalError } from '@portal/server/errors.js';
import { createLogger } from '@portal/server/logger.js';

const log = createLogger('api:admin:settings');

// ============================================================================
// Schemas
// ============================================================================

/**
 * Portal settings as a flat object — matches the frontend PortalSettings interface.
 * Each field maps to a key in the portal_settings table.
 */
const PortalSettingsResponseSchema = z
	.object({
		portalName: z.string().optional(),
		primaryColor: z.string().optional(),
		accentColor: z.string().optional(),
		logoUrl: z.string().nullable().optional(),
		signupEnabled: z.boolean().optional(),
		requireEmailVerification: z.boolean().optional(),
		sessionTimeout: z.number().optional(),
		maxUploadSize: z.number().optional(),
		allowedDomains: z.string().nullable().optional(),
		maintenanceMode: z.boolean().optional(),
		maintenanceMessage: z.string().nullable().optional(),
		termsOfServiceUrl: z.string().nullable().optional(),
		privacyPolicyUrl: z.string().nullable().optional()
	})
	.passthrough();

const PortalSettingsUpdateSchema = PortalSettingsResponseSchema.partial();

/** Map of frontend camelCase field → portal_settings table key */
const SETTINGS_KEY_MAP: Record<string, string> = {
	portalName: 'portal.name',
	primaryColor: 'portal.primary_color',
	accentColor: 'portal.accent_color',
	logoUrl: 'portal.logo_url',
	signupEnabled: 'portal.signup_enabled',
	requireEmailVerification: 'portal.require_email_verification',
	sessionTimeout: 'portal.session_timeout',
	maxUploadSize: 'portal.max_upload_size',
	allowedDomains: 'portal.allowed_domains',
	maintenanceMode: 'portal.maintenance_mode',
	maintenanceMessage: 'portal.maintenance_message',
	termsOfServiceUrl: 'portal.terms_of_service_url',
	privacyPolicyUrl: 'portal.privacy_policy_url'
};

// ============================================================================
// Helpers
// ============================================================================

async function loadSettingsObject(): Promise<Record<string, unknown>> {
	const result: Record<string, unknown> = {};
	for (const [field, key] of Object.entries(SETTINGS_KEY_MAP)) {
		const value = await settingsRepository.getValue(key);
		if (value !== null) {
			result[field] = value;
		}
	}
	return result;
}

// ============================================================================
// Admin Settings Routes
// ============================================================================

/**
 * Admin portal settings API routes.
 * All endpoints require admin:all permission.
 *
 * The frontend expects a flat PortalSettings object, not individual key-value
 * records. This route layer bridges between the key-value repository and the
 * flat object the frontend needs.
 */
export async function adminSettingsRoutes(app: FastifyInstance): Promise<void> {
	/**
	 * GET /api/admin/settings
	 * Get all portal settings as a flat object.
	 */
	app.get(
		'/api/admin/settings',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				response: {
					200: PortalSettingsResponseSchema
				}
			}
		},
		async () => {
			try {
				return await loadSettingsObject();
			} catch (err) {
				const portalError = toPortalError(err);
				log.error({ err: portalError }, 'Failed to fetch portal settings');
				throw portalError;
			}
		}
	);

	/**
	 * PATCH /api/admin/settings
	 * Update portal settings (partial update). Returns updated flat object.
	 */
	app.patch(
		'/api/admin/settings',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				body: PortalSettingsUpdateSchema
			}
		},
		async (request) => {
			try {
				const updates = request.body as Record<string, unknown>;

				for (const [field, value] of Object.entries(updates)) {
					const key = SETTINGS_KEY_MAP[field];
					if (!key || value === undefined) continue;

					const settingValue =
						typeof value === 'string' ||
						typeof value === 'number' ||
						typeof value === 'boolean' ||
						(typeof value === 'object' && value !== null)
							? (value as string | number | boolean | Record<string, unknown>)
							: '';
					await settingsRepository.set({
						key,
						value: settingValue,
						category: 'portal',
						isPublic: false,
						sortOrder: 0
					});
				}

				log.info({ fields: Object.keys(updates) }, 'Updated portal settings');
				return await loadSettingsObject();
			} catch (err) {
				const portalError = toPortalError(err);
				log.error({ err: portalError }, 'Failed to update portal settings');
				throw portalError;
			}
		}
	);
}
