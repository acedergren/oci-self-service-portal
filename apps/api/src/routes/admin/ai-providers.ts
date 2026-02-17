import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../plugins/rbac.js';
import { aiProviderRepository } from '@portal/server/admin/ai-provider-repository.js';
import {
	CreateAiProviderInputSchema,
	UpdateAiProviderInputSchema,
	AiProviderSchema
} from '@portal/server/admin/types.js';
import {
	stripAiProviderSecrets,
	stripAiProviderSecretsArray
} from '@portal/server/admin/strip-secrets.js';
import { NotFoundError, toPortalError } from '@portal/server/errors.js';
import { createLogger } from '@portal/server/logger.js';

const log = createLogger('api:admin:ai-providers');

// ============================================================================
// Response Schemas
// ============================================================================

const AiProviderPublicSchema = AiProviderSchema.omit({ apiKey: true }).extend({
	hasApiKey: z.boolean()
});

const AiProviderListResponseSchema = z.array(AiProviderPublicSchema);

// ============================================================================
// Admin AI Provider Routes
// ============================================================================

/**
 * Admin AI provider management API routes.
 * All endpoints require admin:all permission.
 */
export async function aiProviderAdminRoutes(app: FastifyInstance): Promise<void> {
	/**
	 * GET /api/admin/ai-providers
	 * List all AI providers (API keys stripped).
	 */
	app.get(
		'/api/admin/ai-providers',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				response: {
					200: AiProviderListResponseSchema
				}
			}
		},
		async () => {
			try {
				const providers = await aiProviderRepository.list();
				return stripAiProviderSecretsArray(providers);
			} catch (err) {
				const portalError = toPortalError(err);
				log.error({ err: portalError }, 'Failed to list AI providers');
				throw portalError;
			}
		}
	);

	/**
	 * POST /api/admin/ai-providers
	 * Create a new AI provider.
	 */
	app.post(
		'/api/admin/ai-providers',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				body: CreateAiProviderInputSchema
			}
		},
		async (request, reply) => {
			try {
				const input = request.body as z.infer<typeof CreateAiProviderInputSchema>;
				const created = await aiProviderRepository.create(input);
				reply.code(201);
				return stripAiProviderSecrets(created);
			} catch (err) {
				const portalError = toPortalError(err);
				log.error({ err: portalError }, 'Failed to create AI provider');
				throw portalError;
			}
		}
	);

	/**
	 * PATCH /api/admin/ai-providers/:id
	 * Update an existing AI provider (partial update).
	 */
	app.patch(
		'/api/admin/ai-providers/:id',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({ id: z.string().uuid() }),
				body: UpdateAiProviderInputSchema
			}
		},
		async (request) => {
			try {
				const { id } = request.params as { id: string };
				const input = request.body as z.infer<typeof UpdateAiProviderInputSchema>;

				const existing = await aiProviderRepository.getById(id);
				if (!existing) {
					throw new NotFoundError(`AI provider not found: ${id}`);
				}

				const updated = await aiProviderRepository.update(id, input);
				return stripAiProviderSecrets(updated);
			} catch (err) {
				if (err instanceof NotFoundError) throw err;
				const portalError = toPortalError(err);
				log.error({ err: portalError }, 'Failed to update AI provider');
				throw portalError;
			}
		}
	);

	/**
	 * DELETE /api/admin/ai-providers/:id
	 * Delete an AI provider.
	 */
	app.delete(
		'/api/admin/ai-providers/:id',
		{
			preHandler: requireAuth('admin:all'),
			schema: {
				params: z.object({ id: z.string().uuid() })
			}
		},
		async (request, reply) => {
			try {
				const { id } = request.params as { id: string };
				const deleted = await aiProviderRepository.delete(id);

				if (!deleted) {
					throw new NotFoundError(`AI provider not found: ${id}`);
				}

				reply.code(204);
				return null;
			} catch (err) {
				if (err instanceof NotFoundError) throw err;
				const portalError = toPortalError(err);
				log.error({ err: portalError }, 'Failed to delete AI provider');
				throw portalError;
			}
		}
	);
}
