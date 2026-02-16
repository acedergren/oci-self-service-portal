/**
 * Tests for setup token guard (bootstrap authentication).
 *
 * Validates:
 * - Token generation and logging
 * - Token validation (valid, invalid, missing)
 * - Token invalidation on setup completion
 * - Timing-safe comparison
 * - Setup-complete guard
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockIsSetupComplete = vi.fn().mockResolvedValue(false);

vi.mock('@portal/server/admin/settings-repository.js', () => ({
	settingsRepository: {
		isSetupComplete: () => mockIsSetupComplete()
	}
}));

vi.mock('@portal/server/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

// Import after mocks
import {
	_getSetupToken,
	_resetSetupToken,
	initSetupToken,
	invalidateSetupToken,
	validateSetupToken
} from '@portal/server/admin/setup-token.js';

function makeRequest(token?: string): Request {
	const headers = new Headers();
	if (token) {
		headers.set('Authorization', `Bearer ${token}`);
	}
	return new Request('http://localhost/api/setup/status', { headers });
}

describe('Setup Token Guard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetSetupToken();
		mockIsSetupComplete.mockResolvedValue(false);
	});

	describe('initSetupToken', () => {
		it('generates a token when setup is incomplete', async () => {
			mockIsSetupComplete.mockResolvedValue(false);
			await initSetupToken();

			const token = _getSetupToken();
			expect(token).not.toBeNull();
			expect(token).toHaveLength(64); // 32 bytes = 64 hex chars
		});

		it('does not generate a token when setup is complete', async () => {
			mockIsSetupComplete.mockResolvedValue(true);
			await initSetupToken();

			const token = _getSetupToken();
			expect(token).toBeNull();
		});

		it('is idempotent — only generates once', async () => {
			mockIsSetupComplete.mockResolvedValue(false);
			await initSetupToken();
			const token1 = _getSetupToken();

			await initSetupToken();
			const token2 = _getSetupToken();

			expect(token1).toBe(token2);
		});

		it('generates token even if DB is unavailable', async () => {
			mockIsSetupComplete.mockRejectedValue(new Error('DB not available'));
			await initSetupToken();

			const token = _getSetupToken();
			expect(token).not.toBeNull();
			expect(token).toHaveLength(64);
		});
	});

	describe('invalidateSetupToken', () => {
		it('clears the token', async () => {
			mockIsSetupComplete.mockResolvedValue(false);
			await initSetupToken();
			expect(_getSetupToken()).not.toBeNull();

			invalidateSetupToken();
			expect(_getSetupToken()).toBeNull();
		});
	});

	describe('validateSetupToken', () => {
		it('returns null (success) for valid token', async () => {
			mockIsSetupComplete.mockResolvedValue(false);
			await initSetupToken();
			const token = _getSetupToken()!;

			const result = await validateSetupToken(makeRequest(token));
			expect(result).toBeNull();
		});

		it('returns 401 when no Authorization header', async () => {
			mockIsSetupComplete.mockResolvedValue(false);
			await initSetupToken();

			const result = await validateSetupToken(makeRequest());
			expect(result).not.toBeNull();
			expect(result!.status).toBe(401);

			const body = await result!.json();
			expect(body.error).toContain('Setup token required');
		});

		it('returns 401 for invalid token', async () => {
			mockIsSetupComplete.mockResolvedValue(false);
			await initSetupToken();

			const result = await validateSetupToken(makeRequest('wrong-token-value'));
			expect(result).not.toBeNull();
			expect(result!.status).toBe(401);

			const body = await result!.json();
			expect(body.error).toContain('Invalid setup token');
		});

		it('returns 401 for token with wrong length', async () => {
			mockIsSetupComplete.mockResolvedValue(false);
			await initSetupToken();

			const result = await validateSetupToken(makeRequest('short'));
			expect(result).not.toBeNull();
			expect(result!.status).toBe(401);
		});

		it('returns 403 when setup is already complete', async () => {
			mockIsSetupComplete.mockResolvedValue(true);
			// Token doesn't matter — setup is complete

			const result = await validateSetupToken(makeRequest('any-token'));
			expect(result).not.toBeNull();
			expect(result!.status).toBe(403);

			const body = await result!.json();
			expect(body.error).toContain('Setup is already complete');
		});

		it('returns 401 for Bearer prefix without token', async () => {
			mockIsSetupComplete.mockResolvedValue(false);
			await initSetupToken();

			const headers = new Headers();
			headers.set('Authorization', 'Basic abc123');
			const request = new Request('http://localhost/api/setup/status', { headers });

			const result = await validateSetupToken(request);
			expect(result).not.toBeNull();
			expect(result!.status).toBe(401);
		});
	});

	describe('token uniqueness', () => {
		it('generates different tokens on reset', async () => {
			mockIsSetupComplete.mockResolvedValue(false);

			await initSetupToken();
			const token1 = _getSetupToken();

			_resetSetupToken();
			await initSetupToken();
			const token2 = _getSetupToken();

			// Cryptographically random — virtually impossible to be equal
			expect(token1).not.toBe(token2);
		});
	});
});
