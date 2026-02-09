import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import rateLimitPlugin from './rate-limit.js';

async function buildTestApp(max = 3) {
	const app = Fastify({ logger: false });
	await app.register(rateLimitPlugin, { rateLimitMax: max });
	app.get('/test', async () => ({ ok: true }));
	await app.ready();
	return app;
}

const injectOpts = { method: 'GET' as const, url: '/test', remoteAddress: '127.0.0.1' };

describe('rate-limit plugin', () => {
	it('allows requests under the limit', async () => {
		const app = await buildTestApp(5);

		const res = await app.inject(injectOpts);

		expect(res.statusCode).toBe(200);
	});

	it('returns 429 when limit exceeded', async () => {
		const app = await buildTestApp(2);

		await app.inject(injectOpts);
		await app.inject(injectOpts);

		const res = await app.inject(injectOpts);

		expect(res.statusCode).toBe(429);
	});

	it('includes rate limit headers', async () => {
		const app = await buildTestApp(5);

		const res = await app.inject(injectOpts);

		expect(res.headers['x-ratelimit-limit']).toBeDefined();
		expect(res.headers['x-ratelimit-remaining']).toBeDefined();
	});
});
