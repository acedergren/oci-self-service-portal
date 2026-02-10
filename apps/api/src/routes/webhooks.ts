import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { isWebhookEncryptionEnabled } from '@portal/shared/server/crypto';
import { webhookRepository } from '@portal/shared/server/oracle/repositories/webhook-repository';
import { CreateWebhookInputSchema, WebhookEventTypeSchema } from '@portal/shared/server/api/types';
import { isValidWebhookUrl } from '@portal/shared/server/webhooks';
import { createLogger } from '@portal/shared/server/logger';
import { requireAuth, resolveOrgId } from '../plugins/rbac.js';

const log = createLogger('api:webhooks');

const CreateWebhookBody = CreateWebhookInputSchema.pick({
	url: true,
	events: true
});

const UpdateWebhookBody = z
	.object({
		url: z.string().url().optional(),
		events: z.array(WebhookEventTypeSchema).min(1).optional(),
		status: z.enum(['active', 'paused']).optional()
	})
	.refine((d) => Object.keys(d).length > 0, {
		message: 'No valid fields to update'
	});

const WebhookIdParam = z.object({ id: z.string() });

const WebhookErrorSchema = z.object({ error: z.string() });

const DateOrString = z.union([z.string(), z.date()]);

const WebhookItemSchema = z.object({
	id: z.string(),
	url: z.string(),
	events: z.array(z.string()),
	status: z.string(),
	failureCount: z.number().optional(),
	createdAt: DateOrString.optional(),
	updatedAt: DateOrString.optional()
});

const WebhookListResponseSchema = z.object({
	webhooks: z.array(WebhookItemSchema)
});

const WebhookCreateResponseSchema = z.object({
	id: z.string(),
	secret: z.string()
});

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
	// GET /api/v1/webhooks — list webhooks for org
	app.get(
		'/api/v1/webhooks',
		{
			preHandler: requireAuth('tools:read'),
			schema: {
				response: {
					200: WebhookListResponseSchema,
					403: WebhookErrorSchema
				}
			}
		},
		async (request, reply) => {
			const orgId = resolveOrgId(request);
			if (!orgId) return reply.status(403).send({ error: 'No organization context' });

			const webhooks = await webhookRepository.list(orgId);
			return reply.send({ webhooks });
		}
	);

	// POST /api/v1/webhooks — create webhook
	app.post(
		'/api/v1/webhooks',
		{
			preHandler: requireAuth('tools:execute'),
			schema: {
				body: CreateWebhookBody,
				response: {
					201: WebhookCreateResponseSchema,
					400: WebhookErrorSchema,
					403: WebhookErrorSchema,
					503: WebhookErrorSchema
				}
			}
		},
		async (request, reply) => {
			const orgId = resolveOrgId(request);
			if (!orgId) return reply.status(403).send({ error: 'No organization context' });

			if (!isWebhookEncryptionEnabled()) {
				log.error({ orgId }, 'Webhook encryption key is not configured');
				return reply.status(503).send({ error: 'Webhook encryption is not configured' });
			}

			const body = request.body as z.infer<typeof CreateWebhookBody>;

			if (!isValidWebhookUrl(body.url)) {
				return reply.status(400).send({ error: 'Invalid webhook URL (private IPs not allowed)' });
			}

			const secret = `whsec_${randomUUID().replace(/-/g, '')}`;

			try {
				const { id } = await webhookRepository.create({
					orgId,
					url: body.url,
					secret,
					events: body.events
				});

				return reply.status(201).send({ id, secret });
			} catch (err) {
				log.error({ err, orgId }, 'Failed to create webhook');
				return reply.status(503).send({ error: 'Failed to create webhook' });
			}
		}
	);

	// GET /api/v1/webhooks/:id — get webhook by ID
	app.get(
		'/api/v1/webhooks/:id',
		{
			preHandler: requireAuth('tools:read'),
			schema: {
				params: WebhookIdParam,
				response: {
					200: WebhookItemSchema,
					403: WebhookErrorSchema,
					404: WebhookErrorSchema
				}
			}
		},
		async (request, reply) => {
			const orgId = resolveOrgId(request);
			if (!orgId) return reply.status(403).send({ error: 'No organization context' });

			const { id } = request.params as z.infer<typeof WebhookIdParam>;
			const webhook = await webhookRepository.getById(id, orgId);
			if (!webhook) return reply.status(404).send({ error: 'Webhook not found' });

			return reply.send({
				id: webhook.id,
				url: webhook.url,
				events: webhook.events,
				status: webhook.status,
				failureCount: webhook.failureCount,
				createdAt: webhook.createdAt,
				updatedAt: webhook.updatedAt
			});
		}
	);

	// PUT /api/v1/webhooks/:id — update webhook
	app.put(
		'/api/v1/webhooks/:id',
		{
			preHandler: requireAuth('tools:execute'),
			schema: {
				params: WebhookIdParam,
				body: UpdateWebhookBody,
				response: {
					200: z.object({ ok: z.literal(true) }),
					400: WebhookErrorSchema,
					403: WebhookErrorSchema,
					404: WebhookErrorSchema
				}
			}
		},
		async (request, reply) => {
			const orgId = resolveOrgId(request);
			if (!orgId) return reply.status(403).send({ error: 'No organization context' });

			const { id } = request.params as z.infer<typeof WebhookIdParam>;
			const body = request.body as z.infer<typeof UpdateWebhookBody>;

			if (body.url && !isValidWebhookUrl(body.url)) {
				return reply.status(400).send({ error: 'Invalid webhook URL (private IPs not allowed)' });
			}

			const existing = await webhookRepository.getById(id, orgId);
			if (!existing) return reply.status(404).send({ error: 'Webhook not found' });

			await webhookRepository.update(id, orgId, body);
			return reply.send({ ok: true });
		}
	);

	// DELETE /api/v1/webhooks/:id — delete webhook
	app.delete(
		'/api/v1/webhooks/:id',
		{
			preHandler: requireAuth('tools:execute'),
			schema: {
				params: WebhookIdParam,
				response: {
					204: z.null(),
					403: WebhookErrorSchema
				}
			}
		},
		async (request, reply) => {
			const orgId = resolveOrgId(request);
			if (!orgId) return reply.status(403).send({ error: 'No organization context' });

			const { id } = request.params as z.infer<typeof WebhookIdParam>;
			await webhookRepository.delete(id, orgId);
			return reply.status(204).send(null);
		}
	);
}
