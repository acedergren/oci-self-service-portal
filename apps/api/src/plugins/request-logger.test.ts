import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import requestLoggerPlugin, { redactHeaders } from './request-logger.js';

function buildTestApp() {
	const app = Fastify({ logger: false });
	app.register(requestLoggerPlugin);
	app.get('/test', (request, reply) => {
		return reply.send({ requestId: request.id });
	});
	return app;
}

describe('request-logger plugin', () => {
	it('generates a request ID with req- prefix when none provided', async () => {
		const app = buildTestApp();

		const res = await app.inject({ method: 'GET', url: '/test' });

		const body = res.json();
		expect(body.requestId).toMatch(/^req-/);
	});

	it('reuses X-Request-Id header from client', async () => {
		const app = buildTestApp();

		const res = await app.inject({
			method: 'GET',
			url: '/test',
			headers: { 'x-request-id': 'req-from-frontend' }
		});

		const body = res.json();
		expect(body.requestId).toBe('req-from-frontend');
	});

	it('sets X-Request-Id on the response', async () => {
		const app = buildTestApp();

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.headers['x-request-id']).toBeDefined();
		expect(res.headers['x-request-id']).toMatch(/^req-/);
	});

	it('sanitizes non-string X-Request-Id headers', async () => {
		const app = buildTestApp();

		const res = await app.inject({
			method: 'GET',
			url: '/test',
			headers: { 'x-request-id': '' }
		});

		const body = res.json();
		expect(body.requestId).toMatch(/^req-/);
	});

	it('rejects X-Request-Id with unsafe characters', async () => {
		const app = buildTestApp();

		const res = await app.inject({
			method: 'GET',
			url: '/test',
			headers: { 'x-request-id': 'req-<script>alert(1)</script>' }
		});

		const body = res.json();
		// Should generate a new ID rather than accepting unsafe input
		expect(body.requestId).not.toBe('req-<script>alert(1)</script>');
		expect(body.requestId).toMatch(/^req-[a-zA-Z0-9._-]+$/);
	});

	it('rejects X-Request-Id longer than 128 characters', async () => {
		const app = buildTestApp();
		const longId = 'req-' + 'a'.repeat(200);

		const res = await app.inject({
			method: 'GET',
			url: '/test',
			headers: { 'x-request-id': longId }
		});

		const body = res.json();
		expect(body.requestId.length).toBeLessThanOrEqual(128);
		expect(body.requestId).not.toBe(longId);
	});

	it('accepts X-Request-Id with valid characters', async () => {
		const app = buildTestApp();

		const res = await app.inject({
			method: 'GET',
			url: '/test',
			headers: { 'x-request-id': 'req-abc-123_def.456' }
		});

		const body = res.json();
		expect(body.requestId).toBe('req-abc-123_def.456');
	});
});

describe('redactHeaders', () => {
	it('redacts authorization header', () => {
		const result = redactHeaders({ authorization: 'Bearer secret' });
		expect(result.authorization).toBe('[REDACTED]');
	});

	it('redacts cookie header', () => {
		const result = redactHeaders({ cookie: 'session=abc123' });
		expect(result.cookie).toBe('[REDACTED]');
	});

	it('redacts set-cookie header', () => {
		const result = redactHeaders({ 'set-cookie': 'token=xyz' });
		expect(result['set-cookie']).toBe('[REDACTED]');
	});

	it('redacts x-api-key header', () => {
		const result = redactHeaders({ 'x-api-key': 'portal_abc123' });
		expect(result['x-api-key']).toBe('[REDACTED]');
	});

	it('preserves non-sensitive headers', () => {
		const result = redactHeaders({
			'content-type': 'application/json',
			accept: 'text/html'
		});
		expect(result['content-type']).toBe('application/json');
		expect(result.accept).toBe('text/html');
	});

	it('handles mixed sensitive and non-sensitive headers', () => {
		const result = redactHeaders({
			'content-type': 'application/json',
			authorization: 'Bearer token',
			'x-request-id': 'req-123'
		});
		expect(result['content-type']).toBe('application/json');
		expect(result.authorization).toBe('[REDACTED]');
		expect(result['x-request-id']).toBe('req-123');
	});

	it('is case-insensitive for header names', () => {
		const result = redactHeaders({ Authorization: 'Bearer secret' });
		expect(result.Authorization).toBe('[REDACTED]');
	});

	it('handles empty headers object', () => {
		const result = redactHeaders({});
		expect(Object.keys(result)).toHaveLength(0);
	});
});
