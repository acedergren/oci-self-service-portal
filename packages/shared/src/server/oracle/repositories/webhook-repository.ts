/**
 * Webhook subscription repository — Oracle ADB CRUD for webhook_subscriptions.
 *
 * Follows patterns from audit-repository.ts and workflow-repository.ts:
 * - Oracle UPPERCASE row interfaces
 * - withConnection() wrapper for all operations
 * - Bind variables only (never string interpolation for data)
 * - Org-scoped queries to prevent IDOR
 */
import { withConnection } from '../connection';
import { createLogger } from '../../logger';
import type {
	WebhookSubscriptionRow,
	WebhookSubscription,
	WebhookEventType,
	WebhookStatus
} from '../../api/types';
import { webhookRowToSubscription } from '../../api/types';

const log = createLogger('webhook-repository');

/** Row shape for list queries (excludes secret) */
interface WebhookListRow {
	ID: string;
	URL: string;
	EVENTS: string;
	STATUS: string;
	FAILURE_COUNT: number;
	CREATED_AT: Date;
}

/** Row shape for dispatch queries (includes secret for HMAC signing) */
interface WebhookDispatchRow {
	ID: string;
	URL: string;
	SECRET: string | null;
	EVENTS: string;
	STATUS: string;
	FAILURE_COUNT: number;
}

function listRowToWebhook(row: WebhookListRow): {
	id: string;
	url: string;
	events: string[];
	status: string;
	failureCount: number;
	createdAt: Date;
} {
	return {
		id: row.ID,
		url: row.URL,
		events: JSON.parse(row.EVENTS) as string[],
		status: row.STATUS,
		failureCount: row.FAILURE_COUNT,
		createdAt: row.CREATED_AT
	};
}

export const webhookRepository = {
	/**
	 * Create a new webhook subscription.
	 * Returns the generated ID.
	 */
	async create(params: {
		orgId: string;
		url: string;
		secret: string;
		events: string[];
	}): Promise<{ id: string }> {
		const id = crypto.randomUUID();

		await withConnection(async (conn) => {
			await conn.execute(
				`INSERT INTO webhook_subscriptions
				   (id, org_id, url, secret, events, status, failure_count)
				 VALUES
				   (:id, :orgId, :url, :secret, :events, 'active', 0)`,
				{
					id,
					orgId: params.orgId,
					url: params.url,
					secret: params.secret,
					events: JSON.stringify(params.events)
				}
			);
		});

		return { id };
	},

	/**
	 * Get a webhook by ID, scoped to org for IDOR prevention.
	 */
	async getById(id: string, orgId: string): Promise<WebhookSubscription | null> {
		return withConnection(async (conn) => {
			const result = await conn.execute<WebhookSubscriptionRow>(
				`SELECT id, org_id, url, events, secret, status, failure_count,
				        max_retries, last_fired_at, last_error, created_at, updated_at
				 FROM webhook_subscriptions
				 WHERE id = :id AND org_id = :orgId`,
				{ id, orgId }
			);

			if (!result.rows || result.rows.length === 0) return null;
			return webhookRowToSubscription(result.rows[0]);
		});
	},

	/**
	 * List all webhooks for an org. Does NOT expose the secret.
	 */
	async list(orgId: string): Promise<
		Array<{
			id: string;
			url: string;
			events: string[];
			status: string;
			failureCount: number;
			createdAt: Date;
		}>
	> {
		return withConnection(async (conn) => {
			const result = await conn.execute<WebhookListRow>(
				`SELECT id, url, events, status, failure_count, created_at
				 FROM webhook_subscriptions
				 WHERE org_id = :orgId
				 ORDER BY created_at DESC`,
				{ orgId }
			);

			if (!result.rows) return [];
			return result.rows.map(listRowToWebhook);
		});
	},

	/**
	 * Update webhook properties. Org-scoped for IDOR prevention.
	 */
	async update(
		id: string,
		orgId: string,
		params: Partial<{ url: string; events: string[]; status: string }>
	): Promise<void> {
		const setClauses: string[] = [];
		const binds: Record<string, unknown> = { id, orgId };

		if (params.url !== undefined) {
			setClauses.push('url = :url');
			binds.url = params.url;
		}
		if (params.events !== undefined) {
			setClauses.push('events = :events');
			binds.events = JSON.stringify(params.events);
		}
		if (params.status !== undefined) {
			setClauses.push('status = :status');
			binds.status = params.status;
		}

		if (setClauses.length === 0) return;

		setClauses.push('updated_at = SYSTIMESTAMP');

		await withConnection(async (conn) => {
			await conn.execute(
				`UPDATE webhook_subscriptions
				 SET ${setClauses.join(', ')}
				 WHERE id = :id AND org_id = :orgId`,
				binds
			);
		});
	},

	/**
	 * Delete a webhook. Org-scoped for IDOR prevention.
	 * Cascade deletes webhook_deliveries via FK.
	 */
	async delete(id: string, orgId: string): Promise<void> {
		await withConnection(async (conn) => {
			await conn.execute('DELETE FROM webhook_subscriptions WHERE id = :id AND org_id = :orgId', {
				id,
				orgId
			});
		});
	},

	/**
	 * Get active webhooks subscribed to a specific event type.
	 * Includes secret for HMAC signing during dispatch.
	 */
	async getActiveByEvent(orgId: string, eventType: string): Promise<WebhookDispatchRow[]> {
		return withConnection(async (conn) => {
			const result = await conn.execute<WebhookDispatchRow>(
				`SELECT id, url, secret, events, status, failure_count
				 FROM webhook_subscriptions
				 WHERE org_id = :orgId
				   AND status = 'active'
				   AND JSON_EXISTS(events, '$[*]?(@ == $evt)' PASSING :eventType AS "evt")`,
				{ orgId, eventType }
			);

			return result.rows ?? [];
		});
	},

	/**
	 * Increment failure count and optionally trip circuit breaker.
	 */
	async recordFailure(id: string, error: string): Promise<void> {
		await withConnection(async (conn) => {
			await conn.execute(
				`UPDATE webhook_subscriptions
				 SET failure_count = failure_count + 1,
				     last_error = :error,
				     status = CASE WHEN failure_count + 1 >= 5 THEN 'failed' ELSE status END,
				     updated_at = SYSTIMESTAMP
				 WHERE id = :id`,
				{ id, error }
			);
		});
	},

	/**
	 * Record successful delivery — reset failure count and update last_fired_at.
	 */
	async recordSuccess(id: string): Promise<void> {
		await withConnection(async (conn) => {
			await conn.execute(
				`UPDATE webhook_subscriptions
				 SET failure_count = 0,
				     last_fired_at = SYSTIMESTAMP,
				     last_error = NULL,
				     updated_at = SYSTIMESTAMP
				 WHERE id = :id`,
				{ id }
			);
		});
	}
};
