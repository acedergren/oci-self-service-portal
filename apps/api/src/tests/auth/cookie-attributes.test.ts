/**
 * C-1: Cookie attribute compliance tests.
 *
 * Verifies that auth cookie defaults match the security spec:
 * - HttpOnly: true (prevents XSS cookie theft)
 * - Secure: true in production (HTTPS-only)
 * - SameSite: strict for session cookies (CSRF defense-in-depth)
 * - SameSite: lax for OAuth state cookie (required for OIDC redirect)
 * - Path: / (available to all routes)
 */

import { describe, it, expect } from 'vitest';
import {
	getAuthCookieAttributes,
	getAuthCookieSameSite,
	getAuthUseSecureCookies
} from '@portal/server/auth/cookies';

describe('getAuthCookieAttributes', () => {
	describe('SameSite', () => {
		it('defaults to strict when no env var is set', () => {
			const attrs = getAuthCookieAttributes({} as NodeJS.ProcessEnv);
			expect(attrs.sameSite).toBe('strict');
		});

		it('respects BETTER_AUTH_COOKIE_SAMESITE=lax override', () => {
			const attrs = getAuthCookieAttributes({
				BETTER_AUTH_COOKIE_SAMESITE: 'lax'
			} as NodeJS.ProcessEnv);
			expect(attrs.sameSite).toBe('lax');
		});

		it('falls back to strict for invalid SameSite values', () => {
			const attrs = getAuthCookieAttributes({
				BETTER_AUTH_COOKIE_SAMESITE: 'invalid'
			} as NodeJS.ProcessEnv);
			expect(attrs.sameSite).toBe('strict');
		});

		it('downgrades SameSite=none to strict when cookies are not secure', () => {
			const sameSite = getAuthCookieSameSite({
				BETTER_AUTH_COOKIE_SAMESITE: 'none',
				NODE_ENV: 'development'
			} as NodeJS.ProcessEnv);
			expect(sameSite).toBe('strict');
		});

		it('allows SameSite=none when cookies are secure', () => {
			const sameSite = getAuthCookieSameSite({
				BETTER_AUTH_COOKIE_SAMESITE: 'none',
				NODE_ENV: 'production'
			} as NodeJS.ProcessEnv);
			expect(sameSite).toBe('none');
		});
	});

	describe('HttpOnly', () => {
		it('is always true', () => {
			const attrs = getAuthCookieAttributes({} as NodeJS.ProcessEnv);
			expect(attrs.httpOnly).toBe(true);
		});
	});

	describe('Secure', () => {
		it('is true in production', () => {
			const secure = getAuthUseSecureCookies({
				NODE_ENV: 'production'
			} as NodeJS.ProcessEnv);
			expect(secure).toBe(true);
		});

		it('is false in development by default', () => {
			const secure = getAuthUseSecureCookies({
				NODE_ENV: 'development'
			} as NodeJS.ProcessEnv);
			expect(secure).toBe(false);
		});

		it('can be forced true via BETTER_AUTH_COOKIE_SECURE', () => {
			const secure = getAuthUseSecureCookies({
				NODE_ENV: 'development',
				BETTER_AUTH_COOKIE_SECURE: 'true'
			} as NodeJS.ProcessEnv);
			expect(secure).toBe(true);
		});
	});

	describe('Path', () => {
		it('is always /', () => {
			const attrs = getAuthCookieAttributes({} as NodeJS.ProcessEnv);
			expect(attrs.path).toBe('/');
		});
	});

	describe('Full attribute object', () => {
		it('returns production-safe defaults', () => {
			const attrs = getAuthCookieAttributes({
				NODE_ENV: 'production'
			} as NodeJS.ProcessEnv);
			expect(attrs).toEqual({
				httpOnly: true,
				secure: true,
				sameSite: 'strict',
				path: '/'
			});
		});
	});
});
