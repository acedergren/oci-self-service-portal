import { withConnection } from '$lib/server/oracle/connection.js';
import { createLogger } from '$lib/server/logger.js';

const log = createLogger('rate-limiter');

export interface RateLimitResult {
	remaining: number;
	resetAt: number;
}

export interface RateLimitConfig {
	windowMs: number;
	maxRequests: Record<string, number>;
}

/**
 * Default rate-limit configuration.
 * Chat endpoints get a tighter limit than general API endpoints.
 */
export const RATE_LIMIT_CONFIG: RateLimitConfig = {
	windowMs: 60_000,
	maxRequests: {
		chat: 20,
		api: 60,
	},
};

/**
 * Check whether a client is within their rate limit for a given endpoint.
 *
 * Returns a `RateLimitResult` with `remaining` requests and `resetAt` epoch
 * when the window resets, or `null` when the limit has been exceeded.
 *
 * Fail-open: if the database is unreachable the request is allowed through
 * with a synthetic result so the caller never blocks on a DB outage.
 */
export async function checkRateLimit(
	clientId: string,
	endpoint: string,
	config: RateLimitConfig = RATE_LIMIT_CONFIG
): Promise<RateLimitResult | null> {
	const maxRequests = config.maxRequests[endpoint] ?? config.maxRequests.api ?? 60;
	const windowMs = config.windowMs;

	try {
		return await withConnection(async (conn) => {
			const now = Date.now();
			const windowSec = windowMs / 1000;

			// Atomic MERGE: insert or increment in a single statement to avoid TOCTOU races.
			// If a row exists within the current window, increment its counter.
			// If no current-window row exists, insert a fresh one with count = 1.
			await conn.execute(
				`MERGE INTO rate_limits r
				 USING (SELECT :clientKey AS client_key, :endpoint AS endpoint FROM DUAL) d
				 ON (r.client_key = d.client_key
				     AND r.endpoint = d.endpoint
				     AND r.window_start > SYSTIMESTAMP - NUMTODSINTERVAL(:windowSec, 'SECOND'))
				 WHEN MATCHED THEN
				   UPDATE SET r.request_count = r.request_count + 1
				 WHEN NOT MATCHED THEN
				   INSERT (client_key, endpoint, request_count, window_start)
				   VALUES (:clientKey, :endpoint, 1, SYSTIMESTAMP)`,
				{ clientKey: clientId, endpoint, windowSec }
			);

			// Read back the current count to determine whether the limit is exceeded.
			const { rows } = await conn.execute<{
				CNT: number;
				RESET_AT: Date;
			}>(
				`SELECT request_count AS "CNT",
				        window_start + NUMTODSINTERVAL(:windowSec, 'SECOND') AS "RESET_AT"
				   FROM rate_limits
				  WHERE client_key = :clientKey
				    AND endpoint   = :endpoint
				    AND window_start > SYSTIMESTAMP - NUMTODSINTERVAL(:windowSec, 'SECOND')
				  FETCH FIRST 1 ROW ONLY`,
				{ clientKey: clientId, endpoint, windowSec }
			);

			if (!rows || rows.length === 0) {
				// Should not happen after a successful MERGE, but fail-open
				return { remaining: maxRequests - 1, resetAt: now + windowMs };
			}

			const row = rows[0];
			const resetAt = new Date(row.RESET_AT).getTime();

			if (row.CNT > maxRequests) {
				return null;
			}

			return { remaining: maxRequests - row.CNT, resetAt };
		});
	} catch (err) {
		// Fail-open: allow the request through on DB errors
		log.warn({ err, clientId, endpoint }, 'rate-limit check failed — allowing request');
		return { remaining: maxRequests - 1, resetAt: Date.now() + windowMs };
	}
}
