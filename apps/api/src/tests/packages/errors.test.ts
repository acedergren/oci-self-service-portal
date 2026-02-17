/**
 * Unit tests for the PortalError hierarchy.
 *
 * Pure utility — no mocks needed. Tests constructor behaviour,
 * serialisation methods, type guards, and the helper functions.
 *
 * Source: packages/types/src/errors.ts (204 lines, 0 prior tests)
 */

import { describe, it, expect } from 'vitest';
import {
	PortalError,
	ValidationError,
	AuthError,
	NotFoundError,
	RateLimitError,
	OCIError,
	DatabaseError,
	isPortalError,
	toPortalError,
	errorResponse
} from '@portal/types/errors.js';

// ── PortalError base class ──────────────────────────────────────────────

describe('PortalError', () => {
	it('stores code, message, statusCode, and context', () => {
		const err = new PortalError('TEST', 'test message', 418, { foo: 'bar' });
		expect(err.code).toBe('TEST');
		expect(err.message).toBe('test message');
		expect(err.statusCode).toBe(418);
		expect(err.context).toEqual({ foo: 'bar' });
		expect(err.name).toBe('PortalError');
		expect(err).toBeInstanceOf(Error);
	});

	it('defaults context to empty object', () => {
		const err = new PortalError('X', 'msg', 500);
		expect(err.context).toEqual({});
	});

	it('chains a cause error', () => {
		const cause = new Error('upstream');
		const err = new PortalError('X', 'wrapped', 500, {}, cause);
		expect(err.cause).toBe(cause);
	});

	it('has a stack trace', () => {
		const err = new PortalError('X', 'msg', 500);
		expect(err.stack).toBeDefined();
		expect(err.stack).toContain('PortalError');
	});
});

// ── toJSON (Pino structured logging) ────────────────────────────────────

describe('PortalError.toJSON()', () => {
	it('serialises all fields including stack', () => {
		const err = new PortalError('TEST', 'msg', 418, { reqId: 'r-1' });
		const json = err.toJSON();
		expect(json).toEqual(
			expect.objectContaining({
				name: 'PortalError',
				code: 'TEST',
				message: 'msg',
				statusCode: 418,
				context: { reqId: 'r-1' }
			})
		);
		expect(json.stack).toBeDefined();
	});

	it('includes cause message when present', () => {
		const cause = new Error('boom');
		const err = new PortalError('X', 'wrapped', 500, {}, cause);
		expect(err.toJSON().cause).toBe('boom');
	});

	it('omits cause key when no cause', () => {
		const err = new PortalError('X', 'msg', 500);
		expect(err.toJSON()).not.toHaveProperty('cause');
	});
});

// ── toSentryExtras ──────────────────────────────────────────────────────

describe('PortalError.toSentryExtras()', () => {
	it('spreads context and omits stack', () => {
		const err = new PortalError('X', 'msg', 500, { service: 'compute' });
		const extras = err.toSentryExtras();
		expect(extras).toEqual({
			code: 'X',
			statusCode: 500,
			service: 'compute'
		});
		expect(extras).not.toHaveProperty('stack');
		expect(extras).not.toHaveProperty('message');
	});

	it('includes causeMessage when cause present', () => {
		const err = new PortalError('X', 'msg', 500, {}, new Error('upstream'));
		expect(err.toSentryExtras().causeMessage).toBe('upstream');
	});
});

// ── toResponseBody (safe for API clients) ───────────────────────────────

describe('PortalError.toResponseBody()', () => {
	it('returns error and code without internals', () => {
		const err = new PortalError('X', 'msg', 500, { secretKey: '***' });
		const body = err.toResponseBody();
		expect(body).toEqual({ error: 'msg', code: 'X' });
		expect(body).not.toHaveProperty('stack');
		expect(body).not.toHaveProperty('context');
		expect(body).not.toHaveProperty('statusCode');
	});

	it('includes requestId from context when present', () => {
		const err = new PortalError('X', 'msg', 500, { requestId: 'req-abc' });
		expect(err.toResponseBody().requestId).toBe('req-abc');
	});
});

// ── Subclasses ──────────────────────────────────────────────────────────

describe('Error subclasses', () => {
	it('ValidationError → 400 VALIDATION_ERROR', () => {
		const err = new ValidationError('bad input', { field: 'name' });
		expect(err.code).toBe('VALIDATION_ERROR');
		expect(err.statusCode).toBe(400);
		expect(err.name).toBe('ValidationError');
		expect(err.context).toEqual({ field: 'name' });
		expect(err).toBeInstanceOf(PortalError);
	});

	it('AuthError → defaults to 401', () => {
		const err = new AuthError('not logged in');
		expect(err.code).toBe('AUTH_ERROR');
		expect(err.statusCode).toBe(401);
	});

	it('AuthError → can be 403 for authorisation', () => {
		const err = new AuthError('forbidden', 403);
		expect(err.statusCode).toBe(403);
		expect(err.code).toBe('AUTH_ERROR');
	});

	it('NotFoundError → 404 NOT_FOUND', () => {
		const err = new NotFoundError('session not found');
		expect(err.code).toBe('NOT_FOUND');
		expect(err.statusCode).toBe(404);
	});

	it('RateLimitError → 429 RATE_LIMIT with default message', () => {
		const err = new RateLimitError();
		expect(err.code).toBe('RATE_LIMIT');
		expect(err.statusCode).toBe(429);
		expect(err.message).toContain('Rate limit exceeded');
	});

	it('OCIError → 502 OCI_ERROR', () => {
		const err = new OCIError('CLI failed', { exitCode: 1 });
		expect(err.code).toBe('OCI_ERROR');
		expect(err.statusCode).toBe(502);
		expect(err.context.exitCode).toBe(1);
	});

	it('DatabaseError → 503 DATABASE_ERROR', () => {
		const err = new DatabaseError('connection refused');
		expect(err.code).toBe('DATABASE_ERROR');
		expect(err.statusCode).toBe(503);
	});
});

// ── isPortalError type guard ────────────────────────────────────────────

describe('isPortalError()', () => {
	it('returns true for PortalError', () => {
		expect(isPortalError(new PortalError('X', 'msg', 500))).toBe(true);
	});

	it('returns true for subclasses', () => {
		expect(isPortalError(new ValidationError('bad'))).toBe(true);
		expect(isPortalError(new OCIError('fail'))).toBe(true);
	});

	it('returns false for plain Error', () => {
		expect(isPortalError(new Error('plain'))).toBe(false);
	});

	it('returns false for non-Error values', () => {
		expect(isPortalError('string')).toBe(false);
		expect(isPortalError(null)).toBe(false);
		expect(isPortalError(undefined)).toBe(false);
	});
});

// ── toPortalError wrapper ───────────────────────────────────────────────

describe('toPortalError()', () => {
	it('passes through an existing PortalError unchanged', () => {
		const original = new ValidationError('bad input');
		expect(toPortalError(original)).toBe(original);
	});

	it('wraps a plain Error as INTERNAL_ERROR 500', () => {
		const plain = new Error('oops');
		const wrapped = toPortalError(plain);
		expect(wrapped.code).toBe('INTERNAL_ERROR');
		expect(wrapped.statusCode).toBe(500);
		expect(wrapped.message).toBe('oops');
		expect(wrapped.cause).toBe(plain);
	});

	it('wraps a non-Error value with fallback message', () => {
		const wrapped = toPortalError('something weird');
		expect(wrapped.code).toBe('INTERNAL_ERROR');
		expect(wrapped.statusCode).toBe(500);
		expect(wrapped.message).toBe('Internal server error');
	});

	it('uses custom fallback message', () => {
		const wrapped = toPortalError(42, 'custom fallback');
		expect(wrapped.message).toBe('custom fallback');
	});
});

// ── errorResponse helper ────────────────────────────────────────────────

describe('errorResponse()', () => {
	it('builds a Response with correct status and JSON body', async () => {
		const err = new NotFoundError('session not found');
		const res = errorResponse(err);
		expect(res.status).toBe(404);

		const body = JSON.parse(await (res as unknown as globalThis.Response).text());
		expect(body).toEqual({ error: 'session not found', code: 'NOT_FOUND' });
	});

	it('includes Content-Type application/json header', () => {
		const err = new PortalError('X', 'msg', 500);
		const res = errorResponse(err);
		expect(res.headers.get('Content-Type')).toBe('application/json');
	});

	it('attaches requestId to body and X-Request-Id header', async () => {
		const err = new PortalError('X', 'msg', 500);
		const res = errorResponse(err, 'req-123');

		expect(res.headers.get('X-Request-Id')).toBe('req-123');
		const body = JSON.parse(await (res as unknown as globalThis.Response).text());
		expect(body.requestId).toBe('req-123');
	});
});
