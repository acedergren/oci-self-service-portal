/**
 * URL validation utilities with SSRF prevention.
 *
 * Provides validation for URLs that will be fetched by the server,
 * preventing Server-Side Request Forgery (SSRF) attacks by blocking
 * private IP ranges, loopback addresses, and cloud metadata endpoints.
 *
 * SECURITY: Includes DNS resolution to prevent DNS rebinding attacks where
 * a hostname initially resolves to a public IP but later changes to a private IP.
 */

import ipaddr from 'ipaddr.js';
import { promises as dns } from 'dns';

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
 *
 * This performs DNS resolution to prevent DNS rebinding attacks where a hostname
 * initially points to a public IP but later changes to point to a private IP.
 */
export async function isValidExternalUrl(url: string): Promise<boolean> {
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

	// DNS resolution check to prevent rebinding attacks
	// If hostname is not an IP literal, resolve it and check all resolved IPs
	if (!ipaddr.isValid(hostname.startsWith('[') ? hostname.slice(1, -1) : hostname)) {
		try {
			// Resolve both IPv4 and IPv6 addresses
			const addresses: string[] = [];

			try {
				const ipv4Addrs = await dns.resolve4(hostname);
				addresses.push(...ipv4Addrs);
			} catch {
				// IPv4 resolution failed or not available - continue to check IPv6
			}

			try {
				const ipv6Addrs = await dns.resolve6(hostname);
				addresses.push(...ipv6Addrs);
			} catch {
				// IPv6 resolution failed or not available
			}

			// If no addresses resolved at all, reject the URL
			if (addresses.length === 0) {
				return false;
			}

			// Check if ANY resolved IP is private/loopback/link-local
			for (const addr of addresses) {
				if (isBlockedIpLiteral(addr)) {
					return false; // Found a private/blocked IP - reject the entire URL
				}
			}
		} catch {
			// DNS resolution completely failed - reject for safety
			return false;
		}
	}

	return true;
}
