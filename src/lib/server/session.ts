import type { Cookies } from '@sveltejs/kit';
import { v4 as uuidv4 } from 'uuid';
import { getRepository } from './db.js';
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
 *
 * Tries Oracle DB first; falls back to SQLite if unavailable.
 */
export async function getOrCreateSession(
	cookies: Cookies,
	options: { model: string; region: string; userId?: string }
): Promise<SessionContext> {
	const existingId = cookies.get(SESSION_COOKIE);

	// Try Oracle first
	try {
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
	} catch (err) {
		log.warn({ err }, 'Oracle session lookup failed, falling back to SQLite');
		return getOrCreateSessionFallback(cookies, options, existingId);
	}
}

/**
 * SQLite fallback for getOrCreateSession
 */
function getOrCreateSessionFallback(
	cookies: Cookies,
	options: { model: string; region: string },
	existingId: string | undefined
): SessionContext {
	const repository = getRepository();

	if (existingId) {
		const session = repository.getSession(existingId);
		if (session && session.status === 'active') {
			return { sessionId: existingId, isNew: false };
		}
	}

	const session = repository.createSession({
		id: uuidv4(),
		model: options.model,
		region: options.region,
		status: 'active'
	});

	cookies.set(SESSION_COOKIE, session.id, COOKIE_OPTIONS);
	return { sessionId: session.id, isNew: true };
}

/**
 * Start a new session, replacing any existing one.
 *
 * Tries Oracle DB first; falls back to SQLite if unavailable.
 */
export async function startNewSession(
	cookies: Cookies,
	options: { model: string; region: string; userId?: string }
): Promise<SessionContext> {
	const oldId = cookies.get(SESSION_COOKIE);

	try {
		// Mark old session as completed in Oracle
		if (oldId) {
			await sessionRepository.update(oldId, { status: 'completed' }).catch(() => {
				// Old session may not exist, that's fine
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
	} catch (err) {
		log.warn({ err }, 'Oracle session create failed, falling back to SQLite');
		return startNewSessionFallback(cookies, options, oldId);
	}
}

/**
 * SQLite fallback for startNewSession
 */
function startNewSessionFallback(
	cookies: Cookies,
	options: { model: string; region: string },
	oldId: string | undefined
): SessionContext {
	const repository = getRepository();

	if (oldId) {
		try {
			repository.updateSession(oldId, { status: 'completed' });
		} catch {
			// Old session may not exist, that's fine
		}
	}

	const session = repository.createSession({
		id: uuidv4(),
		model: options.model,
		region: options.region,
		status: 'active'
	});

	cookies.set(SESSION_COOKIE, session.id, COOKIE_OPTIONS);
	return { sessionId: session.id, isNew: true };
}

/**
 * Switch to a specific session (for "continue" functionality).
 *
 * Tries Oracle DB first; falls back to SQLite if unavailable.
 */
export async function switchToSession(
	cookies: Cookies,
	sessionId: string,
	userId?: string
): Promise<boolean> {
	try {
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
	} catch (err) {
		log.warn({ err }, 'Oracle session switch failed, falling back to SQLite');
		return switchToSessionFallback(cookies, sessionId, userId);
	}
}

/**
 * SQLite fallback for switchToSession
 */
function switchToSessionFallback(cookies: Cookies, sessionId: string, userId?: string): boolean {
	const repository = getRepository();
	const session = repository.getSession(sessionId);

	if (!session) {
		return false;
	}

	// Verify session ownership in fallback path (same as Oracle path)
	const sessionUserId = (session as Record<string, unknown>).userId as string | undefined;
	if (userId && sessionUserId && sessionUserId !== userId) {
		log.warn(
			{ sessionId, userId, ownerId: sessionUserId },
			'session ownership mismatch (fallback)'
		);
		return false;
	}

	if (session.status === 'completed') {
		repository.updateSession(sessionId, { status: 'active' });
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
