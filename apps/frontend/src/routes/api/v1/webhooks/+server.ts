/**
 * GET /api/v1/webhooks — List webhooks for the user's org.
 * POST /api/v1/webhooks — Register a new webhook subscription.
 *
 * Requires tools:read permission for GET, tools:execute for POST.
 * Webhook secrets are auto-generated and shown only once (like API keys).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { requireApiAuth, resolveOrgId } from '$lib/server/api/require-auth.js';
import { webhookRepository } from '$lib/server/oracle/repositories/webhook-repository.js';
import { isValidWebhookUrl } from '$lib/server/webhooks.js';
import { CreateWebhookInputSchema } from '$lib/server/api/types.js';
import { createLogger } from '$lib/server/logger.js';

const log = createLogger('api:webhooks');

export const GET: RequestHandler = async (event) => {
	requireApiAuth(event, 'tools:read');

	const orgId = resolveOrgId(event);
	if (!orgId) {
		return json({ error: 'Organization context required' }, { status: 400 });
	}

	try {
		const webhooks = await webhookRepository.list(orgId);
		return json({ webhooks, count: webhooks.length });
	} catch (err) {
		log.error({ err, requestId: event.locals.requestId }, 'Failed to list webhooks');
		return json({ error: 'Failed to list webhooks' }, { status: 503 });
	}
};

export const POST: RequestHandler = async (event) => {
	requireApiAuth(event, 'tools:execute');

	const orgId = resolveOrgId(event);
	if (!orgId) {
		return json({ error: 'Organization context required' }, { status: 400 });
	}

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	// Validate input
	const parsed = CreateWebhookInputSchema.safeParse({
		...(body as Record<string, unknown>),
		orgId
	});
	if (!parsed.success) {
		return json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
	}

	// SSRF prevention
	if (!isValidWebhookUrl(parsed.data.url)) {
		return json({ error: 'URL not allowed (must be HTTPS, public address)' }, { status: 400 });
	}

	// Auto-generate secret
	const secret = `whsec_${crypto.randomUUID().replace(/-/g, '')}`;

	try {
		const result = await webhookRepository.create({
			orgId,
			url: parsed.data.url,
			secret,
			events: parsed.data.events
		});

		// Return secret only once — it cannot be retrieved later
		return json(
			{
				id: result.id,
				secret,
				url: parsed.data.url,
				events: parsed.data.events,
				status: 'active'
			},
			{ status: 201 }
		);
	} catch (err) {
		log.error({ err, requestId: event.locals.requestId }, 'Failed to create webhook');
		return json({ error: 'Failed to create webhook' }, { status: 503 });
	}
};
