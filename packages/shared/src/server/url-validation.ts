/**
 * URL validation utilities with SSRF prevention.
 *
 * Provides validation for URLs that will be fetched by the server,
 * preventing Server-Side Request Forgery (SSRF) attacks by blocking
 * private IP ranges, loopback addresses, and cloud metadata endpoints.
 */

/** Check if a hostname is a private/reserved IPv4 address. */
function isPrivateIPv4(hostname: string): boolean {
	const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!ipMatch) return false;
	const [, a, b] = ipMatch.map(Number);
	if (a === 10) return true; // 10.0.0.0/8
	if (a === 127) return true; // 127.0.0.0/8
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
	if (a === 192 && b === 168) return true; // 192.168.0.0/16
	if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local)
	if (a === 0) return true; // 0.0.0.0
	return false;
}

/**
 * Validate a URL is safe to fetch (SSRF prevention).
 *
 * Blocks:
 * - Non-HTTPS URLs
 * - Private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x)
 * - Loopback (localhost, [::1])
 * - Link-local (169.254.x — cloud metadata)
 * - Internal hostnames (*.internal)
 * - Zero address (0.0.0.0)
 *
 * Use this before fetching any user-supplied URL to prevent SSRF attacks.
 *
 * @param url - The URL to validate
 * @returns true if the URL is safe to fetch, false otherwise
 */
export function isValidExternalUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	// Require HTTPS
	if (parsed.protocol !== 'https:') {
		return false;
	}

	const hostname = parsed.hostname.toLowerCase();

	// Block localhost and loopback
	if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') {
		return false;
	}

	// Block internal hostnames
	if (hostname.endsWith('.internal')) {
		return false;
	}

	// Block IPv6 private/link-local/mapped ranges (S-4)
	if (hostname.startsWith('[')) {
		const ipv6 = hostname.slice(1, -1).toLowerCase();
		// ULA (fc00::/7)
		if (ipv6.startsWith('fc') || ipv6.startsWith('fd')) return false;
		// Link-local (fe80::/10)
		if (ipv6.startsWith('fe80')) return false;
		// Loopback (::1)
		if (ipv6 === '::1') return false;
		// IPv4-mapped (::ffff:x.x.x.x) — extract and check IPv4 below
		if (ipv6.startsWith('::ffff:')) {
			const mapped = ipv6.slice(7);
			if (isPrivateIPv4(mapped)) return false;
		}
	}

	// Block private IPv4 ranges
	if (isPrivateIPv4(hostname)) return false;

	return true;
}
