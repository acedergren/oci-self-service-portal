/**
 * C-10: redirectTo preservation tests.
 *
 * Verifies the open-redirect sanitization logic that the login page uses:
 * - Relative paths starting with / are allowed
 * - Protocol-relative URLs (//evil.com) are rejected
 * - Absolute URLs (https://evil.com) are rejected
 * - Empty/missing redirectTo defaults to /
 */

import { describe, it, expect } from 'vitest';

/**
 * Sanitize redirectTo to prevent open-redirect attacks.
 * This is the same logic as in login/+page.svelte.
 */
function getCallbackURL(raw: string | null): string {
	if (!raw) return '/';
	if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
	return '/';
}

describe('redirectTo sanitization', () => {
	it('allows relative paths starting with /', () => {
		expect(getCallbackURL('/workflows/123')).toBe('/workflows/123');
	});

	it('allows paths with query strings', () => {
		expect(getCallbackURL('/admin?tab=settings')).toBe('/admin?tab=settings');
	});

	it('allows the root path', () => {
		expect(getCallbackURL('/')).toBe('/');
	});

	it('rejects protocol-relative URLs', () => {
		expect(getCallbackURL('//evil.com/steal')).toBe('/');
	});

	it('rejects absolute URLs', () => {
		expect(getCallbackURL('https://evil.com')).toBe('/');
	});

	it('rejects javascript: protocol', () => {
		expect(getCallbackURL('javascript:alert(1)')).toBe('/');
	});

	it('defaults to / when redirectTo is null', () => {
		expect(getCallbackURL(null)).toBe('/');
	});

	it('defaults to / when redirectTo is empty string', () => {
		expect(getCallbackURL('')).toBe('/');
	});

	it('rejects paths that do not start with /', () => {
		expect(getCallbackURL('admin/settings')).toBe('/');
	});
});
