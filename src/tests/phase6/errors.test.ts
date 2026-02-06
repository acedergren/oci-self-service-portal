/**
 * Phase 6 TDD: Structured Error Types (PortalError hierarchy)
 *
 * Provides consistent error handling across the application with
 * proper HTTP status codes, error codes, and structured responses.
 *
 * Expected module: $lib/server/errors.ts
 * Expected exports:
 *   - PortalError (base class extends Error)
 *   - AuthenticationError (401)
 *   - AuthorizationError (403)
 *   - NotFoundError (404)
 *   - ValidationError (400)
 *   - RateLimitError (429)
 *   - DatabaseError (503)
 *   - ToolExecutionError (502)
 *   - toErrorResponse(error): { status: number; body: ErrorBody }
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
		it('extends Error', () => {
			if (!errorsModule) return;
			const PortalError = errorsModule.PortalError as new (
				message: string, status: number, code: string
			) => Error & { status: number; code: string };

			const err = new PortalError('test error', 500, 'INTERNAL');
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('test error');
			expect(err.status).toBe(500);
			expect(err.code).toBe('INTERNAL');
		});

		it('includes stack trace', () => {
			if (!errorsModule) return;
			const PortalError = errorsModule.PortalError as new (
				message: string, status: number, code: string
			) => Error & { stack: string };

			const err = new PortalError('test', 500, 'INTERNAL');
			expect(err.stack).toBeDefined();
		});
	});

	describe('error subclasses', () => {
		it('AuthenticationError has status 401', () => {
			if (!errorsModule) return;
			const AuthenticationError = errorsModule.AuthenticationError as new (
				message?: string
			) => Error & { status: number; code: string };

			const err = new AuthenticationError('Not logged in');
			expect(err.status).toBe(401);
			expect(err.code).toMatch(/AUTH/i);
		});

		it('AuthorizationError has status 403', () => {
			if (!errorsModule) return;
			const AuthorizationError = errorsModule.AuthorizationError as new (
				message?: string
			) => Error & { status: number; code: string };

			const err = new AuthorizationError('Insufficient permissions');
			expect(err.status).toBe(403);
			expect(err.code).toMatch(/FORBIDDEN|AUTHZ/i);
		});

		it('NotFoundError has status 404', () => {
			if (!errorsModule) return;
			const NotFoundError = errorsModule.NotFoundError as new (
				resource: string
			) => Error & { status: number; code: string };

			const err = new NotFoundError('Session');
			expect(err.status).toBe(404);
			expect(err.message).toContain('Session');
		});

		it('ValidationError has status 400', () => {
			if (!errorsModule) return;
			const ValidationError = errorsModule.ValidationError as new (
				message: string, details?: unknown
			) => Error & { status: number; code: string; details?: unknown };

			const err = new ValidationError('Invalid input', { field: 'email' });
			expect(err.status).toBe(400);
			expect(err.details).toEqual({ field: 'email' });
		});

		it('RateLimitError has status 429', () => {
			if (!errorsModule) return;
			const RateLimitError = errorsModule.RateLimitError as new (
				retryAfter: number
			) => Error & { status: number; code: string; retryAfter: number };

			const err = new RateLimitError(30);
			expect(err.status).toBe(429);
			expect(err.retryAfter).toBe(30);
		});

		it('DatabaseError has status 503', () => {
			if (!errorsModule) return;
			const DatabaseError = errorsModule.DatabaseError as new (
				message: string
			) => Error & { status: number; code: string };

			const err = new DatabaseError('Connection pool exhausted');
			expect(err.status).toBe(503);
		});

		it('ToolExecutionError has status 502 and includes tool name', () => {
			if (!errorsModule) return;
			const ToolExecutionError = errorsModule.ToolExecutionError as new (
				toolName: string, message: string
			) => Error & { status: number; code: string; toolName: string };

			const err = new ToolExecutionError('listInstances', 'OCI CLI timeout');
			expect(err.status).toBe(502);
			expect(err.toolName).toBe('listInstances');
		});
	});

	describe('toErrorResponse', () => {
		it('converts PortalError to structured response', () => {
			if (!errorsModule) return;
			const PortalError = errorsModule.PortalError as new (
				message: string, status: number, code: string
			) => Error & { status: number; code: string };
			const toErrorResponse = errorsModule.toErrorResponse as (
				err: Error
			) => { status: number; body: { error: string; code: string; message: string } };

			const err = new PortalError('Bad request', 400, 'VALIDATION');
			const response = toErrorResponse(err);

			expect(response.status).toBe(400);
			expect(response.body.code).toBe('VALIDATION');
			expect(response.body.message).toBe('Bad request');
		});

		it('converts unknown errors to 500 response', () => {
			if (!errorsModule) return;
			const toErrorResponse = errorsModule.toErrorResponse as (
				err: Error
			) => { status: number; body: { error: string; code: string; message: string } };

			const err = new Error('something unexpected');
			const response = toErrorResponse(err);

			expect(response.status).toBe(500);
			expect(response.body.code).toMatch(/INTERNAL/i);
			// Should not leak internal error details to client
			expect(response.body.message).not.toContain('something unexpected');
		});

		it('does not leak stack traces in response body', () => {
			if (!errorsModule) return;
			const toErrorResponse = errorsModule.toErrorResponse as (
				err: Error
			) => { status: number; body: Record<string, unknown> };

			const err = new Error('internal failure');
			const response = toErrorResponse(err);

			expect(response.body).not.toHaveProperty('stack');
		});
	});
});
