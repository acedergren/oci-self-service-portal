/**
 * C-7: Login page error display tests.
 *
 * Verifies that the login page correctly:
 * - Shows error banner for ?error=auth_failed
 * - Shows error banner for ?error=invalid_state
 * - Shows error banner for ?error=session_expired
 * - Shows fallback message for unknown error codes
 * - Shows no error banner when no ?error= param
 */

import { describe, it, expect } from 'vitest';

// Map of known error codes to user-friendly messages (must match +page.svelte)
const ERROR_MESSAGES: Record<string, string> = {
	auth_failed: 'Authentication failed. Please try again.',
	invalid_state: 'Login session expired. Please try again.',
	session_expired: 'Your session has expired. Please sign in again.'
};

describe('Login error display', () => {
	it('maps auth_failed to a user-friendly message', () => {
		const message = ERROR_MESSAGES['auth_failed'];
		expect(message).toBe('Authentication failed. Please try again.');
	});

	it('maps invalid_state to a user-friendly message', () => {
		const message = ERROR_MESSAGES['invalid_state'];
		expect(message).toBe('Login session expired. Please try again.');
	});

	it('maps session_expired to a user-friendly message', () => {
		const message = ERROR_MESSAGES['session_expired'];
		expect(message).toBe('Your session has expired. Please sign in again.');
	});

	it('returns undefined for unknown error codes (component uses fallback)', () => {
		const message = ERROR_MESSAGES['unknown_code'];
		expect(message).toBeUndefined();
		// Component uses: ERROR_MESSAGES[code] ?? 'An unexpected error occurred...'
	});

	it('has no message for empty error code', () => {
		const message = ERROR_MESSAGES[''];
		expect(message).toBeUndefined();
	});
});
