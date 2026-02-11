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

	describe('OIDC flow end-to-end', () => {
		it('completes full login/logout cycle with session cookie', async () => {
			const app = await buildTestApp({ withRbac: false });
			await app.register(authRoutes);
			await app.ready();

			// Step 1: Initiate OIDC login (GET /api/auth/sign-in/social)
			// Better Auth returns 302 redirect to IDCS
			mockAuthHandler.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: {
						location: 'https://identity.oraclecloud.com/oauth2/v1/authorize?...'
					}
				})
			);

			const loginInitiate = await app.inject({
				method: 'GET',
				url: '/api/auth/sign-in/social/oci-iam'
			});

			expect(loginInitiate.statusCode).toBe(302);
			expect(loginInitiate.headers.location).toContain('identity.oraclecloud.com');
			expect(mockAuthHandler).toHaveBeenCalledTimes(1);

			// Step 2: IDCS redirects back to callback with authorization code
			// (In real flow, user logs in at IDCS, then IDCS redirects to callback)
			// Better Auth exchanges code for tokens and creates session
			const sessionCookie = 'session=test-session-id; Path=/; HttpOnly; SameSite=Lax';
			mockAuthHandler.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						user: {
							id: 'user-123',
							email: 'test@example.com',
							name: 'Test User'
						},
						session: {
							id: 'session-123',
							userId: 'user-123',
							expiresAt: new Date(Date.now() + 86400000).toISOString()
						}
					}),
					{
						status: 200,
						headers: {
							'content-type': 'application/json',
							'set-cookie': sessionCookie
						}
					}
				)
			);

			const callback = await app.inject({
				method: 'GET',
				url: '/api/auth/callback/oci-iam?code=auth-code-123&state=state-abc'
			});

			expect(callback.statusCode).toBe(200);
			expect(callback.headers['set-cookie']).toContain('session=test-session-id');
			expect(mockAuthHandler).toHaveBeenCalledTimes(2);

			// Step 3: Make authenticated request using session cookie
			// Better Auth validates session from cookie and returns user data
			mockAuthHandler.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						user: {
							id: 'user-123',
							email: 'test@example.com',
							name: 'Test User'
						},
						session: {
							id: 'session-123',
							userId: 'user-123',
							expiresAt: new Date(Date.now() + 86400000).toISOString()
						}
					}),
					{
						status: 200,
						headers: { 'content-type': 'application/json' }
					}
				)
			);

			const getSession = await app.inject({
				method: 'GET',
				url: '/api/auth/session',
				headers: {
					cookie: 'session=test-session-id'
				}
			});

			expect(getSession.statusCode).toBe(200);
			const sessionData = getSession.json();
			expect(sessionData.user).toEqual({
				id: 'user-123',
				email: 'test@example.com',
				name: 'Test User'
			});
			expect(mockAuthHandler).toHaveBeenCalledTimes(3);

			// Step 4: Logout - clears session cookie
			mockAuthHandler.mockResolvedValueOnce(
				new Response('ok', {
					status: 200,
					headers: {
						'set-cookie': 'session=; Path=/; HttpOnly; Max-Age=0'
					}
				})
			);

			const logout = await app.inject({
				method: 'POST',
				url: '/api/auth/sign-out',
				headers: {
					cookie: 'session=test-session-id'
				}
			});

			expect(logout.statusCode).toBe(200);
			expect(logout.headers['set-cookie']).toContain('Max-Age=0');
			expect(mockAuthHandler).toHaveBeenCalledTimes(4);

			// Step 5: Verify session is invalidated after logout
			mockAuthHandler.mockResolvedValueOnce(
				new Response(JSON.stringify({ user: null, session: null }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			);

			const getSessionAfterLogout = await app.inject({
				method: 'GET',
				url: '/api/auth/session',
				headers: {
					cookie: 'session=test-session-id'
				}
			});

			expect(getSessionAfterLogout.statusCode).toBe(200);
			const loggedOutSession = getSessionAfterLogout.json();
			expect(loggedOutSession.user).toBeNull();
			expect(loggedOutSession.session).toBeNull();
			expect(mockAuthHandler).toHaveBeenCalledTimes(5);
		});

		it('handles OIDC callback with missing code parameter', async () => {
			mockAuthHandler.mockResolvedValue(
				new Response(JSON.stringify({ error: 'missing_code' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				})
			);

			const app = await buildTestApp({ withRbac: false });
			await app.register(authRoutes);
			await app.ready();

			const callback = await app.inject({
				method: 'GET',
				url: '/api/auth/callback/oci-iam?state=state-abc'
				// Missing 'code' parameter
			});

			expect(callback.statusCode).toBe(400);
			expect(callback.json()).toEqual({ error: 'missing_code' });
		});

		it('handles session validation failure for expired cookie', async () => {
			mockAuthHandler.mockResolvedValue(
				new Response(JSON.stringify({ user: null, session: null }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			);

			const app = await buildTestApp({ withRbac: false });
			await app.register(authRoutes);
			await app.ready();

			const getSession = await app.inject({
				method: 'GET',
				url: '/api/auth/session',
				headers: {
					cookie: 'session=expired-or-invalid-session'
				}
			});

			expect(getSession.statusCode).toBe(200);
			const sessionData = getSession.json();
			expect(sessionData.user).toBeNull();
			expect(sessionData.session).toBeNull();
		});
	});
});
