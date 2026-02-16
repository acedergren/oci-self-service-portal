/**
 * Structured error hierarchy for CloudNow.
 *
 * Every error carries a machine-readable `code`, an HTTP `statusCode`,
 * and an arbitrary `context` bag for structured logging. All errors
 * serialise cleanly to JSON (for Pino) and to Sentry extras.
 *
 * Usage:
 *   throw new ValidationError('compartmentId is required', { field: 'compartmentId' });
 *   throw new OCIError('OCI CLI exited with code 1', { service: 'compute', exitCode: 1 });
 */

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

/**
 * Base error for all portal-originated errors.
 *
 * Subclasses set a fixed `code` (e.g. `VALIDATION_ERROR`) and default
 * `statusCode`. Call sites can override `statusCode` when needed
 * (e.g. `AuthError` may be 401 or 403).
 */
export class PortalError extends Error {
	/** Machine-readable error code (e.g. `VALIDATION_ERROR`, `OCI_ERROR`). */
	readonly code: string;

	/** HTTP status code to use when this error reaches an API boundary. */
	readonly statusCode: number;

	/** Arbitrary structured context for logging / diagnostics. */
	readonly context: Record<string, unknown>;

	/** Optional upstream error that caused this one. */
	readonly cause?: Error;

	constructor(
		code: string,
		message: string,
		statusCode: number,
		context: Record<string, unknown> = {},
		cause?: Error
	) {
		super(message, { cause });
		this.name = this.constructor.name;
		this.code = code;
		this.statusCode = statusCode;
		this.context = context;
		this.cause = cause;

		// Maintain proper stack trace in V8
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}

	/**
	 * Serialise for Pino / JSON structured logging.
	 * Pino calls `toJSON()` automatically when an error is passed as a value.
	 */
	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			statusCode: this.statusCode,
			context: this.context,
			stack: this.stack,
			...(this.cause ? { cause: this.cause.message } : {})
		};
	}

	/**
	 * Extract extras for Sentry `captureException(err, { extra })`.
	 * Omits the stack (Sentry captures that separately).
	 */
	toSentryExtras(): Record<string, unknown> {
		return {
			code: this.code,
			statusCode: this.statusCode,
			...this.context,
			...(this.cause ? { causeMessage: this.cause.message } : {})
		};
	}

	/**
	 * Build a safe JSON response body suitable for returning to API clients.
	 * Never exposes stack traces or internal context.
	 */
	toResponseBody(): { error: string; code: string; requestId?: string } {
		return {
			error: this.message,
			code: this.code,
			...(this.context.requestId ? { requestId: this.context.requestId as string } : {})
		};
	}
}

// ---------------------------------------------------------------------------
// Concrete subclasses
// ---------------------------------------------------------------------------

/** Request validation failures (missing fields, bad format, schema mismatch). */
export class ValidationError extends PortalError {
	constructor(message: string, context: Record<string, unknown> = {}, cause?: Error) {
		super('VALIDATION_ERROR', message, 400, context, cause);
	}
}

/** Authentication (401) or authorisation (403) failures. */
export class AuthError extends PortalError {
	constructor(
		message: string,
		statusCode: 401 | 403 = 401,
		context: Record<string, unknown> = {},
		cause?: Error
	) {
		super('AUTH_ERROR', message, statusCode, context, cause);
	}
}

/** Resource not found — tool, session, compartment, etc. */
export class NotFoundError extends PortalError {
	constructor(message: string, context: Record<string, unknown> = {}, cause?: Error) {
		super('NOT_FOUND', message, 404, context, cause);
	}
}

/** Client has exceeded the rate limit. */
export class RateLimitError extends PortalError {
	constructor(
		message: string = 'Rate limit exceeded. Please try again later.',
		context: Record<string, unknown> = {},
		cause?: Error
	) {
		super('RATE_LIMIT', message, 429, context, cause);
	}
}

/**
 * OCI CLI or API call failed.
 * Status 502 because the portal is acting as a gateway to OCI.
 */
export class OCIError extends PortalError {
	constructor(message: string, context: Record<string, unknown> = {}, cause?: Error) {
		super('OCI_ERROR', message, 502, context, cause);
	}
}

/**
 * Oracle database connection or query failure.
 * Status 503 because the DB is a backing service.
 */
export class DatabaseError extends PortalError {
	constructor(message: string, context: Record<string, unknown> = {}, cause?: Error) {
		super('DATABASE_ERROR', message, 503, context, cause);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Type guard: is the value a PortalError?
 */
export function isPortalError(err: unknown): err is PortalError {
	return err instanceof PortalError;
}

/**
 * Wrap an unknown caught value into a PortalError.
 * If it is already a PortalError, returns it unchanged.
 * Otherwise wraps it in a generic 500 PortalError.
 */
export function toPortalError(
	err: unknown,
	fallbackMessage = 'Internal server error'
): PortalError {
	if (isPortalError(err)) return err;

	const cause = err instanceof Error ? err : undefined;
	const message = err instanceof Error ? err.message : fallbackMessage;

	return new PortalError('INTERNAL_ERROR', message, 500, {}, cause);
}

/**
 * Build a `Response` from a PortalError.
 * Attaches the request ID from context if present.
 */
export function errorResponse(err: PortalError, requestId?: string): Response {
	const body = err.toResponseBody();
	if (requestId) body.requestId = requestId;

	return new Response(JSON.stringify(body), {
		status: err.statusCode,
		headers: {
			'Content-Type': 'application/json',
			...(requestId ? { 'X-Request-Id': requestId } : {})
		}
	}) as unknown as Response;
}
