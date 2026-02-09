import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import helmetPlugin from './helmet.js';

function buildTestApp() {
	const app = Fastify({ logger: false });
	app.register(helmetPlugin);
	app.get('/test', async () => ({ ok: true }));
	return app;
}

describe('helmet plugin', () => {
	it('sets X-Content-Type-Options header', async () => {
		const app = buildTestApp();

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.headers['x-content-type-options']).toBe('nosniff');
	});

	it('sets X-Frame-Options header', async () => {
		const app = buildTestApp();

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
	});

	it('removes X-Powered-By header', async () => {
		const app = buildTestApp();

		const res = await app.inject({ method: 'GET', url: '/test' });

		expect(res.headers['x-powered-by']).toBeUndefined();
	});
});
