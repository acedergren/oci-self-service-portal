import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp } from './test-helpers.js';
import { authRoutes } from '../../routes/auth.js';

const { mockAuthHandler } = vi.hoisted(() => {
	return {
		mockAuthHandler: vi.fn()
	};
});

vi.mock('@portal/shared/server/auth/config', () => ({
	auth: {
		handler: (...args: unknown[]) => mockAuthHandler(...args)
	}
}));

describe('Auth routes', () => {
	beforeEach(() => {
		mockAuthHandler.mockReset();
	});

	it('delegates /api/auth/get-session to Better Auth handler', async () => {
		mockAuthHandler.mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		const app = await buildTestApp({ withRbac: false });
		await app.register(authRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/auth/get-session' });
		expect(res.statusCode).toBe(200);
		expect(mockAuthHandler).toHaveBeenCalledOnce();
	});

	it('accepts POST requests on /api/auth/*', async () => {
		mockAuthHandler.mockResolvedValue(
			new Response(JSON.stringify({ error: 'unauthorized' }), {
				status: 401,
				headers: { 'content-type': 'application/json' }
			})
		);

		const app = await buildTestApp({ withRbac: false });
		await app.register(authRoutes);
		await app.ready();

		const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: {} });
		expect(res.statusCode).toBe(401);
		expect(mockAuthHandler).toHaveBeenCalledOnce();
	});

	it('forwards set-cookie headers from Better Auth handler', async () => {
		mockAuthHandler.mockResolvedValue(
			new Response('ok', {
				status: 200,
				headers: {
					'set-cookie': 'session=abc; Path=/; HttpOnly'
				}
			})
		);

		const app = await buildTestApp({ withRbac: false });
		await app.register(authRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/auth/get-session' });
		expect(res.statusCode).toBe(200);
		expect(res.headers['set-cookie']).toContain('session=abc');
	});

	it('returns 500 when Better Auth handler throws', async () => {
		mockAuthHandler.mockRejectedValue(new Error('Unexpected auth failure'));

		const app = await buildTestApp({ withRbac: false });
		await app.register(authRoutes);
		await app.ready();

		const res = await app.inject({ method: 'GET', url: '/api/auth/get-session' });
		expect(res.statusCode).toBe(500);
		expect(res.json()).toEqual({ error: 'Authentication service unavailable' });
	});
});
