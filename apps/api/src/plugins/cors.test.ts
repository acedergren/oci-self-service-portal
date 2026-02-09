import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import corsPlugin from './cors.js';

function buildTestApp(corsOrigin = 'http://localhost:5173') {
	const app = Fastify({ logger: false });
	app.register(corsPlugin, { corsOrigin });
	app.get('/api/v1/test', async () => ({ ok: true }));
	return app;
}

describe('cors plugin', () => {
	it('sets Access-Control-Allow-Origin for configured origin', async () => {
		const app = buildTestApp('https://portal.example.com');

		const res = await app.inject({
			method: 'OPTIONS',
			url: '/api/v1/test',
			headers: {
				origin: 'https://portal.example.com',
				'access-control-request-method': 'GET'
			}
		});

		expect(res.headers['access-control-allow-origin']).toBe('https://portal.example.com');
	});

	it('allows credentials', async () => {
		const app = buildTestApp();

		const res = await app.inject({
			method: 'OPTIONS',
			url: '/api/v1/test',
			headers: {
				origin: 'http://localhost:5173',
				'access-control-request-method': 'GET'
			}
		});

		expect(res.headers['access-control-allow-credentials']).toBe('true');
	});

	it('includes x-request-id in exposed headers', async () => {
		const app = buildTestApp();

		const res = await app.inject({
			method: 'OPTIONS',
			url: '/api/v1/test',
			headers: {
				origin: 'http://localhost:5173',
				'access-control-request-method': 'GET'
			}
		});

		const exposed = res.headers['access-control-expose-headers'];
		expect(exposed).toContain('x-request-id');
	});
});
