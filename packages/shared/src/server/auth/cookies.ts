export type CookieSameSite = 'lax' | 'strict' | 'none';

const DEFAULT_COOKIE_SAME_SITE: CookieSameSite = 'lax';
const VALID_SAME_SITE_VALUES = new Set<CookieSameSite>(['lax', 'strict', 'none']);

function normalizeSameSite(value: string | undefined): CookieSameSite {
	if (!value) return DEFAULT_COOKIE_SAME_SITE;
	const normalized = value.trim().toLowerCase();
	if (VALID_SAME_SITE_VALUES.has(normalized as CookieSameSite)) {
		return normalized as CookieSameSite;
	}
	return DEFAULT_COOKIE_SAME_SITE;
}

export function getAuthUseSecureCookies(env: NodeJS.ProcessEnv = process.env): boolean {
	const isProduction = env.NODE_ENV === 'production';
	return env.BETTER_AUTH_COOKIE_SECURE === 'true' || isProduction;
}

export function getAuthCookieSameSite(env: NodeJS.ProcessEnv = process.env): CookieSameSite {
	const sameSite = normalizeSameSite(env.BETTER_AUTH_COOKIE_SAMESITE);
	const secure = getAuthUseSecureCookies(env);

	// Browsers require Secure when SameSite=None.
	if (sameSite === 'none' && !secure) {
		return DEFAULT_COOKIE_SAME_SITE;
	}

	return sameSite;
}

export function getAuthCookieAttributes(env: NodeJS.ProcessEnv = process.env) {
	return {
		httpOnly: true as const,
		secure: getAuthUseSecureCookies(env),
		sameSite: getAuthCookieSameSite(env),
		path: '/' as const
	};
}

// Static defaults for modules that initialize once at process start.
export const AUTH_USE_SECURE_COOKIES = getAuthUseSecureCookies();
export const AUTH_COOKIE_SAME_SITE = getAuthCookieSameSite();
export const AUTH_COOKIE_ATTRIBUTES = getAuthCookieAttributes();
