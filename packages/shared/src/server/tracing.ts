import { randomUUID } from 'node:crypto';

/**
 * Header name for request tracing.
 * Preserve an incoming value set by reverse proxies (e.g. Cloudflare).
 */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Generate a URL-safe request ID in the format `req-<uuid>`.
 */
export function generateRequestId(): string {
	return `req-${randomUUID()}`;
}
