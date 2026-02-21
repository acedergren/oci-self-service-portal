/**
 * C-9: Cache-Control security header tests.
 *
 * Verifies that addSecurityHeaders() in hooks.server.ts includes:
 * - Cache-Control: no-store, max-age=0
 * - Pragma: no-cache
 *
 * These headers prevent browsers and proxies from caching authenticated
 * page responses, which could leak user data via back-button or shared caches.
 *
 * Note: hooks.server.ts can't be imported directly in tests because it
 * depends on $app/environment (SvelteKit runtime). We verify via source
 * inspection instead.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const hooksSource = readFileSync(resolve(import.meta.dirname, '../../hooks.server.ts'), 'utf-8');

describe('Cache-Control headers (spec compliance)', () => {
	it('sets Cache-Control: no-store, max-age=0 in addSecurityHeaders', () => {
		expect(hooksSource).toContain("'Cache-Control'");
		expect(hooksSource).toContain('no-store, max-age=0');
	});

	it('sets Pragma: no-cache in addSecurityHeaders', () => {
		expect(hooksSource).toContain("'Pragma'");
		expect(hooksSource).toContain('no-cache');
	});

	it('sets HSTS in production only', () => {
		expect(hooksSource).toContain('Strict-Transport-Security');
		expect(hooksSource).toContain('max-age=31536000');
	});

	it('sets X-Content-Type-Options: nosniff', () => {
		expect(hooksSource).toContain('X-Content-Type-Options');
		expect(hooksSource).toContain('nosniff');
	});

	it('sets X-Frame-Options: DENY', () => {
		expect(hooksSource).toContain('X-Frame-Options');
		expect(hooksSource).toContain('DENY');
	});

	it('sets Cross-Origin-Opener-Policy: same-origin', () => {
		expect(hooksSource).toContain('Cross-Origin-Opener-Policy');
	});

	it('sets Permissions-Policy blocking sensitive APIs', () => {
		expect(hooksSource).toContain('Permissions-Policy');
		expect(hooksSource).toContain('camera=()');
		expect(hooksSource).toContain('microphone=()');
	});
});
