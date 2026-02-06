/**
 * GET /api/v1/webhooks/:id — Get webhook details.
 * PUT /api/v1/webhooks/:id — Update webhook URL or events.
 * DELETE /api/v1/webhooks/:id — Remove webhook subscription.
 *
 * All operations are scoped to the authenticated org (IDOR prevention).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireApiAuth, resolveOrgId } from '@portal/shared/server/api/require-auth.js';
import { webhookRepository } from '@portal/shared/server/oracle/repositories/webhook-repository.js';
import { WebhookEventTypeSchema } from '@portal/shared/server/api/types.js';
import { isValidWebhookUrl } from '@portal/shared/server/webhooks.js';
import { createLogger } from '@portal/shared/server/logger.js';
import { z } from 'zod';

const log = createLogger('api:webhooks:id');

export const GET: RequestHandler = async (event) => {
	requireApiAuth(event, 'tools:read');

	const orgId = resolveOrgId(event);
	if (!orgId) {
		return json({ error: 'Organization context required' }, { status: 400 });
	}

	const { id } = event.params;

	try {
		const webhook = await webhookRepository.getById(id, orgId);
		if (!webhook) {
			return json({ error: 'Webhook not found' }, { status: 404 });
		}
		return json({ webhook });
	} catch (err) {
		log.error({ err, webhookId: id, requestId: event.locals.requestId }, 'Failed to get webhook');
		return json({ error: 'Failed to get webhook' }, { status: 503 });
	}
};

export const PUT: RequestHandler = async (event) => {
	requireApiAuth(event, 'tools:execute');

	const orgId = resolveOrgId(event);
	if (!orgId) {
		return json({ error: 'Organization context required' }, { status: 400 });
	}

	const { id } = event.params;

	let body: Record<string, unknown>;
	try {
		body = (await event.request.json()) as Record<string, unknown>;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	// Validate URL if provided
	if (typeof body.url === 'string' && !isValidWebhookUrl(body.url)) {
		return json({ error: 'URL not allowed (must be HTTPS, public address)' }, { status: 400 });
	}

	const updates: Partial<{ url: string; events: string[]; status: string }> = {};
	if (typeof body.url === 'string') updates.url = body.url;

	// M-20: Validate events against WebhookEventTypeSchema
	if (Array.isArray(body.events)) {
		const parsed = z.array(WebhookEventTypeSchema).min(1).safeParse(body.events);
		if (!parsed.success) {
			return json({ error: 'Invalid events', details: parsed.error.flatten() }, { status: 400 });
		}
		updates.events = parsed.data;
	}

	// M-19: Validate status — users can only set 'active' or 'paused' (not 'failed')
	if (typeof body.status === 'string') {
		const validStatuses = ['active', 'paused'] as const;
		if (!validStatuses.includes(body.status as (typeof validStatuses)[number])) {
			return json(
				{ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
				{ status: 400 }
			);
		}
		updates.status = body.status;
	}

	if (Object.keys(updates).length === 0) {
		return json({ error: 'No valid fields to update' }, { status: 400 });
	}

	try {
		await webhookRepository.update(id, orgId, updates);
		return json({ success: true });
	} catch (err) {
		log.error(
			{ err, webhookId: id, requestId: event.locals.requestId },
			'Failed to update webhook'
		);
		return json({ error: 'Failed to update webhook' }, { status: 503 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	requireApiAuth(event, 'tools:execute');

	const orgId = resolveOrgId(event);
	if (!orgId) {
		return json({ error: 'Organization context required' }, { status: 400 });
	}

	const { id } = event.params;

	try {
		await webhookRepository.delete(id, orgId);
		return json({ success: true });
	} catch (err) {
		log.error(
			{ err, webhookId: id, requestId: event.locals.requestId },
			'Failed to delete webhook'
		);
		return json({ error: 'Failed to delete webhook' }, { status: 503 });
	}
};
