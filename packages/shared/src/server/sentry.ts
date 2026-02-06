/**
 * Sentry error-tracking wrapper with graceful degradation.
 *
 * If `SENTRY_DSN` is not set, every function in this module is a safe no-op.
 * This lets us import and call Sentry helpers unconditionally — no feature
 * flags or conditional imports needed.
 *
 * The actual `@sentry/node` SDK is loaded lazily on first `init()` call.
 * This avoids adding Sentry to the bundle when it is not configured.
 *
 * Usage:
 *   import { initSentry, captureError, wrapWithSpan } from '../sentry';
 *
 *   // In hooks.server.ts (once):
 *   initSentry({ dsn: env.SENTRY_DSN, environment: 'production' });
 *
 *   // Anywhere:
 *   captureError(err);
 *   const result = await wrapWithSpan('db.query', 'db', () => conn.execute(sql));
 */

import { createLogger } from './logger';
import type { PortalError } from './errors';

const log = createLogger('sentry');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Sentry initialisation options. */
export interface SentryConfig {
	/** Sentry DSN. If empty/undefined, Sentry is disabled. */
	dsn?: string;
	/** Deployment environment label (e.g. 'production', 'staging'). */
	environment?: string;
	/** Release/version tag. Defaults to `process.env.APP_VERSION`. */
	release?: string;
	/** Error sample rate 0..1. Default 1.0 (capture everything). */
	sampleRate?: number;
	/** Performance traces sample rate 0..1. Default 0.1. */
	tracesSampleRate?: number;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let initialized = false;
let enabled = false;

// We store the Sentry namespace dynamically to avoid hard-dep on @sentry/node
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sentry: any = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Initialise Sentry. Safe to call multiple times — subsequent calls are no-ops.
 *
 * If `dsn` is falsy, Sentry remains disabled and all helpers become no-ops.
 */
export async function initSentry(config: SentryConfig = {}): Promise<void> {
	if (initialized) return;
	initialized = true;

	const dsn = config.dsn || process.env.SENTRY_DSN;
	if (!dsn) {
		log.info('Sentry DSN not configured — error tracking disabled');
		return;
	}

	try {
		// Dynamic import so @sentry/node is not bundled when unused.
		// @ts-expect-error @sentry/node is an optional dependency — installed in Phase 6
		_sentry = await import('@sentry/node');
		_sentry.init({
			dsn,
			environment: config.environment || process.env.NODE_ENV || 'development',
			release: config.release || process.env.APP_VERSION || '0.0.0',
			sampleRate: config.sampleRate ?? 1.0,
			tracesSampleRate: config.tracesSampleRate ?? 0.1
		});
		enabled = true;
		log.info({ environment: config.environment }, 'Sentry initialized');
	} catch (err) {
		log.warn({ err }, 'Failed to initialize Sentry — running without error tracking');
	}
}

// ---------------------------------------------------------------------------
// Error capture
// ---------------------------------------------------------------------------

/**
 * Report an error to Sentry.
 *
 * If the error is a `PortalError`, its `toSentryExtras()` context is
 * automatically attached as Sentry extras. For plain `Error`s, only the
 * default stack trace is sent.
 *
 * No-op when Sentry is disabled.
 */
export function captureError(err: Error | PortalError, extra: Record<string, unknown> = {}): void {
	if (!enabled || !_sentry) return;

	try {
		const portalExtras =
			'toSentryExtras' in err && typeof err.toSentryExtras === 'function'
				? (err as PortalError).toSentryExtras()
				: {};

		_sentry.captureException(err, {
			extra: { ...portalExtras, ...extra }
		});
	} catch (captureErr) {
		log.warn({ err: captureErr }, 'Failed to capture error in Sentry');
	}
}

/**
 * Record a simple message in Sentry (info/warning level).
 * No-op when Sentry is disabled.
 */
export function captureMessage(
	message: string,
	level: 'info' | 'warning' | 'error' = 'info'
): void {
	if (!enabled || !_sentry) return;

	try {
		_sentry.captureMessage(message, level);
	} catch (err) {
		log.warn({ err }, 'Failed to capture message in Sentry');
	}
}

// ---------------------------------------------------------------------------
// Spans (manual instrumentation)
// ---------------------------------------------------------------------------

/**
 * Wrap an async function in a Sentry performance span.
 *
 * If Sentry is disabled, the function is called directly with zero overhead.
 *
 * @param name  Human-readable span description (e.g. 'oracle.getSession').
 * @param op    Span operation category (e.g. 'db', 'http', 'tool').
 * @param fn    The async work to instrument.
 * @returns The return value of `fn`.
 *
 * @example
 * const sessions = await wrapWithSpan('list sessions', 'db', () =>
 *   sessionRepository.list({ userId })
 * );
 */
export async function wrapWithSpan<T>(
	name: string,
	op: string,
	fn: () => T | Promise<T>
): Promise<T> {
	if (!enabled || !_sentry?.startSpan) {
		return fn();
	}

	return _sentry.startSpan({ name, op }, async () => {
		return fn();
	});
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

/**
 * Flush pending Sentry events and shut down the SDK.
 * Call this during graceful shutdown (e.g. SIGTERM handler).
 */
export async function closeSentry(timeoutMs = 2000): Promise<void> {
	if (!enabled || !_sentry) return;

	try {
		await _sentry.close(timeoutMs);
		log.info('Sentry flushed and closed');
	} catch (err) {
		log.warn({ err }, 'Error closing Sentry');
	}
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Check if Sentry is currently active. */
export function isSentryEnabled(): boolean {
	return enabled;
}
