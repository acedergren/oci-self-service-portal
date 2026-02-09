import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import {
	ValidationError,
	AuthError,
	NotFoundError,
	RateLimitError,
	OCIError,
	DatabaseError
} from '@portal/shared';
import errorHandlerPlugin from './error-handler.js';

function buildTestApp() {
	const app = Fastify({ logger: false });
	app.register(errorHandlerPlugin);
	return app;
}

describe('error-handler plugin', () => {
	it('maps ValidationError to 400 with structured body', async () => {
		const app = buildTestApp();
		app.get('/test', () => {
			throw new ValidationError('Bad field', { field: 'email' });
		});

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.statusCode).toBe(400);
		const body = res.json();
		expect(body.error).toBe('Bad field');
		expect(body.code).toBe('VALIDATION_ERROR');
	});

	it('maps AuthError 401 correctly', async () => {
		const app = buildTestApp();
		app.get('/test', () => {
			throw new AuthError('Not authenticated', 401);
		});

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.statusCode).toBe(401);
		expect(res.json().code).toBe('AUTH_ERROR');
	});

	it('maps AuthError 403 correctly', async () => {
		const app = buildTestApp();
		app.get('/test', () => {
			throw new AuthError('Forbidden', 403);
		});

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.statusCode).toBe(403);
		expect(res.json().code).toBe('AUTH_ERROR');
	});

	it('maps NotFoundError to 404', async () => {
		const app = buildTestApp();
		app.get('/test', () => {
			throw new NotFoundError('Session not found');
		});

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.statusCode).toBe(404);
		expect(res.json().code).toBe('NOT_FOUND');
	});

	it('maps RateLimitError to 429', async () => {
		const app = buildTestApp();
		app.get('/test', () => {
			throw new RateLimitError();
		});

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.statusCode).toBe(429);
		expect(res.json().code).toBe('RATE_LIMIT');
	});

	it('maps OCIError to 502', async () => {
		const app = buildTestApp();
		app.get('/test', () => {
			throw new OCIError('OCI CLI failed', { service: 'compute' });
		});

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.statusCode).toBe(502);
		expect(res.json().code).toBe('OCI_ERROR');
	});

	it('maps DatabaseError to 503', async () => {
		const app = buildTestApp();
		app.get('/test', () => {
			throw new DatabaseError('Pool exhausted');
		});

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.statusCode).toBe(503);
		expect(res.json().code).toBe('DATABASE_ERROR');
	});

	it('wraps unknown errors as 500 INTERNAL_ERROR', async () => {
		const app = buildTestApp();
		app.get('/test', () => {
			throw new Error('something broke');
		});

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.statusCode).toBe(500);
		const body = res.json();
		expect(body.code).toBe('INTERNAL_ERROR');
		expect(body.error).toBe('Internal server error');
	});

	it('does not leak stack traces in responses', async () => {
		const app = buildTestApp();
		app.get('/test', () => {
			throw new Error('secret details');
		});

		const res = await app.inject({ method: 'GET', url: '/test' });

		const body = res.json();
		expect(body.stack).toBeUndefined();
		expect(body.error).not.toContain('secret details');
	});

	it('includes requestId from PortalError context', async () => {
		const app = buildTestApp();
		app.get('/test', () => {
			throw new ValidationError('bad input', { requestId: 'req-123' });
		});

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.json().requestId).toBe('req-123');
	});

	it('sets Content-Type to application/json', async () => {
		const app = buildTestApp();
		app.get('/test', () => {
			throw new ValidationError('bad');
		});

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.headers['content-type']).toContain('application/json');
	});
});
