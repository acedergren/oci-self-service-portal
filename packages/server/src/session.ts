import type { Cookies } from '@sveltejs/kit';
import { createLogger } from './logger.js';
import { sessionRepository } from './oracle/repositories/session-repository.js';

const log = createLogger('session');

const SESSION_COOKIE = 'oci_chat_session';
const COOKIE_OPTIONS = {
	path: '/',
	httpOnly: true,
	secure: process.env.NODE_ENV === 'production',
	sameSite: 'lax' as const,
	maxAge: 60 * 60 * 24 * 30 // 30 days
};

export interface SessionContext {
	sessionId: string;
	isNew: boolean;
}

/**
 * Get or create a session from cookies.
 * Returns the session ID and whether it was newly created.
 */
export async function getOrCreateSession(
	cookies: Cookies,
	options: { model: string; region: string; userId?: string }
): Promise<SessionContext> {
	const existingId = cookies.get(SESSION_COOKIE);

	if (existingId) {
		const session = await sessionRepository.getById(existingId);
		if (session && session.status === 'active') {
			return { sessionId: existingId, isNew: false };
		}
	}

	const session = await sessionRepository.create({
		model: options.model,
		region: options.region,
		status: 'active',
		userId: options.userId
	});

	cookies.set(SESSION_COOKIE, session.id, COOKIE_OPTIONS);
	return { sessionId: session.id, isNew: true };
}

/**
 * Start a new session, replacing any existing one.
 */
export async function startNewSession(
	cookies: Cookies,
	options: { model: string; region: string; userId?: string }
): Promise<SessionContext> {
	const oldId = cookies.get(SESSION_COOKIE);

	// Mark old session as completed in Oracle
	if (oldId) {
		await sessionRepository.update(oldId, { status: 'completed' }).catch((err: unknown) => {
			log.debug({ sessionId: oldId, err }, 'could not mark old session as completed');
		});
	}

	const session = await sessionRepository.create({
		model: options.model,
		region: options.region,
		status: 'active',
		userId: options.userId
	});

	cookies.set(SESSION_COOKIE, session.id, COOKIE_OPTIONS);
	return { sessionId: session.id, isNew: true };
}

/**
 * Switch to a specific session (for "continue" functionality).
 */
export async function switchToSession(
	cookies: Cookies,
	sessionId: string,
	userId?: string
): Promise<boolean> {
	const session = await sessionRepository.getById(sessionId);

	if (!session) {
		return false;
	}

	// Verify the session belongs to the requesting user (prevent IDOR)
	if (userId && session.userId && session.userId !== userId) {
		log.warn({ sessionId, userId, ownerId: session.userId }, 'session ownership mismatch');
		return false;
	}

	if (session.status === 'completed') {
		await sessionRepository.update(sessionId, { status: 'active' });
	}

	cookies.set(SESSION_COOKIE, sessionId, COOKIE_OPTIONS);
	return true;
}

/**
 * Get current session ID from cookies (without creating).
 */
export function getCurrentSessionId(cookies: Cookies): string | undefined {
	return cookies.get(SESSION_COOKIE);
}
