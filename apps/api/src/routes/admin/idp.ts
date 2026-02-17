import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../plugins/rbac.js';
import { idpRepository } from '@portal/server/admin/idp-repository.js';
import {
	CreateIdpInputSchema,
	UpdateIdpInputSchema,
	IdpProviderSchema,
	IdpStatusSchema
} from '@portal/server/admin/types.js';
import { stripIdpSecrets, stripIdpSecretsArray } from '@portal/server/admin/strip-secrets.js';
import { NotFoundError, toPortalError } from '@portal/server/errors.js';
import { createLogger } from '@portal/server/logger.js';

const log = createLogger('api:admin:idp');

// ============================================================================
// Response Schemas
// ============================================================================

const IdpPublicResponseSchema = IdpProviderSchema.omit({ clientSecret: true }).extend({
	hasClientSecret: z.boolean()
});

const IdpListResponseSchema = z.array(IdpPublicResponseSchema);

const ToggleInputSchema = z.object({
	enabled: z.boolean()
});

// ============================================================================
// Admin IDP Routes
// ============================================================================

/**
 * Admin IDP management API routes.
 * All endpoints require admin:all permission.
 */
export async function idpAdminRoutes(app: FastifyInstance): Promise<void> {
	/**
	 * GET /api/admin/idp
	 * List all identity providers (secrets stripped).
	 */
	app.get(
		'/api/admin/idp',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				response: {
					200: IdpListResponseSchema
				}
			}
		},
		async () => {
			try {
				const providers = await idpRepository.list();
				return stripIdpSecretsArray(providers);
			} catch (err) {
				const portalError = toPortalError(err);
				log.error({ err: portalError }, 'Failed to list IDPs');
				throw portalError;
			}
		}
	);

	/**
	 * POST /api/admin/idp
	 * Create a new identity provider.
	 */
	app.post(
		'/api/admin/idp',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				body: CreateIdpInputSchema
			}
		},
		async (request, reply) => {
			try {
				const input = request.body as z.infer<typeof CreateIdpInputSchema>;
				const created = await idpRepository.create(input);
				reply.code(201);
				return stripIdpSecrets(created);
			} catch (err) {
				const portalError = toPortalError(err);
				log.error({ err: portalError }, 'Failed to create IDP');
				throw portalError;
			}
		}
	);

	/**
	 * PUT /api/admin/idp/:id
	 * Update an existing identity provider.
	 */
	app.put(
		'/api/admin/idp/:id',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({ id: z.string().uuid() }),
				body: UpdateIdpInputSchema
			}
		},
		async (request) => {
			try {
				const { id } = request.params as { id: string };
				const input = request.body as z.infer<typeof UpdateIdpInputSchema>;

				const existing = await idpRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`Identity provider not found: ${id}`);
				}

				const updated = await idpRepository.update(id, input);
				return stripIdpSecrets(updated);
			} catch (err) {
				if (err instanceof NotFoundError) throw err;
				const portalError = toPortalError(err);
				log.error({ err: portalError }, 'Failed to update IDP');
				throw portalError;
			}
		}
	);

	/**
	 * DELETE /api/admin/idp/:id
	 * Delete an identity provider.
	 */
	app.delete(
		'/api/admin/idp/:id',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({ id: z.string().uuid() })
			}
		},
		async (request, reply) => {
			try {
				const { id } = request.params as { id: string };
				const deleted = await idpRepository.delete(id);

				if (!deleted) {
					throw new NotFoundError(`Identity provider not found: ${id}`);
				}

				reply.code(204);
				return null;
			} catch (err) {
				if (err instanceof NotFoundError) throw err;
				const portalError = toPortalError(err);
				log.error({ err: portalError }, 'Failed to delete IDP');
				throw portalError;
			}
		}
	);

	/**
	 * POST /api/admin/idp/:id/toggle
	 * Toggle an identity provider's status between active and disabled.
	 */
	app.post(
		'/api/admin/idp/:id/toggle',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({ id: z.string().uuid() }),
				body: ToggleInputSchema
			}
		},
		async (request) => {
			try {
				const { id } = request.params as { id: string };
				const { enabled } = request.body as { enabled: boolean };

				const existing = await idpRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`Identity provider not found: ${id}`);
				}

				const status: z.infer<typeof IdpStatusSchema> = enabled ? 'active' : 'disabled';
				const updated = await idpRepository.update(id, { status });
				return stripIdpSecrets(updated);
			} catch (err) {
				if (err instanceof NotFoundError) throw err;
				const portalError = toPortalError(err);
				log.error({ err: portalError }, 'Failed to toggle IDP status');
				throw portalError;
			}
		}
	);
}
