/**
 * Setup Token Guard — Bootstrap authentication for the setup wizard.
 *
 * Before the portal has any auth configured (no IDP, no users), we need
 * a way to protect setup endpoints from unauthorized access. This module
 * generates a one-time setup token on first boot and requires it as
 * Authorization: Bearer <token> on all /api/setup/* endpoints.
 *
 * The token is:
 * - Generated on server start when setup is incomplete
 * - Logged to stdout so the admin can copy it
 * - Stored only in memory (never persisted)
 * - Invalidated when setup completes (markSetupComplete)
 */
import { randomBytes } from 'crypto';
import { json } from '@sveltejs/kit';
import { createLogger } from '../logger.js';
import { settingsRepository } from './settings-repository.js';

const log = createLogger('setup-token');

let setupToken: string | null = null;
let tokenGenerated = false;

/**
 * Generate and log the setup token. Called once on server startup.
 * No-ops if setup is already complete or token was already generated.
 */
export async function initSetupToken(): Promise<void> {
	if (tokenGenerated) return;

	try {
		const isComplete = await settingsRepository.isSetupComplete();
		if (isComplete) {
			tokenGenerated = true;
			setupToken = null;
			return;
		}
	} catch {
		// DB not available yet — generate token anyway, it'll be validated per-request
	}

	setupToken = randomBytes(32).toString('hex');
	tokenGenerated = true;

	log.warn(
		{ tokenLength: setupToken.length },
		'Setup token generated. Use this token to access setup endpoints:'
	);
	// Log to stdout directly so it's visible even if log level filters warn
	console.log(`\n${'='.repeat(60)}`);
	console.log('PORTAL SETUP TOKEN (use as Authorization: Bearer <token>)');
	console.log(`\n  ${setupToken}\n`);
	console.log(`${'='.repeat(60)}\n`);
}

/**
 * Invalidate the setup token. Called when setup completes.
 */
export function invalidateSetupToken(): void {
	setupToken = null;
	log.info('setup token invalidated — setup endpoints are now locked');
}

/**
 * Get the current setup token (for testing only).
 * @internal
 */
export function _getSetupToken(): string | null {
	return setupToken;
}

/**
 * Reset state (for testing only).
 * @internal
 */
export function _resetSetupToken(): void {
	setupToken = null;
	tokenGenerated = false;
}

/**
 * Validate that a request has a valid setup token.
 * Returns a 401 Response if invalid, or null if valid.
 *
 * Usage in setup endpoints:
 * ```ts
 * const denied = await validateSetupToken(request);
 * if (denied) return denied;
 * ```
 */
export async function validateSetupToken(request: Request): Promise<Response | null> {
	// If setup is already complete, deny all setup requests
	try {
		const isComplete = await settingsRepository.isSetupComplete();
		if (isComplete) {
			return json({ error: 'Setup is already complete' }, { status: 403 });
		}
	} catch (err) {
		// DB unavailable — deny access since we can't verify setup state (S-7)
		log.error({ err }, 'Cannot verify setup state — denying setup request');
		return json({ error: 'Unable to verify setup state' }, { status: 503 });
	}

	// Ensure token has been generated
	if (!tokenGenerated) {
		await initSetupToken();
	}

	// No token generated means something is wrong
	if (!setupToken) {
		return json({ error: 'Setup token not available' }, { status: 503 });
	}

	// Extract Bearer token from Authorization header
	const authHeader = request.headers.get('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return json(
			{ error: 'Setup token required. Provide Authorization: Bearer <setup-token>' },
			{ status: 401 }
		);
	}

	const token = authHeader.slice(7);

	// Timing-safe comparison to prevent timing attacks
	if (token.length !== setupToken.length) {
		return json({ error: 'Invalid setup token' }, { status: 401 });
	}

	const tokenBuffer = Buffer.from(token);
	const setupTokenBuffer = Buffer.from(setupToken);

	const { timingSafeEqual } = await import('crypto');
	if (!timingSafeEqual(tokenBuffer, setupTokenBuffer)) {
		return json({ error: 'Invalid setup token' }, { status: 401 });
	}

	return null; // Valid — proceed
}
