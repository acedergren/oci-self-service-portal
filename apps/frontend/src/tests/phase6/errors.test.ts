/**
 * Phase 6 TDD: Structured Error Types (PortalError hierarchy)
 *
 * Tests the error hierarchy defined in $lib/server/errors.ts.
 * Architecture: PortalError base → subclasses with fixed code/statusCode.
 * Serialization: toJSON() for Pino, toSentryExtras() for Sentry, toResponseBody() for HTTP.
 *
 * Exports tested:
 *   - PortalError, ValidationError, AuthError, NotFoundError, RateLimitError, OCIError, DatabaseError
 *   - isPortalError(), toPortalError(), errorResponse()
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let errorsModule: Record<string, unknown> | null = null;
let moduleError: string | null = null;

beforeEach(async () => {
	vi.clearAllMocks();
	try {
		errorsModule = await import('$lib/server/errors.js');
	} catch (err) {
		moduleError = (err as Error).message;
	}
});

describe('Structured Error Types (Phase 6.9)', () => {
	describe('module availability', () => {
		it('errors module should be importable', () => {
			if (moduleError) {
				expect.fail(
					`errors module not yet available: ${moduleError}. ` +
						'Implement $lib/server/errors.ts per Phase 6.9.'
				);
			}
			expect(errorsModule).not.toBeNull();
		});
	});

	describe('PortalError base class', () => {
		it('extends Error with code, statusCode, and context', () => {
			if (!errorsModule) return;
			const PortalError = errorsModule.PortalError as new (
				code: string,
				message: string,
				statusCode: number,
				context?: Record<string, unknown>
			) => Error & { code: string; statusCode: number; context: Record<string, unknown> };

			const err = new PortalError('TEST_ERROR', 'test error', 500, { key: 'val' });
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('test error');
			expect(err.code).toBe('TEST_ERROR');
			expect(err.statusCode).toBe(500);
			expect(err.context).toEqual({ key: 'val' });
		});

		it('includes stack trace', () => {
			if (!errorsModule) return;
			const PortalError = errorsModule.PortalError as new (
				code: string,
				message: string,
				statusCode: number
			) => Error;

			const err = new PortalError('TEST', 'test', 500);
			expect(err.stack).toBeDefined();
		});

		it('supports cause chain', () => {
			if (!errorsModule) return;
			const PortalError = errorsModule.PortalError as new (
				code: string,
				message: string,
				statusCode: number,
				context?: Record<string, unknown>,
				cause?: Error
			) => Error & { cause?: Error };

			const cause = new Error('upstream failure');
			const err = new PortalError('TEST', 'wrapped', 500, {}, cause);
			expect(err.cause).toBe(cause);
		});

		it('sets constructor name correctly', () => {
			if (!errorsModule) return;
			const PortalError = errorsModule.PortalError as new (
				code: string,
				message: string,
				statusCode: number
			) => Error;

			const err = new PortalError('TEST', 'test', 500);
			expect(err.name).toBe('PortalError');
		});
	});

	describe('error subclasses', () => {
		it('ValidationError has statusCode 400', () => {
			if (!errorsModule) return;
			const ValidationError = errorsModule.ValidationError as new (
				message: string,
				context?: Record<string, unknown>
			) => Error & { statusCode: number; code: string; context: Record<string, unknown> };

			const err = new ValidationError('Invalid input', { field: 'email' });
			expect(err.statusCode).toBe(400);
			expect(err.code).toBe('VALIDATION_ERROR');
			expect(err.context).toEqual({ field: 'email' });
		});

		it('AuthError defaults to 401 for authentication failures', () => {
			if (!errorsModule) return;
			const AuthError = errorsModule.AuthError as new (
				message: string,
				statusCode?: 401 | 403
			) => Error & { statusCode: number; code: string };

			const err = new AuthError('Not logged in');
			expect(err.statusCode).toBe(401);
			expect(err.code).toBe('AUTH_ERROR');
		});

		it('AuthError supports 403 for authorization failures', () => {
			if (!errorsModule) return;
			const AuthError = errorsModule.AuthError as new (
				message: string,
				statusCode?: 401 | 403
			) => Error & { statusCode: number; code: string };

			const err = new AuthError('Insufficient permissions', 403);
			expect(err.statusCode).toBe(403);
			expect(err.code).toBe('AUTH_ERROR');
		});

		it('NotFoundError has statusCode 404', () => {
			if (!errorsModule) return;
			const NotFoundError = errorsModule.NotFoundError as new (
				message: string
			) => Error & { statusCode: number; code: string };

			const err = new NotFoundError('Session not found');
			expect(err.statusCode).toBe(404);
			expect(err.code).toBe('NOT_FOUND');
			expect(err.message).toContain('Session');
		});

		it('RateLimitError has statusCode 429 with default message', () => {
			if (!errorsModule) return;
			const RateLimitError = errorsModule.RateLimitError as new (
				message?: string,
				context?: Record<string, unknown>
			) => Error & { statusCode: number; code: string; context: Record<string, unknown> };

			const err = new RateLimitError('Too many requests', { retryAfter: 30 });
			expect(err.statusCode).toBe(429);
			expect(err.code).toBe('RATE_LIMIT');
			expect(err.context.retryAfter).toBe(30);
		});

		it('RateLimitError has sensible default message', () => {
			if (!errorsModule) return;
			const RateLimitError = errorsModule.RateLimitError as new () => Error & {
				statusCode: number;
				message: string;
			};

			const err = new RateLimitError();
			expect(err.statusCode).toBe(429);
			expect(err.message).toBeTruthy();
		});

		it('OCIError has statusCode 502', () => {
			if (!errorsModule) return;
			const OCIError = errorsModule.OCIError as new (
				message: string,
				context?: Record<string, unknown>
			) => Error & { statusCode: number; code: string; context: Record<string, unknown> };

			const err = new OCIError('OCI CLI timeout', {
				service: 'compute',
				command: 'listInstances',
				exitCode: 1
			});
			expect(err.statusCode).toBe(502);
			expect(err.code).toBe('OCI_ERROR');
			expect(err.context.service).toBe('compute');
		});

		it('DatabaseError has statusCode 503', () => {
			if (!errorsModule) return;
			const DatabaseError = errorsModule.DatabaseError as new (
				message: string
			) => Error & { statusCode: number; code: string };

			const err = new DatabaseError('Connection pool exhausted');
			expect(err.statusCode).toBe(503);
			expect(err.code).toBe('DATABASE_ERROR');
		});

		it('all subclasses are instanceof PortalError', () => {
			if (!errorsModule) return;
			const PortalError = errorsModule.PortalError as new (...args: unknown[]) => Error;
			const ValidationError = errorsModule.ValidationError as new (msg: string) => Error;
			const AuthError = errorsModule.AuthError as new (msg: string) => Error;
			const NotFoundError = errorsModule.NotFoundError as new (msg: string) => Error;
			const OCIError = errorsModule.OCIError as new (msg: string) => Error;
			const DatabaseError = errorsModule.DatabaseError as new (msg: string) => Error;
			const RateLimitError = errorsModule.RateLimitError as new () => Error;

			expect(new ValidationError('x')).toBeInstanceOf(PortalError);
			expect(new AuthError('x')).toBeInstanceOf(PortalError);
			expect(new NotFoundError('x')).toBeInstanceOf(PortalError);
			expect(new OCIError('x')).toBeInstanceOf(PortalError);
			expect(new DatabaseError('x')).toBeInstanceOf(PortalError);
			expect(new RateLimitError()).toBeInstanceOf(PortalError);
		});
	});

	describe('toJSON (Pino serialization)', () => {
		it('serializes PortalError to structured JSON', () => {
			if (!errorsModule) return;
			const ValidationError = errorsModule.ValidationError as new (
				message: string,
				context?: Record<string, unknown>
			) => Error & { toJSON: () => Record<string, unknown> };

			const err = new ValidationError('bad input', { field: 'name' });
			const json = err.toJSON();

			expect(json.name).toBe('ValidationError');
			expect(json.code).toBe('VALIDATION_ERROR');
			expect(json.message).toBe('bad input');
			expect(json.statusCode).toBe(400);
			expect(json.context).toEqual({ field: 'name' });
			expect(json.stack).toBeDefined();
		});

		it('includes cause message when present', () => {
			if (!errorsModule) return;
			const DatabaseError = errorsModule.DatabaseError as new (
				message: string,
				context?: Record<string, unknown>,
				cause?: Error
			) => Error & { toJSON: () => Record<string, unknown> };

			const cause = new Error('ORA-12541: TNS:no listener');
			const err = new DatabaseError('DB connection failed', {}, cause);
			const json = err.toJSON();

			expect(json.cause).toBe('ORA-12541: TNS:no listener');
		});
	});

	describe('toSentryExtras', () => {
		it('extracts context as flat key-value pairs for Sentry', () => {
			if (!errorsModule) return;
			const OCIError = errorsModule.OCIError as new (
				message: string,
				context?: Record<string, unknown>
			) => Error & { toSentryExtras: () => Record<string, unknown> };

			const err = new OCIError('CLI failed', { service: 'compute', exitCode: 1 });
			const extras = err.toSentryExtras();

			expect(extras.code).toBe('OCI_ERROR');
			expect(extras.statusCode).toBe(502);
			expect(extras.service).toBe('compute');
			expect(extras.exitCode).toBe(1);
		});
	});

	describe('toResponseBody', () => {
		it('returns safe response body without stack traces', () => {
			if (!errorsModule) return;
			const ValidationError = errorsModule.ValidationError as new (message: string) => Error & {
				toResponseBody: () => { error: string; code: string; requestId?: string };
			};

			const err = new ValidationError('invalid compartmentId');
			const body = err.toResponseBody();

			expect(body.error).toBe('invalid compartmentId');
			expect(body.code).toBe('VALIDATION_ERROR');
			expect(body).not.toHaveProperty('stack');
			expect(body).not.toHaveProperty('context');
		});

		it('includes requestId when present in context', () => {
			if (!errorsModule) return;
			const ValidationError = errorsModule.ValidationError as new (
				message: string,
				context?: Record<string, unknown>
			) => Error & {
				toResponseBody: () => { error: string; code: string; requestId?: string };
			};

			const err = new ValidationError('bad', { requestId: 'req-123' });
			const body = err.toResponseBody();

			expect(body.requestId).toBe('req-123');
		});
	});

	describe('helper functions', () => {
		it('isPortalError type guard works', () => {
			if (!errorsModule) return;
			const isPortalError = errorsModule.isPortalError as (err: unknown) => boolean;
			const ValidationError = errorsModule.ValidationError as new (msg: string) => Error;

			expect(isPortalError(new ValidationError('x'))).toBe(true);
			expect(isPortalError(new Error('x'))).toBe(false);
			expect(isPortalError('not an error')).toBe(false);
		});

		it('toPortalError wraps unknown errors as INTERNAL_ERROR', () => {
			if (!errorsModule) return;
			const toPortalError = errorsModule.toPortalError as (
				err: unknown
			) => Error & { code: string; statusCode: number };

			const wrapped = toPortalError(new Error('oops'));
			expect(wrapped.code).toBe('INTERNAL_ERROR');
			expect(wrapped.statusCode).toBe(500);
		});

		it('toPortalError returns PortalError unchanged', () => {
			if (!errorsModule) return;
			const toPortalError = errorsModule.toPortalError as (err: unknown) => Error;
			const ValidationError = errorsModule.ValidationError as new (msg: string) => Error;

			const original = new ValidationError('bad');
			const result = toPortalError(original);
			expect(result).toBe(original);
		});

		it('errorResponse creates a Response with correct status and headers', () => {
			if (!errorsModule) return;
			const errorResponse = errorsModule.errorResponse as (
				err: Error & { statusCode: number },
				requestId?: string
			) => Response;
			const NotFoundError = errorsModule.NotFoundError as new (
				msg: string
			) => Error & { statusCode: number };

			const err = new NotFoundError('session not found');
			const response = errorResponse(err, 'req-456');

			expect(response.status).toBe(404);
			expect(response.headers.get('Content-Type')).toBe('application/json');
			expect(response.headers.get('X-Request-Id')).toBe('req-456');
		});

		it('errorResponse body does not leak internal details', async () => {
			if (!errorsModule) return;
			const errorResponse = errorsModule.errorResponse as (
				err: Error & { statusCode: number }
			) => Response;
			const DatabaseError = errorsModule.DatabaseError as new (
				msg: string,
				ctx?: Record<string, unknown>
			) => Error & { statusCode: number };

			const err = new DatabaseError('ORA-12541: TNS:no listener', {
				internalDebug: 'secret info'
			});
			const response = errorResponse(err);
			const body = await response.json();

			expect(body).not.toHaveProperty('stack');
			expect(body).not.toHaveProperty('context');
			expect(body).not.toHaveProperty('internalDebug');
		});
	});
});
