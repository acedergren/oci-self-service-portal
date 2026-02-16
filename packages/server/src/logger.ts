/**
 * Structured Pino logger factory for CloudNow.
 *
 * Every server-side module creates a child logger via `createLogger(module)`.
 * The child automatically binds `{ module }` to every log line so you can
 * filter by module in production (`jq 'select(.module=="chat")'`).
 *
 * Dev mode uses pino-pretty (if installed) for human-readable output.
 * Production emits newline-delimited JSON to stdout.
 *
 * Usage:
 *   import { createLogger } from '../logger';
 *   const log = createLogger('chat');
 *   log.info({ model, region }, 'chat request');
 *   log.error({ err }, 'tool execution failed');
 */

import pino, { type Logger, type LoggerOptions } from 'pino';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Known module names for discoverability. Arbitrary strings are also accepted. */
export type KnownModule =
	| 'chat'
	| 'tools'
	| 'auth'
	| 'oracle'
	| 'metrics'
	| 'health'
	| 'hooks'
	| 'sessions-api'
	| 'execute'
	| 'approve'
	| 'audit'
	| 'approvals'
	| 'rate-limiter'
	| 'sentry';

const isDev = process.env.NODE_ENV !== 'production';

// ---------------------------------------------------------------------------
// Serialisers
// ---------------------------------------------------------------------------

/**
 * Custom Pino serialiser for Error objects.
 * Handles PortalError's extra fields (code, statusCode, context) as well
 * as plain Errors.
 */
function errorSerializer(err: Record<string, unknown>): Record<string, unknown> {
	if (!err || typeof err !== 'object') return err;

	const serialized: Record<string, unknown> = {
		message: err.message,
		stack: err.stack
	};

	// PortalError fields
	if ('code' in err) serialized.code = err.code;
	if ('statusCode' in err) serialized.statusCode = err.statusCode;
	if ('context' in err) serialized.context = err.context;

	// Upstream cause (Node 18+)
	if ('cause' in err && err.cause) {
		const cause = err.cause as Record<string, unknown>;
		serialized.cause = {
			message: cause.message,
			...(cause.code ? { code: cause.code } : {})
		};
	}

	return serialized;
}

/**
 * Serialiser for HTTP request objects.
 * Extracts only the fields we want logged — no body, no cookies.
 */
function requestSerializer(req: Record<string, unknown>): Record<string, unknown> {
	if (!req || typeof req !== 'object') return req;
	return {
		method: req.method,
		url: req.url,
		headers: req.headers
			? {
					'user-agent': (req.headers as Record<string, unknown>)['user-agent'],
					'x-request-id': (req.headers as Record<string, unknown>)['x-request-id']
				}
			: undefined
	};
}

// ---------------------------------------------------------------------------
// Transport (dev vs prod)
// ---------------------------------------------------------------------------

function buildTransport(): LoggerOptions['transport'] {
	if (!isDev) return undefined; // JSON to stdout in production

	// Use pino-pretty in dev if available; fall back to default JSON
	try {
		require.resolve('pino-pretty');
		return {
			target: 'pino-pretty',
			options: {
				colorize: true,
				translateTime: 'HH:MM:ss.l',
				ignore: 'pid,hostname'
			}
		};
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Root logger
// ---------------------------------------------------------------------------

const rootOptions: LoggerOptions = {
	level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
	serializers: {
		err: errorSerializer,
		error: errorSerializer,
		req: requestSerializer
	},
	redact: {
		paths: [
			'password',
			'authorization',
			'cookie',
			'*.password',
			'*.authorization',
			'*.cookie',
			'req.headers.authorization',
			'req.headers.cookie',
			'req.headers["set-cookie"]'
		],
		censor: '[REDACTED]'
	},
	transport: buildTransport(),
	// Bind the service name so all lines are attributable in aggregation
	base: { service: 'oci-ai-chat' }
};

/**
 * Root Pino logger instance.
 * Prefer `createLogger(module)` for module-scoped logging.
 */
export const logger: Logger = pino(rootOptions);

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a child logger scoped to a module.
 *
 * The child inherits the root logger's level, serialisers, and transport,
 * and binds `{ module }` plus any extra context to every log line.
 *
 * @param module  Logical module name (e.g. 'chat', 'oracle').
 * @param context Optional extra key-value pairs bound to every log line.
 * @returns A Pino child logger.
 *
 * @example
 * const log = createLogger('chat', { region: 'eu-frankfurt-1' });
 * log.info({ model: 'gemini' }, 'starting stream');
 * // => {"level":30,"module":"chat","region":"eu-frankfurt-1","model":"gemini","msg":"starting stream"}
 */
export function createLogger(
	module: KnownModule | (string & {}),
	context: Record<string, unknown> = {}
): Logger {
	return logger.child({ module, ...context });
}
