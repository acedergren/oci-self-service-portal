/**
 * URL validation utilities with SSRF prevention.
 *
 * Provides validation for URLs that will be fetched by the server,
 * preventing Server-Side Request Forgery (SSRF) attacks by blocking
 * private IP ranges, loopback addresses, and cloud metadata endpoints.
 */

import ipaddr from 'ipaddr.js';

function isBlockedIpLiteral(hostname: string): boolean {
	const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;

	// ipaddr.js handles IPv4 in decimal/octal/hex/shorthand forms.
	if (!ipaddr.isValid(bare)) return false;

	try {
		const parsed = ipaddr.parse(bare);
		const kind = parsed.kind();
		if (kind === 'ipv4') {
			const range = (parsed as ipaddr.IPv4).range();
			return range !== 'unicast';
		}
		const range = (parsed as ipaddr.IPv6).range();
		return range !== 'unicast';
	} catch {
		// If parsing throws, treat it as not-an-IP (hostname) and let other checks decide.
		return false;
	}
}

/**
 * Validate a URL is safe to fetch (SSRF prevention).
 */
export function isValidExternalUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	if (parsed.protocol !== 'https:') return false;

	const hostname = parsed.hostname.toLowerCase();

	// Block localhost and common loopback literals
	if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return false;

	// Block internal hostnames
	if (hostname.endsWith('.internal')) return false;

	// Block IPv6 unspecified address when bracketed
	if (hostname === '[::]' || hostname === '::') return false;

	// Block any non-global IP literal (covers private, loopback, link-local, etc)
	if (isBlockedIpLiteral(hostname)) return false;

	return true;
}
