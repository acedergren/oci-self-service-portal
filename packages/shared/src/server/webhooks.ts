/**
 * Webhook event dispatcher with HMAC-SHA256 signing and SSRF prevention.
 *
 * Dispatches events to registered webhook subscriptions. Features:
 * - HMAC-SHA256 payload signing (X-Webhook-Signature header)
 * - SSRF prevention: blocks private IPs, cloud metadata, non-HTTPS
 * - Exponential backoff retry (1s, 4s, 16s)
 * - Circuit breaker: marks webhook 'failed' after 5 consecutive failures
 * - Fire-and-forget: dispatch is non-blocking in the request path
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { createLogger } from './logger';
import { webhookRepository } from './oracle/repositories/webhook-repository';

const log = createLogger('webhooks');

const MAX_RETRIES = 3;
const RETRY_INTERVALS = [1000, 4000, 16000]; // exponential backoff
const DELIVERY_TIMEOUT = 10_000; // 10s per attempt

// ============================================================================
// HMAC-SHA256 Signature
// ============================================================================

/**
 * Generate HMAC-SHA256 signature for a webhook payload.
 */
export function generateSignature(payload: string, secret: string): string {
	return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify a webhook signature using timing-safe comparison.
 */
export function verifySignature(payload: string, signature: string, secret: string): boolean {
	const expected = generateSignature(payload, secret);
	try {
		return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
	} catch {
		return false;
	}
}

// ============================================================================
// SSRF Prevention
// ============================================================================

/**
 * Validate a webhook URL is safe to call (SSRF prevention).
 *
 * Blocks:
 * - Non-HTTPS URLs
 * - Private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x)
 * - Loopback (localhost, [::1])
 * - Link-local (169.254.x — cloud metadata)
 * - Internal hostnames (*.internal)
 */
export function isValidWebhookUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	// Require HTTPS
	if (parsed.protocol !== 'https:') {
		return false;
	}

	const hostname = parsed.hostname.toLowerCase();

	// Block localhost and loopback
	if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') {
		return false;
	}

	// Block internal hostnames
	if (hostname.endsWith('.internal')) {
		return false;
	}

	// Block private IP ranges
	const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipMatch) {
		const [, a, b] = ipMatch.map(Number);

		// 10.0.0.0/8
		if (a === 10) return false;

		// 127.0.0.0/8
		if (a === 127) return false;

		// 172.16.0.0/12
		if (a === 172 && b >= 16 && b <= 31) return false;

		// 192.168.0.0/16
		if (a === 192 && b === 168) return false;

		// 169.254.0.0/16 (link-local / cloud metadata)
		if (a === 169 && b === 254) return false;

		// 0.0.0.0
		if (a === 0) return false;
	}

	return true;
}

// ============================================================================
// Event Dispatch
// ============================================================================

interface DispatchEvent {
	type: string;
	orgId: string;
	data: Record<string, unknown>;
}

interface DispatchResult {
	webhookId: string;
	status: 'delivered' | 'failed';
	httpStatus?: number;
	error?: string;
}

/**
 * Dispatch a webhook event to all active subscribers.
 *
 * This is designed to be called fire-and-forget in the request path.
 * Failures are logged and tracked per-webhook; they don't propagate.
 */
export async function dispatchEvent(event: DispatchEvent): Promise<DispatchResult[]> {
	const webhooks = await webhookRepository.getActiveByEvent(event.orgId, event.type);

	if (webhooks.length === 0) {
		return [];
	}

	const results: DispatchResult[] = [];

	for (const webhook of webhooks) {
		const result = await deliverToWebhook(webhook, event);
		results.push(result);
	}

	return results;
}

/**
 * Deliver an event to a single webhook with retry logic.
 */
async function deliverToWebhook(
	webhook: { ID: string; URL: string; SECRET: string | null; FAILURE_COUNT: number },
	event: DispatchEvent
): Promise<DispatchResult> {
	const payload = JSON.stringify({
		event: event.type,
		timestamp: new Date().toISOString(),
		data: event.data
	});

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'X-Webhook-Event': event.type
	};

	// Add HMAC signature if secret is configured
	if (webhook.SECRET) {
		headers['X-Webhook-Signature'] = generateSignature(payload, webhook.SECRET);
	}

	// Validate URL (SSRF prevention)
	if (!isValidWebhookUrl(webhook.URL)) {
		log.warn({ webhookId: webhook.ID, url: webhook.URL }, 'Webhook URL blocked by SSRF filter');
		return { webhookId: webhook.ID, status: 'failed', error: 'URL blocked by SSRF filter' };
	}

	// Attempt delivery with retries
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT);

			const response = await fetch(webhook.URL, {
				method: 'POST',
				headers,
				body: payload,
				signal: controller.signal
			});

			clearTimeout(timeout);

			if (response.ok) {
				// Success — reset failure count
				webhookRepository.recordSuccess(webhook.ID).catch((err) => {
					log.warn({ err, webhookId: webhook.ID }, 'Failed to record webhook success');
				});

				return {
					webhookId: webhook.ID,
					status: 'delivered',
					httpStatus: response.status
				};
			}

			// Non-2xx response — treat as failure
			log.warn(
				{ webhookId: webhook.ID, httpStatus: response.status, attempt },
				'Webhook delivery got non-2xx response'
			);

			// Retry on 5xx, give up on 4xx
			if (response.status < 500 && response.status !== 429) {
				break;
			}
		} catch (err) {
			log.warn({ err, webhookId: webhook.ID, attempt }, 'Webhook delivery attempt failed');
		}

		// Wait before retry (unless last attempt)
		if (attempt < MAX_RETRIES) {
			await sleep(RETRY_INTERVALS[attempt]);
		}
	}

	// All attempts failed — record failure and potentially trip circuit breaker
	webhookRepository.recordFailure(webhook.ID, 'Delivery failed after retries').catch((err) => {
		log.warn({ err, webhookId: webhook.ID }, 'Failed to record webhook failure');
	});

	return {
		webhookId: webhook.ID,
		status: 'failed',
		error: 'Delivery failed after retries'
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fire-and-forget dispatch helper.
 * Logs errors but never throws. Use in request handlers.
 */
export function fireWebhookEvent(event: DispatchEvent): void {
	dispatchEvent(event).catch((err) => {
		log.warn(
			{ err, event: event.type, orgId: event.orgId },
			'Webhook dispatch failed (non-critical)'
		);
	});
}
